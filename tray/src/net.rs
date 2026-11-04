/* The network thread: the events stream, the ping fallback, and the alerts.
 *
 * One thread, one socket at a time, no runtime. The shape is the protocol's,
 * and every number below is quoted from it rather than chosen here:
 *
 *   - attach to <events> with the tray header. 409 means a DIFFERENT server
 *     holds the port, and the exe stands down with exit 4.
 *   - while the stream is up, nothing else runs. A stream with no bytes at all
 *     for 3 x beatMs is treated as down (the server's own keepalive is what
 *     makes that a safe reading: an idle board still beats).
 *   - while the stream is down, POST <ping> every 10 s: a different instance
 *     is exit 4, two consecutive failures are exit 6 (the self-reap, with a
 *     code of its own because the server reads a 0 after an attach as the
 *     person choosing Exit), and the answer's dot header steers the icon. The
 *     blocking COUNT is NOT on that path, so the last known one stands in the
 *     tooltip while the dot says blocking.
 *   - reconnect backoff 1 s, 2 s, 5 s, then every 10 s, with the ping running
 *     between the attempts.
 *
 * The waits are slept in short slices rather than one long sleep, so a stdin
 * EOF or a menu exit takes the process down in a quarter second instead of
 * ten. That is a sleep loop, not a poll: nothing is asked of the network in
 * it.
 */
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::http::{self, Pull};
use crate::sse;
use crate::url;
use crate::{App, Card, Dot, EXIT_GONE, EXIT_INSTANCE, Recent, alert, opener, tray};

/* THE MENU'S CAP, applied AGAIN on arrival: the server counts to five and a
   server that sent more is not trusted to have counted. */
const CARDS_MAX: usize = 5;

/* The recent files' own cap and the index bound the f/ routes take: the server
   counting to five is not a reason for this process to trust a frame that said
   six, and an index outside the route's own shape names no ref. */
const RECENTS_MAX: usize = 5;
pub(crate) const INDEX_MAX: u64 = 9999;
/* the WIRE bound on a name, the server's own; the menu's display cut is forty
   and lives in tray.rs with the rest of the menu's words */
const CARD_NAME_MAX: usize = 120;
/* the pause answer is `{ ok, settings: {...} }`, a few hundred bytes; the cap is
   the same posture drain() takes everywhere, a body this client did not ask for
   must not grow a buffer without end */
const PAUSE_BODY_MAX: usize = 16 * 1024;

const PING_EVERY: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const PING_TIMEOUT: Duration = Duration::from_secs(5);
/* the socket read timeout on the stream: long enough not to spin, short
   enough that the liveness clock and the stop flag are checked often */
const SLICE: Duration = Duration::from_millis(250);
/* the server's own default (ASKERDO_BEAT_MS), used until a hello says otherwise */
const DEFAULT_BEAT_MS: u64 = 20_000;
const BACKOFF: [u64; 3] = [1, 2, 5];
const BACKOFF_AFTER: u64 = 10;
/* The whole body of a recent-menu click's POST, a const so a test can name it:
   the open route reads one key and the server resolves everything else. */
pub const OPEN_BODY: &str = "{\"kind\":\"open\"}";

pub fn run(app: Arc<App>, hwnd: isize) {
    let mut attempt = 0usize;
    let mut ping_fails = 0u32;
    let mut beat_ms = DEFAULT_BEAT_MS;
    let mut next_ping = Instant::now();

    loop {
        if app.stop.load(Ordering::SeqCst) {
            return;
        }
        match attach(&app) {
            Attach::Stream(resp) => {
                attempt = 0;
                ping_fails = 0;
                app.journal.line("stream attached");
                crate::console::attached(&app, hwnd);
                beat_ms = pump(&app, hwnd, resp, beat_ms);
                if app.stop.load(Ordering::SeqCst) {
                    return;
                }
                app.journal.line("stream lost");
                /* a stream that has just dropped gets one ping at once, which
                   is also what reaps the exe when the server is simply gone */
                next_ping = Instant::now();
            }
            Attach::Conflict => {
                app.quit(EXIT_INSTANCE, hwnd, "the events stream answered 409");
                return;
            }
            Attach::Failed(why) => {
                app.journal.line(&format!("stream attach failed: {why}"));
            }
        }

        let wait = Duration::from_secs(if attempt < BACKOFF.len() {
            BACKOFF[attempt]
        } else {
            BACKOFF_AFTER
        });
        attempt += 1;
        let until = Instant::now() + wait;
        loop {
            if app.stop.load(Ordering::SeqCst) {
                return;
            }
            if Instant::now() >= next_ping {
                next_ping = Instant::now() + PING_EVERY;
                match ping(&app) {
                    Ping::Dot(dot) => {
                        ping_fails = 0;
                        /* THE PING PATH CARRIES NONE OF THE MENU'S FIVE, so every
                           one of them is None and the last known values stand: a
                           long stream outage leaves the menu showing the last
                           state the stream told it, exactly as the tooltip does. */
                        apply(&app, hwnd, Some(dot), None, None, None, None, None, None, None);
                    }
                    Ping::Different => {
                        app.quit(EXIT_INSTANCE, hwnd, "the ping answered from another instance");
                        return;
                    }
                    Ping::Failed(why) => {
                        ping_fails += 1;
                        app.journal
                            .line(&format!("ping failed ({ping_fails}): {why}"));
                        if ping_fails >= 2 {
                            app.quit(EXIT_GONE, hwnd, "two ping failures: the server is gone");
                            return;
                        }
                    }
                }
            }
            let now = Instant::now();
            if now >= until {
                break;
            }
            std::thread::sleep(SLICE.min(until - now));
        }
    }
}

