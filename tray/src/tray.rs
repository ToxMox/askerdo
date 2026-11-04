/* The window, the notify icon, the menu, and the message loop that owns them.
 *
 * ONE THREAD owns every handle in this file. A HICON, a HWND and the shell's
 * notify-icon slot are all thread affine in practice, and the network thread
 * has no business blocking on a menu, so the two never share anything but a
 * mutex and a PostMessage.
 *
 * The window is a real top-level window that is never shown, rather than a
 * message-only one: the shell broadcasts `TaskbarCreated` to top-level windows
 * only, and that message is how a tray survives an Explorer restart.
 *
 * NEVER A BALLOON TIP. The popup (alert.rs) is the notification surface, and a
 * shown balloon auto-creates an HKCU NotifyIconGeneratedAumid entry of its own
 * (measured, docs/desktop-capabilities.md:147), which would be a second
 * identity beside the AUMID this exe wears on purpose. NIF_INFO appears
 * nowhere below.
 */
use std::cell::RefCell;
use std::sync::Arc;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::core::HRESULT;
use windows_sys::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext,
};
use windows_sys::Win32::UI::Shell::{
    NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NIM_MODIFY, NOTIFYICONDATAW,
    SetCurrentProcessExplicitAppUserModelID, ShellExecuteW, Shell_NotifyIconW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyIcon, DestroyMenu,
    DispatchMessageW, GetCursorPos, GetMessageW, HICON, HMENU, IDC_ARROW, LoadCursorW, MF_GRAYED,
    MF_POPUP, MF_SEPARATOR, MF_STRING, MSG,
    PostMessageW, PostQuitMessage, RegisterClassW, RegisterWindowMessageW, SW_SHOWNORMAL,
    SetForegroundWindow, TPM_BOTTOMALIGN, TPM_RIGHTALIGN, TPM_RIGHTBUTTON, TrackPopupMenu,
    TranslateMessage, WM_COMMAND, WM_DESTROY, WM_DPICHANGED, WM_DISPLAYCHANGE, WM_LBUTTONDBLCLK,
    WM_NULL, WM_RBUTTONUP, WM_SETTINGCHANGE, WNDCLASSW,
};

use crate::registry::{self, wide};
use crate::{App, Card, Dot, EXIT_OK, Face, Recent, alert, console, icon, net};

/* The six faces, compiled in: an install that lost an asset cannot leave this
   tray blank. THREE PER
   TASKBAR THEME, in the one order the Dot enum has (waiting, quiet, blocking):
   the dark set carries the cream check the package drew for a dark taskbar and
   the light set the orange one, because a single .ico does not recolour itself
   with the Windows theme. Which set is worn is icon::Taskbar's answer, read
   from the SYSTEM personalization setting and never from the board's theme. */
pub const ART_DARK: [&[u8]; 3] = [
    include_bytes!("../../assets/tray-waiting.ico"),
    include_bytes!("../../assets/tray-quiet.ico"),
    include_bytes!("../../assets/tray-blocking.ico"),
];
pub const ART_LIGHT: [&[u8]; 3] = [
    include_bytes!("../../assets/tray-light-waiting.ico"),
    include_bytes!("../../assets/tray-light-quiet.ico"),
    include_bytes!("../../assets/tray-light-blocking.ico"),
];

const WM_TRAY_ICON: u32 = 0x0400 + 1;
pub const WM_TRAY_UPDATE: u32 = 0x0400 + 2;
pub const WM_TRAY_QUIT: u32 = 0x0400 + 3;

/* THE COMMAND IDS, one block. Every one but Exit is a shell open or a
   pause post; Exit is untouched. The cards get a base and five ids after it, so
   a card line's id says which line was clicked without a second table. */
const IDM_OPEN: usize = 1;
const IDM_EXIT: usize = 2;
const IDM_SETTINGS: usize = 3;
const IDM_LAB: usize = 4;
const IDM_PAUSE_HOUR: usize = 5;
const IDM_PAUSE_TOMORROW: usize = 6;
const IDM_PAUSE_RESUME_UNTIL: usize = 7;
const IDM_RESUME: usize = 8;
const IDM_CONSOLE: usize = 9;
const IDM_ADD_PC: usize = 10;
/* THE TWO CARD BLOCKS, each with a fixed id range of its own rather than one
   running counter: the blocking questions are 100 to 104 and the waiting ones
   105 to 109, so the slot a click names does not depend on how many blockers
   there were when the menu was built. `card_urls` below writes the model into
   those ten slots and `pick` reads one back, which is the whole freeze. */
pub const IDM_CARD_BASE: usize = 100;
pub const IDM_WAIT_BASE: usize = 105;
const IDM_CARD_SLOTS: usize = 10;
/* THE RECENT FILES BLOCK, its own range and its own frozen
   vector: a recent line POSTs an open where a card line shell-opens a URL, so
   the two must never share a slot. */
pub const IDM_RECENT_BASE: usize = 200;
const IDM_RECENT_SLOTS: usize = 5;
const ICON_ID: u32 = 1;

/* THE MENU'S OWN CUT, over the WHOLE line rather than over the name: forty
   characters is this exe's own rule, since no Microsoft page documents a
   maximum item length or a maximum item count for a popup menu. */
const LINE_MAX: usize = 40;

/* AT MOST FIVE QUESTION LINES. The server counts to five and net.rs caps again
   on arrival; this is the third and last place, so a face filled by any future
   path still draws five lines and five command ids. */
const CARDS_MAX: usize = 5;

/* the pause tokens, as the server's `pause` verb spells them; the empty one is
   Resume, which is the only value that clears a pause */
const TOK_HOUR: &str = "hour";
const TOK_TOMORROW: &str = "tomorrow";
const TOK_FOREVER: &str = "until-resume";
const TOK_RESUME: &str = "";

struct State {
    app: Arc<App>,
    hwnd: HWND,
    /* `--no-icon`: everything else runs, and the shell's notify-icon slot
       is simply never asked for. Read in the three functions that touch it and
       nowhere else, so there is one switch and not a condition per call site. */
    icon_on: bool,
    /* both sets, parsed once at start: six .ico files are 116 KB of frames and
       parsing one on every theme flip would be work done at the worst moment */
    dark: [Vec<icon::Frame>; 3],
    light: [Vec<icon::Frame>; 3],
    theme: icon::Taskbar,
    size: u32,
    current: HICON,
    /* What was last put on the shell, so an unchanged beat draws nothing. The
       theme rides in it, so a flip with the same dot and size still redraws;
       the count rides in it for the TOOLTIP alone (the icon carries
       no count), so a board that goes from 3 blocking to 5 still refreshes the
       words even though the picture is the same one. */
    shown: Option<(Dot, u32, u32, icon::Taskbar)>,
    taskbar_created: u32,
    /* THE CARD URLS AS THE OPEN MENU SHOWED THEM, frozen at build time
       and never read at click time. The network thread can replace Face.cards
       while a menu sits open, and a click that then read the live state would
       open a card the reader never saw, on a line that said something else.
       menu() fills this before TrackPopupMenu returns and WM_COMMAND indexes
       THIS vector. */
    card_urls: Vec<String>,
    /* THE RECENT FILES' OWN FROZEN VECTOR, beside the cards' and for the
       same reason, in its own id range because a recent line POSTs an open where
       a card line shell-opens a URL. */
    recent_urls: Vec<String>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

pub struct Window {
    hwnd: HWND,
}

impl Window {
    pub fn create(app: Arc<App>) -> Result<Window, String> {
        unsafe {
            /* v2 rather than the older per-monitor context: it is the one that
               keeps non-client scaling and the DPI-aware system metrics this
               file reads for the icon size. Before any window exists. */
            SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            /* ShellExecuteW wants an initialized apartment, and this thread is
               the only one that ever calls it in a resident run (the `--open`
               process initializes its own, in shell_open below) */
            CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);

            let instance = GetModuleHandleW(std::ptr::null());
            let class = wide("TAskAndDingTrayWindow");
            let wc = WNDCLASSW {
                style: 0,
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
            if RegisterClassW(&wc) == 0 {
                return Err("could not register the window class".into());
            }
            let title = wide("AskerDo");
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return Err("could not create the window".into());
            }

            let taskbar_created = RegisterWindowMessageW(wide("TaskbarCreated").as_ptr());
            let icon_on = app.args.icon;
            /* THE THEME AT START, read once here and again on every
               ImmersiveColorSet broadcast (wndproc below). */
            let theme = icon::taskbar_from(registry::system_uses_light_theme());
            app.journal
                .line(&format!("taskbar theme {} at start", theme.name()));
            STATE.with(|cell| {
                *cell.borrow_mut() = Some(State {
                    app,
                    hwnd,
                    icon_on,
                    dark: ART_DARK.map(icon::parse),
                    light: ART_LIGHT.map(icon::parse),
                    theme,
                    size: icon::small_icon_size(),
                    current: std::ptr::null_mut(),
                    shown: None,
                    taskbar_created,
                    card_urls: Vec::new(),
                    recent_urls: Vec::new(),
                });
            });
            add_icon();
            refresh(true);
            Ok(Window { hwnd })
        }
    }

