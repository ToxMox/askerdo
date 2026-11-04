/* The popup's model, layout and drawing: a glyph per kind beside a label line with the alert's
 * age, what happened on up to two lines, the context in names, a question's
 * pick, then the links. Blockers do not auto-hide; the rest stack in a queue.
 *
 * Self-contained on purpose: examples/popup_preview.rs includes this file by
 * path and renders it offscreen, so nothing here names the crate, the App, the
 * network or the identity. The window and its clicks live in alert.rs.
 */
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{RECT, SIZE};
use windows_sys::Win32::Graphics::Gdi::{
    CreateFontW, CreatePen, CreateSolidBrush, DT_CENTER, DT_END_ELLIPSIS, DT_LEFT, DT_NOPREFIX,
    DT_SINGLELINE, DT_VCENTER, DeleteObject, DrawTextW, FillRect, GetTextExtentPoint32W, HDC,
    HFONT, LineTo, MoveToEx, PS_SOLID, SelectObject, SetBkMode, SetTextColor, TRANSPARENT,
};

/* three cards on screen at most; the rest wait behind a "+N more" line */
pub const MAX_VISIBLE: usize = 3;
/* a burst past this drops its oldest non-blocking alert rather than growing */
pub const QUEUE_MAX: usize = 20;
/* a non-blocking card leaves on its own this long after it was first drawn */
pub const AUTO_HIDE: Duration = Duration::from_secs(8);
pub const FILES_MAX: usize = 5;

/* logical pixels at 96 dpi, scaled at layout time */
pub const WIDTH: i32 = 380;
const PAD_T: i32 = 10;
const LABEL_H: i32 = 18;
const TITLE_LINE: i32 = 20;
const LINE_H: i32 = 18;
const ACTION_GAP: i32 = 6;
const ACTION_H: i32 = 20;
const PAD_B: i32 = 10;
const MORE_H: i32 = 28;
const STRIP: i32 = 4;
const TEXT_X: i32 = 60;
const TEXT_R: i32 = WIDTH - 16;
const CLOSE: i32 = 24;
/* font sizes, logical pixels */
const TITLE_PX: i32 = 15;
const SMALL_PX: i32 = 12;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Question,
    Blocker,
    Answer,
    Track,
    Handoff,
    Done,
    Dropped,
    Closed,
    Depth,
    Info,
}

impl Kind {
    /* lib/notify.mjs ALERT_KINDS, kept equal by hand; "thread" is the senders'
       old word for a track, read until they send "track" */
    pub fn parse(s: &str) -> Option<Kind> {
        Some(match s {
            "question" => Kind::Question,
            "blocker" => Kind::Blocker,
            "answer" => Kind::Answer,
            "track" | "thread" => Kind::Track,
            "handoff" => Kind::Handoff,
            "done" => Kind::Done,
            "dropped" => Kind::Dropped,
            "closed" => Kind::Closed,
            "depth" => Kind::Depth,
            "info" => Kind::Info,
            _ => return None,
        })
    }

