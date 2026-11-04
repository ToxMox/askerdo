/* The activity console: a window opened from the tray menu, a live
 * tail of the board's activity log grouped by day, newest first, with one
 * filter box. Each line opens its record through the board's r/<key> redirect.
 *
 * The feed is shared: the network thread merges the stream's activity lines
 * into it and posts; a short-lived thread fetches api/activity when the window
 * opens. The window itself lives on the message loop thread like every other.
 * Pure model, layout and drawing are console_view.rs.
 */
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, SYSTEMTIME, WPARAM};
use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateSolidBrush, DeleteDC,
    DeleteObject, EndPaint, HBRUSH, HDC, HFONT, InvalidateRect, PAINTSTRUCT, SRCCOPY, SelectObject,
    SetBkColor, SetTextColor,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::SystemInformation::GetLocalTime;
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SetFocus, TME_LEAVE, TRACKMOUSEEVENT, TrackMouseEvent, VK_ESCAPE};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, GetClientRect, GetWindowTextLengthW,
    GetWindowTextW, HTCLIENT, IDC_ARROW, IDC_HAND, IsIconic, IsWindowVisible, LoadCursorW, LoadIconW, MINMAXINFO,
    MSG, MoveWindow, PostMessageW, RegisterClassW, SPI_GETWORKAREA, SW_RESTORE, SW_SHOW, SWP_NOZORDER,
    SendMessageW, SetCursor, SetForegroundWindow, SetWindowPos, SetWindowTextW, ShowWindow, SystemParametersInfoW,
    WM_COMMAND, WM_DESTROY, WM_DPICHANGED, WM_KEYDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_PAINT, WM_SETCURSOR,
    WM_SETTINGCHANGE, WNDCLASSW, WS_CHILD, WS_OVERLAPPEDWINDOW, WS_TABSTOP, WS_VISIBLE,
};

use crate::console_view::{self as view, Entry, Layout, Row};
use crate::http;
use crate::registry::wide;
use crate::{App, icon, net, registry, tray, url};

/* the message the network thread posts to the tray window when the feed moved */
pub const WM_TRAY_CONSOLE: u32 = 0x0400 + 5;
/* in Win32_UI_Controls and friends, features this crate does not take for a few constants */
const WM_SIZE: u32 = 0x0005;
const WM_SETFOCUS: u32 = 0x0007;
const WM_ERASEBKGND: u32 = 0x0014;
const WM_GETMINMAXINFO: u32 = 0x0024;
const WM_SETFONT: u32 = 0x0030;
const WM_CTLCOLOREDIT: u32 = 0x0133;
const WM_MOUSEWHEEL: u32 = 0x020A;
const WM_MOUSELEAVE: u32 = 0x02A3;
const EN_CHANGE: usize = 0x0300;
const ES_AUTOHSCROLL: u32 = 0x0080;
const EM_SETCUEBANNER: u32 = 0x1501;
const EDIT_ID: usize = 1;
/* the newest page api/activity answers (its cap), and what the console holds */
const PAGE: u32 = 200;
const HELD_MAX: usize = 1000;
const BODY_MAX: usize = 4 * 1024 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const MARGIN: i32 = 12;

#[derive(Default)]
struct Feed {
    entries: Vec<Entry>,
    names: HashMap<String, String>,
    /* a page was asked for since the stream last attached */
    loaded: bool,
    failed: bool,
}

static FEED: Mutex<Option<Feed>> = Mutex::new(None);
/* whether the window is up, for the network thread's reconnect */
static OPEN: AtomicBool = AtomicBool::new(false);

fn with_feed<R>(f: impl FnOnce(&mut Feed) -> R) -> Option<R> {
    let mut g = FEED.lock().ok()?;
    Some(f(g.get_or_insert_with(Feed::default)))
}

/* Rows out of a page or a frame, and the page's workstream names. */
fn read_lines(v: &Value, key: &str) -> (Vec<Entry>, HashMap<String, String>) {
    let lines = v
        .get(key)
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(view::entry_from).collect())
        .unwrap_or_default();
    let mut names = HashMap::new();
    if let Some(m) = v.get("wsNames").and_then(|x| x.as_object()) {
        for (k, n) in m {
            if let Some(n) = n.as_str() {
                names.insert(k.clone(), net::cut_chars(n, 80));
            }
        }
    }
    (lines, names)
}