/* ---- the stream -------------------------------------------------------- */

enum Attach {
    Stream(http::Response),
    Conflict,
    Failed(String),
}

fn attach(app: &Arc<App>) -> Attach {
    let Some(target) = url::parse(&app.args.events) else {
        return Attach::Failed("the events URL will not parse".into());
    };
    /* the claim goes out under the current header name only; an older
       server ignores it, and the stream's and the ping's instance checks
       still catch a stranger on the port. */
    let headers = [
        ("Accept", "text/event-stream".to_string()),
        ("x-askerdo-tray", app.args.instance.clone()),
        /* this exe draws the popup, so the server may send `alert` */
        ("x-askerdo-popup", "1".to_string()),
        ("User-Agent", agent(app)),
    ];
    let req = http::Request {
        method: "GET",
        url: &target,
        headers: &headers,
        body: None,
        connect_timeout: CONNECT_TIMEOUT,
        io_timeout: SLICE,
    };
    match http::send(req) {
        Ok(mut resp) => match resp.status {
            200 => Attach::Stream(resp),
            409 => {
                let _ = resp.drain(512);
                Attach::Conflict
            }
            other => Attach::Failed(format!("the events route answered {other}")),
        },
        Err(e) => Attach::Failed(e.to_string()),
    }
}

/* Reads until the stream ends or goes quiet. Returns the beat cadence it
   learned, so the next attach starts with the server's number rather than
   with the default again. */
fn pump(app: &Arc<App>, hwnd: isize, mut resp: http::Response, mut beat_ms: u64) -> u64 {
    let mut parser = sse::Parser::default();
    let mut buf = Vec::new();
    let mut last = Instant::now();
    loop {
        if app.stop.load(Ordering::SeqCst) {
            return beat_ms;
        }
        buf.clear();
        let arrived = match resp.read_body(&mut buf) {
            Ok(Pull::Bytes) => {
                last = Instant::now();
                parser.push(&buf);
                last
            }
            Ok(Pull::Idle) => Instant::now(),
            Ok(Pull::Eof) => return beat_ms,
            Err(e) => {
                app.journal.line(&format!("stream read failed: {e}"));
                return beat_ms;
            }
        };
        while let Some(frame) = parser.next() {
            match event_of(&frame.event) {
                Event::State => {
                    if let Some(next) = state_frame(app, hwnd, &frame.data) {
                        beat_ms = next;
                    }
                }
                /* THE FRAME STAYS ON THIS THREAD: the message loop must
                   not wait on a shell call, and the opener initializes its own
                   apartment, so it needs no preparation here. */
                Event::Open => opener::apply(app, &frame.data),
                /* routed here, drawn on the message loop */
                Event::Alert => alert::take(app, hwnd, &frame.data, arrived),
                /* a settled question's cards leave; an older exe ignores the event */
                Event::Retract => alert::take_retract(app, hwnd, &frame.data),
                Event::Other => {}
            }
        }
        /* THE LIVENESS RULE. A beat is written to every open stream every
           beatMs, so three missed beats is a socket that is up as far as TCP
           is concerned and dead as far as the board is concerned. */
        if last.elapsed() > Duration::from_millis(beat_ms.saturating_mul(3)) {
            app.journal
                .line(&format!("no bytes for 3 x {beat_ms} ms: reconnecting"));
            return beat_ms;
        }
    }
}

/* THE DISPATCH AS A VALUE, so the table is read in a test rather than through a
   socket: a keepalive comment parses to an empty frame, and an event this exe
   does not know is somebody else's business. */
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Event {
    State,
    Open,
    Alert,
    Retract,
    Other,
}

pub(crate) fn event_of(name: &str) -> Event {
    match name {
        "hello" | "change" => Event::State,
        "open" => Event::Open,
        "alert" => Event::Alert,
        "retract" => Event::Retract,
        _ => Event::Other,
    }
}

/* A hello or a change. Only the additive `tray` object matters here; the rest
   of the payload is the board page's. Returns the beat cadence when the
   payload named one. */
pub(crate) fn state_frame(app: &Arc<App>, hwnd: isize, data: &str) -> Option<u64> {
    let value: Value = serde_json::from_str(data).ok()?;
    /* the console's live tail rides the same frame */
    crate::console::take(hwnd, &value);
    let tray = value.get("tray")?;
    if let Some(seen) = tray.get("instance").and_then(|v| v.as_str())
        && seen != app.args.instance
    {
        app.journal
            .line(&format!("the stream named another instance: {seen}"));
    }
    let dot = tray.get("dot").and_then(|v| v.as_str()).and_then(Dot::parse);
    let blocking = count_of(tray, "blocking");
    /* THE MENU'S FIVE, read off the same object and under the same rule:
       a field the frame did not carry is None, and None leaves the last known
       value standing. */
    let waiting = count_of(tray, "waiting");
    let cards = tray.get("questions").and_then(cards_of);
    let waiting_cards = tray.get("waitingQuestions").and_then(cards_of);
    let recent = tray.get("recent").and_then(recents_of);
    let paused = tray
        .get("pausedUntil")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let label = tray
        .get("pauseLabel")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    /* THE FIRST FRAME IS ITSELF A FACT, and the menu reads it: until one lands,
       the counts line has nothing but the spawn argv's blocking count and would
       otherwise print a `0 waiting` no server ever said. It is set here rather
       than in `apply` because `apply` is also the pause answer's way in, and a
       POST answering is not the stream speaking. */
    if let Ok(mut face) = app.face.lock() {
        face.told = true;
    }
    apply(
        app,
        hwnd,
        dot,
        blocking,
        waiting,
        cards,
        waiting_cards,
        recent,
        paused,
        label,
    );
    tray.get("beatMs")
        .and_then(|v| v.as_u64())
        .filter(|n| *n >= 1000)
}