    /* Segoe UI Symbol glyphs, escaped so the source stays ASCII */
    pub fn glyph(self) -> &'static str {
        match self {
            Kind::Question => "?",
            Kind::Blocker => "!",
            Kind::Answer => "\u{21A9}",
            Kind::Track => "\u{2261}",
            Kind::Handoff => "\u{21C4}",
            Kind::Done => "\u{2713}",
            Kind::Dropped => "\u{2715}",
            Kind::Closed => "\u{2691}",
            Kind::Depth => "\u{25D4}",
            Kind::Info => "i",
        }
    }

    /* the icon package's own colours (assets/icons/README.md), dark then light;
       Done and Closed read finished in a clean green, 5 to 1 on the light card */
    pub fn colour(self, light: bool) -> u32 {
        let (dark, lit) = match self {
            Kind::Question | Kind::Info => (0x39C9FF, 0x008AC7),
            Kind::Blocker | Kind::Depth => (0xFFB300, 0xE68A00),
            Kind::Answer | Kind::Track => (0x9B91FF, 0x7856CB),
            Kind::Handoff => (0xFF62C4, 0xCE238E),
            Kind::Done | Kind::Closed => (0x86EFAC, 0x15803D),
            Kind::Dropped => (0xA8B3CB, 0x5A6178),
        };
        if light { lit } else { dark }
    }

    /* the label line's words: what kind of news this is, before any detail */
    pub fn label(self) -> &'static str {
        match self {
            Kind::Question => "Question",
            Kind::Blocker => "Blocking question",
            Kind::Answer => "Answer",
            Kind::Track => "Track waiting",
            Kind::Handoff => "Handoff written",
            Kind::Done => "Done",
            Kind::Dropped => "Dropped",
            Kind::Closed => "Closed",
            Kind::Depth => "Depth mark reached",
            Kind::Info => "Notice",
        }
    }

    /* the one obvious action's words, for a card that names a record */
    pub fn verb(self) -> &'static str {
        match self {
            Kind::Question | Kind::Blocker => "Answer",
            Kind::Track | Kind::Handoff => "Open track",
            _ => "Open card",
        }
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct File {
    pub id: String,
    pub index: u32,
    pub name: String,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Alert {
    pub kind: Kind,
    pub title: String,
    /* the context line: the sender's names where given, else its `where` */
    pub place: String,
    /* a question's recommended option, by name; empty for none */
    pub pick: String,
    /* when the alert reached the tray, for the label line's age */
    pub arrived: Instant,
    pub blocking: bool,
    /* a URL under the board root, or empty for the board itself */
    pub card: String,
    /* the question the card is about, empty for none: a retract names it */
    pub question: String,
    pub files: Vec<File>,
    pub sound: String,
}

struct Item {
    key: u64,
    alert: Alert,
    shown: Option<Instant>,
}

#[derive(Default)]
pub struct Stack {
    items: Vec<Item>,
    next: u64,
    hover: bool,
}

impl Stack {
    /* A repeat of the same kind for the same card replaces the older one, so a
       chatty sender is one card. Returns what the cap pushed out. */
    pub fn push(&mut self, alert: Alert) -> Vec<Alert> {
        if !alert.card.is_empty()
            && let Some(at) = self
                .items
                .iter()
                .position(|i| i.alert.kind == alert.kind && i.alert.card == alert.card)
        {
            self.items.remove(at);
        }
        self.next += 1;
        self.items.push(Item {
            key: self.next,
            alert,
            shown: None,
        });
        let mut out = Vec::new();
        while self.items.len() > QUEUE_MAX {
            let at = self.items.iter().position(|i| !i.alert.blocking).unwrap_or(0);
            out.push(self.items.remove(at).alert);
        }
        out
    }

    /* Blockers claim the slots first, newest first, then everything else; drawn
       in arrival order, so the newest sits nearest the tray. */
    pub fn visible(&self) -> Vec<(u64, &Alert)> {
        let mut pick: Vec<usize> = Vec::new();
        for want in [true, false] {
            for (n, item) in self.items.iter().enumerate().rev() {
                if pick.len() == MAX_VISIBLE {
                    break;
                }
                if item.alert.blocking == want {
                    pick.push(n);
                }
            }
        }
        pick.sort_unstable();
        pick.iter()
            .map(|&n| (self.items[n].key, &self.items[n].alert))
            .collect()
    }

    pub fn hidden(&self) -> usize {
        self.items.len().saturating_sub(MAX_VISIBLE)
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn get(&self, key: u64) -> Option<&Alert> {
        self.items.iter().find(|i| i.key == key).map(|i| &i.alert)
    }

    pub fn dismiss(&mut self, key: u64) -> Option<Alert> {
        let at = self.items.iter().position(|i| i.key == key)?;
        Some(self.items.remove(at).alert)
    }

    /* A question settled elsewhere takes every card about it, blockers too;
       returns how many left. */
    pub fn retract(&mut self, question: &str) -> usize {
        let before = self.items.len();
        if !question.is_empty() {
            self.items.retain(|i| i.alert.question != question);
        }
        before - self.items.len()
    }

    /* the clock of a card starts when it is first drawn, not when it queued;
       the tests' shorthand for marking every visible card */
    #[cfg(test)]
    pub fn mark_shown(&mut self, now: Instant) {
        let keys: Vec<u64> = self.visible().iter().map(|(k, _)| *k).collect();
        self.mark_drawn(&keys, now);
    }

    /* the layout may draw fewer than visible() on a short screen, so the
       window marks the cards it laid out */
    pub fn mark_drawn(&mut self, keys: &[u64], now: Instant) {
        for item in self.items.iter_mut() {
            if item.shown.is_none() && keys.contains(&item.key) {
                item.shown = Some(now);
            }
        }
    }

    /* Hovering holds every card, and leaving gives the drawn ones their full
       time again, so a card is never pulled from under the pointer. */
    pub fn set_hover(&mut self, on: bool, now: Instant) {
        if self.hover && !on {
            for item in self.items.iter_mut() {
                if item.shown.is_some() {
                    item.shown = Some(now);
                }
            }
        }
        self.hover = on;
    }

    /* drops the drawn non-blocking cards whose time is up; true when any went */
    pub fn expire(&mut self, now: Instant) -> bool {
        if self.hover {
            return false;
        }
        let before = self.items.len();
        self.items.retain(|i| {
            i.alert.blocking || !matches!(i.shown, Some(at) if now.duration_since(at) >= AUTO_HIDE)
        });
        self.items.len() != before
    }

    /* a timer is wanted only while a drawn card can still leave on its own */
    pub fn needs_timer(&self) -> bool {
        self.visible().iter().any(|(_, a)| !a.blocking)
    }
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

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct CardBox {
    pub key: u64,
    pub card: Rect,
    pub glyph: Rect,
    pub label: Rect,
    /* one rect per line of what happened, one or two */
    pub title: Vec<Rect>,
    pub place: Option<Rect>,
    pub pick: Option<Rect>,
    pub action: Rect,
    pub files: Option<Rect>,
    pub close: Rect,
}

#[derive(Clone, PartialEq, Debug, Default)]
pub struct Layout {
    pub width: i32,
    pub height: i32,
    pub cards: Vec<CardBox>,
    pub more: Option<Rect>,
    /* the cards queued but not drawn, the "+N more" count */
    pub hidden: usize,
    pub scale: f32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Hit {
    Close(u64),
    Action(u64),
    Files(u64),
    Body(u64),
    More,
}

pub fn scale_of(dpi: u32) -> f32 {
    if dpi == 0 { 1.0 } else { dpi as f32 / 96.0 }
}

/* the desktop app's toast zone over its window's bottom edge, logical pixels: the
   tallest toast measured, three lines, has its top 131 and 132 above the window's
   bottom (at full scale and at half); the rest is rounding */
pub const APP_TOAST_ZONE: i32 = 136;

/* One top-level window of the desktop app (its exe and Electron's class). */
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct AppWin {
    pub rect: Rect,
    /* visible, and not cloaked onto another virtual desktop */
    pub shown: bool,
    pub minimized: bool,
    pub foreground: bool,
}

fn rect_words(r: &Rect) -> String {
    format!("{},{} {}x{}", r.l, r.t, r.r - r.l, r.b - r.t)
}

/* The stack's bottom right, device pixels, and why, for the journal: the work
   area's corner less the gap, or, while the largest shown and not minimized app
   window over that corner, foreground or not, lifts it above its toast zone. */
pub fn corner(work: Rect, gap: i32, wins: &[AppWin], zone: i32) -> (i32, i32, String) {
    let (x, y) = (work.r - gap, work.b - gap);
    let area = |w: &&AppWin| (w.rect.r - w.rect.l) as i64 * (w.rect.b - w.rect.t) as i64;
    let open = || wins.iter().filter(|w| w.shown && !w.minimized);
    if let Some(w) = open().filter(|w| w.rect.has(x - 1, y - 1)).max_by_key(area) {
        let side = if w.foreground { "the foreground" } else { "behind another window" };
        return (x, y.min(w.rect.b - zone - gap), format!("lifted over the app's window {} ({side})", rect_words(&w.rect)));
    }
    let why = match open().max_by_key(area) {
        Some(w) => format!("the app's window {} is off the corner", rect_words(&w.rect)),
        None if wins.iter().any(|w| w.minimized) => "the app is minimized".into(),
        None if wins.is_empty() => "no app window".into(),
        None => "the app's windows are hidden".into(),
    };
    (x, y, why)
}

/* What happened, as at most two lines at `width` device pixels: the first line
   breaks at a space (or mid-word for a word wider than the line), the second
   is the rest, which the painter ends with an ellipsis when it still overflows. */
pub fn wrap(text: &str, width: i32, measure: &dyn Fn(&str) -> i32) -> Vec<String> {
    let text = text.trim();
    if text.is_empty() || measure(text) <= width {
        return vec![text.to_string()];
    }
    let mut first = String::new();
    let mut used = 0;
    for (at, _) in text.match_indices(' ').chain(std::iter::once((text.len(), ""))) {
        if measure(&text[..at]) > width {
            break;
        }
        first = text[..at].to_string();
        used = at;
    }
    if first.is_empty() {
        /* one word wider than the line: cut it at the last char that fits */
        for (at, _) in text.char_indices().skip(1) {
            if measure(&text[..at]) > width {
                break;
            }
            used = at;
        }
        if used == 0 {
            used = text.chars().next().map(char::len_utf8).unwrap_or(text.len());
        }
        first = text[..used].to_string();
    }
    let rest = text[used..].trim();
    if rest.is_empty() { vec![first] } else { vec![first, rest.to_string()] }
}

/* the context line's words: the names, else "blocks work" for a blocker */
pub fn place_label(a: &Alert) -> String {
    if a.place.is_empty() && a.blocking { "blocks work".to_string() } else { a.place.clone() }
}

/* One card's height in logical pixels for this many title lines. */
fn card_h(a: &Alert, lines: i32) -> i32 {
    let mut h = PAD_T + LABEL_H + 2 + TITLE_LINE * lines + 2;
    if !place_label(a).is_empty() {
        h += LINE_H;
    }
    if !a.pick.is_empty() {
        h += LINE_H;
    }
    h + ACTION_GAP + ACTION_H + PAD_B
}

/* `measure` is the title font's width in device pixels at this dpi; `max_h` the
   room on screen, 0 for none. A stack taller than the room leaves its oldest
   non-blocking cards to the "+N more" line. */
pub fn layout(view: &[(u64, &Alert)], hidden: usize, dpi: u32, max_h: i32, measure: &dyn Fn(&str) -> i32) -> Layout {
    let s = scale_of(dpi);
    let px = |n: i32| (n as f32 * s).round() as i32;
    let width = px(WIDTH);
    let title_w = px(TEXT_R) - px(TEXT_X);
    let mut keep: Vec<(u64, &Alert, Vec<String>)> = view
        .iter()
        .map(|(k, a)| (*k, *a, wrap(&a.title, title_w, measure)))
        .collect();
    let mut hidden = hidden;
    let total = |keep: &[(u64, &Alert, Vec<String>)], more: bool| -> i32 {
        keep.iter().map(|(_, a, t)| px(card_h(a, t.len() as i32))).sum::<i32>()
            + if more { px(MORE_H) } else { 0 }
    };
    while max_h > 0 && keep.len() > 1 && total(&keep, hidden > 0) > max_h {
        let at = keep.iter().position(|(_, a, _)| !a.blocking).unwrap_or(0);
        keep.remove(at);
        hidden += 1;
    }

    let mut y = 0;
    let mut cards = Vec::new();
    for (key, alert, lines) in &keep {
        let top = y;
        let at = |l: i32, t: i32, r: i32, b: i32| Rect {
            l: px(l),
            t: top + px(t),
            r: px(r),
            b: top + px(b),
        };
        let mut row = PAD_T + LABEL_H + 2;
        let title = (0..lines.len() as i32)
            .map(|n| at(TEXT_X, row + n * TITLE_LINE, TEXT_R, row + (n + 1) * TITLE_LINE))
            .collect();
        row += TITLE_LINE * lines.len() as i32 + 2;
        let place = if place_label(alert).is_empty() {
            None
        } else {
            row += LINE_H;
            Some(at(TEXT_X, row - LINE_H, TEXT_R, row))
        };
        let pick = if alert.pick.is_empty() {
            None
        } else {
            row += LINE_H;
            Some(at(TEXT_X, row - LINE_H, TEXT_R, row))
        };
        row += ACTION_GAP;
        let h = card_h(alert, lines.len() as i32);
        cards.push(CardBox {
            key: *key,
            card: Rect {
                l: 0,
                t: top,
                r: width,
                b: top + px(h),
            },
            glyph: at(14, PAD_T, 50, PAD_T + 36),
            label: at(TEXT_X, PAD_T, WIDTH - 12 - CLOSE, PAD_T + LABEL_H),
            title,
            place,
            pick,
            action: at(TEXT_X, row, TEXT_X + 110, row + ACTION_H),
            files: if alert.files.is_empty() {
                None
            } else {
                Some(at(TEXT_X + 118, row, TEXT_R, row + ACTION_H))
            },
            close: at(WIDTH - 8 - CLOSE, 6, WIDTH - 8, 6 + CLOSE),
        });
        y += px(h);
    }
    let more = if hidden > 0 {
        let r = Rect {
            l: 0,
            t: y,
            r: width,
            b: y + px(MORE_H),
        };
        y += px(MORE_H);
        Some(r)
    } else {
        None
    };
    Layout {
        width,
        height: y,
        cards,
        more,
        hidden,
        scale: s,
    }
}

pub fn hit(l: &Layout, x: i32, y: i32) -> Option<Hit> {
    if let Some(m) = l.more
        && m.has(x, y)
    {
        return Some(Hit::More);
    }
    for c in &l.cards {
        if !c.card.has(x, y) {
            continue;
        }
        if c.close.has(x, y) {
            return Some(Hit::Close(c.key));
        }
        if let Some(f) = c.files
            && f.has(x, y)
        {
            return Some(Hit::Files(c.key));
        }
        if c.action.has(x, y) {
            return Some(Hit::Action(c.key));
        }
        return Some(Hit::Body(c.key));
    }
    None
}

/* ---- the words ---------------------------------------------------------- */

/* the age beside the label, from when the alert reached the tray */
pub fn age_label(age: Duration) -> String {
    let m = age.as_secs() / 60;
    match m {
        0 => "just now".to_string(),
        1..=59 => format!("{m} min ago"),
        60..=1439 => format!("{} hr ago", m / 60),
        _ => {
            let d = m / 1440;
            if d == 1 { "1 day ago".to_string() } else { format!("{d} days ago") }
        }
    }
}

/* the label line in full, as the painter draws it and the timer compares it */
pub fn label_line(a: &Alert, now: Instant) -> String {
    format!("{}{}{}", a.kind.label(), DOT, age_label(now.saturating_duration_since(a.arrived)))
}

const DOT: &str = " \u{00B7} ";
const PICK_HEAD: &str = "My pick: ";

pub fn action_label(a: &Alert) -> &'static str {
    if a.card.is_empty() { "Open board" } else { a.kind.verb() }
}

/* One file is named; more are counted, and the click lists them. */
pub fn files_label(a: &Alert) -> String {
    match a.files.len() {
        0 => String::new(),
        1 => format!("Open {}", a.files[0].name),
        n => format!("Open files ({n})"),
    }
}

pub fn more_label(hidden: usize) -> String {
    format!("+{hidden} more, open the board")
}

/* ---- drawing ------------------------------------------------------------ */

pub struct Palette {
    pub back: u32,
    pub hover: u32,
    pub rule: u32,
    pub text: u32,
    pub muted: u32,
    pub link: u32,
}

/* the icon package's preview panels, dark; a plain light twin */
pub fn palette(light: bool) -> Palette {
    if light {
        Palette {
            back: 0xFFFFFF,
            hover: 0xF3F1F8,
            rule: 0xDAD6E4,
            text: 0x131321,
            muted: 0x5A6178,
            link: 0x008AC7,
        }
    } else {
        Palette {
            back: 0x202031,
            hover: 0x2A2A40,
            rule: 0x393E53,
            text: 0xFAF6FF,
            muted: 0xA8B3CB,
            link: 0x39C9FF,
        }
    }
}

/* GDI wants 0x00BBGGRR */
pub fn bgr(rgb: u32) -> u32 {
    ((rgb & 0xFF) << 16) | (rgb & 0xFF00) | ((rgb >> 16) & 0xFF)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn font(px: i32, weight: i32, underline: bool, face: &str) -> HFONT {
    let name = wide(face);
    unsafe {
        CreateFontW(
            -px,
            0,
            0,
            0,
            weight,
            0,
            underline as u32,
            0,
            1, /* DEFAULT_CHARSET */
            0,
            0,
            5, /* CLEARTYPE_QUALITY */
            0,
            name.as_ptr(),
        )
    }
}

fn title_font_px(scale: f32) -> i32 {
    (TITLE_PX as f32 * scale).round() as i32
}

/* the width of `s` in `f`, device pixels */
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

/* Runs `f` with the title font's measure at `dpi`, for layout(); any DC will do,
   a screen DC or a memory one.
   # Safety: `hdc` is a live device context the caller owns. */
pub unsafe fn with_measure<R>(hdc: HDC, dpi: u32, f: impl FnOnce(&dyn Fn(&str) -> i32) -> R) -> R {
    unsafe {
        let tf = font(title_font_px(scale_of(dpi)), 600, false, "Segoe UI");
        let out = f(&|s: &str| width_in(hdc, s, tf));
        DeleteObject(tf as _);
        out
    }
}

unsafe fn fill(hdc: HDC, r: Rect, rgb: u32) {
    unsafe {
        let brush = CreateSolidBrush(bgr(rgb));
        FillRect(hdc, &r.win(), brush);
        DeleteObject(brush as _);
    }
}

unsafe fn text(hdc: HDC, s: &str, r: Rect, f: HFONT, rgb: u32, centre: bool) {
    let w: Vec<u16> = s.encode_utf16().collect();
    let mut rc = r.win();
    let align = if centre { DT_CENTER } else { DT_LEFT };
    unsafe {
        let old = SelectObject(hdc, f as _);
        SetTextColor(hdc, bgr(rgb));
        DrawTextW(
            hdc,
            w.as_ptr(),
            w.len() as i32,
            &mut rc,
            align | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS,
        );
        SelectObject(hdc, old);
    }
}

/* A head in one font and colour, then the rest in another, on one line. */
unsafe fn two_part(hdc: HDC, head: &str, rest: &str, r: Rect, fonts: (HFONT, HFONT), colours: (u32, u32)) {
    unsafe {
        text(hdc, head, r, fonts.0, colours.0, false);
        let at = r.l + width_in(hdc, head, fonts.0);
        if at < r.r {
            text(hdc, rest, Rect { l: at, ..r }, fonts.1, colours.1, false);
        }
    }
}

/* Draws the whole stack into `hdc` at the layout's own scale. `hot` is what the
   pointer is over: its link is underlined and its card lifted a shade. `now`
   dates the label line's age.
   # Safety: `hdc` is a live device context the caller owns. */
pub unsafe fn paint(hdc: HDC, view: &[(u64, &Alert)], l: &Layout, light: bool, hot: Option<Hit>, now: Instant) {
    let p = palette(light);
    let px = |n: i32| (n as f32 * l.scale).round() as i32;
    unsafe {
        SetBkMode(hdc, TRANSPARENT as _);
        fill(
            hdc,
            Rect {
                l: 0,
                t: 0,
                r: l.width,
                b: l.height,
            },
            p.back,
        );
        let title_f = font(title_font_px(l.scale), 600, false, "Segoe UI");
        let small = font(px(SMALL_PX), 400, false, "Segoe UI");
        let small_u = font(px(SMALL_PX), 400, true, "Segoe UI");
        let link_f = font(px(SMALL_PX), 600, false, "Segoe UI");
        let link_u = font(px(SMALL_PX), 600, true, "Segoe UI");
        let glyph_f = font(px(26), 600, false, "Segoe UI Symbol");
        let close_f = font(px(11), 400, false, "Segoe UI Symbol");
        let pen = CreatePen(PS_SOLID, 1, bgr(p.rule));
        let old_pen = SelectObject(hdc, pen as _);

        for (n, cb) in l.cards.iter().enumerate() {
            let Some((_, a)) = view.iter().find(|(k, _)| *k == cb.key) else {
                continue;
            };
            let on = |h: Hit| hot == Some(h);
            let lifted = matches!(hot, Some(Hit::Body(k) | Hit::Action(k) | Hit::Files(k) | Hit::Close(k)) if k == cb.key);
            if lifted {
                fill(hdc, cb.card, p.hover);
            }
            let tint = a.kind.colour(light);
            fill(
                hdc,
                Rect {
                    l: 0,
                    t: cb.card.t,
                    r: px(STRIP),
                    b: cb.card.b,
                },
                tint,
            );
            text(hdc, a.kind.glyph(), cb.glyph, glyph_f, tint, true);
            let age = format!("{DOT}{}", age_label(now.saturating_duration_since(a.arrived)));
            two_part(hdc, a.kind.label(), &age, cb.label, (link_f, small), (tint, p.muted));
            /* the same wrap layout() counted, so the lines land in its rects */
            let width = cb.title.first().map(|r| r.r - r.l).unwrap_or(0);
            let lines = wrap(&a.title, width, &|s: &str| width_in(hdc, s, title_f));
            for (line, r) in lines.iter().zip(cb.title.iter()) {
                text(hdc, line, *r, title_f, p.text, false);
            }
            if let Some(r) = cb.place {
                text(hdc, &place_label(a), r, small, p.muted, false);
            }
            if let Some(r) = cb.pick {
                two_part(hdc, PICK_HEAD, &a.pick, r, (small, link_f), (p.muted, p.text));
            }
            let act = on(Hit::Action(cb.key)) || on(Hit::Body(cb.key));
            text(hdc, action_label(a), cb.action, if act { link_u } else { link_f }, p.link, false);
            if let Some(fr) = cb.files {
                let f = if on(Hit::Files(cb.key)) { small_u } else { small };
                text(hdc, &files_label(a), fr, f, p.link, false);
            }
            let x = if on(Hit::Close(cb.key)) { p.text } else { p.muted };
            text(hdc, "\u{2715}", cb.close, close_f, x, true);
            if n + 1 < l.cards.len() || l.more.is_some() {
                MoveToEx(hdc, px(STRIP), cb.card.b - 1, std::ptr::null_mut());
                LineTo(hdc, l.width, cb.card.b - 1);
            }
        }
        if let Some(m) = l.more {
            if hot == Some(Hit::More) {
                fill(hdc, m, p.hover);
            }
            let r = Rect {
                l: px(16),
                ..m
            };
            let f = if hot == Some(Hit::More) { small_u } else { small };
            text(hdc, &more_label(l.hidden), r, f, p.muted, false);
        }

        SelectObject(hdc, old_pen);
        DeleteObject(pen as _);
        for f in [title_f, small, small_u, link_f, link_u, glyph_f, close_f] {
            DeleteObject(f as _);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alert(kind: Kind, blocking: bool, card: &str) -> Alert {
        Alert {
            kind,
            title: "t".into(),
            place: String::new(),
            pick: String::new(),
            arrived: Instant::now(),
            blocking,
            card: card.into(),
            question: String::new(),
            files: Vec::new(),
            sound: String::new(),
        }
    }

    /* a fixed-pitch stand-in for the title font: 7 pixels a char */
    fn mono(s: &str) -> i32 {
        s.chars().count() as i32 * 7
    }

    #[test]
    fn every_kind_the_server_sends_parses_and_nothing_else_does() {
        for k in [
            "question", "blocker", "answer", "track", "thread", "handoff", "done", "dropped",
            "closed", "depth", "info",
        ] {
            let kind = Kind::parse(k).unwrap_or_else(|| panic!("{k}"));
            assert!(!kind.glyph().is_empty());
            assert_ne!(kind.colour(false), kind.colour(true), "{k} has a light twin");
        }
        assert_eq!(Kind::parse("thread"), Kind::parse("track"), "the senders' old word reads track");
        assert_eq!(Kind::parse("leg"), None, "auto-continue's kind is gone (T-51)");
        assert_eq!(Kind::parse("Blocker"), None);
        assert_eq!(Kind::parse(""), None);
    }

    #[test]
    fn three_cards_show_and_blockers_claim_the_slots_first() {
        let mut s = Stack::default();
        s.push(alert(Kind::Blocker, true, "b"));
        for n in 0..4 {
            s.push(alert(Kind::Done, false, &format!("d{n}")));
        }
        let v = s.visible();
        assert_eq!(v.len(), MAX_VISIBLE);
        assert!(v[0].1.blocking, "the old blocker is still on screen, drawn first");
        assert_eq!(v[1].1.card, "d2");
        assert_eq!(v[2].1.card, "d3", "the newest sits nearest the tray");
        assert_eq!(s.hidden(), 2);
    }

    #[test]
    fn a_repeat_for_the_same_card_replaces_the_older() {
        let mut s = Stack::default();
        s.push(alert(Kind::Done, false, "x"));
        s.push(alert(Kind::Done, false, "x"));
        s.push(alert(Kind::Answer, false, "x"));
        s.push(alert(Kind::Info, false, ""));
        s.push(alert(Kind::Info, false, ""));
        assert_eq!(s.visible().len() + s.hidden(), 4, "a different kind or no card is its own card");
    }

    #[test]
    fn a_retract_takes_every_card_for_its_question_blockers_too() {
        let about = |kind, blocking, card: &str, q: &str| Alert { question: q.into(), ..alert(kind, blocking, card) };
        let mut s = Stack::default();
        s.push(about(Kind::Blocker, true, "q12", "Q12"));
        s.push(about(Kind::Question, false, "q12b", "Q12"));
        s.push(about(Kind::Question, false, "q13", "Q13"));
        s.push(alert(Kind::Done, false, "d"));
        assert_eq!(s.retract("Q12"), 2);
        let left: Vec<&str> = s.visible().iter().map(|(_, a)| a.card.as_str()).collect();
        assert_eq!(left, ["q13", "d"]);
        assert_eq!(s.retract("Q12"), 0, "a card already gone stays gone");
        assert_eq!(s.retract(""), 0, "a card about no question is never taken");
    }

    #[test]
    fn blockers_never_expire_and_others_do_once_drawn() {
        let t0 = Instant::now();
        let mut s = Stack::default();
        s.push(alert(Kind::Blocker, true, "b"));
        s.push(alert(Kind::Done, false, "d"));
        assert!(!s.expire(t0 + AUTO_HIDE * 2), "nothing drawn, nothing timed");
        s.mark_shown(t0);
        assert!(s.needs_timer());
        assert!(!s.expire(t0 + AUTO_HIDE / 2));
        assert!(s.expire(t0 + AUTO_HIDE));
        assert_eq!(s.visible().len(), 1);
        assert!(s.visible()[0].1.blocking);
        assert!(!s.needs_timer(), "a blocker alone wants no timer");
        assert!(!s.expire(t0 + AUTO_HIDE * 100));
    }

    #[test]
    fn hover_holds_the_cards_and_leaving_restarts_their_time() {
        let t0 = Instant::now();
        let mut s = Stack::default();
        s.push(alert(Kind::Done, false, "d"));
        s.mark_shown(t0);
        s.set_hover(true, t0 + AUTO_HIDE / 2);
        assert!(!s.expire(t0 + AUTO_HIDE * 3));
        let left = t0 + AUTO_HIDE * 3;
        s.set_hover(false, left);
        assert!(!s.expire(left + AUTO_HIDE / 2));
        assert!(s.expire(left + AUTO_HIDE));
    }

    #[test]
    fn a_hidden_card_starts_its_clock_only_when_it_is_drawn() {
        let t0 = Instant::now();
        let mut s = Stack::default();
        for n in 0..4 {
            s.push(alert(Kind::Done, false, &format!("d{n}")));
        }
        s.mark_shown(t0);
        let first = s.visible()[0].0;
        s.dismiss(first);
        let later = t0 + AUTO_HIDE - Duration::from_secs(1);
        s.mark_shown(later);
        assert!(s.expire(t0 + AUTO_HIDE));
        assert_eq!(s.visible().len(), 1, "the card that surfaced late keeps its own time");
        assert_eq!(s.visible()[0].1.card, "d0");
    }

    #[test]
    fn the_cap_drops_the_oldest_card_that_does_not_block() {
        let mut s = Stack::default();
        s.push(alert(Kind::Blocker, true, "b"));
        for n in 0..QUEUE_MAX {
            s.push(alert(Kind::Done, false, &format!("d{n}")));
        }
        assert_eq!(s.visible().len() + s.hidden(), QUEUE_MAX);
        assert!(s.visible().iter().any(|(_, a)| a.blocking));
    }

    #[test]
    fn the_layout_scales_and_the_hit_test_reads_it() {
        let a = Alert {
            files: vec![File {
                id: "Q1".into(),
                index: 0,
                name: "a.md".into(),
            }],
            ..alert(Kind::Blocker, true, "http://127.0.0.1:1/s/q/Q1")
        };
        let b = alert(Kind::Done, false, "");
        let view = vec![(1, &a), (2, &b)];
        let l = layout(&view, 1, 96, 0, &mono);
        /* a blocker with no names still says it blocks work; a plain card has
           no context line at all */
        let (ha, hb) = (106, 88);
        assert_eq!(card_h(&a, 1), ha);
        assert_eq!(card_h(&b, 1), hb);
        assert_eq!(l.width, WIDTH);
        assert_eq!(l.height, ha + hb + MORE_H);
        assert_eq!(l.hidden, 1);
        assert!(l.cards[0].files.is_some() && l.cards[0].place.is_some());
        assert!(l.cards[1].files.is_none() && l.cards[1].place.is_none());
        let c = &l.cards[0];
        assert_eq!(hit(&l, c.close.l + 2, c.close.t + 2), Some(Hit::Close(1)));
        assert_eq!(hit(&l, c.action.l + 2, c.action.t + 2), Some(Hit::Action(1)));
        let f = c.files.unwrap();
        assert_eq!(hit(&l, f.l + 2, f.t + 2), Some(Hit::Files(1)));
        assert!(c.close.b <= c.title[0].t + 2, "the close box sits in the label row");
        assert_eq!(hit(&l, 30, ha + 5), Some(Hit::Body(2)));
        assert_eq!(hit(&l, 30, ha + hb + 5), Some(Hit::More));
        assert_eq!(hit(&l, 30, l.height + 5), None);
        let big = layout(&view, 0, 144, 0, &|s: &str| mono(s) * 3 / 2);
        assert_eq!(big.width, WIDTH * 3 / 2);
        assert_eq!(big.height, (ha + hb) * 3 / 2);
        assert!(big.more.is_none());
    }

    #[test]
    fn every_line_of_a_full_card_has_its_own_row() {
        let a = Alert {
            title: "Q512 needs you: which carrier for the band, the output style or a hook that rewrites each turn?".into(),
            place: "tidewatch \u{00B7} the board".into(),
            pick: "the output style".into(),
            ..alert(Kind::Blocker, true, "u")
        };
        let view = vec![(1, &a)];
        let l = layout(&view, 0, 96, 0, &mono);
        let c = &l.cards[0];
        assert_eq!(c.title.len(), 2, "what happened wraps to a second line");
        let (p, k) = (c.place.unwrap(), c.pick.unwrap());
        assert!(c.label.b <= c.title[0].t && c.title[0].b <= c.title[1].t);
        assert!(c.title[1].b <= p.t && p.b <= k.t && k.b <= c.action.t, "label, title, names, pick, links");
        assert!(c.action.b <= c.card.b);
        assert_eq!(l.height, 10 + 18 + 2 + 40 + 2 + 18 + 18 + 6 + 20 + 10);
    }

    #[test]
    fn three_full_cards_and_the_more_line_fit_the_corner() {
        let full = |k| Alert {
            title: "x ".repeat(80),
            place: "p".into(),
            pick: "q".into(),
            ..alert(k, true, "u")
        };
        let (a, b, c, d) = (full(Kind::Blocker), full(Kind::Question), full(Kind::Handoff), full(Kind::Track));
        let view = vec![(1, &a), (2, &b), (3, &c)];
        let l = layout(&view, 1, 96, 0, &mono);
        /* 1366x768 at 100 percent leaves about 728 above the taskbar */
        assert!(l.height <= 480, "{} logical pixels", l.height);
        let tall = layout(&view, 1, 192, 0, &|s: &str| mono(s) * 2);
        assert!(tall.height <= 1000 - 48, "1080p at 200 percent: {}", tall.height);
        /* a screen shorter than the stack sends the oldest non-blocker to the more line */
        let mixed = vec![(1, &a), (2, &b), (4, &d)];
        let b2 = Alert { blocking: false, ..b.clone() };
        let mixed2 = vec![(1, &a), (2, &b2), (4, &d)];
        let short = layout(&mixed2, 0, 96, l.height - 100, &mono);
        assert_eq!(short.cards.len(), 2);
        assert_eq!(short.hidden, 1);
        assert!(short.height <= l.height - 100);
        assert!(short.cards.iter().all(|c| c.key != 2), "the non-blocker went first");
        assert_eq!(layout(&mixed, 0, 96, 50, &mono).cards.len(), 1, "one card always draws");
        /* the corner: the desktop app's window over it lifts the stack clear of its toast */
        let work = Rect { l: 0, t: 0, r: 2560, b: 1392 };
        let at = |wins: &[AppWin]| {
            let (x, y, _) = corner(work, 12, wins, APP_TOAST_ZONE);
            (x, y)
        };
        assert_eq!(at(&[]), (2548, 1380), "no app window: the corner as before");
        let app = AppWin { rect: work, shown: true, ..AppWin::default() };
        /* the app's window behind another one still lifts, and its three-line toast stands 132 tall */
        let (x, y) = at(&[app]);
        assert_eq!(x, 2548);
        assert!(y + 12 <= 1392 - 132, "the stack's bottom and its gap stand above a three-line toast: {y}");
        let left_half = AppWin { rect: Rect { r: 1280, ..work }, foreground: true, ..app };
        assert_eq!(at(&[left_half, app]), (2548, y), "the covering window wins over a foreground one off the corner");
        assert_eq!(at(&[left_half]), (2548, 1380), "an app window off the corner leaves it");
        assert_eq!(at(&[AppWin { minimized: true, ..app }]), (2548, 1380), "a minimized app leaves it");
        /* the lifted stack still fits three full cards on a 1366x768 screen */
        let small = Rect { l: 0, t: 0, r: 1366, b: 728 };
        let (_, y, _) = corner(small, 12, &[AppWin { rect: small, ..app }], APP_TOAST_ZONE);
        assert!(l.height <= y - 12, "{} in {}", l.height, y - 12);
    }

    #[test]
    fn the_wrap_breaks_at_a_space_and_hands_the_rest_to_line_two() {
        assert_eq!(wrap("short", 100, &mono), vec!["short"]);
        assert_eq!(wrap("", 100, &mono), vec![""]);
        /* 14 chars fit in 100 px */
        assert_eq!(wrap("one two three four five", 100, &mono), vec!["one two three", "four five"]);
        assert_eq!(wrap("abcdefghijklmnopqrstuvwxyz end", 100, &mono), vec!["abcdefghijklmn", "opqrstuvwxyz end"]);
        let long = wrap(&"word ".repeat(40), 100, &mono);
        assert_eq!(long.len(), 2, "never a third line; the painter ends line two with an ellipsis");
        assert_eq!(wrap("\u{00E9}\u{00E9}\u{00E9}", 14, &mono), vec!["\u{00E9}\u{00E9}", "\u{00E9}"], "cuts on a char boundary");
    }

    #[test]
    fn the_label_line_names_the_kind_and_its_age() {
        assert_eq!(age_label(Duration::from_secs(0)), "just now");
        assert_eq!(age_label(Duration::from_secs(59)), "just now");
        assert_eq!(age_label(Duration::from_secs(60)), "1 min ago");
        assert_eq!(age_label(Duration::from_secs(150)), "2 min ago");
        assert_eq!(age_label(Duration::from_secs(3600 * 3)), "3 hr ago");
        assert_eq!(age_label(Duration::from_secs(86400)), "1 day ago");
        assert_eq!(age_label(Duration::from_secs(86400 * 3)), "3 days ago");
        let mut a = alert(Kind::Blocker, true, "");
        let t0 = Instant::now();
        a.arrived = t0;
        assert_eq!(label_line(&a, t0), "Blocking question \u{00B7} just now");
        assert_eq!(label_line(&a, t0 + Duration::from_secs(125)), "Blocking question \u{00B7} 2 min ago");
        let words: Vec<&str> = [
            Kind::Question, Kind::Blocker, Kind::Answer, Kind::Track, Kind::Handoff,
            Kind::Done, Kind::Dropped, Kind::Closed, Kind::Depth, Kind::Info,
        ]
        .iter()
        .map(|k| k.label())
        .collect();
        let mut unique = words.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), words.len(), "one label per kind");
        assert_eq!(place_label(&alert(Kind::Blocker, true, "")), "blocks work");
        assert_eq!(place_label(&alert(Kind::Done, false, "")), "");
    }

    #[test]
    fn the_words_on_a_card() {
        let mut a = alert(Kind::Blocker, true, "u");
        assert_eq!(action_label(&a), "Answer");
        assert_eq!(files_label(&a), "");
        a.files.push(File {
            id: "Q1".into(),
            index: 0,
            name: "plan.md".into(),
        });
        assert_eq!(files_label(&a), "Open plan.md");
        a.files.push(a.files[0].clone());
        assert_eq!(files_label(&a), "Open files (2)");
        assert_eq!(action_label(&alert(Kind::Done, false, "")), "Open board");
        assert_eq!(action_label(&alert(Kind::Handoff, false, "u")), action_label(&alert(Kind::Track, false, "u")));
        assert_eq!(more_label(4), "+4 more, open the board");
        assert_eq!(bgr(0x112233), 0x332211);
    }
}
