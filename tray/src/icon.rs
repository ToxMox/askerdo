/* The six faces, the taskbar theme that picks between them, and the HICON the
 * tray actually wears.
 *
 * The art is NOT drawn here, nor anywhere in this repo. The six committed tray
 * .ico files come from the icon package (assets/icons/README.md carries its
 * provenance, its colours and its manifest), and they are compiled into the
 * exe by include_bytes! in tray.rs, so the tray cannot lose its icon to a
 * missing file. What this file does is read those bytes, pick the frame the
 * system asks for, and hand Windows an icon handle carrying those exact
 * pixels.
 *
 * SIX AND NOT THREE, because a single .ico does not recolour itself with the
 * Windows theme and the package draws the check in two colours: a cream check
 * for a DARK taskbar (tray-waiting, tray-quiet, tray-blocking) and an orange
 * one for a LIGHT taskbar (tray-light-*). The set is chosen from the SYSTEM
 * personalization setting, never from the board's own theme, and it is chosen
 * again on the shell's ImmersiveColorSet broadcast: see Taskbar below.
 *
 * WHY THE .ico IS PARSED BY HAND rather than handed to LoadImage: the frame
 * that reaches the taskbar is chosen HERE. LoadImage takes a size and lets the
 * shell stretch whichever frame it settled on; this file hands back the exact
 * frame when the package delivers one for that size and area-averages the 48
 * frame down when it does not, which is the whole of the difference at 28, 36
 * and 40. The format is the one the package writes and its README describes:
 * an ICONDIR, then one classic 32 bit BGRA device independent bitmap per size
 * (16, 20, 24, 32, 48), bottom up, with an AND mask after it that the alpha
 * channel makes redundant. Those five frames are exact at 16, 20, 24, 32 and
 * 48; 28, 36, 40 and anything above 48 are resampled from the 48 frame. The
 * shell asks 28, 36 and 40 at 175, 225 and 250 per cent, so a resample IS
 * reached on scales Windows offers, and it goes DOWN from 48
 * rather than up.
 *
 * NO COUNT BADGE, AT ANY SIZE: nothing is painted over the delivered art, so
 * the face a state wears is the package's own frame and the mark stays whole
 * down to 16 px, where a disc half the icon wide would cover a quarter of it.
 * The count lives elsewhere: the TOOLTIP says how many are blocking (tray.rs),
 * the stream state carries the number for the tray menu, and the marker
 * the package drew into every face (amber blocking, blue waiting, the hollow
 * ring quiet) is what says the state at a glance.
 */
use std::ptr::null_mut;

use windows_sys::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateBitmap, CreateDIBSection, DIB_RGB_COLORS,
    DeleteObject,
};
use windows_sys::Win32::UI::HiDpi::{GetDpiForSystem, GetSystemMetricsForDpi};
use windows_sys::Win32::UI::WindowsAndMessaging::{CreateIconIndirect, HICON, ICONINFO, SM_CXSMICON};

/* WHICH TASKBAR THIS IS, which is the only thing that picks the face set. The
   value is HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize
   SystemUsesLightTheme: the SYSTEM's setting, the one the taskbar and the tray
   follow. AppsUseLightTheme beside it is the setting for app windows and says
   nothing about the taskbar, so it is never read. A missing value is DARK,
   which is both the Windows default and the set the mark was drawn for first. */
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Taskbar {
    Dark,
    Light,
}

impl Taskbar {
    pub fn name(self) -> &'static str {
        match self {
            Taskbar::Dark => "dark",
            Taskbar::Light => "light",
        }
    }
}

/* The pick, as a pure function of the setting, so a test can inject 1, 0 and
   absent without a registry. Anything that is not exactly 1 is dark: the value
   is documented as a boolean and a third number is not a third theme. */
pub fn taskbar_from(setting: Option<u32>) -> Taskbar {
    match setting {
        Some(1) => Taskbar::Light,
        _ => Taskbar::Dark,
    }
}

/* WM_SETTINGCHANGE carries a name in lParam, and the shell broadcasts
   `ImmersiveColorSet` when the light or dark choice moves. A null or unreadable
   lParam is taken as a yes rather than a no: re-reading one registry value on a
   settings broadcast costs nothing, and missing the one broadcast that matters
   would leave a cream check on a white taskbar until the next restart. */
pub fn names_the_colour_set(name: Option<&str>) -> bool {
    match name {
        Some(n) => n.eq_ignore_ascii_case("ImmersiveColorSet"),
        None => true,
    }
}

