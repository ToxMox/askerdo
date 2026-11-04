/* The HTTP/1.1 client, hand-rolled over std::net::TcpStream.
 *
 * Everything on this wire is loopback, plaintext, and answered by ONE server
 * whose code is in the same repository: no TLS, no redirects, no cookies, no
 * compression, no connection reuse, no proxy. That is why there is no HTTP
 * crate here. What it does have to be right about is the two body framings
 * Node's http server actually uses: `Transfer-Encoding: chunked` for the
 * events stream (which has no length and never ends) and `Content-Length` for
 * everything with a body, plus the 204 that the ping answers with, which has
 * neither.
 *
 * The stream must not block the exe's own liveness rule, so BODY reads are
 * given a short socket timeout and a timed-out read is reported as Idle rather
 * than as an error: the caller decides what a quiet socket means by the clock
 * the protocol gives it (3 x beatMs), not by whatever the OS chose.
 *
 * THE HEAD IS READ ON THE CONNECT BUDGET, NOT THE BODY'S. The attach hands in
 * a 250 ms io timeout because that is the slice the stream wants between
 * liveness checks, and a server that took longer than 250 ms to write its
 * response head would fail the attach outright and drop the exe into
 * backoff plus ping. The head is a one-off, so it gets the connect timeout,
 * and the socket is put on the io timeout before the Response is handed back.
 */
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use crate::url::Url;

/* What one call for more body bytes found. Idle is a socket that simply had
   nothing to say inside the read timeout, which is the NORMAL state of an
   open event stream between beats. */
pub enum Pull {
    Bytes,
    Idle,
    Eof,
}

pub struct Response {
    pub status: u16,
    headers: Vec<(String, String)>,
    conn: Conn,
    body: Framing,
    done: bool,
}

enum Framing {
    /* Transfer-Encoding: chunked, with the size line pending or a count of
       bytes left in the current chunk */
    ChunkSize,
    ChunkData(u64),
    ChunkCrLf,
    Length(u64),
    /* no length and no chunking: the body is whatever arrives until EOF */
    ToEof,
}

impl Response {
    pub fn header(&self, name: &str) -> Option<&str> {
        let want = name.to_ascii_lowercase();
        self.headers
            .iter()
            .find(|(k, _)| *k == want)
            .map(|(_, v)| v.as_str())
    }

    /* Appends whatever body bytes are decodable right now. Never loops on the
       socket: one fill at most, so a caller can check its own clock and its
       own stop flag between calls. */
    pub fn read_body(&mut self, out: &mut Vec<u8>) -> io::Result<Pull> {
        if self.decode(out) > 0 {
            return Ok(Pull::Bytes);
        }
        if self.done {
            return Ok(Pull::Eof);
        }
        match self.conn.fill() {
            Ok(0) => Ok(Pull::Eof),
            Ok(_) => {
                if self.decode(out) > 0 {
                    Ok(Pull::Bytes)
                } else if self.done {
                    Ok(Pull::Eof)
                } else {
                    Ok(Pull::Idle)
                }
            }
            Err(e) if idle_error(&e) => Ok(Pull::Idle),
            Err(e) => Err(e),
        }
    }

    /* Reads the whole body, for the small answers (a 409's text, a ping's
       nothing). Bounded, because a body this client did not ask for must not
       be able to grow a buffer without end. */
    pub fn drain(&mut self, cap: usize) -> Vec<u8> {
        let mut out = Vec::new();
        loop {
            match self.read_body(&mut out) {
                Ok(Pull::Bytes) if out.len() < cap => continue,
                Ok(Pull::Idle) => break,
                _ => break,
            }
        }
        out.truncate(cap);
        out
    }

    fn decode(&mut self, out: &mut Vec<u8>) -> usize {
        let before = out.len();
        loop {
            match self.body {
                Framing::Length(0) => {
                    self.done = true;
                    break;
                }
                Framing::Length(left) => {
                    let have = self.conn.available();
                    if have == 0 {
                        break;
                    }
                    let take = std::cmp::min(have as u64, left) as usize;
                    self.conn.take(take, out);
                    self.body = Framing::Length(left - take as u64);
                }
                Framing::ToEof => {
                    let have = self.conn.available();
                    if have == 0 {
                        break;
                    }
                    self.conn.take(have, out);
                }
                Framing::ChunkSize => {
                    let Some(line) = self.conn.take_line() else { break };
                    /* a chunk extension after a semicolon is legal and this
                       server never sends one, but ignoring it is one split */
                    let head = line.split(';').next().unwrap_or("").trim();
                    match u64::from_str_radix(head, 16) {
                        Ok(0) => {
                            self.done = true;
                            break;
                        }
                        Ok(n) => self.body = Framing::ChunkData(n),
                        Err(_) => {
                            self.done = true;
                            break;
                        }
                    }
                }
                Framing::ChunkData(0) => self.body = Framing::ChunkCrLf,
                Framing::ChunkData(left) => {
                    let have = self.conn.available();
                    if have == 0 {
                        break;
                    }
                    let take = std::cmp::min(have as u64, left) as usize;
                    self.conn.take(take, out);
                    self.body = Framing::ChunkData(left - take as u64);
                }
                Framing::ChunkCrLf => {
                    if self.conn.take_line().is_none() {
                        break;
                    }
                    self.body = Framing::ChunkSize;
                }
            }
        }
        out.len() - before
    }
}

