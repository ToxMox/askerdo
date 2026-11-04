/* The alert event: the frame read off the stream and the popup window
 * with its clicks, the one surface every alert draws on.
 *
 * The network thread parses; the popup itself lives on the message loop thread
 * like every other window here, reached by an inbox and a post. The server
 * sends `alert` only to an exe that announced it (the x-askerdo-popup header).
 */
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::Value;
use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute, DwmSetWindowAttribute};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
    EndPaint, GetDC, InvalidateRect, PAINTSTRUCT, ReleaseDC, SRCCOPY, SelectObject,
};
use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_ALIAS, SND_ASYNC, SND_NODEFAULT};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{TME_LEAVE, TRACKMOUSEEVENT, TrackMouseEvent};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CS_DROPSHADOW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu,
    EnumWindows, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, HTCLIENT, IDC_ARROW, IDC_HAND, IsIconic, IsWindowVisible, KillTimer, LoadCursorW, MA_NOACTIVATE, MF_STRING,
    PostMessageW, RegisterClassW, SPI_GETWORKAREA, SW_HIDE, SW_SHOWNOACTIVATE, SWP_NOACTIVATE,
    SetCursor, SetForegroundWindow, SetTimer, SetWindowPos, ShowWindow, SystemParametersInfoW,
    TPM_RETURNCMD, TPM_RIGHTBUTTON, TrackPopupMenu, WM_DPICHANGED, WM_LBUTTONUP, WM_MOUSEACTIVATE,
    WM_MOUSEMOVE, WM_NULL, WM_PAINT, WM_RBUTTONUP, WM_SETCURSOR, WM_TIMER,
    WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

use crate::popup::{self, Alert, File, Hit, Kind, Layout, Stack};
use crate::registry::wide;
use crate::{App, icon, net, registry, tray};

/* the message the network thread posts to the tray window when the inbox grew */
pub const WM_TRAY_ALERT: u32 = 0x0400 + 4;
/* in Win32_UI_Controls, a feature this crate does not take for one constant */
const WM_MOUSELEAVE: u32 = 0x02A3;
const TIMER_ID: usize = 1;
const TIMER_MS: u32 = 500;
/* while only blockers show, the timer just keeps the label's age current */
const AGE_MS: u32 = 15_000;
/* the gap between the popup and the work area's corner, logical pixels */
const MARGIN: i32 = 12;
/* the wire bounds, the server's own: a frame that says more is cut, not trusted */
const TITLE_MAX: usize = 120;
const PLACE_MAX: usize = 80;
const NAMES_MAX: usize = 120;
const PICK_MAX: usize = 80;
const NAME_MAX: usize = 120;

/* alerts and retracts share one queue, so a retract never overtakes the alert
   sent before it, nor clears one sent after it */
enum Msg {
    Alert(Alert),
    Retract(String),
}

static INBOX: Mutex<Vec<Msg>> = Mutex::new(Vec::new());

/* ---- the frame ---------------------------------------------------------- */

/* The frame into an Alert, or the reason it is not one. The card must sit under
   this exe's own board root and each file must pass the store's id shape, so
   nothing off the board is ever opened from a popup click. */