fn count_of(tray: &Value, key: &str) -> Option<u32> {
    tray.get(key)
        .and_then(|v| v.as_u64())
        .map(|n| n.min(u32::MAX as u64) as u32)
}

/* THE QUESTION LINES, checked on arrival rather than at the click: the id
 * becomes a URL in the menu, so AN ENTRY WHOSE ID FAILS THE STORE'S OWN SHAPE
 * IS DROPPED, not shown and not opened. The cap and the name bound are applied
 * here too, because the server counting to five is not a reason for this
 * process to trust a frame that said six. A `questions` that is not an array is
 * None, which leaves the last known list standing rather than emptying the menu
 * on a malformed frame.
 *
 * THE SHAPE CHECK RUNS FIRST AND THE CAP AFTER IT, and the order is the whole
 * point: capping the raw list first would let five malformed entries and a good
 * sixth draw NOTHING, where the reader deserves the one line the frame actually
 * carried. The bound that matters is on what the menu will DRAW, and this loop
 * stops the moment it has five to draw, so a pathological list is still never
 * walked past what it costs to fill the menu.
 *
 * Both lists come through here: the blocking block and the waiting one are the
 * same shape under the same rules, so there is one reader and not two.
 */
fn cards_of(v: &Value) -> Option<Vec<Card>> {
    let list = v.as_array()?;
    let mut out = Vec::new();
    for entry in list.iter() {
        let Some(id) = entry.get("id").and_then(|x| x.as_str()) else {
            continue;
        };
        if !well_formed(id) {
            continue;
        }
        let name = entry.get("name").and_then(|x| x.as_str()).unwrap_or("");
        let key = entry.get("key").and_then(|x| x.as_str()).unwrap_or("");
        out.push(Card {
            id: id.to_string(),
            name: cut_chars(name, CARD_NAME_MAX),
            key: if well_formed_key(key) { key.to_string() } else { String::new() },
        });
        if out.len() == CARDS_MAX {
            break;
        }
    }
    Some(out)
}

/* `^Q\d+$`, spelled out rather than with a regex crate: the shape is four
   lines, not worth a dependency. */
fn well_formed(id: &str) -> bool {
    let mut chars = id.chars();
    if chars.next() != Some('Q') {
        return false;
    }
    let rest: Vec<char> = chars.collect();
    !rest.is_empty() && rest.iter().all(|c| c.is_ascii_digit())
}

/* a record key, eight of lowercase Crockford base32 (no i, l, o, u), the
   store's own KEY_RE spelled out; anything else is dropped to '' */
pub(crate) fn well_formed_key(key: &str) -> bool {
    key.len() == 8
        && key
            .bytes()
            .all(|b| b.is_ascii_digit() || (b.is_ascii_lowercase() && !b"ilou".contains(&b)))
}

fn digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/* THE RECENT LIST'S OWN SHAPE CHECK: a recent file can hang off a work record as
   well as a question, so all four of the store's id shapes pass here where the
   question lists take Q alone. */
pub(crate) fn well_formed_ref(id: &str) -> bool {
    /* a handoff (TR-n.m, or an old thread's TH-n.m) has files too: its
       verify-first repos */
    if let Some(rest) = id.strip_prefix("TR-").or_else(|| id.strip_prefix("TH-")) {
        return match rest.split_once('.') {
            Some((n, m)) => digits(n) && digits(m),
            None => digits(rest),
        };
    }
    for head in ["WS-", "P-", "T-", "K-"] {
        if let Some(rest) = id.strip_prefix(head) {
            return digits(rest);
        }
    }
    match id.strip_prefix('Q') {
        Some(rest) => digits(rest),
        None => false,
    }
}

/* THE RECENT FILES, checked on arrival as the question lines are: the id and the
   index become a menu URL, so a malformed entry is dropped rather than shown,
   and a `recent` that is not an array leaves the last list standing. */
fn recents_of(v: &Value) -> Option<Vec<Recent>> {
    let list = v.as_array()?;
    let mut out = Vec::new();
    for entry in list.iter() {
        let Some(id) = entry.get("id").and_then(|x| x.as_str()) else {
            continue;
        };
        if !well_formed_ref(id) {
            continue;
        }
        let Some(index) = entry.get("index").and_then(|x| x.as_u64()) else {
            continue;
        };
        if index > INDEX_MAX {
            continue;
        }
        let name = entry.get("name").and_then(|x| x.as_str()).unwrap_or("");
        out.push(Recent {
            id: id.to_string(),
            index: index as u32,
            name: cut_chars(name, CARD_NAME_MAX),
        });
        if out.len() == RECENTS_MAX {
            break;
        }
    }
    Some(out)
}

/* On CHARACTER boundaries, so a scalar is never split. No ellipsis: this is the
   wire bound, and the menu's own cut adds the dots. */
pub(crate) fn cut_chars(s: &str, n: usize) -> String {
    match s.char_indices().nth(n) {
        Some((at, _)) => s[..at].to_string(),
        None => s.to_string(),
    }
}

/* ---- the ping ---------------------------------------------------------- */

enum Ping {
    Dot(Dot),
    Different,
    Failed(String),
}

