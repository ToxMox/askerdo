/* The activity console's model, layout and drawing: activity lines grouped by day, newest first, one filter
 * over project, workstream, kind and name words, two lines per entry.
 *
 * Self-contained like popup.rs: examples/console_preview.rs includes this file
 * by path and renders it offscreen. The window, the feed and the clicks live
 * in console.rs.
 */
use std::collections::HashMap;

use serde_json::Value;
use windows_sys::Win32::Foundation::{RECT, SIZE};
use windows_sys::Win32::Graphics::Gdi::{
    CreateFontW, CreateSolidBrush, DT_END_ELLIPSIS, DT_LEFT, DT_NOPREFIX, DT_RIGHT, DT_SINGLELINE,
    DT_VCENTER, DeleteObject, DrawTextW, FillRect, GetTextExtentPoint32W, HDC, HFONT, SelectObject,
    SetBkMode, SetTextColor, TRANSPARENT,
};

/* logical pixels at 96 dpi, scaled at layout time */
pub const WIDTH: i32 = 520;
pub const HEIGHT: i32 = 640;
pub const HEAD_H: i32 = 48;
pub const EDIT_X: i32 = 64;
pub const EDIT_Y: i32 = 11;
pub const EDIT_H: i32 = 26;
const DAY_H: i32 = 30;
const ROW_H: i32 = 44;
const PAD_X: i32 = 16;
const STRIP: i32 = 3;
const BAR: i32 = 4;
const TITLE_PX: i32 = 14;
pub const SMALL_PX: i32 = 12;
const DOT: &str = " \u{00B7} ";

/* One activity line as the console shows it. */
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Entry {
    /* the log position (`<month>#<line>`), the dedupe key */
    pub at: String,
    pub ts: String,
    pub kind: String,
    pub verb: String,
    pub id: String,
    pub key: String,
    pub name: String,
    /* the project directory's last segment */
    pub project: String,
    pub ws: String,
    pub ws_name: String,
    /* the status it moved to, when it moved one */
    pub status: String,
    /* an override's act, worded from its changes; empty for every other line */
    pub word: String,
    /* an edit that moved the hand: "taken in hand", "taken over" or "let go" */
    pub hand: String,
}

/* One api/activity or stream row into an Entry; anything without a stamp, a
   kind and an id is not a line the console can show. */
pub fn entry_from(v: &Value) -> Option<Entry> {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    let ts = s("ts");
    if ts.len() < 16 || !ts.is_char_boundary(16) || s("kind").is_empty() || s("id").is_empty() {
        return None;
    }
    let project = s("project").replace('\\', "/");
    let status = v
        .get("changes")
        .and_then(|c| c.get("status"))
        .and_then(|p| p.get(1))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let word = if s("kind") == "override" && s("verb") == "override" {
        override_word(v.get("changes"))
    } else if s("verb") == "join" {
        join_word(v.get("changes"))
    } else {
        String::new()
    };
    let hand = if s("verb") == "edit" { hand_word(v.get("changes"), &status) } else { "" };
    let at = s("at");
    /* a thread's old lines read as the track it became */
    let kind = if s("kind") == "thread" { "track".to_string() } else { s("kind") };
    Some(Entry {
        at: if at.is_empty() { format!("{ts} {} {}", s("id"), s("verb")) } else { at },
        kind,
        verb: s("verb"),
        id: s("id"),
        key: s("key"),
        name: flat(&s("name")),
        project: project.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string(),
        ws: s("ws"),
        ws_name: String::new(),
        status,
        word,
        hand: hand.to_string(),
        ts,
    })
}

/* the feed's handWord: an edit's inHand move in the hand's words;
   a let-go an ending carries is no hand move, as work.mjs answers it */