pub fn parse(data: &str, board: &str) -> Result<Alert, String> {
    let v: Value = serde_json::from_str(data).map_err(|_| "the frame was not JSON".to_string())?;
    let kind = v
        .get("kind")
        .and_then(|x| x.as_str())
        .and_then(Kind::parse)
        .ok_or("the frame named no kind this build draws")?;
    let title = net::cut_chars(&flat(v.get("title").and_then(|x| x.as_str()).unwrap_or("")), TITLE_MAX);
    if title.is_empty() {
        return Err("the frame carried no title".into());
    }
    let card = v.get("card").and_then(|x| x.as_str()).unwrap_or("");
    let card = if card.is_empty() || (card.starts_with(board) && !card.chars().any(char::is_whitespace)) {
        card.to_string()
    } else {
        return Err("the card is not on this board".into());
    };
    let mut files = Vec::new();
    if let Some(list) = v.get("files").and_then(|x| x.as_array()) {
        for f in list {
            let Some(id) = f.get("id").and_then(|x| x.as_str()) else {
                continue;
            };
            let Some(index) = f.get("index").and_then(|x| x.as_u64()) else {
                continue;
            };
            if !net::well_formed_ref(id) || index > net::INDEX_MAX {
                continue;
            }
            let name = net::cut_chars(f.get("name").and_then(|x| x.as_str()).unwrap_or(""), NAME_MAX);
            files.push(File {
                id: id.to_string(),
                index: index as u32,
                name,
            });
            if files.len() == popup::FILES_MAX {
                break;
            }
        }
    }
    let line = |key: &str, max: usize| net::cut_chars(&flat(v.get(key).and_then(|x| x.as_str()).unwrap_or("")), max);
    /* the sender's names where it gave them, its `where` otherwise */
    let names = line("place", NAMES_MAX);
    Ok(Alert {
        kind,
        title,
        place: if names.is_empty() { line("where", PLACE_MAX) } else { names },
        pick: line("pick", PICK_MAX),
        arrived: Instant::now(),
        blocking: v.get("blocking").and_then(|x| x.as_bool()).unwrap_or(kind == Kind::Blocker),
        card,
        question: question_of(&v),
        files,
        sound: v.get("sound").and_then(|x| x.as_str()).unwrap_or("").to_string(),
    })
}

/* a question id under `question`, or empty: anything else names nothing */
fn question_of(v: &Value) -> String {
    let q = v.get("question").and_then(|x| x.as_str()).unwrap_or("");
    let digits = q.strip_prefix('Q').unwrap_or("");
    if !digits.is_empty() && digits.len() <= 12 && digits.bytes().all(|b| b.is_ascii_digit()) {
        q.to_string()
    } else {
        String::new()
    }
}

/* The retract frame: the question it names, or the reason it names none. */
pub fn parse_retract(data: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(data).map_err(|_| "the frame was not JSON".to_string())?;
    let q = question_of(&v);
    if q.is_empty() { Err("the retract named no question".into()) } else { Ok(q) }
}

