/* A PREVIEW and not shipped code: draws the activity console from a
 * fixed sample of activity lines into an offscreen bitmap and writes a PNG. No
 * window, no network, no store: console_view.rs is included by path. The EDIT
 * control is a child window, so the preview draws its text in the box itself.
 * Run: cargo run --example console_preview -- <out.png> [dark|light] [dpi] [filter] */
#![allow(dead_code)]

#[path = "../src/console_view.rs"]
mod console_view;

use std::collections::HashMap;
use std::io::Write;

use console_view as view;
use serde_json::json;
use windows_sys::Win32::Foundation::RECT;
use windows_sys::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, CreateDIBSection, DIB_RGB_COLORS,
    DT_LEFT, DT_NOPREFIX, DT_SINGLELINE, DT_VCENTER, DeleteDC, DeleteObject, DrawTextW, GdiFlush,
    SelectObject, SetTextColor,
};

const TODAY: &str = "2026-10-21";

fn sample() -> Vec<view::Entry> {
    let tw = "C:/Demo/tidewatch";
    let rows = [
        ("2026-10-21T17:23:39-08:00", "create", "question", "Q41", "0pakgysx", "gauge refresh rate", tw, "WS-2", None),
        ("2026-10-21T16:58:02-08:00", "answer", "question", "Q40", "pxmdpty2", "chart colours", tw, "WS-2", Some("answered")),
        /* three notes in one minute fold into one row with its count */
        ("2026-10-21T16:20:41-08:00", "note", "task", "T-36", "h2v8c4tw", "calibrate the harbor gauge", tw, "WS-1", None),
        ("2026-10-21T16:20:20-08:00", "note", "task", "T-36", "h2v8c4tw", "calibrate the harbor gauge", tw, "WS-1", None),
        ("2026-10-21T16:20:05-08:00", "note", "task", "T-36", "h2v8c4tw", "calibrate the harbor gauge", tw, "WS-1", None),
        /* a plain echo folds into the line that says what it moved to */
        ("2026-10-21T15:12:55-08:00", "update", "task", "T-37", "k3m9q2ra", "tide chart export", tw, "WS-1", None),
        ("2026-10-21T15:12:40-08:00", "update", "task", "T-37", "k3m9q2ra", "tide chart export", tw, "WS-1", Some("in_progress")),
        ("2026-10-21T14:05:11-08:00", "handoff", "track", "TR-4", "w7c2n5pe", "station sync", tw, "WS-1", None),
        ("2026-10-21T09:41:27-08:00", "note", "workstream", "WS-1", "r8d4t6ya", "the gauges", tw, "WS-1", None),
        ("2026-10-20T22:17:03-08:00", "update", "task", "T-31", "b5x8m2kq", "offline cache for readings", tw, "WS-1", Some("completed")),
        ("2026-10-20T18:30:55-08:00", "create", "track", "TR-5", "f2n7v9sd", "station map, two lanes", tw, "WS-1", None),
        ("2026-10-20T11:02:16-08:00", "close", "question", "Q38", "c9p3w6zh", "alert wording", tw, "WS-1", Some("closed")),
        ("2026-10-19T16:44:08-08:00", "update", "task", "T-88", "m4k7r2xb", "pier camera feed", "C:/Demo/harbor", "WS-7", Some("blocked")),
        ("2026-10-19T10:20:31-08:00", "create", "task", "T-89", "q6h3y8nd", "login screen", "C:/Demo/harbor", "WS-7", None),
        ("2026-10-16T13:55:47-08:00", "create", "workstream", "WS-2", "z9w5k3mr", "the station map", tw, "WS-2", None),
    ];
    let lines: Vec<view::Entry> = rows
        .iter()
        .enumerate()
        .filter_map(|(n, (ts, verb, kind, id, key, name, project, ws, status))| {
            let mut v = json!({
                "ts": ts, "verb": verb, "kind": kind, "id": id, "key": key, "name": name,
                "project": project, "ws": ws, "at": format!("2026-10#{}", 100 - n),
            });
            if let Some(s) = status {
                v["changes"] = json!({ "status": ["open", s] });
            }
            view::entry_from(&v)
        })
        .collect();
    let mut names = HashMap::new();
    names.insert("WS-1".to_string(), "the gauges".to_string());
    names.insert("WS-2".to_string(), "the station map".to_string());
    names.insert("WS-7".to_string(), "Harbor app".to_string());
    let mut held = Vec::new();
    view::merge(&mut held, lines, &names, 1000);
    held
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.first().cloned().unwrap_or_else(|| "console.png".into());
    let light = args.get(1).map(|s| s == "light").unwrap_or(false);
    let dpi: u32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(96);
    let filter = args.get(3).cloned().unwrap_or_default();

    let held = sample();
    let rows = view::rows(&held, &filter, TODAY);
    let s = view::scale_of(dpi);
    let (w, h) = ((view::WIDTH as f32 * s).round() as i32, (view::HEIGHT as f32 * s).round() as i32);
    let layout = view::layout(&rows, w, h, 0, dpi);
    /* the second line drawn hovered, as the pointer would leave it */
    let hot = rows.iter().filter_map(|r| if let view::Row::Line(n, _) = r { Some(*n) } else { None }).nth(1);

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
        view::paint(dc, &held, &rows, &layout, light, hot, "Nothing matches the filter.");
        /* the box's text, where the EDIT control would draw it */
        let p = view::palette(light);
        let r = view::edit_rect(w, dpi);
        let f = view::font((view::SMALL_PX as f32 * s).round() as i32 + 1, 400);
        let (word, colour) = if filter.is_empty() { ("project, workstream or kind".to_string(), p.muted) } else { (filter.clone(), p.text) };
        let text: Vec<u16> = word.encode_utf16().collect();
        let mut rc = RECT { left: r.l, top: r.t, right: r.r, bottom: r.b };
        let of = SelectObject(dc, f as _);
        SetTextColor(dc, view::bgr(colour));
        DrawTextW(dc, text.as_ptr(), text.len() as i32, &mut rc, DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
        SelectObject(dc, of);
        DeleteObject(f as _);
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