pub struct Frame {
    pub size: u32,
    /* top down, BGRA, straight (not premultiplied) alpha */
    pub bgra: Vec<u8>,
}

/* Reads every classic 32 bit frame out of an .ico. A frame in any other depth,
   and a PNG-compressed frame (app.ico carries one at 256), is skipped rather
   than guessed at: the six committed tray files are five classic 32 bit frames
   each by construction, and a fallback that silently drew the wrong thing
   would be worse than an empty list. The 40 byte BITMAPINFOHEADER is checked
   FIRST, because a PNG payload's own bytes would otherwise be read as a width
   and a depth. */
pub fn parse(bytes: &[u8]) -> Vec<Frame> {
    let mut out = Vec::new();
    if bytes.len() < 6 || rd_u16(bytes, 2) != 1 {
        return out;
    }
    let count = rd_u16(bytes, 4) as usize;
    for i in 0..count {
        let at = 6 + i * 16;
        if at + 16 > bytes.len() {
            break;
        }
        let offset = rd_u32(bytes, at + 12) as usize;
        if offset + 40 > bytes.len() {
            continue;
        }
        if rd_u32(bytes, offset) != 40 {
            continue;
        }
        let width = rd_i32(bytes, offset + 4);
        let height = rd_i32(bytes, offset + 8) / 2;
        let bits = rd_u16(bytes, offset + 14);
        if bits != 32 || width <= 0 || width != height {
            continue;
        }
        let size = width as u32;
        let need = (size * size * 4) as usize;
        let from = offset + 40;
        if from + need > bytes.len() {
            continue;
        }
        /* bottom up in the file, top down here */
        let mut bgra = vec![0u8; need];
        for y in 0..size {
            let src = ((size - 1 - y) * size * 4) as usize;
            let dst = (y * size * 4) as usize;
            bgra[dst..dst + (size * 4) as usize]
                .copy_from_slice(&bytes[from + src..from + src + (size * 4) as usize]);
        }
        out.push(Frame { size, bgra });
    }
    out
}

/* The pixels for the size Windows asked for: an exact frame when the file has
   one, otherwise the largest frame resampled. The package delivers 16, 20, 24,
   32 and 48, the small-icon metric at 100, 125, 150, 200 and 300 per cent, so
   those sizes are exact; 28, 36 and 40 (175, 225 and 250 per cent) and
   anything above 48 fall to the resample below, which reads the 48 frame. */
pub fn face(frames: &[Frame], size: u32) -> Vec<u8> {
    if let Some(exact) = frames.iter().find(|f| f.size == size) {
        return exact.bgra.clone();
    }
    let Some(best) = frames.iter().max_by_key(|f| f.size) else {
        return vec![0u8; (size * size * 4) as usize];
    };
    resample(&best.bgra, best.size, size)
}

/* Area average going down, bilinear going up, both in PREMULTIPLIED space so
   a transparent neighbour cannot darken an edge: averaging over the covered
   samples only is what keeps a half transparent edge from dulling the hue
   beside it. Reached for 28, 36 and 40 (175, 225 and 250 per cent), where it
   area-averages the 48 frame DOWN, and above 48, where it goes up. */
fn resample(src: &[u8], sw: u32, dw: u32) -> Vec<u8> {
    let mut out = vec![0u8; (dw * dw * 4) as usize];
    let scale = sw as f64 / dw as f64;
    for y in 0..dw {
        for x in 0..dw {
            let (b, g, r, a) = if dw < sw {
                let x0 = x as f64 * scale;
                let x1 = (x + 1) as f64 * scale;
                let y0 = y as f64 * scale;
                let y1 = (y + 1) as f64 * scale;
                area(src, sw, x0, x1, y0, y1)
            } else {
                let fx = (x as f64 + 0.5) * scale - 0.5;
                let fy = (y as f64 + 0.5) * scale - 0.5;
                bilinear(src, sw, fx, fy)
            };
            let at = ((y * dw + x) * 4) as usize;
            /* back out of premultiplied space */
            let (b, g, r) = if a > 0.0 {
                (b / a, g / a, r / a)
            } else {
                (0.0, 0.0, 0.0)
            };
            out[at] = clamp(b);
            out[at + 1] = clamp(g);
            out[at + 2] = clamp(r);
            out[at + 3] = clamp(a * 255.0);
        }
    }
    out
}