fn hand_word(changes: Option<&Value>, status: &str) -> &'static str {
    let Some(pair) = changes.and_then(|c| c.get("inHand")).and_then(|p| p.as_array()) else {
        return "";
    };
    let held = |i: usize| pair.get(i).is_some_and(|x| x.as_str().is_some_and(|s| !s.is_empty()));
    match (held(0), held(1)) {
        (true, true) => "taken over",
        (false, true) => "taken in hand",
        (true, false) if status != "completed" && status != "dropped" => "let go",
        _ => "",
    }
}

/* the status a hand move brings with it, which its row leaves unsaid */
fn hand_status(hand: &str) -> &'static str {
    match hand {
        "taken in hand" | "taken over" => "in progress",
        "let go" => "open",
        _ => "",
    }
}

/* the feed's overrideWord (server/web/feed.mjs): the first of its changes that is set names the act */
fn override_word(changes: Option<&Value>) -> String {
    let now = |k: &str| {
        let v = changes?.get(k)?;
        let n = if v.is_array() { v.get(1)? } else { v };
        if n.is_null() { None } else { Some(n.clone()) }
    };
    if now("asked").is_some() {
        return "asked".into();
    }
    if let Some(d) = now("decided") {
        return if d.as_str() == Some("allow") { "allowed" } else { "kept as written" }.into();
    }
    if now("changed").is_some() {
        return "refused, changed since asked".into();
    }
    if now("dropped").is_some() {
        return "closed unanswered".into();
    }
    "changed".into()
}

/* a device's join names the PC whose code it used */
fn join_word(changes: Option<&Value>) -> String {
    let by = changes
        .and_then(|c| c.get("mintedBy"))
        .and_then(|p| p.get(1))
        .and_then(|x| x.as_str())
        .unwrap_or("");
    if by.is_empty() { "joined".into() } else { format!("joined, with a code from {by}") }
}