fn ping(app: &Arc<App>) -> Ping {
    let Some(target) = url::parse(&app.args.ping) else {
        return Ping::Failed("the ping URL will not parse".into());
    };
    let headers = [("User-Agent", agent(app))];
    let req = http::Request {
        method: "POST",
        url: &target,
        headers: &headers,
        body: Some(&[]),
        connect_timeout: CONNECT_TIMEOUT,
        io_timeout: PING_TIMEOUT,
    };
    let resp = match http::send(req) {
        Ok(r) => r,
        Err(e) => return Ping::Failed(e.to_string()),
    };
    if !(200..300).contains(&resp.status) {
        return Ping::Failed(format!("the ping answered {}", resp.status));
    }
    ping_answer(app, |name| resp.header(name))
}

/* the x-askerdo-* headers the local server sends on ping */
fn ping_answer<'a>(app: &Arc<App>, header: impl Fn(&str) -> Option<&'a str>) -> Ping {
    let read = |name: &str| header(&format!("x-askerdo-{name}"));
    /* the instance check comes FIRST: a squatter that took the port must not
       be able to steer the corner dot for even one tick */
    if let Some(seen) = read("instance")
        && seen != app.args.instance
    {
        return Ping::Different;
    }
    match read("dot").and_then(Dot::parse) {
        Some(dot) => Ping::Dot(dot),
        /* an answer from our own server with no readable dot is a live server
           and an unchanged icon, not a failure */
        None => Ping::Dot(app.face.lock().map(|f| f.dot).unwrap_or(Dot::Waiting)),
    }
}

/* ---- the pause the menu posts ------------------------------------ */

/* THE ONE PLACE THIS EXE WRITES ANYTHING ANYWHERE, and it writes it to the
 * board server rather than to a store: a POST of one verb to the NOTIFY route
 * the server handed over in `--notify`. It is not `--settings`: that flag is
 * the settings PAGE, and a POST to a page route is a 404 (measured).
 *
 * OFF THE MESSAGE LOOP. The menu is built and its command handled on the
 * message loop thread, inside the WM_RBUTTONUP handler, and a blocking connect
 * plus read there would hold the shell's own menu open on a network read. This
 * spawns a short-lived thread and returns at once: no CoInitializeEx, because
 * there is no COM on this path, and the same shape main.rs already uses for the
 * shortcut.
 *
 * NOTHING MORE IN http.rs: `ping` above already POSTs down this same client, and
 * all this adds is a body and a Content-Type. The budgets are the
 * ping's own.
 *
 * FAIL QUIET. On anything but a 2xx, and on any error at all: ONE journal line
 * and nothing else. No retry, no dialog, no balloon, because the stream's next
 * frame is the correction and the server guarantees there is one (its fan-out
 * takes a moved tray digest as a reason to send).
 */
