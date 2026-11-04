/* A PREVIEW and not shipped code: draws the popup from canned alerts
 * into an offscreen bitmap and writes it as a PNG. No window, no identity, no
 * network, no store: popup.rs is included by path and handed a memory DC.
 * Run: cargo run --example popup_preview -- <out.png> [dark|light] [dpi] [hover] [all]
 * `all` draws every kind, three to a stack as the cap allows: <out>-1.png and on. */
#![allow(dead_code)]

#[path = "../src/popup.rs"]
mod popup;

use std::io::Write;
use std::time::{Duration, Instant};

use popup::{Alert, File, Hit, Kind, MAX_VISIBLE, Stack};
use windows_sys::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, CreateDIBSection, DIB_RGB_COLORS,
    DeleteDC, DeleteObject, GdiFlush, SelectObject,
};

fn alert(now: Instant, kind: Kind, mins: u64, title: &str, place: &str, pick: &str, card: &str, files: Vec<File>) -> Alert {
    Alert {
        kind,
        title: title.into(),
        place: place.into(),
        pick: pick.into(),
        arrived: now - Duration::from_secs(mins * 60 + 5),
        blocking: kind == Kind::Blocker,
        card: if card.is_empty() { String::new() } else { format!("http://127.0.0.1:4321/s/{card}") },
        question: String::new(),
        files,
        sound: "Default".into(),
    }
}

fn f(id: &str, index: u32, name: &str) -> File {
    File {
        id: id.into(),
        index,
        name: name.into(),
    }
}

fn canned(now: Instant) -> Vec<Alert> {
    let a = |kind, mins, title: &str, place: &str, pick: &str, card: &str, files| alert(now, kind, mins, title, place, pick, card, files);
    /* the oldest non-blocker waits behind the "+1 more" line */
    vec![
        a(Kind::Done, 9, "The tide chart export is finished", "Tidewatch \u{00B7} the gauges", "", "w/T-37", vec![]),
        a(
            Kind::Blocker,
            5,
            "Which source should the gauges read: the harbor feed, or the national tide tables?",
            "Tidewatch \u{00B7} the gauges \u{00B7} holds up the station sync",
            "the harbor feed",
            "q/Q41",
            vec![f("Q41", 0, "gauge-sources.md"), f("Q41", 2, "feed-notes.md")],
        ),
        a(
            Kind::Handoff,
            2,
            "Station sync handed off at 31 percent: next, retry a dropped reading",
            "Tidewatch \u{00B7} the gauges \u{00B7} track station sync",
            "",
            "r/TR-6.1",
            vec![],
        ),
        a(
            Kind::Track,
            0,
            "Station sync is waiting for you: write the retry tests",
            "Tidewatch \u{00B7} the gauges \u{00B7} track station sync",
            "",
            "r/TR-6",
            vec![],
        ),
    ]
}

/* the canned four plus the other six, in the order Kind declares them */
fn every_kind(now: Instant) -> Vec<Alert> {
    let a = |kind, mins, title: &str, place: &str, pick: &str, card: &str, files| alert(now, kind, mins, title, place, pick, card, files);
    let board = "Tidewatch \u{00B7} the gauges";
    let track = "Tidewatch \u{00B7} the gauges \u{00B7} track station sync";
    let mut all = canned(now);
    all.extend([
        a(
            Kind::Question,
            14,
            "Should the chart show past tides too, or only the coming week?",
            board,
            "past tides too, in a lighter line",
            "r/Q518",
            vec![f("Q518", 0, "chart-notes.md")],
        ),
        a(Kind::Answer, 12, "Where the map shows the station in hand", board, "", "r/Q511", vec![]),
        a(Kind::Dropped, 11, "Paper chart printing dropped", board, "", "r/T-88", vec![]),
        a(Kind::Closed, 8, "The gauge fixes closed: every fault fixed and merged", board, "", "r/P-14", vec![]),
        a(Kind::Depth, 3, "Station sync is at 62 percent of its context: hand off at the next clean commit", track, "", "r/TR-6", vec![]),
        a(Kind::Info, 1, "4 more changes on the board", "", "", "", vec![]),
    ]);
    all.sort_by_key(|a| a.kind as u8);
    all
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.first().cloned().unwrap_or_else(|| "popup.png".into());
    /* the flags after the path in any order; a number is the dpi */
    let has = |w: &str| args.iter().skip(1).any(|s| s == w);
    let light = has("light");
    let dpi: u32 = args.iter().skip(1).find_map(|s| s.parse().ok()).unwrap_or(96);
    let hover = has("hover");

    let now = Instant::now();
    if !has("all") {
        let mut stack = Stack::default();
        for a in canned(now) {
            stack.push(a);
        }
        render(&stack, &out, light, dpi, hover, now);
        return;
    }
    let stem = out.strip_suffix(".png").unwrap_or(&out);
    for (n, page) in every_kind(now).chunks(MAX_VISIBLE).enumerate() {
        /* pushed oldest first, as they would reach the tray */
        let mut page = page.to_vec();
        page.sort_by_key(|a| a.arrived);
        let mut stack = Stack::default();
        for a in page {
            stack.push(a);
        }
        render(&stack, &format!("{stem}-{}.png", n + 1), light, dpi, hover, now);
    }
}