fn absorb(lines: Vec<Entry>, names: HashMap<String, String>) {
    with_feed(|f| {
        f.names.extend(names);
        view::merge(&mut f.entries, lines, &f.names, HELD_MAX);
    });
}

/* The network thread's half: a hello or change frame's activity lines into the
   feed once a page is held (before that, the page will carry them). */
pub fn take(hwnd: isize, frame: &Value) {
    let (lines, names) = read_lines(frame, "activity");
    if lines.is_empty() || with_feed(|f| f.loaded) != Some(true) {
        return;
    }
    absorb(lines, names);
    unsafe { PostMessageW(hwnd as HWND, WM_TRAY_CONSOLE, 0, 0) };
}

/* A fresh stream may have missed lines: an open console asks for the page
   again, a closed one asks when it next opens. */
pub fn attached(app: &Arc<App>, hwnd: isize) {
    with_feed(|f| f.loaded = false);
    if OPEN.load(Ordering::SeqCst) {
        fetch(app.clone(), hwnd);
    }
}

/* api/activity's newest page, off the message loop and off the stream's
   thread; the answer lands in the feed and the tray window is posted. */
fn fetch(app: Arc<App>, hwnd: isize) {
    with_feed(|f| {
        f.loaded = true;
        f.failed = false;
    });
    std::thread::spawn(move || {
        let raw = format!("{}api/activity?limit={PAGE}", app.args.board);
        let got = (|| -> Result<Value, String> {
            let target = url::parse(&raw).ok_or("the activity url will not parse")?;
            let headers = [("User-Agent", format!("askerdo-tray/{}", app.args.version))];
            let req = http::Request {
                method: "GET",
                url: &target,
                headers: &headers,
                body: None,
                connect_timeout: FETCH_TIMEOUT,
                io_timeout: FETCH_TIMEOUT,
            };
            let mut resp = http::send(req).map_err(|e| e.to_string())?;
            if resp.status != 200 {
                return Err(format!("answered {}", resp.status));
            }
            serde_json::from_slice(&resp.drain(BODY_MAX)).map_err(|_| "the answer was not JSON".to_string())
        })();
        match got {
            Ok(v) => {
                let (lines, names) = read_lines(&v, "lines");
                app.journal.line(&format!("console fetched {} lines", lines.len()));
                absorb(lines, names);
            }
            Err(why) => {
                app.journal.line(&format!("console fetch failed: {why}"));
                with_feed(|f| {
                    f.failed = true;
                    f.loaded = false;
                });
            }
        }
        unsafe { PostMessageW(hwnd as HWND, WM_TRAY_CONSOLE, 0, 0) };
    });
}

/* ---- the window --------------------------------------------------------- */

struct Con {
    app: Arc<App>,
    hwnd: HWND,
    edit: HWND,
    edit_font: HFONT,
    brush: HBRUSH,
    brush_light: bool,
    filter: String,
    entries: Vec<Entry>,
    rows: Vec<Row>,
    layout: Layout,
    scroll: i32,
    hot: Option<usize>,
    tracking: bool,
}

thread_local! {
    static CON: RefCell<Option<Con>> = const { RefCell::new(None) };
}

fn light() -> bool {
    icon::taskbar_from(registry::system_uses_light_theme()) == icon::Taskbar::Light
}