fn flat(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/* The network thread's half: leave the alert in the inbox and wake the message
   loop. */
pub fn take(app: &Arc<App>, hwnd: isize, data: &str, arrived: Instant) {
    let alert = match parse(data, &app.args.board) {
        Ok(a) => Alert { arrived, ..a },
        Err(why) => {
            app.journal.line(&format!("alert: {why}"));
            return;
        }
    };
    if let Ok(mut inbox) = INBOX.lock() {
        inbox.push(Msg::Alert(alert));
    }
    unsafe { PostMessageW(hwnd as HWND, WM_TRAY_ALERT, 0, 0) };
    app.journal
        .line(&format!("alert queued {} ms", arrived.elapsed().as_millis()));
}

/* A question settled elsewhere: queued behind the alerts already in, and drawn
   off the popup on the message loop. */
pub fn take_retract(app: &Arc<App>, hwnd: isize, data: &str) {
    let q = match parse_retract(data) {
        Ok(q) => q,
        Err(why) => {
            app.journal.line(&format!("retract: {why}"));
            return;
        }
    };
    if let Ok(mut inbox) = INBOX.lock() {
        inbox.push(Msg::Retract(q));
    }
    unsafe { PostMessageW(hwnd as HWND, WM_TRAY_ALERT, 0, 0) };
}

/* the settings' sound name (`Default`, `Looping.Alarm2`) as Windows' system sound
   alias; '' and 'silent' are no sound, and anything not shaped like a name is refused */
pub fn sound_alias(sound: &str) -> Option<String> {
    if sound.is_empty() || sound == "silent" || sound.len() > 32 {
        return None;
    }
    if !sound.chars().all(|c| c.is_ascii_alphanumeric() || c == '.') {
        return None;
    }
    Some(format!("Notification.{sound}"))
}

/* ---- the window --------------------------------------------------------- */

struct Pop {
    app: Arc<App>,
    hwnd: HWND,
    stack: Stack,
    layout: Layout,
    hot: Option<Hit>,
    tracking: bool,
    /* the running timer's period in ms, 0 for none */
    timer: u32,
    /* the label lines last painted, so the age timer repaints only on a change */
    labels: Vec<String>,
    /* the placement's journal line last written, empty while nothing shows */
    placed: String,
}

thread_local! {
    static POP: RefCell<Option<Pop>> = const { RefCell::new(None) };
}

/* The message loop's half: the inbox into the stack, the window made the first
   time it is needed. A window that will not come up costs the alerts one line. */
pub fn drain(app: &Arc<App>) {
    let list: Vec<Msg> = match INBOX.lock() {
        Ok(mut inbox) => std::mem::take(&mut *inbox),
        Err(_) => return,
    };
    let alerts = list.iter().filter(|m| matches!(m, Msg::Alert(_))).count();
    /* retracts alone never open the window: with none made, no card is up */
    if alerts == 0 && POP.with(|c| c.borrow().is_none()) {
        return;
    }
    if !ensure_window(app) {
        app.journal
            .line(&format!("popup: the window would not open: {alerts} alerts dropped"));
        return;
    }
    let sound = list.iter().rev().find_map(|m| match m {
        Msg::Alert(a) => Some(sound_alias(&a.sound)),
        Msg::Retract(_) => None,
    }).flatten();
    POP.with(|c| {
        if let Some(p) = c.borrow_mut().as_mut() {
            for m in list {
                match m {
                    Msg::Alert(a) => {
                        app.journal.line(&format!("popup {} {}", kind_name(a.kind), a.card));
                        for dropped in p.stack.push(a) {
                            app.journal
                                .line(&format!("popup queue full: dropped {}", dropped.card));
                        }
                    }
                    Msg::Retract(q) => {
                        let n = p.stack.retract(&q);
                        if n > 0 {
                            p.hot = None;
                            app.journal.line(&format!("popup retract {q}: {n} cards left"));
                        }
                    }
                }
            }
        }
    });
    /* one cue per drain, the newest alert's: one audible cue per event, never a burst */
    if let Some(alias) = sound {
        let w = wide(&alias);
        unsafe { PlaySoundW(w.as_ptr(), std::ptr::null_mut(), SND_ALIAS | SND_ASYNC | SND_NODEFAULT) };
    }
    refresh();
}

fn kind_name(k: Kind) -> &'static str {
    match k {
        Kind::Question => "question",
        Kind::Blocker => "blocker",
        Kind::Answer => "answer",
        Kind::Track => "track",
        Kind::Handoff => "handoff",
        Kind::Done => "done",
        Kind::Dropped => "dropped",
        Kind::Closed => "closed",
        Kind::Depth => "depth",
        Kind::Info => "info",
    }
}

fn ensure_window(app: &Arc<App>) -> bool {
    if POP.with(|c| c.borrow().is_some()) {
        return true;
    }
    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let class = wide("AskerDoPopup");
        let wc = WNDCLASSW {
            style: CS_DROPSHADOW,
            lpfnWndProc: Some(wndproc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: std::ptr::null_mut(),
            hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class.as_ptr(),
        };
        /* a second attempt after a failed create finds the class already there,
           so only the create below decides */
        RegisterClassW(&wc);
        let title = wide("AskerDo");
        let hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            class.as_ptr(),
            title.as_ptr(),
            WS_POPUP,
            0,
            0,
            1,
            1,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        );
        if hwnd.is_null() {
            app.journal.line("popup: could not create the window");
            return false;
        }
        /* Windows 11 rounds a popup only when asked; older builds ignore it */
        let round: i32 = 2;
        DwmSetWindowAttribute(hwnd, 33, (&round as *const i32).cast(), 4);
        POP.with(|c| {
            *c.borrow_mut() = Some(Pop {
                app: app.clone(),
                hwnd,
                stack: Stack::default(),
                layout: Layout::default(),
                hot: None,
                tracking: false,
                timer: 0,
                labels: Vec::new(),
                placed: String::new(),
            });
        });
    }
    true
}

fn light() -> bool {
    icon::taskbar_from(registry::system_uses_light_theme()) == icon::Taskbar::Light
}