    pub fn handle(&self) -> isize {
        self.hwnd as isize
    }

    pub fn run(&self) {
        unsafe {
            let mut msg: MSG = std::mem::zeroed();
            loop {
                let got = GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0);
                if got == 0 || got == -1 {
                    break;
                }
                if console::escape(&msg) {
                    continue;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}

pub fn set_app_id(aumid: &str) {
    unsafe {
        SetCurrentProcessExplicitAppUserModelID(wide(aumid).as_ptr());
    }
}

/* The two ways another thread reaches the message loop. Both are posts: a
   send would block the network thread behind a menu somebody has open. */
pub fn post_update(hwnd: isize) {
    unsafe {
        PostMessageW(hwnd as HWND, WM_TRAY_UPDATE, 0, 0);
    }
}

pub fn post_quit(hwnd: isize) {
    unsafe {
        PostMessageW(hwnd as HWND, WM_TRAY_QUIT, 0, 0);
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    let taskbar = STATE.with(|c| c.borrow().as_ref().map(|s| s.taskbar_created).unwrap_or(0));
    if taskbar != 0 && msg == taskbar {
        /* Explorer restarted and took every tray icon with it */
        add_icon();
        refresh(true);
        return 0;
    }
    match msg {
        WM_TRAY_UPDATE => {
            refresh(false);
            0
        }
        console::WM_TRAY_CONSOLE => {
            console::refresh();
            0
        }
        alert::WM_TRAY_ALERT => {
            let app = STATE.with(|c| c.borrow().as_ref().map(|s| s.app.clone()));
            if let Some(app) = app {
                alert::drain(&app);
            }
            0
        }
        WM_TRAY_QUIT => {
            remove_icon();
            unsafe { PostQuitMessage(0) };
            0
        }
        /* the icon metric moves with the DPI and with a theme or metric
           change, and the art is re-cut for the new size rather than
           stretched by the shell. WM_SETTINGCHANGE is ALSO the light-or-dark
           broadcast: lParam names `ImmersiveColorSet` when the taskbar's
           theme moved, and that is the one message this exe has to answer to
           keep a cream check off a white taskbar. */
        WM_DPICHANGED | WM_DISPLAYCHANGE | WM_SETTINGCHANGE => {
            let next = icon::small_icon_size();
            let colours = msg == WM_SETTINGCHANGE
                && icon::names_the_colour_set(unsafe { wide_at(lp) }.as_deref());
            STATE.with(|c| {
                if let Some(s) = c.borrow_mut().as_mut() {
                    if s.size != next {
                        s.size = next;
                        s.shown = None;
                    }
                    if colours {
                        let theme = icon::taskbar_from(registry::system_uses_light_theme());
                        if theme != s.theme {
                            s.app
                                .journal
                                .line(&format!("taskbar theme {} on ImmersiveColorSet", theme.name()));
                            s.theme = theme;
                            s.shown = None;
                        }
                    }
                }
            });
            refresh(false);
            unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
        }
        WM_TRAY_ICON => {
            match lp as u32 {
                WM_RBUTTONUP => menu(hwnd),
                WM_LBUTTONDBLCLK => open_board(),
                _ => {}
            }
            0
        }
        WM_COMMAND => {
            command(wp & 0xffff);
            0
        }
        WM_DESTROY => {
            unsafe { PostQuitMessage(0) };
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wp, lp) },
    }
}

/* The lParam of a WM_SETTINGCHANGE, which Windows documents as either null or
   a pointer to a null-terminated wide string naming the area that moved. The
   read is BOUNDED at 64 units: the names this message carries are short words
   like `ImmersiveColorSet` and `Environment`, and a sender that passed
   something else must not be able to walk this process off the end of a page
   looking for a terminator. Null is None, which names_the_colour_set reads as
   a yes. */
unsafe fn wide_at(lp: LPARAM) -> Option<String> {
    let ptr = lp as *const u16;
    if ptr.is_null() {
        return None;
    }
    let mut units: Vec<u16> = Vec::new();
    for i in 0..64 {
        let unit = unsafe { *ptr.add(i) };
        if unit == 0 {
            break;
        }
        units.push(unit);
    }
    Some(String::from_utf16_lossy(&units))
}

/* ---- the menu: a pure model, then a thin walker ------------------ */

/* ONE LINE OF THE MENU. The labels are the strings AS THEY REACH AppendMenuW:
   cut, then escaped (see cut and menu_label below), so a test reads exactly
   what the shell is handed and the walker interprets nothing. */
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Line {
    /* the greyed counts line at the top; id 0, so a click on it does nothing */
    Counts(String),
    /* a question line: the command id, the label the reader sees and the card
       URL it opens, frozen together at build time. THE ID IS IN THE MODEL and
       not counted by the walker, so the model alone says which slot a click
       lands in and a test can read it. */
    Card {
        id: usize,
        label: String,
        url: String,
    },
    Item { id: usize, label: String },
    Submenu { label: String, entries: Vec<Line> },
    Separator,
    /* a line that is there to be READ rather than clicked (Resume now while
       nothing holds). MF_GRAYED rather than MF_DISABLED: both refuse the click,
       and only MF_GRAYED greys the text, which is what says WHY it refuses. */
    Grayed(String),
}

pub struct MenuModel {
    pub lines: Vec<Line>,
}

/* THE WHOLE MENU AS A VALUE: every word, every id and every URL, and not one
 * Win32 call. It is the shape tooltip() has beside it, for the same reason:
 * the vocabulary is testable and the unsafe call site holds none of it.
 *
 * `settings`, `lab` and `add_pc` are argv URLs, and AN ABSENT ONE OMITS ITS LINE
 * with no gap and no greyed placeholder: a link the server did not hand over is
 * not a thing the reader can be told about.
 *
 * A PAUSE HOLDS WHEN THE SERVER SAID SO. `face.pause_label` empty is no pause:
 * this process has no local clock and must not grow one, so it never compares
 * a stamp against anything.
 *
 * BEFORE THE FIRST HELLO (`face.told` false) the counts line says `connecting`
 * and no question line is drawn at all: the spawn argv carries a blocking count
 * and nothing else, so any number beside it would be one no server ever said.
 * The hello lands in tens of milliseconds and this is what the menu shows in
 * them.
 *
 * THE TWO CARD BLOCKS: the blocking questions, then
 * the waiting ones under a greyed heading that names them, each line opening
 * its own card. A block with nothing in it is not drawn, heading and all.
 */
pub fn menu_model(
    face: &Face,
    settings: Option<&str>,
    lab: Option<&str>,
    notify: Option<&str>,
    add_pc: Option<&str>,
    board: &str,
) -> MenuModel {
    let mut lines = Vec::new();
    lines.push(Line::Counts(menu_label(&counts_line(
        face.blocking,
        face.waiting,
        face.told,
    ))));
    lines.push(Line::Separator);
    if face.told && !face.cards.is_empty() {
        push_cards(&mut lines, &face.cards, IDM_CARD_BASE, None, board);
    }
    if face.told && !face.waiting_cards.is_empty() {
        push_cards(
            &mut lines,
            &face.waiting_cards,
            IDM_WAIT_BASE,
            Some("waiting"),
            board,
        );
    }
    /* ABOVE Open board: the files this board's opener touched, newest
       first, each line asking the server to open that ref again. */
    if face.told && !face.recent.is_empty() {
        push_recent(&mut lines, &face.recent, board);
    }
    lines.push(Line::Item {
        id: IDM_OPEN,
        label: menu_label("Open board"),
    });
    /* the activity console, a window of its own */
    lines.push(Line::Item {
        id: IDM_CONSOLE,
        label: menu_label("Activity"),
    });
    /* a join code for another PC, minted on a page of the local server */
    if add_pc.is_some() {
        lines.push(Line::Item {
            id: IDM_ADD_PC,
            label: menu_label("Add a PC"),
        });
    }
    if settings.is_some() {
        lines.push(Line::Item {
            id: IDM_SETTINGS,
            label: menu_label("Notification settings"),
        });
    }
    if lab.is_some() {
        lines.push(Line::Item {
            id: IDM_LAB,
            label: menu_label("Notification lab"),
        });
    }
    /* THE PAUSE LINE RIDES `--notify` the way each link rides its own flag: a
       server that named no route to post to cannot be paused from here, and a
       submenu whose every entry fails silently reads worse than no submenu. */
    if notify.is_some() {
        lines.push(pause_line(face));
    }
    lines.push(Line::Separator);
    lines.push(Line::Item {
        id: IDM_EXIT,
        label: menu_label("Exit"),
    });
    MenuModel { lines }
}

/* ONE CARD BLOCK: an optional greyed heading naming what the block is, one line
   per question with its own fixed command id, and the separator that closes it
   off. The blocking block carries no heading because it is the one the counts
   line's first number already named; the
   waiting block carries one, because two unlabelled runs of `Q<id> <name>` are
   not two blocks to a reader. */
fn push_cards(lines: &mut Vec<Line>, cards: &[Card], base: usize, heading: Option<&str>, board: &str) {
    if let Some(word) = heading {
        lines.push(Line::Grayed(menu_label(word)));
    }
    for (n, card) in cards.iter().take(CARDS_MAX).enumerate() {
        lines.push(Line::Card {
            id: base + n,
            label: menu_label(&cut(&format!("{} {}", card.id, card.name), LINE_MAX)),
            url: card_url(board, card),
        });
    }
    lines.push(Line::Separator);
}

/* THE RECENT FILES BLOCK, push_cards' own shape: a greyed heading naming it, one
   line per file with its own fixed command id, and the separator that closes it
   off. Not drawn at all when the list is empty, heading included. */
fn push_recent(lines: &mut Vec<Line>, recent: &[Recent], board: &str) {
    lines.push(Line::Grayed(menu_label("recent files")));
    for (n, file) in recent.iter().take(IDM_RECENT_SLOTS).enumerate() {
        lines.push(Line::Card {
            id: IDM_RECENT_BASE + n,
            label: menu_label(&cut(&file.name, LINE_MAX)),
            url: open_url(board, &file.id, file.index),
        });
    }
    lines.push(Line::Separator);
}

/* THE OPEN ROUTE, off the board root exactly as card_url builds a card's: the
   exe holds no path it was not handed on a frame, so the click asks by RECORD ID
   AND INDEX and the board card takes the identical code path. */
pub(crate) fn open_url(board: &str, id: &str, index: u32) -> String {
    format!("{board}f/{id}/{index}/open")
}

/* THE COUNTS LINE'S WORDS. No plural forms and no branch on 1, because the
   TOOLTIP beside it does exactly that (`AskerDo: 12 blocking`); and
   `nothing waiting` when both are zero, which is the word the quiet dot already
   says. ONE NEUTRAL WORD AND NO NUMBERS before the first hello: the spawn argv
   carries a blocking count and no waiting one, so `3 blocking, 0 waiting` would
   be a fabricated half. Those are the only three branches there are. */
fn counts_line(blocking: u32, waiting: u32, told: bool) -> String {
    if !told {
        return "connecting".into();
    }
    if blocking == 0 && waiting == 0 {
        return "nothing waiting".into();
    }
    format!("{blocking} blocking, {waiting} waiting")
}

/* THE PARENT PAUSE LINE AND ITS SUBMENU. `Pause notifications` when no pause
   holds, `Paused ` plus the SERVER'S OWN words otherwise. NO CHECK MARKS:
   `pausedUntil` alone cannot say WHICH entry set a given stamp, so a
   mark would be a guess; CheckMenuRadioItem exists and is deliberately not
   used. Resume now is always THERE and greyed while nothing holds: a menu that
   can pause forever with no way back is broken, and a Resume that vanishes
   changes the menu's length for no reason a reader can see. */
fn pause_line(face: &Face) -> Line {
    let holds = !face.pause_label.is_empty();
    let label = if holds {
        menu_label(&format!("Paused {}", face.pause_label))
    } else {
        menu_label("Pause notifications")
    };
    Line::Submenu {
        label,
        entries: vec![
            Line::Item {
                id: IDM_PAUSE_HOUR,
                label: menu_label("For 1 hour"),
            },
            /* THE ENTRY NAMES THE HOUR IT RESOLVES TO. `tomorrow` is 07:00 on
               the next calendar day, always, and the server's own label for the
               stamp it writes reads `until 07:00 tomorrow`, so an entry saying
               only "Until tomorrow" set a pause the parent line then described
               in words the entry never used. One string, in the vocabulary the
               label already has. */
            Line::Item {
                id: IDM_PAUSE_TOMORROW,
                label: menu_label("Until 07:00 tomorrow"),
            },
            Line::Item {
                id: IDM_PAUSE_RESUME_UNTIL,
                label: menu_label("Until I resume"),
            },
            Line::Separator,
            if holds {
                Line::Item {
                    id: IDM_RESUME,
                    label: menu_label("Resume now"),
                }
            } else {
                Line::Grayed(menu_label("Resume now"))
            },
        ],
    }
}

/* THE CARD'S PERMANENT URL, the SAME shape lib/notify.mjs builds for the
   popup's card and hooks/board-server.mjs serves: the board root (the
   protocol pins the trailing slash) plus `r/` plus the key, or the
   label where the frame carried no key. Both passed their shape checks on
   arrival (net.rs), so nothing else is ever concatenated here. */
fn card_url(board: &str, card: &Card) -> String {
    let id = if card.key.is_empty() { &card.id } else { &card.key };
    format!("{board}r/{id}")
}

/* CUT FIRST. Over the WHOLE line, on char_indices boundaries so a Unicode
 * SCALAR is never split, with three ASCII dots appended when it cut (the repo's
 * own cut, as server/verbs/search.mjs clip makes it, and its ASCII-source
 * convention).
 *
 * "NEVER SPLITTING A CHARACTER" MEANS A SCALAR HERE and this comment says so:
 * without a segmentation crate a combining mark can still be orphaned from
 * the base it decorates, so this code promises scalars, not graphemes.
 */
pub fn cut(line: &str, n: usize) -> String {
    match line.char_indices().nth(n) {
        Some((at, _)) => format!("{}...", &line[..at]),
        None => line.to_string(),
    }
}

/* ESCAPE SECOND. A literal ampersand in a menu item is written as TWO, because
 * a single one is the access-key prefix. THAT IS NOT STATED ON ANY WIN32 MENU
 * PAGE (the nearest documented statement is DrawText's DT_NOPREFIX, which names
 * "the mnemonic-prefix characters && as a directive to print a single &"), so
 * it is BUILT and MEASURED and never assumed: tray/README.md carries what the
 * measurement showed.
 *
 * THE ORDER IS NOT A PREFERENCE. Cutting AFTER the doubling could cut a doubled
 * pair in half and turn a literal ampersand into an access key, which is the
 * cap-before-escape order every escaper here keeps. It is
 * applied to EVERY string that reaches AppendMenuW, the counts line and the
 * pause label included. AskerDo carries no ampersand of its own, but a
 * question title and a file name still do, so every label is escaped.
 */
pub fn menu_label(s: &str) -> String {
    s.replace('&', "&&")
}

/* ---- the freeze, as two pure steps ------------------------------------- */

/* THE MODEL'S CARD URLS INTO THEIR COMMAND SLOTS, which is the vector `menu()`
 * stores before TrackPopupMenu and `command()` indexes at the click. Ten slots,
 * one per card id (100 to 109), and an empty string is a slot no line took.
 *
 * IT IS A PURE FUNCTION so the rule can be pinned from a state: the freeze
 * itself lives in a thread-local behind Win32 and cannot be reached from a unit
 * test, but the model-to-vector-to-id-offset step is the whole mechanism, and a
 * vector built from one model answers that model's URLs however the live Face
 * moves afterwards.
 */
pub fn card_urls(model: &MenuModel) -> Vec<String> {
    let mut out = vec![String::new(); IDM_CARD_SLOTS];
    for line in &model.lines {
        if let Line::Card { id, url, .. } = line
            && let Some(slot) = id.checked_sub(IDM_CARD_BASE)
            && slot < out.len()
        {
            out[slot] = url.clone();
        }
    }
    out
}

/* The click's own half: a command id back to the URL the open froze, or None
   for an id no card line took. */
pub fn pick(urls: &[String], id: usize) -> Option<&str> {
    let slot = id.checked_sub(IDM_CARD_BASE)?;
    match urls.get(slot) {
        Some(url) if !url.is_empty() => Some(url.as_str()),
        _ => None,
    }
}

/* THE RECENT BLOCK'S OWN FREEZE, the same two pure steps over its own range: the
   network thread can replace Face.recent while the menu sits open, so a click
   that read the live list would open a file the reader never saw. */
pub fn recent_urls(model: &MenuModel) -> Vec<String> {
    let mut out = vec![String::new(); IDM_RECENT_SLOTS];
    for line in &model.lines {
        if let Line::Card { id, url, .. } = line
            && let Some(slot) = id.checked_sub(IDM_RECENT_BASE)
            && slot < out.len()
        {
            out[slot] = url.clone();
        }
    }
    out
}

pub fn pick_recent(urls: &[String], id: usize) -> Option<&str> {
    let slot = id.checked_sub(IDM_RECENT_BASE)?;
    match urls.get(slot) {
        Some(url) if !url.is_empty() => Some(url.as_str()),
        _ => None,
    }
}

/* the menu opens with the plugin version this tray was started under,
   greyed: a line to read, never to click, so no command id moves. */
pub fn with_version(mut model: MenuModel, version: &str) -> MenuModel {
    if !version.is_empty() {
        model
            .lines
            .insert(0, Line::Grayed(menu_label(&format!("AskerDo {version}"))));
    }
    model
}

/* ---- the walker -------------------------------------------------------- */

/* Everything the menu needs, read out of the thread-local state in ONE borrow
   so nothing is held across the Win32 calls below. */
fn menu(hwnd: HWND) {
    let Some((model, urls, recent, line)) = STATE.with(|c| {
        let state = c.borrow();
        let s = state.as_ref()?;
        let face = s.app.face.lock().ok()?;
        let model = with_version(
            menu_model(
                &face,
                s.app.args.settings.as_deref(),
                s.app.args.lab.as_deref(),
                s.app.args.notify.as_deref(),
                s.app.args.add_pc.as_deref(),
                &s.app.args.board,
            ),
            &s.app.args.version,
        );
        let urls = card_urls(&model);
        let recent = recent_urls(&model);
        let line = format!(
            "menu {} blocking {} waiting {} cards {} waiting cards {} recent paused {}",
            face.blocking,
            face.waiting,
            face.cards.len(),
            face.waiting_cards.len(),
            face.recent.len(),
            if face.pause_label.is_empty() {
                "-"
            } else {
                face.pause_label.as_str()
            },
        );
        Some((model, urls, recent, line))
    }) else {
        return;
    };
    /* ONE LINE PER MENU OPEN when --log named a path, and Journal::on() is what
       gates it: nothing at all when there is no log. */
    STATE.with(|c| {
        if let Some(s) = c.borrow().as_ref() {
            s.app.journal.line(&line);
        }
    });
    /* FROZEN BEFORE THE MENU IS EVEN SHOWN, and certainly before
       TrackPopupMenu returns: the click below reads this vector and never the
       live state. The network thread can replace Face.cards while a menu sits
       open, and a click that then read the live state would open a card the
       reader never saw, on a line that said something else. */
    STATE.with(|c| {
        if let Some(s) = c.borrow_mut().as_mut() {
            s.card_urls = urls;
            s.recent_urls = recent;
        }
    });

    unsafe {
        let mut pt = POINT { x: 0, y: 0 };
        GetCursorPos(&mut pt);
        let menu = CreatePopupMenu();
        if menu.is_null() {
            return;
        }
        /* A FRESH POPUP PER OPEN, which is why there is no WM_INITMENUPOPUP
           anywhere here: the whole menu is built microseconds before
           TrackPopupMenu, so there is nothing left to update afterwards. */
        for l in &model.lines {
            append(menu, l);
        }
        /* the documented dance: the menu belongs to the foreground window, and
           the null post is what lets it dismiss on a click elsewhere. NO
           TPM_RETURNCMD: the WM_COMMAND path is the one this exe has, and that
           TPM_RETURNCMD suppresses WM_COMMAND is not documented. */
        SetForegroundWindow(hwnd);
        TrackPopupMenu(
            menu,
            TPM_RIGHTBUTTON | TPM_RIGHTALIGN | TPM_BOTTOMALIGN,
            pt.x,
            pt.y,
            0,
            hwnd,
            std::ptr::null(),
        );
        /* ONE DestroyMenu, ON THE PARENT: the docs say it is recursive and
           takes every submenu with it. */
        DestroyMenu(menu);
        PostMessageW(hwnd, WM_NULL, 0, 0);
    }
}

/* One line to one AppendMenuW, and the ONLY place a menu flag is chosen. */
unsafe fn append(menu: HMENU, line: &Line) {
    unsafe {
        match line {
            Line::Separator => {
                AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
            }
            Line::Counts(label) | Line::Grayed(label) => {
                AppendMenuW(menu, MF_GRAYED | MF_STRING, 0, wide(label).as_ptr());
            }
            Line::Item { id, label } | Line::Card { id, label, .. } => {
                AppendMenuW(menu, MF_STRING, *id, wide(label).as_ptr());
            }
            Line::Submenu { label, entries } => {
                let sub = CreatePopupMenu();
                if sub.is_null() {
                    return;
                }
                for e in entries {
                    append(sub, e);
                }
                AppendMenuW(menu, MF_POPUP | MF_STRING, sub as usize, wide(label).as_ptr());
            }
        }
    }
}

/* ---- the click --------------------------------------------------------- */

/* EVERY ONE OF THESE IS A SHELL OPEN OR A PAUSE POST, and Exit is untouched.
   The pause ids do NOT do the network call here: the menu is built on the
   MESSAGE LOOP THREAD inside the WM_RBUTTONUP handler, and a blocking POST here
   would hold the shell's own menu open on a network read. net::pause spawns a
   short-lived thread and returns at once. */
fn command(id: usize) {
    let Some((app, hwnd, urls, recent)) = STATE.with(|c| {
        let state = c.borrow();
        let s = state.as_ref()?;
        Some((
            s.app.clone(),
            s.hwnd as isize,
            s.card_urls.clone(),
            s.recent_urls.clone(),
        ))
    }) else {
        return;
    };
    match id {
        IDM_OPEN => {
            picked(&app, "open board", &app.args.board);
            shell_open(&app.args.board);
        }
        IDM_EXIT => app.quit(EXIT_OK, hwnd, "the menu said exit"),
        IDM_CONSOLE => {
            picked(&app, "activity console", &app.args.board);
            console::open(&app, hwnd);
        }
        IDM_ADD_PC => {
            if let Some(url) = app.args.add_pc.clone() {
                picked(&app, "add a pc", &url);
                shell_open(&url);
            }
        }
        IDM_SETTINGS => {
            if let Some(url) = app.args.settings.clone() {
                picked(&app, "notification settings", &url);
                shell_open(&url);
            }
        }
        IDM_LAB => {
            if let Some(url) = app.args.lab.clone() {
                picked(&app, "notification lab", &url);
                shell_open(&url);
            }
        }
        IDM_PAUSE_HOUR => net::pause(app, hwnd, TOK_HOUR),
        IDM_PAUSE_TOMORROW => net::pause(app, hwnd, TOK_TOMORROW),
        IDM_PAUSE_RESUME_UNTIL => net::pause(app, hwnd, TOK_FOREVER),
        IDM_RESUME => net::pause(app, hwnd, TOK_RESUME),
        other => {
            /* THREE BLOCKS, each read out of the vector THIS open froze and
               never out of the live Face. A recent file POSTs an open where a
               card shell-opens a URL, so its range is tested first. */
            if other >= IDM_RECENT_BASE {
                if let Some(url) = pick_recent(&recent, other) {
                    picked(&app, "recent file", url);
                    net::open_ref(app, url);
                }
            } else if let Some(url) = pick(&urls, other) {
                let what = if other >= IDM_WAIT_BASE { "waiting card" } else { "card" };
                picked(&app, what, url);
                shell_open(url);
            }
        }
    }
}

/* ONE LINE PER COMMAND CHOSEN, naming what it was and the URL it opened; the
   pause posts journal their own token in net::pause, which is where the answer
   they are waiting on lands. */
fn picked(app: &Arc<App>, what: &str, url: &str) {
    app.journal.line(&format!("menu chose {what} {url}"));
}

/* The click: a shell open of the loopback board URL, so the default browser decides everything. */
fn open_board() {
    let url = STATE.with(|c| c.borrow().as_ref().map(|s| s.app.args.board.clone()));
    let Some(url) = url else { return };
    shell_open(&url);
}

/* ShellExecuteW wants an apartment, and the ANSWER comes back because the
   same kind answers S_FALSE, but a thread already in the MTA answers
   RPC_E_CHANGED_MODE and stays there, so opener.rs runs on an STA of its own. */
pub fn com_apartment() -> HRESULT {
    unsafe { CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32) }
}

/* The answer is handed back, since a scheme with no handler is otherwise
   silent end to end. Greater than 32 is success. */
pub fn shell_open(url: &str) -> isize {
    com_apartment();
    unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            wide("open").as_ptr(),
            wide(url).as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        ) as isize
    }
}