fn today() -> String {
    let mut t: SYSTEMTIME = unsafe { std::mem::zeroed() };
    unsafe { GetLocalTime(&mut t) };
    format!("{:04}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay)
}

/* The menu's half: one window, shown and brought forward when it is already up. */
pub fn open(app: &Arc<App>, tray_hwnd: isize) {
    if let Some(hwnd) = CON.with(|c| c.borrow().as_ref().map(|s| s.hwnd)) {
        show(hwnd);
        unsafe { SetForegroundWindow(hwnd) };
        return;
    }
    if !create(app) {
        app.journal.line("console: could not create the window");
        return;
    }
    OPEN.store(true, Ordering::SeqCst);
    if with_feed(|f| f.loaded) != Some(true) {
        fetch(app.clone(), tray_hwnd);
    }
    refresh();
}

/* A hidden launch (lib/tray.mjs spawns with windowsHide) turns the process's
   first ShowWindow of an overlapped window into SW_HIDE; a second call is
   honoured, so a window still hidden is shown again (measured). */
fn show(hwnd: HWND) {
    unsafe {
        let cmd = if IsIconic(hwnd) != 0 { SW_RESTORE } else { SW_SHOW };
        ShowWindow(hwnd, cmd);
        if IsWindowVisible(hwnd) == 0 {
            ShowWindow(hwnd, cmd);
        }
    }
}

fn create(app: &Arc<App>) -> bool {
    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let class = wide("AskerDoConsole");
        let wc = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(wndproc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            /* the exe's own icon resource, 1 by winresource's default */
            hIcon: LoadIconW(instance, 1 as _),
            hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class.as_ptr(),
        };
        RegisterClassW(&wc);
        let title = wide("AskerDo activity");
        let hwnd = CreateWindowExW(0, class.as_ptr(), title.as_ptr(), WS_OVERLAPPEDWINDOW,
            0, 0, 1, 1, std::ptr::null_mut(), std::ptr::null_mut(), instance, std::ptr::null());
        if hwnd.is_null() {
            return false;
        }
        let edit_class = wide("EDIT");
        let empty = wide("");
        let edit = CreateWindowExW(0, edit_class.as_ptr(), empty.as_ptr(),
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_AUTOHSCROLL,
            0, 0, 1, 1, hwnd, EDIT_ID as _, instance, std::ptr::null());
        let cue = wide("project, workstream or kind");
        SendMessageW(edit, EM_SETCUEBANNER, 0, cue.as_ptr() as LPARAM);
        CON.with(|c| {
            *c.borrow_mut() = Some(Con {
                app: app.clone(),
                hwnd,
                edit,
                edit_font: std::ptr::null_mut(),
                brush: std::ptr::null_mut(),
                brush_light: false,
                filter: String::new(),
                entries: Vec::new(),
                rows: Vec::new(),
                layout: Layout::default(),
                scroll: 0,
                hot: None,
                tracking: false,
            });
        });
        /* sized at the window's own dpi, parked by the tray's corner */
        let dpi = GetDpiForWindow(hwnd);
        let s = view::scale_of(dpi);
        let px = |n: i32| (n as f32 * s).round() as i32;
        let mut wa = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        SystemParametersInfoW(SPI_GETWORKAREA, 0, (&mut wa as *mut RECT).cast(), 0);
        let w = px(view::WIDTH).min(wa.right - wa.left);
        let h = px(view::HEIGHT).min(wa.bottom - wa.top);
        SetWindowPos(hwnd, std::ptr::null_mut(), wa.right - w - px(MARGIN), wa.bottom - h - px(MARGIN), w, h, SWP_NOZORDER);
        theme(hwnd, dpi);
        show(hwnd);
        SetForegroundWindow(hwnd);
        SetFocus(edit);
    }
    true
}

/* the title bar's dark mode, the box's font and colours: at create, on a dpi
   move and on a theme flip */
fn theme(hwnd: HWND, dpi: u32) {
    let lit = light();
    let dark: i32 = (!lit) as i32;
    unsafe { DwmSetWindowAttribute(hwnd, 20, (&dark as *const i32).cast(), 4) };
    CON.with(|c| {
        let mut b = c.borrow_mut();
        let Some(s) = b.as_mut() else { return };
        unsafe {
            let f = view::font((view::SMALL_PX as f32 * view::scale_of(dpi)).round() as i32 + 1, 400);
            SendMessageW(s.edit, WM_SETFONT, f as WPARAM, 1);
            if !s.edit_font.is_null() {
                DeleteObject(s.edit_font as _);
            }
            s.edit_font = f;
            if !s.brush.is_null() {
                DeleteObject(s.brush as _);
            }
            s.brush = CreateSolidBrush(view::bgr(view::palette(lit).back));
            s.brush_light = lit;
        }
    });
    place(hwnd);
}

/* the box into its row and the list laid out at the client size */
fn place(hwnd: HWND) {
    let mut rc = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    unsafe { GetClientRect(hwnd, &mut rc) };
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    CON.with(|c| {
        let mut b = c.borrow_mut();
        let Some(s) = b.as_mut() else { return };
        let r = view::edit_rect(rc.right, dpi);
        unsafe { MoveWindow(s.edit, r.l, r.t, (r.r - r.l).max(1), (r.b - r.t).max(1), 1) };
        s.layout = view::layout(&s.rows, rc.right, rc.bottom, s.scroll, dpi);
        s.scroll = s.layout.scroll;
    });
    unsafe { InvalidateRect(hwnd, std::ptr::null(), 0) };
}