/* Electron's top-level windows; the exe check runs after, once per process */
unsafe extern "system" fn electron(hwnd: HWND, lp: LPARAM) -> i32 {
    let list = unsafe { &mut *(lp as *mut Vec<isize>) };
    let mut class = [0u16; 64];
    let n = unsafe { GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32) }.max(0) as usize;
    if String::from_utf16_lossy(&class[..n]) == "Chrome_WidgetWin_1" {
        list.push(hwnd as isize);
    }
    1
}

fn is_claude(pid: u32) -> bool {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut path = [0u16; 1024];
        let mut len = path.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, path.as_mut_ptr(), &mut len);
        CloseHandle(h);
        let path = String::from_utf16_lossy(&path[..len.min(1024) as usize]);
        ok != 0 && path.rsplit(['\\', '/']).next().unwrap_or("").eq_ignore_ascii_case("claude.exe")
    }
}

/* the frame bounds leave out a maximized window's invisible resize border */
fn frame(hwnd: HWND) -> Option<popup::Rect> {
    let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    let size = std::mem::size_of::<RECT>() as u32;
    unsafe {
        if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS as _, (&mut r as *mut RECT).cast(), size) != 0
            && GetWindowRect(hwnd, &mut r) == 0
        {
            return None;
        }
    }
    Some(popup::Rect { l: r.left, t: r.top, r: r.right, b: r.bottom })
}

/* Every top-level window of the Claude desktop app (its exe and Electron's class)
   as the corner reads it, foreground or not: the app can show its toast
   while another window has the focus. */
fn app_windows() -> Vec<popup::AppWin> {
    let mut list: Vec<isize> = Vec::new();
    unsafe { EnumWindows(Some(electron), &mut list as *mut Vec<isize> as LPARAM) };
    let fg = unsafe { GetForegroundWindow() } as isize;
    let mut claude: HashMap<u32, bool> = HashMap::new();
    let mut out = Vec::new();
    for h in list {
        let hwnd = h as HWND;
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        if !*claude.entry(pid).or_insert_with(|| is_claude(pid)) {
            continue;
        }
        let Some(rect) = frame(hwnd) else { continue };
        let mut cloaked = 0u32;
        let read = unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED as _, (&mut cloaked as *mut u32).cast(), 4) };
        out.push(popup::AppWin {
            rect,
            shown: unsafe { IsWindowVisible(hwnd) } != 0 && !(read == 0 && cloaked != 0),
            minimized: unsafe { IsIconic(hwnd) } != 0,
            foreground: h == fg,
        });
    }
    out
}

/* Lays the stack out at the window's DPI and the work area's height, parks it
   on the corner, shows or hides it, and keeps a timer while anything shows: a
   fast one while a card can expire, a slow one for the age alone. The window
   calls run after the borrow ends: a move can send WM_DPICHANGED back into
   this module. */
fn refresh() {
    let Some((hwnd, dpi)) = POP.with(|c| {
        c.borrow().as_ref().map(|p| (p.hwnd, unsafe { GetDpiForWindow(p.hwnd) }))
    }) else {
        return;
    };
    let mut wa = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    unsafe { SystemParametersInfoW(SPI_GETWORKAREA, 0, (&mut wa as *mut RECT).cast(), 0) };
    let s = popup::scale_of(dpi);
    let m = (MARGIN as f32 * s).round() as i32;
    let work = popup::Rect { l: wa.left, t: wa.top, r: wa.right, b: wa.bottom };
    let zone = (popup::APP_TOAST_ZONE as f32 * s).round() as i32;
    let (right, bottom, why) = popup::corner(work, m, &app_windows(), zone);
    let room = (bottom - wa.top - m).max(0);
    let now = Instant::now();
    let plan = POP.with(|c| {
        let mut b = c.borrow_mut();
        let p = b.as_mut()?;
        let had = p.timer;
        if p.stack.is_empty() {
            p.hot = None;
            p.timer = 0;
            p.placed.clear();
            return Some((None, 0, had));
        }
        /* one line per placement shown, so a rerun reads why the stack stood where it did */
        let placed = format!("popup placed at {right},{bottom}: {why}");
        if placed != p.placed {
            p.app.journal.line(&placed);
            p.placed = placed;
        }
        let view = p.stack.visible();
        p.layout = unsafe {
            let dc = GetDC(p.hwnd);
            let l = popup::with_measure(dc, dpi, |measure| popup::layout(&view, p.stack.hidden(), dpi, room, measure));
            ReleaseDC(p.hwnd, dc);
            l
        };
        let drawn: Vec<u64> = p.layout.cards.iter().map(|c| c.key).collect();
        p.stack.mark_drawn(&drawn, now);
        p.labels = labels(p, now);
        p.timer = if p.stack.needs_timer() { TIMER_MS } else { AGE_MS };
        Some((Some((p.layout.width, p.layout.height)), p.timer, had))
    });
    let Some((size, want, had)) = plan else { return };
    unsafe {
        match size {
            None => {
                ShowWindow(hwnd, SW_HIDE);
            }
            Some((w, h)) => {
                /* HWND_TOPMOST each time, since a full-screen app can push a topmost down */
                SetWindowPos(hwnd, -1isize as HWND, right - w, bottom - h, w, h, SWP_NOACTIVATE);
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                InvalidateRect(hwnd, std::ptr::null(), 0);
            }
        }
        if want != had {
            if want == 0 {
                KillTimer(hwnd, TIMER_ID);
            } else {
                /* a live id's period is replaced in place */
                SetTimer(hwnd, TIMER_ID, want, None);
            }
        }
    }
}