fn base_nid(hwnd: HWND) -> NOTIFYICONDATAW {
    let mut nid: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
    nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    nid.hWnd = hwnd;
    nid.uID = ICON_ID;
    nid
}

fn add_icon() {
    STATE.with(|c| {
        let state = c.borrow();
        let Some(s) = state.as_ref() else { return };
        if !s.icon_on {
            return;
        }
        let mut nid = base_nid(s.hwnd);
        nid.uFlags = NIF_MESSAGE;
        nid.uCallbackMessage = WM_TRAY_ICON;
        /* a NIM_ADD that fails is an INVISIBLE tray, which is the one failure
           nobody would ever notice, so it is said out loud when there is a log */
        if unsafe { Shell_NotifyIconW(NIM_ADD, &nid) } == 0 {
            s.app.journal.line("tray icon: Shell_NotifyIcon NIM_ADD refused");
        }
    });
}

fn remove_icon() {
    STATE.with(|c| {
        let mut state = c.borrow_mut();
        let Some(s) = state.as_mut() else { return };
        if !s.icon_on {
            return;
        }
        let nid = base_nid(s.hwnd);
        unsafe { Shell_NotifyIconW(NIM_DELETE, &nid) };
        if !s.current.is_null() {
            unsafe { DestroyIcon(s.current) };
            s.current = std::ptr::null_mut();
        }
    });
}

