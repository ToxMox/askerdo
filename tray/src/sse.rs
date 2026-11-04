/* The server-sent-events reader.
 *
 * The board server writes exactly two shapes on this wire (hooks/board-server.mjs
 * sseSend and the beat timer): `event: <name>\ndata: <json>\n\n` and the
 * comment line `: beat\n\n`. This parser is deliberately a little wider than
 * that (several data lines concatenate with a newline, an unknown field is
 * skipped, a comment is dropped) because the wire format says so and being
 * strict here would buy nothing.
 *
 * A frame is complete at a blank line. Bytes are pushed in as the socket
 * hands them over, so a frame split across two TCP reads is one frame here.
 */
pub struct Frame {
    pub event: String,
    pub data: String,
}

#[derive(Default)]
pub struct Parser {
    buf: Vec<u8>,
}

/* A frame this client will never send a reply to must not be able to grow the
   buffer without end: 1 MiB is far past the largest alert frame the server
   can build (its every field capped in lib/notify.mjs) and past any change
   payload the board sends. */
const CAP: usize = 1024 * 1024;

impl Parser {
    pub fn push(&mut self, bytes: &[u8]) {
        self.buf.extend_from_slice(bytes);
        if self.buf.len() > CAP {
            /* keep the tail, so the next blank line resynchronises the stream
               rather than leaving the parser wedged for good */
            let drop = self.buf.len() - CAP;
            self.buf.drain(..drop);
        }
    }

    pub fn next(&mut self) -> Option<Frame> {
        let at = self.frame_end()?;
        let raw = String::from_utf8_lossy(&self.buf[..at.0]).into_owned();
        self.buf.drain(..at.1);
        let mut event = String::new();
        let mut data = String::new();
        for line in raw.split('\n') {
            let line = line.trim_end_matches('\r');
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            let (field, value) = match line.split_once(':') {
                Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
                None => (line, ""),
            };
            match field {
                "event" => event = value.to_string(),
                "data" => {
                    if !data.is_empty() {
                        data.push('\n');
                    }
                    data.push_str(value);
                }
                _ => {}
            }
        }
        Some(Frame { event, data })
    }

    /* (the length of the frame's own text, the length to consume) */
    fn frame_end(&self) -> Option<(usize, usize)> {
        let mut i = 0;
        while i < self.buf.len() {
            if self.buf[i] == b'\n' {
                if i + 1 < self.buf.len() && self.buf[i + 1] == b'\n' {
                    return Some((i, i + 2));
                }
                if i + 2 < self.buf.len() && self.buf[i + 1] == b'\r' && self.buf[i + 2] == b'\n' {
                    return Some((i, i + 3));
                }
            }
            i += 1;
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::Parser;

    #[test]
    fn reads_one_frame_split_across_reads() {
        let mut p = Parser::default();
        p.push(b"event: hello\ndata: {\"a\":");
        assert!(p.next().is_none());
        p.push(b"1}\n\n");
        let f = p.next().unwrap();
        assert_eq!(f.event, "hello");
        assert_eq!(f.data, "{\"a\":1}");
    }

    #[test]
    fn drops_the_keepalive_comment() {
        let mut p = Parser::default();
        p.push(b": beat\n\nevent: change\ndata: {}\n\n");
        let beat = p.next().unwrap();
        assert_eq!(beat.event, "");
        assert_eq!(beat.data, "");
        assert_eq!(p.next().unwrap().event, "change");
    }

    #[test]
    fn joins_several_data_lines() {
        let mut p = Parser::default();
        p.push(b"event: alert\ndata: one\ndata: two\n\n");
        assert_eq!(p.next().unwrap().data, "one\ntwo");
    }
}