/* The feed or the filter moved: the rows again, then the layout. */
pub fn refresh() {
    let Some(hwnd) = CON.with(|c| c.borrow().as_ref().map(|s| s.hwnd)) else {
        return;
    };
    let entries = with_feed(|f| f.entries.clone()).unwrap_or_default();
    let day = today();
    CON.with(|c| {
        if let Some(s) = c.borrow_mut().as_mut() {
            s.rows = view::rows(&entries, &s.filter, &day);
            s.entries = entries;
            s.hot = None;
        }
    });
    place(hwnd);
}

fn empty_words(filtered: bool) -> &'static str {
    match with_feed(|f| (f.failed, f.loaded, f.entries.is_empty())) {
        Some((true, _, _)) => "The board did not answer. Close and open the console to try again.",
        _ if filtered => "Nothing matches the filter.",
        Some((_, _, true)) => "No activity yet.",
        _ => "",
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_PAINT => {
            paint(hwnd);
            0
        }
        WM_ERASEBKGND => 1,
        WM_SIZE => {
            place(hwnd);
            0
        }
        WM_SETFOCUS => {
            if let Some(e) = CON.with(|c| c.borrow().as_ref().map(|s| s.edit)) {
                unsafe { SetFocus(e) };
            }
            0
        }
        WM_GETMINMAXINFO => {
            let s = view::scale_of(unsafe { GetDpiForWindow(hwnd) });
            let mm = lp as *mut MINMAXINFO;
            if !mm.is_null() {
                unsafe {
                    (*mm).ptMinTrackSize.x = (320.0 * s) as i32;
                    (*mm).ptMinTrackSize.y = (240.0 * s) as i32;
                }
            }
            0
        }
        WM_DPICHANGED => {
            let r = lp as *const RECT;
            if !r.is_null() {
                let r = unsafe { *r };
                unsafe { SetWindowPos(hwnd, std::ptr::null_mut(), r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOZORDER) };
            }
            theme(hwnd, (wp & 0xFFFF) as u32);
            0
        }
        WM_SETTINGCHANGE => {
            theme(hwnd, unsafe { GetDpiForWindow(hwnd) });
            unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
        }
        WM_COMMAND => {
            if (wp & 0xFFFF) == EDIT_ID && ((wp >> 16) & 0xFFFF) == EN_CHANGE {
                filter_changed();
            }
            0
        }
        WM_CTLCOLOREDIT => {
            let lit = light();
            let p = view::palette(lit);
            let dc = wp as HDC;
            unsafe {
                SetTextColor(dc, view::bgr(p.text));
                SetBkColor(dc, view::bgr(p.back));
            }
            CON.with(|c| c.borrow().as_ref().map(|s| s.brush as LRESULT)).unwrap_or(0)
        }
        WM_MOUSEWHEEL => {
            let delta = ((wp >> 16) & 0xFFFF) as i16 as i32;
            CON.with(|c| {
                if let Some(s) = c.borrow_mut().as_mut() {
                    let step = (44.0 * 3.0 * s.layout.scale) as i32;
                    s.scroll -= delta * step / 120;
                }
            });
            place(hwnd);
            0
        }
        WM_MOUSEMOVE => {
            let (x, y) = point(lp);
            let moved = CON.with(|c| {
                let mut b = c.borrow_mut();
                let s = b.as_mut()?;
                if !s.tracking {
                    let mut tme = TRACKMOUSEEVENT {
                        cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                        dwFlags: TME_LEAVE,
                        hwndTrack: hwnd,
                        dwHoverTime: 0,
                    };
                    unsafe { TrackMouseEvent(&mut tme) };
                    s.tracking = true;
                }
                let hot = view::hit(&s.layout, &s.rows, x, y);
                let moved = hot != s.hot;
                s.hot = hot;
                Some(moved)
            });
            if moved == Some(true) {
                unsafe { InvalidateRect(hwnd, std::ptr::null(), 0) };
            }
            0
        }
        WM_MOUSELEAVE => {
            CON.with(|c| {
                if let Some(s) = c.borrow_mut().as_mut() {
                    s.tracking = false;
                    s.hot = None;
                }
            });
            unsafe { InvalidateRect(hwnd, std::ptr::null(), 0) };
            0
        }
        WM_SETCURSOR if (lp & 0xFFFF) as u32 == HTCLIENT && wp as HWND == hwnd => {
            let hot = CON.with(|c| c.borrow().as_ref().and_then(|s| s.hot));
            let shape = if hot.is_some() { IDC_HAND } else { IDC_ARROW };
            unsafe { SetCursor(LoadCursorW(std::ptr::null_mut(), shape)) };
            1
        }
        WM_LBUTTONUP => {
            let (x, y) = point(lp);
            click(x, y);
            0
        }
        WM_DESTROY => {
            OPEN.store(false, Ordering::SeqCst);
            CON.with(|c| {
                if let Some(s) = c.borrow_mut().take() {
                    unsafe {
                        DeleteObject(s.edit_font as _);
                        DeleteObject(s.brush as _);
                    }
                }
            });
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wp, lp) },
    }
}