fn area(src: &[u8], sw: u32, x0: f64, x1: f64, y0: f64, y1: f64) -> (f64, f64, f64, f64) {
    let (mut b, mut g, mut r, mut a, mut n) = (0.0, 0.0, 0.0, 0.0, 0.0);
    let xs = x0.floor() as u32;
    let xe = (x1.ceil() as u32).min(sw);
    let ys = y0.floor() as u32;
    let ye = (y1.ceil() as u32).min(sw);
    for sy in ys..ye {
        for sx in xs..xe {
            let at = ((sy * sw + sx) * 4) as usize;
            let alpha = src[at + 3] as f64 / 255.0;
            b += src[at] as f64 * alpha;
            g += src[at + 1] as f64 * alpha;
            r += src[at + 2] as f64 * alpha;
            a += alpha;
            n += 1.0;
        }
    }
    if n == 0.0 {
        return (0.0, 0.0, 0.0, 0.0);
    }
    (b / n, g / n, r / n, a / n)
}

fn bilinear(src: &[u8], sw: u32, fx: f64, fy: f64) -> (f64, f64, f64, f64) {
    let x0 = fx.floor().max(0.0) as u32;
    let y0 = fy.floor().max(0.0) as u32;
    let x1 = (x0 + 1).min(sw - 1);
    let y1 = (y0 + 1).min(sw - 1);
    let tx = (fx - x0 as f64).clamp(0.0, 1.0);
    let ty = (fy - y0 as f64).clamp(0.0, 1.0);
    let at = |x: u32, y: u32| -> (f64, f64, f64, f64) {
        let i = ((y.min(sw - 1) * sw + x.min(sw - 1)) * 4) as usize;
        let alpha = src[i + 3] as f64 / 255.0;
        (
            src[i] as f64 * alpha,
            src[i + 1] as f64 * alpha,
            src[i + 2] as f64 * alpha,
            alpha,
        )
    };
    let (a00, a10, a01, a11) = (at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1));
    let mix = |p: f64, q: f64, t: f64| p + (q - p) * t;
    (
        mix(mix(a00.0, a10.0, tx), mix(a01.0, a11.0, tx), ty),
        mix(mix(a00.1, a10.1, tx), mix(a01.1, a11.1, tx), ty),
        mix(mix(a00.2, a10.2, tx), mix(a01.2, a11.2, tx), ty),
        mix(mix(a00.3, a10.3, tx), mix(a01.3, a11.3, tx), ty),
    )
}

fn clamp(v: f64) -> u8 {
    v.round().clamp(0.0, 255.0) as u8
}

/* ---- the handle -------------------------------------------------------- */

/* The system small icon metric at the SYSTEM DPI: 16 at 100 per cent, 20 at
   125, 24 at 150, 32 at 200. GetDpiForSystem is the primary monitor's DPI, not
   the taskbar's, so on a mixed-DPI desk a taskbar on the other monitor gets a
   frame cut for the primary's scale and the shell stretches it. That is a
   known residual, not a claim of per-monitor correctness: the process is
   per-monitor aware v2 for its window metrics, and the tray icon size is one
   number for the whole system. */
pub fn small_icon_size() -> u32 {
    unsafe {
        let dpi = GetDpiForSystem();
        let cx = GetSystemMetricsForDpi(SM_CXSMICON, dpi);
        if cx > 0 { cx as u32 } else { 16 }
    }
}

/* An icon handle out of straight BGRA. The colour bitmap carries the alpha, so
   the AND mask is all zeroes (every pixel opaque as far as the legacy path is
   concerned) and the alpha channel does the shaping. */
pub fn to_hicon(px: &[u8], size: u32) -> HICON {
    unsafe {
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size as i32,
            /* negative: top down, the order the pixels are already in */
            biHeight: -(size as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        };
        let mut bits: *mut core::ffi::c_void = null_mut();
        let colour = CreateDIBSection(
            null_mut(),
            &info,
            DIB_RGB_COLORS,
            &mut bits,
            null_mut(),
            0,
        );
        if colour.is_null() || bits.is_null() {
            return null_mut();
        }
        std::ptr::copy_nonoverlapping(px.as_ptr(), bits as *mut u8, px.len());

        let stride = ((size as usize + 15) / 16) * 2;
        let mask_bits = vec![0u8; stride * size as usize];
        let mask = CreateBitmap(size as i32, size as i32, 1, 1, mask_bits.as_ptr().cast());
        if mask.is_null() {
            DeleteObject(colour);
            return null_mut();
        }

        let info = ICONINFO {
            fIcon: 1,
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: mask,
            hbmColor: colour,
        };
        let icon = CreateIconIndirect(&info);
        DeleteObject(colour);
        DeleteObject(mask);
        icon
    }
}