/* the drawn cards' label lines, the only text that changes with time */
fn labels(p: &Pop, now: Instant) -> Vec<String> {
    p.layout
        .cards
        .iter()
        .filter_map(|c| p.stack.get(c.key))
        .map(|a| popup::label_line(a, now))
        .collect()
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_PAINT => {
            paint(hwnd);
            0
        }
        WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
        WM_MOUSEMOVE => {
            let (x, y) = point(lp);
            let moved = POP.with(|c| {
                let mut b = c.borrow_mut();
                let p = b.as_mut()?;
                if !p.tracking {
                    let mut tme = TRACKMOUSEEVENT {
                        cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                        dwFlags: TME_LEAVE,
                        hwndTrack: hwnd,
                        dwHoverTime: 0,
                    };
                    unsafe { TrackMouseEvent(&mut tme) };
                    p.tracking = true;
                    p.stack.set_hover(true, Instant::now());
                }
                let hot = popup::hit(&p.layout, x, y);
                let moved = hot != p.hot;
                p.hot = hot;
                Some(moved)
            });
            if moved == Some(true) {
                unsafe { InvalidateRect(hwnd, std::ptr::null(), 0) };
            }
            0
        }
        WM_MOUSELEAVE => {
            POP.with(|c| {
                if let Some(p) = c.borrow_mut().as_mut() {
                    p.tracking = false;
                    p.hot = None;
                    p.stack.set_hover(false, Instant::now());
                }
            });
            unsafe { InvalidateRect(hwnd, std::ptr::null(), 0) };
            0
        }
        WM_SETCURSOR if (lp & 0xFFFF) as u32 == HTCLIENT => {
            let hot = POP.with(|c| c.borrow().as_ref().and_then(|p| p.hot));
            let shape = if hot.is_some() { IDC_HAND } else { IDC_ARROW };
            unsafe { SetCursor(LoadCursorW(std::ptr::null_mut(), shape)) };
            1
        }
        WM_LBUTTONUP => {
            let (x, y) = point(lp);
            click(hwnd, x, y);
            0
        }
        /* a right click is the quick dismiss */
        WM_RBUTTONUP => {
            let (x, y) = point(lp);
            let key = POP.with(|c| {
                let b = c.borrow();
                let p = b.as_ref()?;
                match popup::hit(&p.layout, x, y)? {
                    Hit::Close(k) | Hit::Action(k) | Hit::Files(k) | Hit::Body(k) => Some(k),
                    Hit::More => None,
                }
            });
            if let Some(k) = key {
                dismiss(k);
            }
            0
        }
        WM_TIMER => {
            let now = Instant::now();
            let (gone, aged) = POP.with(|c| {
                let mut b = c.borrow_mut();
                let Some(p) = b.as_mut() else { return (false, false) };
                if p.stack.expire(now) {
                    return (true, false);
                }
                let fresh = labels(p, now);
                let aged = fresh != p.labels;
                p.labels = fresh;
                (false, aged)
            });
            if gone {
                refresh();
            } else if aged {
                unsafe { InvalidateRect(hwnd, std::ptr::null(), 0) };
            }
            0
        }
        WM_DPICHANGED => {
            refresh();
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wp, lp) },
    }
}