pub fn pause(app: Arc<App>, hwnd: isize, token: &str) {
    /* `--notify` and NOT `--settings`: the settings page takes no POST at all
       (measured, a 404), so the verb goes to the api route beside it. */
    let Some(raw) = app.args.notify.clone() else {
        app.journal
            .line("menu pause: no --notify url, so there is nowhere to post it");
        return;
    };
    let token = token.to_string();
    std::thread::spawn(move || {
        app.journal.line(&format!(
            "menu chose pause {}",
            if token.is_empty() { "resume" } else { token.as_str() }
        ));
        let Some(target) = url::parse(&raw) else {
            app.journal.line("menu pause: the notify url will not parse");
            return;
        };
        let body = format!("{{\"pause\":\"{token}\"}}");
        let headers = [
            ("User-Agent", agent(&app)),
            ("Content-Type", "application/json".to_string()),
        ];
        let req = http::Request {
            method: "POST",
            url: &target,
            headers: &headers,
            body: Some(body.as_bytes()),
            connect_timeout: CONNECT_TIMEOUT,
            io_timeout: PING_TIMEOUT,
        };
        let mut resp = match http::send(req) {
            Ok(r) => r,
            Err(e) => {
                app.journal.line(&format!("menu pause failed: {e}"));
                return;
            }
        };
        if !(200..300).contains(&resp.status) {
            app.journal
                .line(&format!("menu pause answered {}", resp.status));
            return;
        }
        /* THE SERVER'S OWN WORD, never a local echo of what was clicked: the
           answer carries the settings as they now stand, so the next menu open
           is already right without waiting for the stream frame behind it. It
           goes in through apply, so the loop is woken exactly as a frame wakes
           it. */
        let raw_body = resp.drain(PAUSE_BODY_MAX);
        let Ok(value) = serde_json::from_slice::<Value>(&raw_body) else {
            app.journal.line("menu pause: the answer was not JSON");
            return;
        };
        let settings = value.get("settings");
        let paused = settings
            .and_then(|s| s.get("pausedUntil"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let label = settings
            .and_then(|s| s.get("pauseLabel"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        app.journal.line(&format!(
            "menu pause ok: {}",
            label.clone().unwrap_or_else(|| "-".into())
        ));
        apply(&app, hwnd, None, None, None, None, None, None, paused, label);
    });
}

/* THE RECENT FILES MENU'S CLICK, net::pause's exact shape.
 * TWO HOPS ON PURPOSE: the exe asks the board to open the ref by record id and
 * index, so it never holds a path it was not handed on a frame. */
pub fn open_ref(app: Arc<App>, url: &str) {
    let raw = url.to_string();
    std::thread::spawn(move || {
        let Some(target) = url::parse(&raw) else {
            app.journal.line("menu recent: the open url will not parse");
            return;
        };
        let body = OPEN_BODY;
        let headers = [
            ("User-Agent", agent(&app)),
            ("Content-Type", "application/json".to_string()),
        ];
        let req = http::Request {
            method: "POST",
            url: &target,
            headers: &headers,
            body: Some(body.as_bytes()),
            connect_timeout: CONNECT_TIMEOUT,
            io_timeout: PING_TIMEOUT,
        };
        match http::send(req) {
            Ok(resp) if (200..300).contains(&resp.status) => {}
            Ok(resp) => app
                .journal
                .line(&format!("menu recent answered {}", resp.status)),
            Err(e) => app.journal.line(&format!("menu recent failed: {e}")),
        }
    });
}

/* ---- the shared face --------------------------------------------------- */

/* The one place the network thread touches what the message loop draws. An
   absent count leaves the last known one standing, which is exactly what the
   ping path needs. */
#[allow(clippy::too_many_arguments)]
pub(crate) fn apply(
    app: &Arc<App>,
    hwnd: isize,
    dot: Option<Dot>,
    blocking: Option<u32>,
    waiting: Option<u32>,
    cards: Option<Vec<Card>>,
    waiting_cards: Option<Vec<Card>>,
    recent: Option<Vec<Recent>>,
    paused: Option<String>,
    pause_label: Option<String>,
) {
    let mut moved = false;
    if let Ok(mut face) = app.face.lock() {
        if let Some(dot) = dot
            && face.dot != dot
        {
            face.dot = dot;
            moved = true;
        }
        if let Some(count) = blocking
            && face.blocking != count
        {
            face.blocking = count;
            moved = true;
        }
        if let Some(count) = waiting
            && face.waiting != count
        {
            face.waiting = count;
            moved = true;
        }
        if let Some(list) = cards
            && face.cards != list
        {
            face.cards = list;
            moved = true;
        }
        if let Some(list) = waiting_cards
            && face.waiting_cards != list
        {
            face.waiting_cards = list;
            moved = true;
        }
        if let Some(list) = recent
            && face.recent != list
        {
            face.recent = list;
            moved = true;
        }
        if let Some(v) = paused
            && face.paused != v
        {
            face.paused = v;
            moved = true;
        }
        if let Some(v) = pause_label
            && face.pause_label != v
        {
            face.pause_label = v;
            moved = true;
        }
    }
    if moved {
        tray::post_update(hwnd);
    }
}

fn agent(app: &Arc<App>) -> String {
    format!("askerdo-tray/{}", app.args.version)
}

/* WHAT IS PINNED HERE is the READING of a frame's `tray` object and the rule that governs an
 * absent field, which are the two things the menu's whole staleness posture
 * rests on. `state_frame` and `apply` are pub(crate) for exactly this: the
 * frame reading is the seam, and there is no other way to reach it without a
 * socket.
 *
 * NO NETWORK, NO REGISTRY, NO WINDOW: the App is built here with a null hwnd
 * and a journal that was never opened, and post_update on a null window is what
 * the message loop already tolerates on every path.
 */
#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicI32};

    use super::{
        Event, OPEN_BODY, Ping, event_of, ping_answer, state_frame, well_formed, well_formed_ref,
    };
    use crate::journal::Journal;
    use crate::{App, Card, Dot, Face};
    use std::path::PathBuf;
    use std::sync::Arc;

    fn app() -> Arc<App> {
        Arc::new(App {
            args: crate::Args {
                board: "http://127.0.0.1:4321/s/".into(),
                events: "http://127.0.0.1:4321/s/api/events".into(),
                ping: "http://127.0.0.1:4321/s/ping".into(),
                instance: "inst01".into(),
                dot: Dot::Quiet,
                blocking: 0,
                version: "9.9.9".into(),
                icon: true,
                log: None::<PathBuf>,
                settings: None,
                lab: None,
                notify: None,
                add_pc: None,
            },
            face: Mutex::new(Face {
                dot: Dot::Quiet,
                blocking: 0,
                waiting: 0,
                cards: Vec::new(),
                waiting_cards: Vec::new(),
                recent: Vec::new(),
                paused: String::new(),
                pause_label: String::new(),
                told: false,
            }),
            journal: Journal::open(None),
            stop: AtomicBool::new(false),
            code: AtomicI32::new(0),
        })
    }

    fn read(app: &Arc<App>, json: &str) {
        state_frame(app, 0, json);
    }

    fn face(app: &Arc<App>) -> (u32, u32, Vec<Card>, String, String) {
        let f = app.face.lock().unwrap();
        (
            f.blocking,
            f.waiting,
            f.cards.clone(),
            f.paused.clone(),
            f.pause_label.clone(),
        )
    }

    /* the second card block, read on its own so the cases about it say so */
    fn waiting_ids(app: &Arc<App>) -> Vec<String> {
        app.face
            .lock()
            .unwrap()
            .waiting_cards
            .iter()
            .map(|c| c.id.clone())
            .collect()
    }

    /* the ping reads the x-askerdo-* headers: the dot from its own server, another instance as such */
    #[test]
    fn the_ping_reads_the_askerdo_headers() {
        let app = app();
        let answer = |pairs: &'static [(&'static str, &'static str)]| {
            ping_answer(&app, |name| {
                pairs.iter().find(|(k, _)| *k == name).map(|(_, v)| *v)
            })
        };
        assert!(matches!(
            answer(&[("x-askerdo-instance", "inst01"), ("x-askerdo-dot", "waiting")]),
            Ping::Dot(Dot::Waiting)
        ));
        assert!(matches!(answer(&[("x-askerdo-instance", "other")]), Ping::Different));
    }

    #[test]
    fn a_tray_object_carrying_the_four_new_fields_lands_whole() {
        let app = app();
        read(
            &app,
            r#"{"tray":{"instance":"inst01","dot":"blocking","blocking":3,"waiting":5,
               "questions":[{"id":"Q7","name":"one"},{"id":"Q112","name":"two"}],
               "pausedUntil":"until-resume","pauseLabel":"until I resume","beatMs":20000}}"#,
        );
        let (blocking, waiting, cards, paused, label) = face(&app);
        assert_eq!(blocking, 3);
        assert_eq!(waiting, 5);
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].id, "Q7");
        assert_eq!(cards[1].name, "two");
        assert_eq!(paused, "until-resume");
        assert_eq!(label, "until I resume");
        assert_eq!(app.face.lock().unwrap().dot, Dot::Blocking);
    }

    /* THE RULE THE WHOLE STALENESS POSTURE RESTS ON: an absent field leaves the
       last known value standing. The ping path carries NONE of these, so a long
       stream outage leaves the menu showing the last state the stream told it,
       exactly as the tooltip's count already does. */
    #[test]
    fn each_absent_field_leaves_the_last_known_value_standing() {
        let app = app();
        read(
            &app,
            r#"{"tray":{"dot":"blocking","blocking":3,"waiting":5,
               "questions":[{"id":"Q7","name":"one"}],
               "pausedUntil":"until-resume","pauseLabel":"until I resume"}}"#,
        );
        /* a frame with the tray object and nothing in it: every value stands */
        read(&app, r#"{"tray":{}}"#);
        let (blocking, waiting, cards, paused, label) = face(&app);
        assert_eq!((blocking, waiting), (3, 5));
        assert_eq!(cards.len(), 1);
        assert_eq!(paused, "until-resume");
        assert_eq!(label, "until I resume");

        /* one field at a time moves and the rest stand */
        read(&app, r#"{"tray":{"waiting":9}}"#);
        let (blocking, waiting, cards, _, label) = face(&app);
        assert_eq!((blocking, waiting), (3, 9));
        assert_eq!(cards.len(), 1);
        assert_eq!(label, "until I resume");

        /* the pause CLEARING is a present empty string, not an absent field:
           the server sends both fields on every frame, so a resume reaches the
           menu as two empty strings rather than as a silence */
        read(&app, r#"{"tray":{"pausedUntil":"","pauseLabel":""}}"#);
        let (_, _, _, paused, label) = face(&app);
        assert_eq!(paused, "");
        assert_eq!(label, "");
    }

    /* a well-formed key rides beside the label; any other is dropped to '' */
    #[test]
    fn a_question_carries_its_key_when_well_formed() {
        let app = app();
        read(
            &app,
            r#"{"tray":{"questions":[{"id":"Q7","name":"one","key":"k7m2q9xa"},
               {"id":"Q8","name":"two","key":"K7M2Q9XA"},{"id":"Q9","name":"three","key":"../etc/x"},
               {"id":"Q10","name":"four"}]}}"#,
        );
        let (_, _, cards, _, _) = face(&app);
        assert_eq!(
            cards.iter().map(|c| c.key.as_str()).collect::<Vec<_>>(),
            vec!["k7m2q9xa", "", "", ""]
        );
        assert!(!super::well_formed_key("k7m2q9xi"), "no i, l, o or u");
    }

    /* AN ENTRY WHOSE ID FAILS THE STORE'S OWN SHAPE IS DROPPED, not shown and
       not opened: the id becomes a URL, and nothing but one of the store's own
       shapes ever gets that far. */
    #[test]
    fn a_question_whose_id_is_not_a_q_number_is_dropped() {
        let app = app();
        read(
            &app,
            r#"{"tray":{"questions":[{"id":"Q7","name":"kept"},{"id":"T-3","name":"work"},
               {"id":"Q","name":"bare"},{"id":"../etc","name":"walk"},
               {"id":"Q9","name":"kept too"}]}}"#,
        );
        let (_, _, cards, _, _) = face(&app);
        assert_eq!(
            cards.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            vec!["Q7", "Q9"]
        );
        /* an entry with no id at all, and one whose id is not a string */
        read(
            &app,
            r#"{"tray":{"questions":[{"name":"no id"},{"id":7,"name":"a number"},
               {"id":"Q3","name":"kept"}]}}"#,
        );
        let (_, _, cards, _, _) = face(&app);
        assert_eq!(
            cards.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            vec!["Q3"]
        );
    }

    #[test]
    fn the_shape_check_is_a_q_and_at_least_one_digit() {
        for good in ["Q1", "Q0", "Q112", "Q999999"] {
            assert!(well_formed(good), "{good}");
        }
        for bad in ["", "Q", "q1", "Q1a", "1", "T-1", "Q 1", "Q-1", "Q1."] {
            assert!(!well_formed(bad), "{bad}");
        }
    }

    /* a file can hang off any record with a card, tracks and knowledge included */
    #[test]
    fn a_ref_id_is_any_record_with_a_card() {
        for good in ["Q1", "WS-11", "P-10", "T-307", "TR-6", "TR-6.1", "TH-3", "TH-3.2", "K-184"] {
            assert!(well_formed_ref(good), "{good}");
        }
        for bad in ["", "TR-", "TR-6.", "TH-", "TH-3.", "TH-.2", "TH-3.2.1", "K-", "K-1a", "X-1", "th-3"] {
            assert!(!well_formed_ref(bad), "{bad}");
        }
    }

    /* MORE THAN FIVE IS CAPPED ON ARRIVAL: a server that sent more is not
       trusted to have counted.
       THE SHAPE CHECK RUNS FIRST AND THE CAP AFTER IT: a frame carrying five
       malformed entries and a good sixth shows THE ONE LINE it actually
       carried, rather than nothing at all. The bound that matters is on what
       the menu will DRAW, and the loop stops the moment it has five to draw.
     */
    #[test]
    fn more_than_five_questions_are_capped_and_a_long_name_is_cut() {
        let app = app();
        let many: Vec<String> = (1..=8)
            .map(|n| format!(r#"{{"id":"Q{n}","name":"n{n}"}}"#))
            .collect();
        read(
            &app,
            &format!(r#"{{"tray":{{"questions":[{}]}}}}"#, many.join(",")),
        );
        let (_, _, cards, _, _) = face(&app);
        assert_eq!(cards.len(), 5);
        assert_eq!(cards[4].id, "Q5");

        /* THE CHECK BEFORE THE CAP, said out loud: five bad and a good sixth */
        read(
            &app,
            r#"{"tray":{"questions":[{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"},
               {"id":"e"},{"id":"Q6","name":"the one that was really there"}]}}"#,
        );
        let (_, _, cards, _, _) = face(&app);
        assert_eq!(
            cards.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            vec!["Q6"]
        );

        /* and the cap is still five WELL-FORMED ones, however much junk sits
           between them */
        read(
            &app,
            r#"{"tray":{"questions":[{"id":"x"},{"id":"Q1"},{"id":"y"},{"id":"Q2"},
               {"id":"z"},{"id":"Q3"},{"id":"Q4"},{"id":"Q5"},{"id":"Q6"},{"id":"Q7"}]}}"#,
        );
        let (_, _, cards, _, _) = face(&app);
        assert_eq!(
            cards.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            vec!["Q1", "Q2", "Q3", "Q4", "Q5"]
        );

        let long = "x".repeat(400);
        read(
            &app,
            &format!(r#"{{"tray":{{"questions":[{{"id":"Q1","name":"{long}"}}]}}}}"#),
        );
        let (_, _, cards, _, _) = face(&app);
        assert_eq!(cards[0].name.chars().count(), 120);
    }

    /* THE SECOND LIST, on the same object and through
       the same reader: the same shape check, the same cap, the same name bound,
       and the same absent-leaves-the-last-value rule. */
    #[test]
    fn the_waiting_list_rides_beside_the_blocking_one() {
        let app = app();
        read(
            &app,
            r#"{"tray":{"blocking":1,"waiting":3,
               "questions":[{"id":"Q1","name":"the blocker"}],
               "waitingQuestions":[{"id":"Q9","name":"newest"},{"id":"Q4","name":"older"}]}}"#,
        );
        let (_, _, cards, _, _) = face(&app);
        assert_eq!(cards.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), vec!["Q1"]);
        assert_eq!(waiting_ids(&app), vec!["Q9", "Q4"]);
        assert_eq!(
            app.face.lock().unwrap().waiting_cards[0].name,
            "newest",
            "the server's own order is kept: it sorted them newest first"
        );

        /* absent leaves it standing, and an empty array empties it */
        read(&app, r#"{"tray":{"waiting":3}}"#);
        assert_eq!(waiting_ids(&app), vec!["Q9", "Q4"]);
        read(&app, r#"{"tray":{"waitingQuestions":[]}}"#);
        assert!(waiting_ids(&app).is_empty());
        assert_eq!(
            face(&app).2.len(),
            1,
            "and the blocking list is untouched by any of it"
        );

        /* the cap, the shape check and the name bound, on this list too */
        let many: Vec<String> = (1..=8)
            .map(|n| format!(r#"{{"id":"Q{n}","name":"n{n}"}}"#))
            .collect();
        read(
            &app,
            &format!(
                r#"{{"tray":{{"waitingQuestions":[{{"id":"T-3"}},{}]}}}}"#,
                many.join(",")
            ),
        );
        assert_eq!(waiting_ids(&app), vec!["Q1", "Q2", "Q3", "Q4", "Q5"]);
        let long = "y".repeat(400);
        read(
            &app,
            &format!(r#"{{"tray":{{"waitingQuestions":[{{"id":"Q1","name":"{long}"}}]}}}}"#),
        );
        assert_eq!(
            app.face.lock().unwrap().waiting_cards[0].name.chars().count(),
            120
        );
    }

    /* THE FIRST FRAME IS ITSELF A FACT: until one lands the menu has only the
       spawn argv's blocking count, and its counts line says a neutral word
       rather than a `0 waiting` no server ever sent. */
    #[test]
    fn the_first_frame_is_what_turns_the_counts_line_on() {
        let app = app();
        assert!(!app.face.lock().unwrap().told, "nothing has been said yet");
        /* a frame that is not JSON, and one with no tray object, say nothing */
        read(&app, "not json at all");
        read(&app, r#"{"rev":"abc"}"#);
        assert!(!app.face.lock().unwrap().told);
        /* and an EMPTY tray object is the stream speaking: every value stands,
           and the menu may print its numbers */
        read(&app, r#"{"tray":{}}"#);
        assert!(app.face.lock().unwrap().told);
    }

    /* A `questions` THAT IS NOT AN ARRAY leaves the last known list standing
       rather than emptying the menu on a malformed frame, which is the same
       rule every other field here keeps. */
    #[test]
    fn a_malformed_questions_field_leaves_the_list_standing() {
        let app = app();
        read(&app, r#"{"tray":{"questions":[{"id":"Q7","name":"one"}]}}"#);
        for bad in [r#""nope""#, "3", "null", r#"{"id":"Q7"}"#] {
            read(&app, &format!(r#"{{"tray":{{"questions":{bad}}}}}"#));
            let (_, _, cards, _, _) = face(&app);
            assert_eq!(cards.len(), 1, "{bad}");
            assert_eq!(cards[0].id, "Q7");
        }
        /* an EMPTY array is not malformed: it is the board saying nothing
           blocks any more, and it empties the list */
        read(&app, r#"{"tray":{"questions":[]}}"#);
        let (_, _, cards, _, _) = face(&app);
        assert!(cards.is_empty());
    }

    /* ---- the recent files field ------------------------- */

    fn recent(app: &Arc<App>) -> Vec<(String, u32, String)> {
        app.face
            .lock()
            .unwrap()
            .recent
            .iter()
            .map(|r| (r.id.clone(), r.index, r.name.clone()))
            .collect()
    }

    /* THE TENTH FIELD, read off the same object under the same rules as the two
       question lists, and a work token is as good as a question one here. */
    #[test]
    fn a_recent_list_lands_whole_and_takes_every_store_id_shape() {
        let app = app();
        read(
            &app,
            r#"{"tray":{"recent":[{"id":"T-86","index":2,"name":"opener.rs"},
               {"id":"Q113","index":0,"name":"notes.md"},
               {"id":"WS-4","index":11,"name":"plan.md"},
               {"id":"P-3","index":0,"name":"p.md"}]}}"#,
        );
        assert_eq!(
            recent(&app),
            vec![
                ("T-86".to_string(), 2, "opener.rs".to_string()),
                ("Q113".to_string(), 0, "notes.md".to_string()),
                ("WS-4".to_string(), 11, "plan.md".to_string()),
                ("P-3".to_string(), 0, "p.md".to_string()),
            ]
        );
    }

    /* AN ENTRY THAT COULD NOT BECOME A URL IS DROPPED, not shown and not opened:
       the id and the index are what the click posts. */
    #[test]
    fn a_recent_entry_that_fails_the_stores_shapes_is_dropped() {
        let app = app();
        read(
            &app,
            r#"{"tray":{"recent":[{"id":"nope","index":0,"name":"a"},
               {"id":"T-","index":0,"name":"b"},
               {"id":"T-86","name":"c"},
               {"id":"T-86","index":-1,"name":"d"},
               {"id":"T-86","index":10000,"name":"e"},
               {"id":"T-86","index":3,"name":"f"}]}}"#,
        );
        assert_eq!(recent(&app), vec![("T-86".to_string(), 3, "f".to_string())]);
    }

    /* THE CAP AND THE NAME BOUND, applied again on arrival: the server counting
       to five is not a reason to trust a frame that said six. */
    #[test]
    fn more_than_five_recent_files_are_capped_and_a_long_name_is_cut() {
        let app = app();
        let long = "n".repeat(200);
        let rows: Vec<String> = (0..7)
            .map(|i| format!(r#"{{"id":"T-86","index":{i},"name":"{long}"}}"#))
            .collect();
        read(&app, &format!(r#"{{"tray":{{"recent":[{}]}}}}"#, rows.join(",")));
        let seen = recent(&app);
        assert_eq!(seen.len(), 5);
        assert_eq!(seen[0].2.chars().count(), 120);
    }

    /* THE SAME RULE AS EVERY OTHER FIELD: absent leaves the last list standing,
       and a `recent` that is not an array is absent. An EMPTY array is present
       and empties the block, which is what a swept file means. */
    #[test]
    fn an_absent_or_malformed_recent_leaves_the_last_list_standing() {
        let app = app();
        read(&app, r#"{"tray":{"recent":[{"id":"T-86","index":2,"name":"opener.rs"}]}}"#);
        read(&app, r#"{"tray":{"dot":"quiet"}}"#);
        assert_eq!(recent(&app).len(), 1);
        read(&app, r#"{"tray":{"recent":"not a list"}}"#);
        assert_eq!(recent(&app).len(), 1);
        read(&app, r#"{"tray":{"recent":[]}}"#);
        assert!(recent(&app).is_empty());
    }

    /* THE EVENT TABLE, read as a value: `open` is the arm, and a
       keepalive comment, an empty name and an unknown event are all somebody
       else's business. */
    #[test]
    fn the_open_arm_joins_the_dispatch_and_nothing_else_moves() {
        assert_eq!(event_of("open"), Event::Open);
        assert_eq!(event_of("hello"), Event::State);
        assert_eq!(event_of("change"), Event::State);
        assert_eq!(event_of("toast"), Event::Other);
        assert_eq!(event_of("alert"), Event::Alert);
        assert_eq!(event_of("retract"), Event::Retract);
        assert_eq!(event_of(""), Event::Other);
        assert_eq!(event_of("Open"), Event::Other);
        assert_eq!(event_of("whatever-comes-next"), Event::Other);
    }

    /* The recent-menu click's whole body, by value: the exe asks for a kind and
       the server resolves the ref, so a second key here would be a path this exe
       had no business holding. */
    #[test]
    fn the_recent_clicks_body_is_one_key() {
        assert_eq!(OPEN_BODY, "{\"kind\":\"open\"}");
        assert!(!OPEN_BODY.contains("path"));
    }
}