pub struct Request<'a> {
    pub method: &'a str,
    pub url: &'a Url,
    pub headers: &'a [(&'a str, String)],
    pub body: Option<&'a [u8]>,
    pub connect_timeout: Duration,
    pub io_timeout: Duration,
}

pub fn send(req: Request) -> io::Result<Response> {
    let addr = req
        .url
        .authority()
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no address"))?;
    let stream = TcpStream::connect_timeout(&addr, req.connect_timeout)?;
    /* the request and the response head both ride the connect budget */
    stream.set_read_timeout(Some(req.connect_timeout))?;
    stream.set_write_timeout(Some(req.connect_timeout))?;
    /* a frame the reader is waiting on must not sit in a Nagle buffer */
    let _ = stream.set_nodelay(true);

    let mut head = String::with_capacity(256);
    head.push_str(req.method);
    head.push(' ');
    head.push_str(&req.url.path);
    head.push_str(" HTTP/1.1\r\nHost: ");
    head.push_str(&req.url.authority());
    head.push_str("\r\n");
    for (name, value) in req.headers {
        head.push_str(name);
        head.push_str(": ");
        head.push_str(value);
        head.push_str("\r\n");
    }
    if let Some(body) = req.body {
        head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    head.push_str("\r\n");

    let mut conn = Conn::new(stream);
    conn.stream.write_all(head.as_bytes())?;
    if let Some(body) = req.body {
        conn.stream.write_all(body)?;
    }
    conn.stream.flush()?;

    /* The head, up to the blank line, on the connect timeout set above. A
       server that sends no head inside THAT budget is a failure, not an idle:
       only a BODY is allowed to be quiet on this wire. */
    loop {
        if conn.head_end().is_some() {
            break;
        }
        match conn.fill() {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "the connection closed before the response head",
                ));
            }
            Ok(_) => {}
            Err(e) => return Err(e),
        }
    }
    let head_len = conn.head_end().unwrap();
    let raw = String::from_utf8_lossy(&conn.buf[conn.start..conn.start + head_len]).into_owned();
    conn.start += head_len;

    let mut lines = raw.split("\r\n");
    let status_line = lines.next().unwrap_or("");
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "no status line"))?;
    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
        }
    }

    let chunked = headers
        .iter()
        .any(|(k, v)| k == "transfer-encoding" && v.to_ascii_lowercase().contains("chunked"));
    let length = headers
        .iter()
        .find(|(k, _)| k == "content-length")
        .and_then(|(_, v)| v.trim().parse::<u64>().ok());
    /* 204 and 304 carry no body whatever their headers claim */
    let empty = status == 204 || status == 304 || (100..200).contains(&status);
    let body = if empty {
        Framing::Length(0)
    } else if chunked {
        Framing::ChunkSize
    } else {
        match length {
            Some(n) => Framing::Length(n),
            None => Framing::ToEof,
        }
    };

    /* the head is in: from here the body's own budget applies, which for the
       events stream is the short slice its liveness clock is checked on */
    conn.stream.set_read_timeout(Some(req.io_timeout))?;
    conn.stream.set_write_timeout(Some(req.io_timeout))?;

    Ok(Response { status, headers, conn, body, done: false })
}

/* ---- the socket buffer ------------------------------------------------- */

struct Conn {
    stream: TcpStream,
    buf: Vec<u8>,
    start: usize,
    end: usize,
}

/* 64 KiB is far more than one SSE frame and far less than anything worth
   worrying about: the working set target is single-digit MB. */
const BUF: usize = 64 * 1024;

impl Conn {
    fn new(stream: TcpStream) -> Conn {
        Conn { stream, buf: vec![0u8; BUF], start: 0, end: 0 }
    }

    fn available(&self) -> usize {
        self.end - self.start
    }

    fn take(&mut self, n: usize, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.buf[self.start..self.start + n]);
        self.start += n;
    }

    /* one line ending in \n, returned without its \r\n */
    fn take_line(&mut self) -> Option<String> {
        let at = self.buf[self.start..self.end].iter().position(|b| *b == b'\n')?;
        let line = String::from_utf8_lossy(&self.buf[self.start..self.start + at])
            .trim_end_matches('\r')
            .to_string();
        self.start += at + 1;
        Some(line)
    }

    /* the byte length of the response head including its blank line */
    fn head_end(&self) -> Option<usize> {
        let win = &self.buf[self.start..self.end];
        win.windows(4).position(|w| w == b"\r\n\r\n").map(|at| at + 4)
    }

    fn fill(&mut self) -> io::Result<usize> {
        if self.start > 0 {
            self.buf.copy_within(self.start..self.end, 0);
            self.end -= self.start;
            self.start = 0;
        }
        if self.end == self.buf.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "a response head or chunk header larger than the buffer",
            ));
        }
        let n = self.stream.read(&mut self.buf[self.end..])?;
        self.end += n;
        Ok(n)
    }
}

/* A read that simply timed out. Windows reports it as TimedOut and every
   other platform as WouldBlock; both mean the socket had nothing to say. */
fn idle_error(e: &io::Error) -> bool {
    matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut)
}