fn point(lp: LPARAM) -> (i32, i32) {
    ((lp & 0xFFFF) as i16 as i32, ((lp >> 16) & 0xFFFF) as i16 as i32)
}

fn dismiss(key: u64) {
    POP.with(|c| {
        if let Some(p) = c.borrow_mut().as_mut() {
            p.stack.dismiss(key);
            p.hot = None;
        }
    });
    refresh();
}

/* One click, one obvious thing: the card (or the board) opens and the card
   leaves; the files line opens the record's files through the board's own open
   route, the tray menu's path, and leaves the card where it is. */
fn click(hwnd: HWND, x: i32, y: i32) {
    let Some((app, hit, alert)) = POP.with(|c| {
        let b = c.borrow();
        let p = b.as_ref()?;
        let hit = popup::hit(&p.layout, x, y)?;
        let alert = match hit {
            Hit::Close(k) | Hit::Action(k) | Hit::Files(k) | Hit::Body(k) => p.stack.get(k).cloned(),
            Hit::More => None,
        };
        Some((p.app.clone(), hit, alert))
    }) else {
        return;
    };
    match (hit, alert) {
        (Hit::More, _) => {
            app.journal.line("popup chose the board");
            tray::shell_open(&app.args.board);
        }
        (Hit::Close(k), _) => dismiss(k),
        (Hit::Action(k) | Hit::Body(k), Some(a)) => {
            let url = if a.card.is_empty() { app.args.board.clone() } else { a.card.clone() };
            app.journal.line(&format!("popup chose {url}"));
            tray::shell_open(&url);
            dismiss(k);
        }
        (Hit::Files(_), Some(a)) => open_files(&app, hwnd, &a),
        _ => {}
    }
}

fn open_files(app: &Arc<App>, hwnd: HWND, a: &Alert) {
    let pick = if a.files.len() == 1 {
        Some(0)
    } else {
        unsafe {
            let menu = CreatePopupMenu();
            if menu.is_null() {
                return;
            }
            for (n, f) in a.files.iter().enumerate() {
                let label = tray::menu_label(&tray::cut(&f.name, 40));
                AppendMenuW(menu, MF_STRING, n + 1, wide(&label).as_ptr());
            }
            let mut pt = POINT { x: 0, y: 0 };
            GetCursorPos(&mut pt);
            SetForegroundWindow(hwnd);
            let chose = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON, pt.x, pt.y, 0, hwnd, std::ptr::null());
            DestroyMenu(menu);
            PostMessageW(hwnd, WM_NULL, 0, 0);
            if chose > 0 { Some(chose as usize - 1) } else { None }
        }
    };
    if let Some(f) = pick.and_then(|n| a.files.get(n)) {
        let url = tray::open_url(&app.args.board, &f.id, f.index);
        app.journal.line(&format!("popup chose file {url}"));
        net::open_ref(app.clone(), &url);
    }
}