fn render(stack: &Stack, out: &str, light: bool, dpi: u32, hover: bool, now: Instant) {
    let view = stack.visible();
    /* measured on a memory DC in the title font, as the window measures on its own */
    let layout = unsafe {
        let dc = CreateCompatibleDC(std::ptr::null_mut());
        let l = popup::with_measure(dc, dpi, |m| popup::layout(&view, stack.hidden(), dpi, 0, m));
        DeleteDC(dc);
        l
    };
    let hot = if hover {
        layout.cards.last().map(|c| Hit::Action(c.key))
    } else {
        None
    };
    let (w, h) = (layout.width, layout.height);

    let pixels = unsafe {
        let dc = CreateCompatibleDC(std::ptr::null_mut());
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..std::mem::zeroed()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let bmp = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, std::ptr::null_mut(), 0);
        let old = SelectObject(dc, bmp as _);
        popup::paint(dc, &view, &layout, light, hot, now);
        GdiFlush();
        let raw = std::slice::from_raw_parts(bits as *const u8, (w * h * 4) as usize).to_vec();
        SelectObject(dc, old);
        DeleteObject(bmp as _);
        DeleteDC(dc);
        raw
    };
    let png = encode(w as u32, h as u32, &pixels);
    std::fs::File::create(&out)
        .and_then(|mut f| f.write_all(&png))
        .expect("the PNG was written");
    println!("{out}: {w}x{h} at {dpi} dpi, {} theme", if light { "light" } else { "dark" });
}

/* ---- a stored-deflate PNG, enough for a preview ------------------------- */

fn encode(w: u32, h: u32, bgra: &[u8]) -> Vec<u8> {
    let mut raw = Vec::with_capacity((w * h * 3 + h) as usize);
    for y in 0..h {
        raw.push(0);
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            raw.extend_from_slice(&[bgra[i + 2], bgra[i + 1], bgra[i]]);
        }
    }
    let mut z = vec![0x78, 0x01];
    for (n, block) in raw.chunks(65535).enumerate() {
        let last = (n + 1) * 65535 >= raw.len();
        z.push(last as u8);
        let len = block.len() as u16;
        z.extend_from_slice(&len.to_le_bytes());
        z.extend_from_slice(&(!len).to_le_bytes());
        z.extend_from_slice(block);
    }
    z.extend_from_slice(&adler(&raw).to_be_bytes());

    let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&w.to_be_bytes());
    ihdr.extend_from_slice(&h.to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(&mut png, b"IHDR", &ihdr);
    chunk(&mut png, b"IDAT", &z);
    chunk(&mut png, b"IEND", &[]);
    png
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let mut body = kind.to_vec();
    body.extend_from_slice(data);
    out.extend_from_slice(&body);
    out.extend_from_slice(&crc(&body).to_be_bytes());
}

fn crc(data: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
        }
    }
    !c
}

fn adler(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &x in data {
        a = (a + x as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}