fn point(lp: LPARAM) -> (i32, i32) {
    ((lp & 0xFFFF) as i16 as i32, ((lp >> 16) & 0xFFFF) as i16 as i32)
}

fn filter_changed() {
    let Some(edit) = CON.with(|c| c.borrow().as_ref().map(|s| s.edit)) else {
        return;
    };
    let text = unsafe {
        let n = GetWindowTextLengthW(edit).clamp(0, 400);
        let mut buf = vec![0u16; n as usize + 1];
        let got = GetWindowTextW(edit, buf.as_mut_ptr(), buf.len() as i32);
        String::from_utf16_lossy(&buf[..got.max(0) as usize])
    };
    CON.with(|c| {
        if let Some(s) = c.borrow_mut().as_mut() {
            s.filter = text;
            s.scroll = 0;
        }
    });
    refresh();
}

/* Esc in the console clears the filter. The box is a plain EDIT with no
   dialog manager, so the loop asks here before dispatch; true swallows the key. */
pub fn escape(msg: &MSG) -> bool {
    if msg.message != WM_KEYDOWN || msg.wParam != VK_ESCAPE as WPARAM {
        return false;
    }
    let Some((hwnd, edit)) = CON.with(|c| c.borrow().as_ref().map(|s| (s.hwnd, s.edit))) else {
        return false;
    };
    if msg.hwnd != edit && msg.hwnd != hwnd {
        return false;
    }
    if unsafe { GetWindowTextLengthW(edit) } == 0 {
        return true;
    }
    let empty = [0u16];
    unsafe { SetWindowTextW(edit, empty.as_ptr()) };
    /* a single-line box sends EN_CHANGE for this; the filter is read again only if it did not */
    if CON.with(|c| c.borrow().as_ref().is_some_and(|s| !s.filter.is_empty())) {
        filter_changed();
    }
    true
}

/* The record's issue through the board's own redirect, by key where the line
   carries one; like every URL this exe opens, it must sit under the board root. */
pub fn record_url(board: &str, e: &Entry) -> Option<String> {
    let id = if net::well_formed_key(&e.key) {
        &e.key
    } else if net::well_formed_ref(&e.id) {
        &e.id
    } else {
        return None;
    };
    let url = format!("{board}r/{id}");
    (url.starts_with(board) && !url.chars().any(char::is_whitespace)).then_some(url)
}

fn click(x: i32, y: i32) {
    let Some((app, url)) = CON.with(|c| {
        let b = c.borrow();
        let s = b.as_ref()?;
        let n = view::hit(&s.layout, &s.rows, x, y)?;
        let e = s.entries.get(n)?;
        Some((s.app.clone(), record_url(&s.app.args.board, e)?))
    }) else {
        return;
    };
    app.journal.line(&format!("console chose {url}"));
    tray::shell_open(&url);
}

fn paint(hwnd: HWND) {
    let filtered = CON.with(|c| c.borrow().as_ref().map(|s| !s.filter.trim().is_empty())).unwrap_or(false);
    let empty = empty_words(filtered);
    CON.with(|c| {
        let b = c.borrow();
        let Some(s) = b.as_ref() else { return };
        unsafe {
            let mut ps: PAINTSTRUCT = std::mem::zeroed();
            let hdc = BeginPaint(hwnd, &mut ps);
            let (w, h) = (s.layout.width.max(1), s.layout.height.max(1));
            /* drawn off screen and copied once, so a scroll or hover never flickers */
            let mem = CreateCompatibleDC(hdc);
            let bmp = CreateCompatibleBitmap(hdc, w, h);
            let old = SelectObject(mem, bmp as _);
            view::paint(mem, &s.entries, &s.rows, &s.layout, s.brush_light, s.hot, empty);
            BitBlt(hdc, 0, 0, w, h, mem, 0, 0, SRCCOPY);
            SelectObject(mem, old);
            DeleteObject(bmp as _);
            DeleteDC(mem);
            EndPaint(hwnd, &ps);
        }
    });
}