fn paint(hwnd: HWND) {
    POP.with(|c| {
        let b = c.borrow();
        let Some(p) = b.as_ref() else { return };
        let view = p.stack.visible();
        unsafe {
            let mut ps: PAINTSTRUCT = std::mem::zeroed();
            let hdc = BeginPaint(hwnd, &mut ps);
            let (w, h) = (p.layout.width.max(1), p.layout.height.max(1));
            /* drawn off screen and copied once, so a hover redraw never flickers */
            let mem = CreateCompatibleDC(hdc);
            let bmp = CreateCompatibleBitmap(hdc, w, h);
            let old = SelectObject(mem, bmp as _);
            popup::paint(mem, &view, &p.layout, light(), p.hot, Instant::now());
            BitBlt(hdc, 0, 0, w, h, mem, 0, 0, SRCCOPY);
            SelectObject(mem, old);
            DeleteObject(bmp as _);
            DeleteDC(mem);
            EndPaint(hwnd, &ps);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOARD: &str = "http://127.0.0.1:4321/s/";

    #[test]
    fn a_frame_reads_into_an_alert_and_the_card_stays_on_the_board() {
        let a = parse(
            r#"{"kind":"blocker","title":"  Q12 needs\nyou ","where":"WS-11","blocking":true,"question":"Q12",
               "card":"http://127.0.0.1:4321/s/q/Q12",
               "files":[{"id":"Q12","index":0,"name":"a.md"},{"id":"../x","index":1,"name":"b"},
                        {"id":"T-3","index":99999,"name":"c"},{"id":"T-3","index":2,"name":"d.md"}],
               "sound":"Default"}"#,
            BOARD,
        )
        .unwrap();
        assert_eq!(a.kind, Kind::Blocker);
        assert_eq!(a.title, "Q12 needs you");
        assert_eq!(a.place, "WS-11");
        assert!(a.blocking);
        assert_eq!(a.files.len(), 2, "a bad id and an index out of range are dropped");
        assert_eq!(a.files[1].name, "d.md");

        for bad in [
            r#"{"kind":"blocker","title":"x","card":"https://example.com/"}"#,
            r#"{"kind":"blocker","title":"x","card":"http://127.0.0.1:9999/s/q/Q1"}"#,
            r#"{"kind":"blocker","title":"x","card":"http://127.0.0.1:4321/s/q/Q1 x"}"#,
            r#"{"kind":"nope","title":"x"}"#,
            r#"{"kind":"info","title":"   "}"#,
            "not json",
        ] {
            assert!(parse(bad, BOARD).is_err(), "{bad}");
        }
        let bare = parse(r#"{"kind":"blocker","title":"x"}"#, BOARD).unwrap();
        assert!(bare.blocking, "a blocker blocks unless it says otherwise");
        assert!(bare.card.is_empty());
        assert_eq!(a.question, "Q12");
        assert!(bare.question.is_empty());
        assert_eq!(parse_retract(r#"{"question":"Q12"}"#).as_deref(), Ok("Q12"));
        assert!(parse_retract(r#"{"question":"T-3"}"#).is_err());
    }

    #[test]
    fn the_names_beat_the_codes_and_the_pick_rides_along() {
        let named = parse(
            r#"{"kind":"blocker","title":"x","where":"Q12, blocks work, WS-11",
               "place":"tidewatch, the board","pick":"  the output\nstyle "}"#,
            BOARD,
        )
        .unwrap();
        assert_eq!(named.place, "tidewatch, the board");
        assert_eq!(named.pick, "the output style");
        let old = parse(r#"{"kind":"thread","title":"x","where":"mod core","place":"  "}"#, BOARD).unwrap();
        assert_eq!(old.place, "mod core", "a frame without names keeps its where");
        assert_eq!(old.pick, "");
        let long = parse(&format!(r#"{{"kind":"info","title":"x","place":"{}","pick":"{}"}}"#, "p".repeat(300), "q".repeat(300)), BOARD).unwrap();
        assert_eq!((long.place.chars().count(), long.pick.chars().count()), (NAMES_MAX, PICK_MAX));
    }

    #[test]
    fn six_files_are_five() {
        let files: Vec<String> = (0..7)
            .map(|n| format!(r#"{{"id":"Q1","index":{n},"name":"f{n}"}}"#))
            .collect();
        let a = parse(&format!(r#"{{"kind":"info","title":"x","files":[{}]}}"#, files.join(",")), BOARD).unwrap();
        assert_eq!(a.files.len(), popup::FILES_MAX);
    }

    #[test]
    fn the_sound_is_an_alias_or_nothing() {
        assert_eq!(sound_alias("Default").as_deref(), Some("Notification.Default"));
        assert_eq!(sound_alias("Looping.Alarm2").as_deref(), Some("Notification.Looping.Alarm2"));
        assert_eq!(sound_alias(""), None);
        assert_eq!(sound_alias("silent"), None);
        assert_eq!(sound_alias("C:\\x.wav"), None);
        assert_eq!(sound_alias(&"a".repeat(40)), None);
    }
}