fn flat(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/* New lines into the held list: deduped by position, newest first, capped. */
pub fn merge(held: &mut Vec<Entry>, fresh: Vec<Entry>, names: &HashMap<String, String>, cap: usize) {
    for e in fresh {
        if !held.iter().any(|h| h.at == e.at) {
            held.push(e);
        }
    }
    for e in held.iter_mut() {
        if let Some(n) = names.get(&e.ws) {
            e.ws_name = n.clone();
        }
    }
    held.sort_by(|a, b| b.ts.cmp(&a.ts));
    held.truncate(cap);
}

/* the web feed's past tenses (server/web/feed.mjs VERB_WORDS), kept equal by hand */
fn verb_word(verb: &str) -> &str {
    match verb {
        "create" => "created",
        "update" => "updated",
        "edit" => "edited",
        "answer" => "answered",
        "amend" => "amended",
        "close" => "closed",
        "reopen" => "reopened",
        "note" => "noted",
        "drop" => "dropped",
        "snooze" => "snoozed",
        "wake" => "woke",
        "surface" => "surfaced",
        "subscribe" => "subscribed",
        "link" => "linked",
        "unlink" => "unlinked",
        "delete" => "deleted",
        "bind" => "bound",
        "handoff" => "handed off",
        "join" => "joined",
        /* a profile line's kind is profile, so its verb words only the act */
        "profile-define" => "defined",
        "profile-edit" => "edited",
        "profile-add" => "added",
        "profile-remove" => "removed",
        other => other,
    }
}

/* what happened: the kind, the verb or the hand, the status it moved to when that says more */
fn act(e: &Entry) -> String {
    let word = [e.hand.as_str(), e.word.as_str()].into_iter().find(|w| !w.is_empty()).unwrap_or(verb_word(&e.verb));
    let mut out = format!("{} {}", e.kind, word);
    let status = e.status.replace('_', " ");
    if !status.is_empty() && e.verb != "create" && !word.contains(status.as_str()) && status != hand_status(&e.hand) {
        out.push_str(", now ");
        out.push_str(&status);
    }
    out
}

/* the second line's words: what happened, how many lines it stands for, then where */
pub fn what(e: &Entry, count: u32) -> String {
    let mut out = act(e);
    if count > 1 {
        out.push_str(&format!(", {count} times"));
    }
    for part in [&e.project, if e.ws_name.is_empty() { &e.ws } else { &e.ws_name }] {
        if !part.is_empty() {
            out.push_str(DOT);
            out.push_str(part);
        }
    }
    out
}

/* a name that only repeats the id (a profile's) draws once */
pub fn title(e: &Entry) -> String {
    if e.name.is_empty() || e.name == e.id { e.id.clone() } else { format!("{} {}", e.id, e.name) }
}

/* Every word of the box must appear in the line's project, workstream, kind,
   verb, id or name, case aside. */
pub fn matches(e: &Entry, filter: &str) -> bool {
    let hay = [
        e.project.as_str(),
        e.ws.as_str(),
        e.ws_name.as_str(),
        e.kind.as_str(),
        e.verb.as_str(),
        verb_word(&e.verb),
        e.hand.as_str(),
        e.status.as_str(),
        e.id.as_str(),
        e.name.as_str(),
    ]
    .join(" ")
    .to_lowercase();
    filter.split_whitespace().all(|w| hay.contains(&w.to_lowercase()))
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Row {
    Day(String),
    /* an index into the held entries, and how many lines it stands for */
    Line(usize, u32),
}

/* a plain echo (no status) of the line that says what the record moved to */
fn echo(plain: &Entry, told: &Entry) -> bool {
    plain.status.is_empty() && !told.status.is_empty() && act(told).starts_with(&act(plain))
}

/* upkeep's status line after a hand move, the status that move brings */
fn follows(plain: &Entry, hand: &Entry) -> bool {
    plain.hand.is_empty() && !plain.status.is_empty() && plain.status.replace('_', " ") == hand_status(&hand.hand)
}

/* The held entries (newest first) through the filter, a day heading before each
   day's first line (`today` local, YYYY-MM-DD); one row per change, merged as the
   web feed merges, so the console and the feed read the same. */
pub fn rows(entries: &[Entry], filter: &str, today: &str) -> Vec<Row> {
    let mut kept: Vec<(usize, u32)> = Vec::new();
    let mut last: HashMap<String, usize> = HashMap::new();
    for (n, e) in entries.iter().enumerate() {
        if !matches(e, filter) {
            continue;
        }
        let rec = if e.key.is_empty() { &e.kind } else { &e.key };
        let k = format!("{rec}\n{}\n{}\n{}", e.id, e.verb, &e.ts[..16]);
        if let Some(&i) = last.get(&k).filter(|&&i| entries[kept[i].0].hand.is_empty() || e.hand.is_empty()) {
            let p = &entries[kept[i].0];
            if follows(e, p) {
                continue;
            }
            if follows(p, e) {
                kept[i] = (n, 1);
                continue;
            }
            if act(p) == act(e) {
                kept[i].1 += 1;
                continue;
            }
            if echo(e, p) {
                continue;
            }
            if echo(p, e) {
                kept[i] = (n, 1);
                continue;
            }
        }
        last.insert(k, kept.len());
        kept.push((n, 1));
    }
    let mut out = Vec::new();
    let mut day = "";
    for (n, count) in kept {
        let d = &entries[n].ts[..10];
        if d != day {
            day = d;
            out.push(Row::Day(day_label(d, today)));
        }
        out.push(Row::Line(n, count));
    }
    out
}

fn ymd(s: &str) -> Option<(i64, i64, i64)> {
    let mut it = s.splitn(3, '-').map(|p| p.parse::<i64>().ok());
    Some((it.next()??, it.next()??, it.next()??))
}

/* days since 1970-01-01, Howard Hinnant's civil algorithm */
fn days(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}

pub fn day_label(day: &str, today: &str) -> String {
    let (Some((y, m, d)), Some((ty, tm, td))) = (ymd(day), ymd(today)) else {
        return day.to_string();
    };
    let (n, t) = (days(y, m, d), days(ty, tm, td));
    if n == t {
        return "Today".into();
    }
    if n + 1 == t {
        return "Yesterday".into();
    }
    const WEEK: [&str; 7] = ["Thursday", "Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"];
    const MONTH: [&str; 12] = [
        "January", "February", "March", "April", "May", "June", "July", "August", "September",
        "October", "November", "December",
    ];
    let wd = WEEK[n.rem_euclid(7) as usize];
    let mon = MONTH[((m - 1).clamp(0, 11)) as usize];
    if y == ty { format!("{wd} {d} {mon}") } else { format!("{wd} {d} {mon} {y}") }
}

/* ---- layout and hit test ------------------------------------------------ */

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Rect {
    pub l: i32,
    pub t: i32,
    pub r: i32,
    pub b: i32,
}

impl Rect {
    pub fn has(&self, x: i32, y: i32) -> bool {
        x >= self.l && x < self.r && y >= self.t && y < self.b
    }
    fn win(&self) -> RECT {
        RECT {
            left: self.l,
            top: self.t,
            right: self.r,
            bottom: self.b,
        }
    }
}

#[derive(Clone, PartialEq, Debug, Default)]
pub struct Layout {
    pub scale: f32,
    pub width: i32,
    pub height: i32,
    /* the list's top edge, under the filter row */
    pub top: i32,
    /* the whole list's height and the clamped scroll into it */
    pub total: i32,
    pub scroll: i32,
    /* the rows on screen: (index into the rows, its rect) */
    pub items: Vec<(usize, Rect)>,
}

pub fn scale_of(dpi: u32) -> f32 {
    if dpi == 0 { 1.0 } else { dpi as f32 / 96.0 }
}

/* The rows on screen in a client area `width` by `height` device pixels,
   scrolled `scroll` pixels down (clamped to the list). */
pub fn layout(rows: &[Row], width: i32, height: i32, scroll: i32, dpi: u32) -> Layout {
    let s = scale_of(dpi);
    let px = |n: i32| (n as f32 * s).round() as i32;
    let top = px(HEAD_H);
    let h_of = |r: &Row| if matches!(r, Row::Day(_)) { px(DAY_H) } else { px(ROW_H) };
    let total: i32 = rows.iter().map(h_of).sum();
    let room = (height - top).max(0);
    let scroll = scroll.clamp(0, (total - room).max(0));
    let mut items = Vec::new();
    let mut y = top - scroll;
    for (n, r) in rows.iter().enumerate() {
        let h = h_of(r);
        if y + h > top && y < height {
            items.push((n, Rect { l: 0, t: y, r: width, b: y + h }));
        }
        y += h;
    }
    Layout { scale: s, width, height, top, total, scroll, items }
}

/* The entry under the pointer, as an index into the held entries. */
pub fn hit(l: &Layout, rows: &[Row], x: i32, y: i32) -> Option<usize> {
    if y < l.top {
        return None;
    }
    let (n, _) = l.items.iter().find(|(_, r)| r.has(x, y))?;
    match rows.get(*n)? {
        Row::Line(e, _) => Some(*e),
        Row::Day(_) => None,
    }
}

/* ---- drawing ------------------------------------------------------------ */

pub struct Palette {
    pub back: u32,
    pub head: u32,
    pub hover: u32,
    pub rule: u32,
    pub text: u32,
    pub muted: u32,
    pub accent: u32,
}

/* the popup's palette; the accent is the vivid sky blue family, never teal */
pub fn palette(light: bool) -> Palette {
    if light {
        Palette {
            back: 0xFFFFFF,
            head: 0xF6F5FA,
            hover: 0xF0EEF6,
            rule: 0xDAD6E4,
            text: 0x131321,
            muted: 0x5A6178,
            accent: 0x0096D6,
        }
    } else {
        Palette {
            back: 0x202031,
            head: 0x1A1A28,
            hover: 0x2A2A40,
            rule: 0x393E53,
            text: 0xFAF6FF,
            muted: 0xA8B3CB,
            accent: 0x26C3FF,
        }
    }
}

/* a record kind's strip colour, the popup's families */
pub fn kind_colour(kind: &str, light: bool) -> u32 {
    let (dark, lit) = match kind {
        "question" => (0x26C3FF, 0x0096D6),
        "workstream" | "plan" => (0x9B91FF, 0x7856CB),
        "task" => (0xFFB300, 0xE68A00),
        "track" | "handoff" => (0xFF62C4, 0xCE238E),
        _ => (0xA8B3CB, 0x5A6178),
    };
    if light { lit } else { dark }
}

/* GDI wants 0x00BBGGRR */
pub fn bgr(rgb: u32) -> u32 {
    ((rgb & 0xFF) << 16) | (rgb & 0xFF00) | ((rgb >> 16) & 0xFF)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/* # Safety: plain GDI object creation; the caller deletes the font. */
pub unsafe fn font(px: i32, weight: i32) -> HFONT {
    let name = wide("Segoe UI");
    unsafe { CreateFontW(-px, 0, 0, 0, weight, 0, 0, 0, 1, 0, 0, 5, 0, name.as_ptr()) }
}

unsafe fn fill(hdc: HDC, r: Rect, rgb: u32) {
    unsafe {
        let brush = CreateSolidBrush(bgr(rgb));
        FillRect(hdc, &r.win(), brush);
        DeleteObject(brush as _);
    }
}

unsafe fn text(hdc: HDC, s: &str, r: Rect, f: HFONT, rgb: u32, right: bool) {
    let w: Vec<u16> = s.encode_utf16().collect();
    let mut rc = r.win();
    let align = if right { DT_RIGHT } else { DT_LEFT };
    unsafe {
        let old = SelectObject(hdc, f as _);
        SetTextColor(hdc, bgr(rgb));
        DrawTextW(hdc, w.as_ptr(), w.len() as i32, &mut rc,
            align | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);
        SelectObject(hdc, old);
    }
}

unsafe fn width_in(hdc: HDC, s: &str, f: HFONT) -> i32 {
    let w: Vec<u16> = s.encode_utf16().collect();
    let mut size = SIZE { cx: 0, cy: 0 };
    unsafe {
        let old = SelectObject(hdc, f as _);
        GetTextExtentPoint32W(hdc, w.as_ptr(), w.len() as i32, &mut size);
        SelectObject(hdc, old);
    }
    size.cx
}

/* Draws the filter row's back and label and the list. `hot` is the entry under
   the pointer; `empty` is what an empty list says.
   # Safety: `hdc` is a live device context the caller owns. */
pub unsafe fn paint(hdc: HDC, entries: &[Entry], rows: &[Row], l: &Layout, light: bool, hot: Option<usize>, empty: &str) {
    let p = palette(light);
    let px = |n: i32| (n as f32 * l.scale).round() as i32;
    unsafe {
        SetBkMode(hdc, TRANSPARENT as _);
        fill(hdc, Rect { l: 0, t: 0, r: l.width, b: l.height }, p.back);
        let title_f = font(px(TITLE_PX), 600);
        let small = font(px(SMALL_PX), 400);
        let day_f = font(px(SMALL_PX), 700);
        let right = l.width - px(PAD_X) - px(BAR);
        for (n, r) in &l.items {
            match &rows[*n] {
                Row::Day(label) => {
                    let band = Rect { t: r.b - px(24), ..*r };
                    text(hdc, &label.to_uppercase(), Rect { l: px(PAD_X), r: right, ..band }, day_f, p.muted, false);
                    fill(hdc, Rect { l: px(PAD_X), t: r.b - 1, r: right, b: r.b }, p.rule);
                }
                Row::Line(e, count) => {
                    let Some(e) = entries.get(*e) else { continue };
                    if hot == Some(rows_entry(rows, *n)) {
                        fill(hdc, *r, p.hover);
                    }
                    let tint = kind_colour(&e.kind, light);
                    fill(hdc, Rect { l: px(PAD_X) - px(8), t: r.t + px(8), r: px(PAD_X) - px(8) + px(STRIP), b: r.b - px(8) }, tint);
                    let time = e.ts.get(11..16).unwrap_or("");
                    let tw = width_in(hdc, time, small) + px(8);
                    let line1 = Rect { l: px(PAD_X), t: r.t + px(5), r: right, b: r.t + px(24) };
                    text(hdc, time, line1, small, p.muted, true);
                    text(hdc, &title(e), Rect { r: right - tw, ..line1 }, title_f, p.text, false);
                    let line2 = Rect { l: px(PAD_X), t: r.t + px(23), r: right, b: r.t + px(40) };
                    text(hdc, &what(e, *count), line2, small, p.muted, false);
                }
            }
        }
        if l.items.is_empty() && !empty.is_empty() {
            let r = Rect { l: px(PAD_X), t: l.top + px(16), r: right, b: l.top + px(40) };
            text(hdc, empty, r, small, p.muted, false);
        }
        /* a slim scroll mark when the list is longer than the window */
        let room = l.height - l.top;
        if l.total > room && room > 0 {
            let th = (room as i64 * room as i64 / l.total as i64).max(px(24) as i64) as i32;
            let tt = l.top + ((room - th) as i64 * l.scroll as i64 / (l.total - room).max(1) as i64) as i32;
            fill(hdc, Rect { l: l.width - px(BAR) - px(2), t: tt, r: l.width - px(2), b: tt + th }, p.rule);
        }
        /* the filter row, drawn last so a scrolled row never shows above it */
        fill(hdc, Rect { l: 0, t: 0, r: l.width, b: l.top }, p.head);
        fill(hdc, Rect { l: 0, t: l.top - 1, r: l.width, b: l.top }, p.rule);
        let lab = Rect { l: px(PAD_X), t: px(EDIT_Y), r: px(EDIT_X) - px(6), b: px(EDIT_Y + EDIT_H) };
        text(hdc, "Filter", lab, small, p.muted, false);
        /* the box's accent frame; the EDIT control sits inside it */
        let f = Rect { l: px(EDIT_X) - 1, t: px(EDIT_Y) - 1, r: l.width - px(PAD_X) + 1, b: px(EDIT_Y + EDIT_H) + 1 };
        fill(hdc, f, p.accent);
        fill(hdc, Rect { l: f.l + 1, t: f.t + 1, r: f.r - 1, b: f.b - 1 }, p.back);
        for f in [title_f, small, day_f] {
            DeleteObject(f as _);
        }
    }
}

fn rows_entry(rows: &[Row], n: usize) -> usize {
    match rows[n] {
        Row::Line(e, _) => e,
        Row::Day(_) => usize::MAX,
    }
}

/* the EDIT control's rect inside the filter row, device pixels */
pub fn edit_rect(width: i32, dpi: u32) -> Rect {
    let s = scale_of(dpi);
    let px = |n: i32| (n as f32 * s).round() as i32;
    let inset = px(4);
    Rect {
        l: px(EDIT_X) + inset,
        t: px(EDIT_Y) + px(5),
        r: width - px(PAD_X) - inset,
        b: px(EDIT_Y + EDIT_H) - px(3),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(ts: &str, kind: &str, id: &str, name: &str, project: &str, ws: &str) -> Entry {
        let v: Value = serde_json::json!({
            "ts": ts, "verb": "create", "kind": kind, "id": id, "name": name,
            "project": project, "ws": ws, "at": format!("{ts}#{id}"),
        });
        entry_from(&v).unwrap()
    }

    fn sample() -> Vec<Entry> {
        let mut names = HashMap::new();
        names.insert("WS-11".to_string(), "the board".to_string());
        let mut held = Vec::new();
        merge(&mut held, vec![
            entry("2026-10-19T09:00:00-08:00", "task", "T-1", "old work", "C:\\Demo\\harbor", ""),
            entry("2026-10-21T16:36:29-08:00", "question", "Q508", "band chips", "C:\\Demo\\tidewatch", "WS-11"),
            entry("2026-10-20T08:00:00-08:00", "thread", "TH-4", "mod core", "C:/Demo/tidewatch/", "WS-11"),
        ], &names, 100);
        /* a line seen twice (a page and the stream) is one line */
        merge(&mut held, vec![entry("2026-10-21T16:36:29-08:00", "question", "Q508", "band chips", "", "")], &names, 100);
        held
    }

    #[test]
    fn lines_group_by_day_newest_first() {
        let held = sample();
        assert_eq!(held.len(), 3);
        let r = rows(&held, "", "2026-10-21");
        assert_eq!(r, vec![
            Row::Day("Today".into()), Row::Line(0, 1),
            Row::Day("Yesterday".into()), Row::Line(1, 1),
            Row::Day("Monday 19 October".into()), Row::Line(2, 1),
        ]);
        assert_eq!(day_label("2025-12-31", "2026-10-21"), "Wednesday 31 December 2025");
        assert_eq!(what(&held[0], 1), "question created \u{00B7} tidewatch \u{00B7} the board");
        /* one row per change, as the web feed folds them */
        let edit = |ts: &str, id: &str, status: &str, n: u32| {
            let mut v = serde_json::json!({ "ts": ts, "verb": "edit", "kind": "task", "id": id, "key": id, "at": format!("2026-10#{n}") });
            if !status.is_empty() {
                v["changes"] = serde_json::json!({ "status": ["open", status] });
            }
            entry_from(&v).unwrap()
        };
        let mut log = Vec::new();
        merge(&mut log, vec![
            edit("2026-10-28T21:14:50-08:00", "T-336", "", 9),
            edit("2026-10-28T21:14:30-08:00", "T-336", "", 8),
            edit("2026-10-28T21:14:10-08:00", "T-336", "", 7),
            edit("2026-10-28T21:12:40-08:00", "T-5", "", 6),
            edit("2026-10-28T21:12:20-08:00", "T-5", "in_progress", 5),
            edit("2026-10-28T21:11:40-08:00", "T-6", "completed", 4),
            edit("2026-10-28T21:11:20-08:00", "T-6", "in_progress", 3),
            edit("2026-10-28T21:09:59-08:00", "T-336", "", 2),
        ], &HashMap::new(), 100);
        let lines: Vec<(String, String, u32)> = rows(&log, "", "2026-10-28").iter()
            .filter_map(|r| if let Row::Line(n, c) = r { Some((log[*n].id.clone(), log[*n].status.clone(), *c)) } else { None })
            .collect();
        assert_eq!(lines, vec![
            ("T-336".into(), "".into(), 3),
            ("T-5".into(), "in_progress".into(), 1),
            ("T-6".into(), "completed".into(), 1),
            ("T-6".into(), "in_progress".into(), 1),
            ("T-336".into(), "".into(), 1),
        ], "repeats count, the echo folds into the move, two moves stay two, another minute is its own");
        assert!(what(&log[0], 3).contains("3 times"));
        /* an override's act is worded from its changes, as the feed does */
        let over = |changes: Value| {
            let v = serde_json::json!({ "ts": "2026-10-28T21:20:00-08:00", "verb": "override", "kind": "override", "id": "#3", "changes": changes });
            what(&entry_from(&v).unwrap(), 1)
        };
        assert!(over(serde_json::json!({ "decided": [null, "allow"] })).contains("allowed"));
        assert!(over(serde_json::json!({ "asked": [null, "K-7"] })).contains("asked"));
        assert!(!over(serde_json::json!({ "decided": [null, "keep"] })).contains("override override"));
        /* a join reads in words, naming the PC whose code it used */
        let join = serde_json::json!({ "ts": "2026-10-30T09:00:00-08:00", "verb": "join", "kind": "device", "id": "pc-two",
            "name": "pc-two", "changes": { "device": [null, "pc-two"], "mintedBy": [null, "home-pc"] } });
        let joined = what(&entry_from(&join).unwrap(), 1);
        assert!(joined.contains("joined") && joined.contains("home-pc") && !joined.contains("device join "), "{joined}");
        /* a profile's rows in words, its name once; the feed words them the same */
        let line = |verb: &str, id: &str, name: &str, changes: Value, n: u32| {
            let v = serde_json::json!({ "ts": "2026-10-29T10:06:00-08:00", "verb": verb, "kind": if verb == "edit" { "task" } else { "profile" },
                "id": id, "key": id, "name": name, "changes": changes, "at": format!("2026-10#{n}") });
            entry_from(&v).unwrap()
        };
        let define = line("profile-define", "look5-marks", "look5-marks", serde_json::json!({}), 1);
        let add = line("profile-add", "TR-4", "look5-marks", serde_json::json!({ "profile": "look5-marks" }), 2);
        for e in [&define, &add] {
            let words = format!("{} {}", title(e), what(e, 1));
            assert!(!words.contains("profile profile") && words.matches("look5-marks").count() == 1, "{words}");
        }
        assert!(title(&add).contains("TR-4"), "an add names the record it went on");
        /* a take, a take-over and a let-go in one minute stay three rows in the hand's words; upkeep's status lines fold in */
        let mut hands = Vec::new();
        merge(&mut hands, vec![
            line("edit", "T-81", "", serde_json::json!({ "status": ["in_progress", "open"] }), 15),
            line("edit", "T-81", "", serde_json::json!({ "inHand": ["s2", null] }), 14),
            line("edit", "T-81", "", serde_json::json!({ "inHand": ["s1", "s2"] }), 13),
            line("edit", "T-81", "", serde_json::json!({ "status": ["open", "in_progress"] }), 12),
            line("edit", "T-81", "", serde_json::json!({ "inHand": [null, "s1"] }), 11),
        ], &HashMap::new(), 100);
        let acts: Vec<String> = rows(&hands, "", "2026-10-29").iter()
            .filter_map(|r| if let Row::Line(n, c) = r { Some(format!("{} x{c}", act(&hands[*n]))) } else { None })
            .collect();
        assert_eq!(acts.len(), 3, "{acts:?}");
        for (row, word) in acts.iter().zip(["let go", "taken over", "taken in hand"]) {
            assert!(row.contains(word) && !row.contains("now") && row.ends_with("x1"), "{acts:?}");
        }
    }

    #[test]
    fn the_filter_matches_project_workstream_and_kind_words() {
        let held = sample();
        let ids = |f: &str| rows(&held, f, "2026-10-21").iter()
            .filter_map(|r| if let Row::Line(n, _) = r { Some(held[*n].id.clone()) } else { None })
            .collect::<Vec<_>>();
        assert_eq!(ids("harbor"), vec!["T-1"]);
        assert_eq!(ids("The Board"), vec!["Q508", "TH-4"], "by the workstream's name");
        assert_eq!(ids("track tidewatch"), vec!["TH-4"], "every word must match; a thread's old line reads track");
        assert!(ids("nothing-like-this").is_empty());
    }

    #[test]
    fn the_layout_clamps_its_scroll_and_hits_only_lines() {
        let held = sample();
        let r = rows(&held, "", "2026-10-21");
        let l = layout(&r, 520, 200, 10_000, 96);
        /* three days and three lines: 3 x 30 + 3 x 44 = 222, in 200 - 48 of room */
        assert_eq!((l.top, l.total, l.scroll), (48, 222, 70));
        let at = |n: usize| l.items.iter().find(|(i, _)| *i == n).map(|(_, r)| *r).unwrap();
        let line = at(5);
        assert_eq!(hit(&l, &r, 40, line.t + 2), Some(2));
        assert_eq!(hit(&l, &r, 40, at(4).t + 2), None, "a day heading opens nothing");
        assert_eq!(hit(&l, &r, 40, 10), None, "the filter row opens nothing");
        let big = layout(&r, 780, 300, 0, 144);
        assert_eq!(big.top, 72);
        assert_eq!(big.items.first().map(|(_, r)| r.t), Some(72));
    }
}