fn rd_u16(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

fn rd_u32(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

fn rd_i32(b: &[u8], at: usize) -> i32 {
    i32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

#[cfg(test)]
mod tests {
    use super::{Taskbar, face, names_the_colour_set, parse, taskbar_from};
    use crate::tray::{ART_DARK, ART_LIGHT};

    /* The delivered frame set: the small-icon metric at 100, 125, 150, 200 and
       300 per cent, exact in the file. The metric at 175, 225 and 250 per cent
       (28, 36 and 40) is not delivered and is resampled from the 48 frame. */
    const DELIVERED: [u32; 5] = [16, 20, 24, 32, 48];

    #[test]
    fn all_six_faces_carry_the_five_delivered_frames() {
        for (set, which) in [(ART_DARK, "dark"), (ART_LIGHT, "light")] {
            for bytes in set {
                let frames = parse(bytes);
                let mut sizes: Vec<u32> = frames.iter().map(|f| f.size).collect();
                sizes.sort();
                assert_eq!(sizes, DELIVERED.to_vec(), "{which}");
                for frame in &frames {
                    assert_eq!(frame.bgra.len(), (frame.size * frame.size * 4) as usize);
                }
            }
        }
    }

    #[test]
    fn every_size_windows_asks_for_is_an_exact_frame() {
        let frames = parse(ART_DARK[0]);
        for size in DELIVERED {
            let exact = frames.iter().find(|f| f.size == size).unwrap();
            /* the same bytes, not merely the same length: a resample of the
               right length would pass a length check and lose the hinting */
            assert_eq!(face(&frames, size), exact.bgra, "{size}");
        }
        /* off the delivered set the largest frame is resampled: the shell's own
           asks at 175, 225 and 250 per cent (28, 36, 40) go down from 48, and
           anything above 48 goes up */
        assert_eq!(face(&frames, 64).len(), 64 * 64 * 4);
    }

    #[test]
    fn the_light_and_dark_sets_are_six_distinct_files() {
        let mut seen: Vec<&[u8]> = Vec::new();
        for bytes in ART_DARK.iter().chain(ART_LIGHT.iter()) {
            assert!(!seen.contains(bytes), "two faces are the same file");
            seen.push(bytes);
        }
        assert_eq!(seen.len(), 6);
    }

    #[test]
    fn the_taskbar_theme_comes_from_the_system_setting_alone() {
        assert_eq!(taskbar_from(Some(1)), Taskbar::Light);
        assert_eq!(taskbar_from(Some(0)), Taskbar::Dark);
        assert_eq!(taskbar_from(None), Taskbar::Dark);
        /* not a boolean, not a third theme */
        assert_eq!(taskbar_from(Some(2)), Taskbar::Dark);
        assert_eq!(Taskbar::Light.name(), "light");
        assert_eq!(Taskbar::Dark.name(), "dark");
    }

    #[test]
    fn the_settings_message_is_read_for_the_colour_set() {
        assert!(names_the_colour_set(Some("ImmersiveColorSet")));
        assert!(names_the_colour_set(Some("immersivecolorset")));
        assert!(!names_the_colour_set(Some("Environment")));
        assert!(!names_the_colour_set(Some("Policy")));
        /* an unreadable name re-reads rather than misses the one that matters */
        assert!(names_the_colour_set(None));
    }

    /* NO count badge, at any size. The blocking state is the one
       a count badge would sit on, so it is the one pinned here, in both taskbar sets: what the tray hands Windows for a
       blocking board is the package's delivered frame, byte for byte. The
       comparison is on the PIXELS and not on the length, because an overlay
       and a resample both keep the length and change the bytes. */
    #[test]
    fn the_blocking_face_is_the_delivered_frame_with_nothing_painted_over_it() {
        for (art, which) in [(ART_DARK[2], "dark"), (ART_LIGHT[2], "light")] {
            let frames = parse(art);
            for size in [16u32, 32] {
                let delivered = frames.iter().find(|f| f.size == size).unwrap();
                assert_eq!(face(&frames, size), delivered.bgra, "{which} {size}");
            }
        }
    }
}