/* Redraws the icon and the tooltip, and ONLY when something they show
   actually moved: the shell repaints on every NIM_MODIFY, so a tray that
   modified on every beat would flicker for nothing. */
fn refresh(force: bool) {
    STATE.with(|c| {
        let mut state = c.borrow_mut();
        let Some(s) = state.as_mut() else { return };
        if !s.icon_on {
            return;
        }
        let (dot, blocking) = {
            let face = s.app.face.lock().unwrap();
            (face.dot, face.blocking)
        };
        /* the number the TOOLTIP will say, and the only reason a count is in
           the gate at all: the icon is the delivered frame for the dot and
           nothing else, so it does not move when the count
           does, but the words under the cursor do. Zero off the blocking
           state, because that is what the tooltip says there. */
        let tip_count = if dot == Dot::Blocking { blocking } else { 0 };
        let want = (dot, tip_count, s.size, s.theme);
        if !force && s.shown == Some(want) {
            return;
        }

        let set = match s.theme {
            icon::Taskbar::Dark => &s.dark,
            icon::Taskbar::Light => &s.light,
        };
        let art = &set[match dot {
            Dot::Waiting => 0,
            Dot::Quiet => 1,
            Dot::Blocking => 2,
        }];
        /* the delivered frame, untouched: nothing is composited over it */
        let px = icon::face(art, s.size);
        let next = icon::to_hicon(&px, s.size);
        /* GDI ran out of something. Handing NIM_MODIFY a null hIcon would put
           a BLANK square in the tray, and recording `shown` here would mean
           the next change to this same state saw nothing to do and never
           retried. So: keep the icon that is up, keep the state that drew it,
           and let the next change cut a fresh handle. */
        if next.is_null() {
            s.app
                .journal
                .line("tray icon: no icon handle from GDI, keeping the one on screen");
            return;
        }
        s.shown = Some(want);

        let mut nid = base_nid(s.hwnd);
        nid.uFlags = NIF_ICON | NIF_TIP;
        nid.hIcon = next;
        let tip = tooltip(dot, blocking, &s.app.args.version);
        for (i, unit) in wide(&tip).into_iter().take(127).enumerate() {
            nid.szTip[i] = unit;
        }
        if unsafe { Shell_NotifyIconW(NIM_MODIFY, &nid) } == 0 {
            s.app.journal.line("tray icon: Shell_NotifyIcon NIM_MODIFY refused");
        }

        if !s.current.is_null() {
            unsafe { DestroyIcon(s.current) };
        }
        s.current = next;

        if s.app.journal.on() {
            /* the icon's own three facts, and then the tooltip verbatim: the
               icon carries no count, so the words are where the
               count is read back */
            s.app.journal.line(&format!(
                "icon {} size {} faces {} tip {}",
                dot.name(),
                s.size,
                s.theme.name(),
                tip
            ));
        }
    });
}

pub fn tooltip(dot: Dot, blocking: u32, version: &str) -> String {
    /* the hover names the version too */
    let name = if version.is_empty() {
        "AskerDo".to_string()
    } else {
        format!("AskerDo {version}")
    };
    match dot {
        Dot::Blocking => format!("{name}: {blocking} blocking"),
        Dot::Waiting => format!("{name}: waiting"),
        Dot::Quiet => format!("{name}: quiet"),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        IDM_CARD_BASE, IDM_RECENT_BASE, IDM_WAIT_BASE, LINE_MAX, Line, card_urls, cut, menu_label,
        menu_model, pick, pick_recent, recent_urls, tooltip, with_version,
    };
    use crate::{Card, Dot, Face, Recent};

    const BOARD: &str = "http://127.0.0.1:4321/s/";
    const SETTINGS: &str = "http://127.0.0.1:4321/s/notifications";
    const LAB: &str = "http://127.0.0.1:4321/s/lab/alerts";
    const NOTIFY: &str = "http://127.0.0.1:4321/s/api/notify";
    const ADD_PC: &str = "http://127.0.0.1:4321/s/add-pc";

    /* A FACE THE STREAM HAS ALREADY SPOKEN TO (`told`), with the blocking block
       filled and the waiting one empty: the cases that need the second block or
       the pre-hello state set those two fields themselves, so every case that
       does not is reading the menu's common shape. */
    fn face(blocking: u32, waiting: u32, cards: &[(&str, &str)], label: &str) -> Face {
        Face {
            dot: if blocking > 0 {
                Dot::Blocking
            } else if waiting > 0 {
                Dot::Waiting
            } else {
                Dot::Quiet
            },
            blocking,
            waiting,
            cards: card_list(cards),
            waiting_cards: Vec::new(),
            recent: Vec::new(),
            paused: String::new(),
            pause_label: label.to_string(),
            told: true,
        }
    }

    fn card_list(cards: &[(&str, &str)]) -> Vec<Card> {
        cards
            .iter()
            .map(|(id, name)| Card {
                id: (*id).to_string(),
                name: (*name).to_string(),
                key: String::new(),
            })
            .collect()
    }

    /* every label the model carries, in order, whatever kind of line it is:
       what a reader would see down the menu */
    fn labels(lines: &[Line]) -> Vec<String> {
        lines
            .iter()
            .map(|l| match l {
                Line::Counts(s) | Line::Grayed(s) => s.clone(),
                Line::Card { label, .. } | Line::Item { label, .. } => label.clone(),
                Line::Submenu { label, .. } => label.clone(),
                Line::Separator => "-".into(),
            })
            .collect()
    }

    fn cards_of(lines: &[Line]) -> Vec<(String, String)> {
        lines
            .iter()
            .filter_map(|l| match l {
                Line::Card { label, url, .. } => Some((label.clone(), url.clone())),
                _ => None,
            })
            .collect()
    }

    /* every card line's command id, in the order the menu draws them */
    fn card_ids(lines: &[Line]) -> Vec<usize> {
        lines
            .iter()
            .filter_map(|l| match l {
                Line::Card { id, .. } => Some(*id),
                _ => None,
            })
            .collect()
    }

    fn recent_list(files: &[(&str, u32, &str)]) -> Vec<Recent> {
        files
            .iter()
            .map(|(id, index, name)| Recent {
                id: (*id).to_string(),
                index: *index,
                name: (*name).to_string(),
            })
            .collect()
    }

    /* a face carrying recent files and nothing else the menu needs */
    fn recent_face(files: &[(&str, u32, &str)]) -> Face {
        let mut f = face(0, 0, &[], "");
        f.recent = recent_list(files);
        f
    }

    fn submenu(lines: &[Line]) -> (String, Vec<Line>) {
        for l in lines {
            if let Line::Submenu { label, entries } = l {
                return (label.clone(), entries.clone());
            }
        }
        panic!("the menu carried no pause submenu");
    }

    #[test]
    fn the_three_tooltip_forms() {
        assert_eq!(tooltip(Dot::Waiting, 0, ""), "AskerDo: waiting");
        assert_eq!(tooltip(Dot::Quiet, 4, ""), "AskerDo: quiet");
        assert_eq!(tooltip(Dot::Blocking, 12, ""), "AskerDo: 12 blocking");
        assert!(tooltip(Dot::Quiet, 0, "0.8.10").contains("0.8.10"));
    }

    /* the version opens the menu greyed, and no clickable line moves its id */
    #[test]
    fn the_menu_opens_with_the_version_greyed() {
        let plain = menu_model(&face(1, 0, &[("Q1", "the blocker")], ""), None, None, Some(NOTIFY), None, BOARD);
        let urls = card_urls(&plain);
        let m = with_version(plain, "0.8.10");
        assert!(matches!(&m.lines[0], Line::Grayed(l) if l.contains("0.8.10")));
        assert_eq!(card_urls(&m), urls);
    }

    /* THE COUNTS LINE, and its only branch: both zero. No plural forms and no
       branch on 1, because the tooltip beside it does exactly that. */
    #[test]
    fn the_counts_lines_three_shapes() {
        let m = menu_model(&face(0, 0, &[], ""), None, None, Some(NOTIFY), None, BOARD);
        assert_eq!(labels(&m.lines)[0], "nothing waiting");
        let m = menu_model(&face(0, 5, &[], ""), None, None, Some(NOTIFY), None, BOARD);
        assert_eq!(labels(&m.lines)[0], "0 blocking, 5 waiting");
        let m = menu_model(&face(3, 5, &[], ""), None, None, Some(NOTIFY), None, BOARD);
        assert_eq!(labels(&m.lines)[0], "3 blocking, 5 waiting");
        /* one of each, and still no singular anywhere */
        let m = menu_model(&face(1, 1, &[], ""), None, None, Some(NOTIFY), None, BOARD);
        assert_eq!(labels(&m.lines)[0], "1 blocking, 1 waiting");
    }

    /* A QUIET BOARD: the counts line, one separator, the three fixed lines, the
       pause parent, a separator and Exit. No card block and therefore no second
       separator, so the menu never carries a gap where a question would be. */
    #[test]
    fn a_quiet_board_is_the_menu_with_no_card_block() {
        let m = menu_model(&face(0, 0, &[], ""), None, None, Some(NOTIFY), None, BOARD);
        assert_eq!(
            labels(&m.lines),
            vec![
                "nothing waiting",
                "-",
                "Open board",
                "Activity",
                "Pause notifications",
                "-",
                "Exit",
            ]
        );
        assert!(cards_of(&m.lines).is_empty());
    }

    /* A WAITING BOARD names no question either: the menu lists the BLOCKING
       ones, and a waiting board has none of those. */
    #[test]
    fn a_waiting_board_names_no_question() {
        let m = menu_model(&face(0, 4, &[], ""), Some(SETTINGS), Some(LAB), Some(NOTIFY), None, BOARD);
        assert_eq!(labels(&m.lines)[0], "0 blocking, 4 waiting");
        assert!(cards_of(&m.lines).is_empty());
    }

    #[test]
    fn one_blocking_question_is_one_line_between_two_separators() {
        let m = menu_model(
            &face(1, 0, &[("Q112", "the tray menu")], ""),
            Some(SETTINGS),
            Some(LAB),
            Some(NOTIFY),
            None,
            BOARD,
        );
        assert_eq!(
            labels(&m.lines),
            vec![
                "1 blocking, 0 waiting",
                "-",
                "Q112 the tray menu",
                "-",
                "Open board",
                "Activity",
                "Notification settings",
                "Notification lab",
                "Pause notifications",
                "-",
                "Exit",
            ]
        );
    }

    /* THE URL EACH CARD LINE OPENS: the board root plus q/ plus the id, the
       same string lib/notify.mjs builds for the popup's card. */
    /* a card that carries its key opens the record's page by the key */
    #[test]
    fn a_keyed_card_line_opens_r_by_key() {
        let mut f = face(1, 0, &[("Q7", "one"), ("Q8", "two")], "");
        f.cards[0].key = "k7m2q9xa".to_string();
        let m = menu_model(&f, None, None, Some(NOTIFY), None, BOARD);
        let cards = cards_of(&m.lines);
        assert_eq!(cards[0].1, "http://127.0.0.1:4321/s/r/k7m2q9xa");
        assert_eq!(cards[1].1, "http://127.0.0.1:4321/s/r/Q8");
    }

    #[test]
    fn a_card_line_opens_the_questions_own_card() {
        let m = menu_model(
            &face(2, 0, &[("Q7", "one"), ("Q112", "two")], ""),
            None,
            None,
            Some(NOTIFY),
            None,
            BOARD,
        );
        let cards = cards_of(&m.lines);
        assert_eq!(cards[0].1, "http://127.0.0.1:4321/s/r/Q7");
        assert_eq!(cards[1].1, "http://127.0.0.1:4321/s/r/Q112");
    }

    #[test]
    fn exactly_five_is_five_lines_and_more_than_five_is_still_five() {
        let five = [
            ("Q1", "a"),
            ("Q2", "b"),
            ("Q3", "c"),
            ("Q4", "d"),
            ("Q5", "e"),
        ];
        let m = menu_model(&face(5, 0, &five, ""), None, None, Some(NOTIFY), None, BOARD);
        assert_eq!(cards_of(&m.lines).len(), 5);

        let six = [
            ("Q1", "a"),
            ("Q2", "b"),
            ("Q3", "c"),
            ("Q4", "d"),
            ("Q5", "e"),
            ("Q6", "f"),
        ];
        let m = menu_model(&face(6, 0, &six, ""), None, None, Some(NOTIFY), None, BOARD);
        let cards = cards_of(&m.lines);
        assert_eq!(cards.len(), 5, "the first five and no sixth");
        assert!(!cards.iter().any(|(l, _)| l.contains("Q6")));
        /* and the COUNT still says six: the line list is capped, the reading is
           not, so a reader is never told there are only five blockers */
        assert_eq!(labels(&m.lines)[0], "6 blocking, 0 waiting");
    }

    /* THE TWO LINKS, each present only when the server handed its URL over, and
       omitted with no gap and no greyed placeholder when it did not. */
    /* THE PAUSE LINE RIDES `--notify`, the route the verb is posted to, and not
       `--settings`, the page the link opens: measured 2026-09-09 against a live
       board, a POST to the settings PAGE is a 404, since the route table gates
       the method. A server that named no route to post to shows no pause line,
       the same rule each link line keeps. */
    #[test]
    fn the_pause_line_rides_the_notify_route_and_not_the_settings_page() {
        let f = face(0, 0, &[], "");
        let with = labels(&menu_model(&f, Some(SETTINGS), Some(LAB), Some(NOTIFY), None, BOARD).lines);
        assert!(with.contains(&"Pause notifications".to_string()));

        let without = menu_model(&f, Some(SETTINGS), Some(LAB), None, None, BOARD);
        let names = labels(&without.lines);
        assert!(!names.iter().any(|l| l.starts_with("Pause")));
        assert!(names.contains(&"Notification settings".to_string()),
            "the settings LINK is still there: it is a page, not a route");
        assert!(!without.lines.iter().any(|l| matches!(l, Line::Submenu { .. })));
        /* one line shorter, and no gap: the separators do not move */
        assert_eq!(names.len(), with.len() - 1);
        assert_eq!(names.last().unwrap(), "Exit");
    }

    #[test]
    fn each_link_line_rides_its_own_flag() {
        let f = face(0, 0, &[], "");
        let both = labels(&menu_model(&f, Some(SETTINGS), Some(LAB), Some(NOTIFY), None, BOARD).lines);
        assert!(both.contains(&"Notification settings".to_string()));
        assert!(both.contains(&"Notification lab".to_string()));

        let neither = labels(&menu_model(&f, None, None, Some(NOTIFY), None, BOARD).lines);
        assert!(!neither.iter().any(|l| l.starts_with("Notification")));

        let settings_only = labels(&menu_model(&f, Some(SETTINGS), None, Some(NOTIFY), None, BOARD).lines);
        assert!(settings_only.contains(&"Notification settings".to_string()));
        assert!(!settings_only.contains(&"Notification lab".to_string()));

        let lab_only = labels(&menu_model(&f, None, Some(LAB), Some(NOTIFY), None, BOARD).lines);
        assert!(!lab_only.contains(&"Notification settings".to_string()));
        assert!(lab_only.contains(&"Notification lab".to_string()));

        /* Add a PC rides --add-pc, under Activity */
        let add = labels(&menu_model(&f, None, None, Some(NOTIFY), Some(ADD_PC), BOARD).lines);
        let at = add.iter().position(|l| l == "Add a PC").expect("the Add a PC line");
        assert_eq!(add[at - 1], "Activity");
        assert!(!neither.contains(&"Add a PC".to_string()));

        /* an omitted line takes its own row and nothing else: no separator
           moves and the menu is one line shorter, not one gap longer */
        assert_eq!(
            menu_model(&f, Some(SETTINGS), Some(LAB), Some(NOTIFY), None, BOARD).lines.len(),
            neither.len() + 2
        );
    }

    /* THE FOUR PAUSE STATES. The exe holds no clock and compares no stamp: an
       empty label from the server IS no pause, and the words after "Paused "
       are the server's own. */
    #[test]
    fn the_pause_parent_reads_the_servers_own_words_and_resume_greys_with_it() {
        let none = menu_model(&face(0, 0, &[], ""), None, None, Some(NOTIFY), None, BOARD);
        let (label, entries) = submenu(&none.lines);
        assert_eq!(label, "Pause notifications");
        assert_eq!(
            labels(&entries),
            vec![
                "For 1 hour",
                "Until 07:00 tomorrow",
                "Until I resume",
                "-",
                "Resume now",
            ]
        );
        assert!(
            matches!(entries[4], Line::Grayed(_)),
            "Resume now is greyed while nothing holds"
        );

        for (given, want) in [
            ("until 15:40", "Paused until 15:40"),
            ("until 07:00 tomorrow", "Paused until 07:00 tomorrow"),
            ("until I resume", "Paused until I resume"),
        ] {
            let m = menu_model(&face(0, 0, &[], given), None, None, Some(NOTIFY), None, BOARD);
            let (label, entries) = submenu(&m.lines);
            assert_eq!(label, want);
            assert!(
                matches!(entries[4], Line::Item { .. }),
                "Resume now is live while a pause holds: {given}"
            );
            /* the same five entries at every state: no check marks, and no
               entry appears or vanishes, so the submenu never changes length */
            assert_eq!(entries.len(), 5);
        }

        /* and the MENU's own length is the same at all four states: only the
           parent line's words move */
        let lens: Vec<usize> = ["", "until 15:40", "until 07:00 tomorrow", "until I resume"]
            .iter()
            .map(|l| menu_model(&face(0, 0, &[], l), None, None, Some(NOTIFY), None, BOARD).lines.len())
            .collect();
        assert_eq!(lens, vec![7, 7, 7, 7]);
    }

    /* THE TWO STRING RULES, IN THIS ORDER AND NEVER THE OTHER. */
    #[test]
    fn cut_is_over_the_whole_line_on_scalar_boundaries() {
        assert_eq!(cut("short", 40), "short");
        /* exactly n is not cut; n + 1 is */
        assert_eq!(cut("abcde", 5), "abcde");
        assert_eq!(cut("abcdef", 5), "abcde...");
        /* a name whose fortieth character sits inside a multi-byte scalar: the
           cut lands on the boundary and never inside it */
        let line = format!("Q1 {}", "e\u{0301}".repeat(30));
        let out = cut(&line, LINE_MAX);
        assert_eq!(out.chars().count(), LINE_MAX + 3);
        assert!(out.ends_with("..."));
        assert!(std::str::from_utf8(out.as_bytes()).is_ok());
        /* an emoji name: no split, no panic, and the count is in SCALARS */
        let emoji = format!("Q2 {}", "\u{1F600}".repeat(60));
        let out = cut(&emoji, LINE_MAX);
        assert_eq!(out.chars().count(), LINE_MAX + 3);
    }

    #[test]
    fn menu_label_doubles_every_ampersand() {
        assert_eq!(menu_label("Open board"), "Open board");
        assert_eq!(menu_label("ship & tell"), "ship && tell");
        assert_eq!(menu_label("a & b & c"), "a && b && c");
        assert_eq!(menu_label("&&"), "&&&&");
    }

    /* THE ORDER, pinned as a behaviour rather than as a preference: the CUT
       runs on the raw line and the doubling after it, so a doubled pair can
       never be cut in half and turn a literal ampersand into an access key. */
    #[test]
    fn a_name_with_an_ampersand_is_cut_first_and_doubled_second() {
        let m = menu_model(
            &face(1, 0, &[("Q9", "ship & tell: the menu")], ""),
            None,
            None,
            Some(NOTIFY),
            None,
            BOARD,
        );
        assert_eq!(cards_of(&m.lines)[0].0, "Q9 ship && tell: the menu");

        /* forty characters of raw line, with the ampersand at the very end of
           what survives: doubling first would have pushed a lone & to the cut */
        let name = format!("{}&{}", "a".repeat(36), "z".repeat(10));
        let m = menu_model(&face(1, 0, &[("Q9", &name)], ""), None, None, Some(NOTIFY), None, BOARD);
        let label = &cards_of(&m.lines)[0].0;
        assert_eq!(cut(&format!("Q9 {name}"), LINE_MAX).chars().count(), LINE_MAX + 3);
        assert!(label.ends_with("&&..."), "{label}");
        /* every ampersand that survived the cut is doubled, and there are no
           odd runs left anywhere */
        for run in label.split(|c| c != '&').filter(|r| !r.is_empty()) {
            assert_eq!(run.len() % 2, 0, "an odd run of ampersands: {label}");
        }
    }

    #[test]
    fn a_name_that_needs_the_cut_gets_three_ascii_dots() {
        let long = "the tray menu: what its dynamic lines carry and why";
        let m = menu_model(&face(1, 0, &[("Q105", long)], ""), None, None, Some(NOTIFY), None, BOARD);
        let label = &cards_of(&m.lines)[0].0;
        assert_eq!(label.chars().count(), LINE_MAX + 3);
        assert!(label.ends_with("..."));
        assert!(label.starts_with("Q105 the tray menu"));
        assert!(label.is_ascii(), "the source stays ASCII: {label}");
    }

    /* THE FROZEN CARD URLS, pinned through the step the rule actually lives in:
       the MODEL to the VECTOR to the ID OFFSET. menu() writes card_urls(&model)
       into the thread-local before TrackPopupMenu and command() reads pick() out
       of it, and both of those are unreachable from a unit test (Win32, a
       thread-local State), so what is pinned here is the mapping they use. A
       vector built from one model answers THAT model's URLs however the live
       Face moves afterwards, which is the whole reason the freeze exists: the
       network thread can replace Face.cards while a menu sits open, and a click
       that read the live state would open a card the reader never saw. */
    #[test]
    fn the_stored_card_urls_survive_a_state_change() {
        let mut f = face(2, 0, &[("Q7", "one"), ("Q8", "two")], "");
        f.waiting = 1;
        f.waiting_cards = card_list(&[("Q30", "waiting one")]);
        let frozen = card_urls(&menu_model(&f, None, None, Some(NOTIFY), None, BOARD));

        /* the id a click carries, straight back to the URL that line drew */
        assert_eq!(pick(&frozen, IDM_CARD_BASE), Some("http://127.0.0.1:4321/s/r/Q7"));
        assert_eq!(pick(&frozen, IDM_CARD_BASE + 1), Some("http://127.0.0.1:4321/s/r/Q8"));
        assert_eq!(pick(&frozen, IDM_WAIT_BASE), Some("http://127.0.0.1:4321/s/r/Q30"));
        /* a slot no line took, and an id below the block, are both nothing */
        assert_eq!(pick(&frozen, IDM_CARD_BASE + 2), None);
        assert_eq!(pick(&frozen, IDM_WAIT_BASE + 4), None);
        assert_eq!(pick(&frozen, 1), None);

        /* THE STREAM LANDS A WHOLE NEW STATE WHILE THE MENU IS OPEN: different
           questions, in both blocks, and the model built from it says so */
        f.cards = card_list(&[("Q99", "somebody else")]);
        f.waiting_cards = card_list(&[("Q98", "and another")]);
        let after = card_urls(&menu_model(&f, None, None, Some(NOTIFY), None, BOARD));
        assert_eq!(pick(&after, IDM_CARD_BASE), Some("http://127.0.0.1:4321/s/r/Q99"));
        assert_eq!(pick(&after, IDM_WAIT_BASE), Some("http://127.0.0.1:4321/s/r/Q98"));

        /* and the vector THIS open froze still answers the old URLs, which is
           what a click on the menu the reader is looking at gets */
        assert_eq!(pick(&frozen, IDM_CARD_BASE), Some("http://127.0.0.1:4321/s/r/Q7"));
        assert_eq!(pick(&frozen, IDM_CARD_BASE + 1), Some("http://127.0.0.1:4321/s/r/Q8"));
        assert_eq!(pick(&frozen, IDM_WAIT_BASE), Some("http://127.0.0.1:4321/s/r/Q30"));
    }

    /* THE SECOND BLOCK: the newest waiting questions
       under the blockers, each opening its own card, under a greyed heading
       that says which block it is. */
    #[test]
    fn the_waiting_block_sits_under_the_blockers_with_its_own_ids() {
        let mut f = face(1, 2, &[("Q1", "the blocker")], "");
        f.waiting_cards = card_list(&[("Q9", "newest waiter"), ("Q4", "older waiter")]);
        let m = menu_model(&f, Some(SETTINGS), Some(LAB), Some(NOTIFY), None, BOARD);
        assert_eq!(
            labels(&m.lines),
            vec![
                "1 blocking, 2 waiting",
                "-",
                "Q1 the blocker",
                "-",
                "waiting",
                "Q9 newest waiter",
                "Q4 older waiter",
                "-",
                "Open board",
                "Activity",
                "Notification settings",
                "Notification lab",
                "Pause notifications",
                "-",
                "Exit",
            ]
        );
        /* THE TWO ID BLOCKS ARE DISJOINT AND FIXED: the waiting lines are 105
           and up whatever the blocking block's length was */
        assert_eq!(card_ids(&m.lines), vec![100, 105, 106]);
        let cards = cards_of(&m.lines);
        assert_eq!(cards[1].1, "http://127.0.0.1:4321/s/r/Q9");
        assert_eq!(cards[2].1, "http://127.0.0.1:4321/s/r/Q4");
        /* the heading is a line to READ and not one to click */
        assert!(m.lines.iter().any(|l| matches!(l, Line::Grayed(w) if w == "waiting")));

        /* FIVE BLOCKERS AND FIVE WAITERS is the full dress, and the second block
           starts at 105 there too */
        let five = [("Q1", "a"), ("Q2", "b"), ("Q3", "c"), ("Q4", "d"), ("Q5", "e")];
        let mut full = face(9, 9, &five, "");
        full.waiting_cards = card_list(&[
            ("Q20", "v"),
            ("Q19", "w"),
            ("Q18", "x"),
            ("Q17", "y"),
            ("Q16", "z"),
        ]);
        let m = menu_model(&full, Some(SETTINGS), Some(LAB), Some(NOTIFY), None, BOARD);
        assert_eq!(card_ids(&m.lines), vec![100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
        assert_eq!(m.lines.len(), 22);

        /* and a SIXTH waiting card is not drawn, exactly as a sixth blocker is
           not: the cap is on what the menu will look at */
        let mut over = face(0, 6, &[], "");
        over.waiting_cards = card_list(&[
            ("Q6", "a"), ("Q5", "b"), ("Q4", "c"), ("Q3", "d"), ("Q2", "e"), ("Q1", "f"),
        ]);
        let m = menu_model(&over, None, None, Some(NOTIFY), None, BOARD);
        assert_eq!(cards_of(&m.lines).len(), 5);
        assert!(!labels(&m.lines).iter().any(|l| l.contains("Q1 ")));
    }

    /* A BOARD WITH NOTHING WAITING DRAWS NO BLOCK AT ALL, heading and separator
       included: the menu never carries a gap where a question would be. */
    #[test]
    fn no_waiting_question_draws_no_waiting_block() {
        let m = menu_model(&face(1, 0, &[("Q1", "the blocker")], ""), None, None, Some(NOTIFY), None, BOARD);
        assert_eq!(
            labels(&m.lines),
            vec![
                "1 blocking, 0 waiting",
                "-",
                "Q1 the blocker",
                "-",
                "Open board",
                "Activity",
                "Pause notifications",
                "-",
                "Exit",
            ]
        );
        assert!(!labels(&m.lines).contains(&"waiting".to_string()));

        /* and a board with waiting questions and NO blockers draws the second
           block alone, with no empty first one above it */
        let mut waiters = face(0, 2, &[], "");
        waiters.waiting_cards = card_list(&[("Q9", "one"), ("Q8", "two")]);
        let m = menu_model(&waiters, None, None, Some(NOTIFY), None, BOARD);
        assert_eq!(
            labels(&m.lines),
            vec![
                "0 blocking, 2 waiting",
                "-",
                "waiting",
                "Q9 one",
                "Q8 two",
                "-",
                "Open board",
                "Activity",
                "Pause notifications",
                "-",
                "Exit",
            ]
        );
        assert_eq!(card_ids(&m.lines), vec![105, 106]);
    }

    /* THE MENU OPENED BEFORE THE FIRST HELLO. The spawn argv carries a blocking
       count and nothing else, so the counts line says one neutral word and no
       numbers, and no question line is drawn: `3 blocking, 0 waiting` with
       nothing under it is a half nobody said. */
    #[test]
    fn the_menu_before_the_first_frame_names_no_numbers() {
        let mut f = face(3, 0, &[("Q1", "not yet")], "");
        f.told = false;
        let m = menu_model(&f, Some(SETTINGS), Some(LAB), Some(NOTIFY), None, BOARD);
        assert_eq!(
            labels(&m.lines),
            vec![
                "connecting",
                "-",
                "Open board",
                "Activity",
                "Notification settings",
                "Notification lab",
                "Pause notifications",
                "-",
                "Exit",
            ]
        );
        assert!(cards_of(&m.lines).is_empty(), "no question line before the first frame");
        assert!(matches!(m.lines[0], Line::Counts(_)), "and it is still the greyed line");

        /* the FIRST FRAME is what turns the numbers on, and nothing else does */
        f.told = true;
        let m = menu_model(&f, Some(SETTINGS), Some(LAB), Some(NOTIFY), None, BOARD);
        assert_eq!(labels(&m.lines)[0], "3 blocking, 0 waiting");
        assert_eq!(cards_of(&m.lines).len(), 1);
    }

    /* ---- the recent files block ------------------------- */

    /* THE BLOCK IS NOT DRAWN AT ALL WHEN THE LIST IS EMPTY, heading included, so
       the menu never carries a gap where a file would be. */
    #[test]
    fn no_recent_file_draws_no_recent_block() {
        let m = menu_model(&face(0, 0, &[], ""), None, None, Some(NOTIFY), None, BOARD);
        assert_eq!(
            labels(&m.lines),
            vec!["nothing waiting", "-", "Open board", "Activity", "Pause notifications", "-", "Exit"]
        );
        assert!(recent_urls(&m).iter().all(|u| u.is_empty()));
    }

    /* ONE ENTRY IS A HEADING, A LINE AND A SEPARATOR, and the block sits ABOVE
       Open board, where the reader looks for what the board just did. */
    #[test]
    fn one_recent_file_is_one_line_above_open_board() {
        let m = menu_model(&recent_face(&[("T-86", 2, "opener.rs")]), None, None, None, None, BOARD);
        assert_eq!(
            labels(&m.lines),
            vec!["nothing waiting", "-", "recent files", "opener.rs", "-", "Open board", "Activity", "-", "Exit"]
        );
        assert_eq!(
            cards_of(&m.lines),
            vec![(
                "opener.rs".to_string(),
                "http://127.0.0.1:4321/s/f/T-86/2/open".to_string()
            )]
        );
        assert_eq!(card_ids(&m.lines), vec![IDM_RECENT_BASE]);
    }

    /* FIVE SLOTS AND NO SIXTH: the server counts to five, net.rs caps again on
       arrival, and this is the third and last place. */
    #[test]
    fn five_recent_files_are_five_lines_and_more_are_still_five() {
        let five = [
            ("T-86", 0, "a.md"),
            ("T-86", 1, "b.md"),
            ("Q113", 0, "c.md"),
            ("WS-4", 3, "d.md"),
            ("P-3", 2, "e.md"),
        ];
        let m = menu_model(&recent_face(&five), None, None, None, None, BOARD);
        assert_eq!(
            card_ids(&m.lines),
            vec![
                IDM_RECENT_BASE,
                IDM_RECENT_BASE + 1,
                IDM_RECENT_BASE + 2,
                IDM_RECENT_BASE + 3,
                IDM_RECENT_BASE + 4
            ]
        );
        let mut six = five.to_vec();
        six.push(("T-99", 0, "f.md"));
        let m = menu_model(&recent_face(&six), None, None, None, None, BOARD);
        assert_eq!(card_ids(&m.lines).len(), 5);
        assert_eq!(
            cards_of(&m.lines).last().unwrap().1,
            "http://127.0.0.1:4321/s/f/P-3/2/open"
        );
    }

    /* THE RECENT URLS ARE FROZEN AT MENU BUILD TIME, beside the card URLs: the
       network thread can replace Face.recent while the menu sits open, and a
       live read would open a file the reader never saw. */
    #[test]
    fn the_stored_recent_urls_survive_a_state_change() {
        let mut f = recent_face(&[("T-86", 2, "opener.rs"), ("Q113", 0, "notes.md")]);
        f.cards = card_list(&[("Q7", "one")]);
        f.blocking = 1;
        let frozen = recent_urls(&menu_model(&f, None, None, Some(NOTIFY), None, BOARD));
        assert_eq!(
            pick_recent(&frozen, IDM_RECENT_BASE),
            Some("http://127.0.0.1:4321/s/f/T-86/2/open")
        );
        assert_eq!(
            pick_recent(&frozen, IDM_RECENT_BASE + 1),
            Some("http://127.0.0.1:4321/s/f/Q113/0/open")
        );
        /* a slot no line took, and a CARD's id, are both nothing here: the two
           blocks own disjoint ranges and disjoint vectors */
        assert_eq!(pick_recent(&frozen, IDM_RECENT_BASE + 2), None);
        assert_eq!(pick_recent(&frozen, IDM_CARD_BASE), None);
        assert_eq!(pick(&card_urls(&menu_model(&f, None, None, None, None, BOARD)), IDM_RECENT_BASE), None);

        f.recent = recent_list(&[("T-99", 9, "somebody else.md")]);
        let after = recent_urls(&menu_model(&f, None, None, Some(NOTIFY), None, BOARD));
        assert_eq!(
            pick_recent(&after, IDM_RECENT_BASE),
            Some("http://127.0.0.1:4321/s/f/T-99/9/open")
        );
        assert_eq!(
            pick_recent(&frozen, IDM_RECENT_BASE),
            Some("http://127.0.0.1:4321/s/f/T-86/2/open")
        );
    }

    /* THE TWO STRING RULES, on a recent line as on every other: cut first at
       forty over the whole line, escape second. */
    #[test]
    fn a_recent_line_is_cut_at_forty_and_its_ampersand_doubled() {
        let long = "a-really-long-file-name-that-runs-past-forty.md";
        let m = menu_model(&recent_face(&[("T-86", 0, long)]), None, None, None, None, BOARD);
        let drawn = cards_of(&m.lines)[0].0.clone();
        assert_eq!(drawn, cut(long, LINE_MAX));
        assert_eq!(drawn.chars().count(), LINE_MAX + 3);

        let m = menu_model(&recent_face(&[("T-86", 0, "ship & tell notes.md")]), None, None, None, None, BOARD);
        assert_eq!(cards_of(&m.lines)[0].0, "ship && tell notes.md");
    }

    /* BEFORE THE FIRST FRAME nothing is drawn from the stream at all, and the
       recent block is no exception. */
    #[test]
    fn the_recent_block_waits_for_the_first_frame_like_every_other() {
        let mut f = recent_face(&[("T-86", 2, "opener.rs")]);
        f.told = false;
        let m = menu_model(&f, None, None, None, None, BOARD);
        assert!(!labels(&m.lines).contains(&"recent files".to_string()));
    }
}
