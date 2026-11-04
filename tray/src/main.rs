/* AskerDo's tray: one native executable that owns the Windows tray icon,
 * its tooltip, its menu and its alert popup, with no script host resident
 * beside it.
 *
 * It is a CLIENT of the board server and nothing else: it writes no record,
 * reads no store, and holds no state the server does not hand it. The wire
 * contract is in tray/README.md, pinned by the crate tests and
 * test/tray.test.mjs; every argv flag, header, event name, exit code and timing
 * below comes from there.
 *
 * The shape, in three threads:
 *   - THIS thread becomes the message loop (tray.rs). It owns the window, the
 *     notify icon, the menu and every HICON. Nothing else touches them.
 *   - one NETWORK thread (net.rs) holds the events stream, falls back to the
 *     ping when the stream is down, and hands each alert to the popup.
 *   - one STDIN thread, because the control channel is a blocking pipe read
 *     that cannot sit on a message loop and must not become a poll.
 * State crosses on a Mutex plus a PostMessage, so the message loop never
 * blocks on the network and the network never touches a window handle other
 * than to post to it.
 */
#![windows_subsystem = "windows"]

mod alert;
mod console;
mod console_view;
mod http;
mod icon;
mod journal;
mod net;
mod open;
mod opener;
mod popup;
mod registry;
mod serve;
mod shortcut;
mod sse;
mod tray;
mod url;

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};

use journal::Journal;

/* The identity the tray's windows wear and the Start Menu shortcut carries, so
   the shell takes the two for one app. */
pub const AUMID: &str = "ToxMox.AskerDo";
/* The app's mark: the package's app.ico, the same drawing build.rs embeds as
   the exe's own resource icon, committed beside the exe in assets/. The Start
   Menu shortcut wears it. */
pub const ICON_FILE: &str = "app.ico";
/* The Start Menu shortcut's file name, which is the name Start shows. */
pub const DISPLAY_NAME: &str = "AskerDo";

/* The exit codes the protocol pins. 1 is deliberately unused: a panic is the
   only thing that should ever produce it, and panic = "abort" makes even that
   loud rather than quiet. */
pub const EXIT_OK: i32 = 0;
pub const EXIT_ARGS: i32 = 2;
pub const EXIT_REGISTER: i32 = 3;
pub const EXIT_INSTANCE: i32 = 4;
/* The tray could not be shown: the window class, the window or the shell's
   icon slot refused. It is its OWN code rather than 3, because 3 says the
   Start Menu or registry flags failed and a reader of a log deserves the truth
   about which half failed. The server falls back on any pre-attach exit, so a
   code of its own costs it nothing. */
pub const EXIT_TRAY: i32 = 5;
/* THE SELF-REAP: two ping failures in a row say the server this exe belongs to
   is gone, so the exe retires itself. It is its OWN code rather than 0 because
   the server reads 0 after an attach as the person choosing Exit from the menu,
   and a server that stalled past two pings and then recovered would read its
   own reaped tray as a decision and refuse every alert until its next start.
   Under --no-icon there is no menu to choose Exit from at all, so that reading
   cannot be right. The server takes 6 as a crash: the tray
   goes back up once, past the floor, or at the next demand. */
pub const EXIT_GONE: i32 = 6;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Dot {
    Waiting,
    Quiet,
    Blocking,
}

impl Dot {
    pub fn parse(s: &str) -> Option<Dot> {
        match s {
            "waiting" => Some(Dot::Waiting),
            "quiet" => Some(Dot::Quiet),
            "blocking" => Some(Dot::Blocking),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Dot::Waiting => "waiting",
            Dot::Quiet => "quiet",
            Dot::Blocking => "blocking",
        }
    }
}

/* What the network thread knows and the message loop draws. The count is kept
   even while the dot is not blocking, because the ping path carries no count
   at all and the protocol says the last known one stands while the ping says
   blocking. */
/* ONE QUESTION LINE OF THE MENU, as the stream sent it and as the menu draws
   it. The id has already passed the store's own Q-shape on arrival (net.rs), so
   nothing but digits after a Q is ever concatenated into a card URL. */
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Card {
    pub id: String,
    pub name: String,
    /* the record's key, '' when the frame carried none (or a malformed one) */
    pub key: String,
}

/* ONE RECENT-FILES LINE. NO PATH RIDES THE WIRE: the name is the
   basename the server cut, and the id plus the index is how the click asks for
   that file again, through the same route the board's own row posts to. */
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Recent {
    pub id: String,
    pub index: u32,
    pub name: String,
}

pub struct Face {
    pub dot: Dot,
    pub blocking: u32,
    /* THE MENU'S OWN STATE, and every one of these fields follows the
       count's rule above: an absent field on a frame leaves the last known
       value standing, and the PING path carries none of them at all, so a long
       stream outage leaves the menu showing the last state the stream told it,
       exactly as the tooltip's count already does. */
    pub waiting: u32,
    pub cards: Vec<Card>,
    /* THE MENU'S SECOND BLOCK: the newest WAITING
       questions, at most five, beside the blocking ones and never mixed into
       them. An empty list draws no block at all. */
    pub waiting_cards: Vec<Card>,
    /* THE FILES THE OPENER TOUCHED, at most five, newest first,
       under the same absent-leaves-the-last-value rule. An empty list draws no
       block at all, heading included. */
    pub recent: Vec<Recent>,
    /* notify.json's own value, verbatim: "", a store stamp, or `until-resume`.
       The exe never parses it and never compares it against a clock: it has no
       local clock and must not grow one. It is diffed rather than drawn: the
       menu prints `pause_label` and this is what makes a pause the page set
       reach `apply` as a move even when the words did not change. */
    pub paused: String,
    /* the WORDS after "Paused ", built by the server off the clock that wrote
       the stamp, and printed by the menu verbatim. Empty means no pause holds. */
    pub pause_label: String,
    /* WHETHER THE STREAM HAS SAID ANYTHING YET. False from the spawn argv until
       the first hello lands, which is what lets the counts line say `connecting`
       rather than a fabricated `0 waiting` beside the argv's blocking count. */
    pub told: bool,
}

pub struct App {
    pub args: Args,
    pub face: Mutex<Face>,
    pub journal: Journal,
    pub stop: AtomicBool,
    pub code: AtomicI32,
}

impl App {
    /* Every exit runs through here: the FIRST caller wins, so a stream that
       saw a different instance and a stdin that reached EOF in the same
       moment cannot argue about the code. The message loop is woken to take
       the icon down; it is the only thread allowed to. */
    pub fn quit(&self, code: i32, hwnd: isize, why: &str) {
        if self.stop.swap(true, Ordering::SeqCst) {
            return;
        }
        self.code.store(code, Ordering::SeqCst);
        self.journal.line(&format!("exit {code}: {why}"));
        tray::post_quit(hwnd);
    }
}

pub struct Args {
    pub board: String,
    pub events: String,
    pub ping: String,
    pub instance: String,
    pub dot: Dot,
    pub blocking: u32,
    pub version: String,
    /* WHETHER THERE IS AN ICON AT ALL. `--no-icon` runs everything else
       untouched, the stream, the popup and the stdin control channel, with no
       notification-area icon and therefore no menu: it is what notify.json's
       `tray: false` means. The window is still created (it is never shown
       either way, and it is what the message loop and the quit path are built
       on); the shell's icon slot is simply never asked for. */
    pub icon: bool,
    pub log: Option<PathBuf>,
    /* THE MENU'S TWO LINKS, absolute loopback URLs the SERVER builds and
       hands over at the on-demand start. The exe builds NO URL of its own here:
       deriving `board + "notifications"` in Rust would put a copy of the
       server's route table inside a committed binary, where a route rename
       becomes a silent 404 and a rebuild-and-revendor to fix. AN ABSENT FLAG
       MEANS THE MENU OMITS THAT LINE, with no gap and no greyed placeholder.
       `--settings` is a PAGE the menu opens and nothing else: the pause is
       POSTed to `--notify` below, because that page route takes no POST. */
    pub settings: Option<String>,
    pub lab: Option<String>,
    /* THE ROUTE THE PAUSE IS POSTED TO, and it is a THIRD flag rather than the
       settings URL reused, because the settings PAGE takes no POST: measured
       2026-09-09 against a live board, a POST of the pause verb to
       `<secret>/notifications` answers 404, since the server's route table
       gates the method. An absent one omits the pause line, exactly as an
       absent `--settings` omits its own. */
    pub notify: Option<String>,
    /* the Add a PC page, which mints a join code through the board; absent
       omits the line, like the two links above */
    pub add_pc: Option<String>,
}

/* The AppUserModelId key older releases wrote: its only reader was the
   notification platform, so a start removes it when present. A failure is one
   line and never an exit. */
fn drop_the_toast_key(mut line: impl FnMut(&str)) {
    match registry::remove() {
        Ok(true) => line(&format!("removed the notification key {AUMID}")),
        Ok(false) => {}
        Err(e) => line(&format!("notification key removal failed: {e}")),
    }
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();

    /* The two hand-and-test flags, before anything else: they touch the Start
       Menu and the registry and exit, and they show a window of no kind. */
    if argv.iter().any(|a| a == "--unregister") {
        attach_console();
        let mut code = EXIT_OK;
        if let Err(e) = registry::remove() {
            say(&format!("notification key removal failed: {e}"));
            code = EXIT_REGISTER;
        }
        if let Err(e) = shortcut::uninstall() {
            say(&format!("shortcut removal failed: {e}"));
            code = EXIT_REGISTER;
        }
        std::process::exit(code);
    }
    if argv.iter().any(|a| a == "--register") {
        attach_console();
        let mut code = EXIT_OK;
        drop_the_toast_key(say);
        /* strict where the resident start is not: a person running --register
           is asking whether the shortcut is whole */
        if let Err(e) = shortcut::install() {
            say(&format!("shortcut failed: {e}"));
            code = EXIT_REGISTER;
        }
        if code == EXIT_OK {
            say("registered");
        }
        std::process::exit(code);
    }

    /* THE SHORTCUT'S CLICK. A person who clicks the Start Menu entry
       is asking for the board. It reads the store's board folder, opens the
       running board the way the tray's own menu item does, and exits 0 whether
       it found one or not: no window, no console, one journal line. It is a
       mode of its own before parse_args, exactly as the two registry flags
       are, because the resident argv has nothing to do with it. */
    if open::requested(&argv) {
        open::run(&Journal::open(open::log_path(&argv)));
        std::process::exit(EXIT_OK);
    }

    /* THE SCHEDULED TASK'S ACTION. The board is launched by a
       per-user scheduled task rather than by the session that noticed it was
       down, so it lands outside every Claude job; this exe is the task's
       action because a GUI-subsystem image gets no console and a task whose
       action is node.exe shows a real window. It creates the server, closes
       both handles and exits: no icon, no stream, no registry, no shortcut,
       nothing written anywhere. A mode of its own before parse_args, exactly
       as --open is. */
    if serve::requested(&argv) {
        let code = serve::run(&Journal::open(serve::log_path(&argv)), &argv);
        std::process::exit(code);
    }

    let args = match parse_args(&argv) {
        Ok(a) => a,
        Err(e) => {
            attach_console();
            say(&format!("askerdo-tray: {e}"));
            say("usage: askerdo-tray --board <url> --events <url> --ping <url>");
            say("       --instance <id> --dot waiting|quiet|blocking --blocking <n>");
            say("       --version <x.y.z> [--settings <url>] [--lab <url>] [--notify <url>] [--add-pc <url>]");
            say("       [--no-icon] [--log <path>]");
            say("       askerdo-tray --register | --unregister");
            say("       askerdo-tray --open [--log <path>]");
            say("       askerdo-tray --serve --root <store root> [--log <path>]");
            std::process::exit(EXIT_ARGS);
        }
    };

    let app = Arc::new(App {
        face: Mutex::new(Face {
            dot: args.dot,
            blocking: args.blocking,
            /* the spawn argv carries the dot and the blocking count and nothing
               else, so the menu's own state starts empty and is filled by the
               first hello, which arrives in tens of milliseconds. `told` is
               what keeps the counts line honest until it does. */
            waiting: 0,
            cards: Vec::new(),
            waiting_cards: Vec::new(),
            recent: Vec::new(),
            paused: String::new(),
            pause_label: String::new(),
            told: false,
        }),
        journal: Journal::open(args.log.clone()),
        stop: AtomicBool::new(false),
        code: AtomicI32::new(EXIT_OK),
        args,
    });

    app.journal.line(&format!(
        "start version {} instance {} dot {} blocking {} icon {}",
        app.args.version,
        app.args.instance,
        app.args.dot.name(),
        app.args.blocking,
        app.args.icon
    ));

    /* Before any icon exists: the process wears the identity, and the key
       older releases left behind goes. */
    tray::set_app_id(AUMID);
    drop_the_toast_key(|line| app.journal.line(line));

    /* The Start Menu shortcut, on a thread of its OWN and never in the start
       sequence: writing the link the FIRST time took 21 seconds (measured
       2026-09-08), far past the 500 ms the server gives the exe to attach, and
       a missing shortcut costs Start its entry and nothing else. Every later
       start finds the link already right and costs one file read. */
    let scribe = app.clone();
    if shortcut::from_other_store(open::store_root().as_deref()) {
        scribe.journal.line("shortcut left alone: this copy runs from another store");
    } else {
        std::thread::spawn(move || match shortcut::install() {
            Ok(()) => scribe.journal.line("shortcut ok"),
            Err(e) => scribe.journal.line(&format!("shortcut failed: {e}")),
        });
    }

    /* Step 3: the icon, before the network, so a server that is slow to
       answer still leaves a tray the moment the process is up. A failure here
       is exit 5: there is simply no tray, and a reader of a log deserves to
       know which half failed. Under `--no-icon` the window is still created
       and only the shell's icon slot is left alone, so the message loop, the
       quit path and the popup are the same code on both sides of the switch. */
    let win = match tray::Window::create(app.clone()) {
        Ok(w) => w,
        Err(e) => {
            app.journal.line(&format!("tray icon failed: {e}"));
            std::process::exit(EXIT_TRAY);
        }
    };
    let hwnd = win.handle();

    let net_app = app.clone();
    /* Never joined, exactly like the stdin thread below: see the exit at the
       bottom of this function for why. */
    let _ = std::thread::Builder::new()
        .name("net".into())
        .spawn(move || net::run(net_app, hwnd));

    let stdin_app = app.clone();
    /* The control channel. A closed pipe is the server going away abruptly,
       and `stop` is its polite form; both are exit 0. This thread is never
       joined: it is blocked in a read that only the pipe can end. */
    std::thread::Builder::new()
        .name("stdin".into())
        .spawn(move || {
            let mut line = String::new();
            let stdin = std::io::stdin();
            let mut handle = stdin.lock();
            loop {
                line.clear();
                match handle.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        if line.trim() == "stop" {
                            stdin_app.quit(EXIT_OK, hwnd, "stdin said stop");
                            return;
                        }
                    }
                    Err(_) => break,
                }
            }
            stdin_app.quit(EXIT_OK, hwnd, "stdin closed");
        })
        .ok();

    win.run();
    app.stop.store(true, Ordering::SeqCst);
    /* THE EXIT WAITS FOR NOTHING. The icon was already taken down in
       WM_TRAY_QUIT, which is what ended the loop above, so the only thing a
       join would buy is tidiness; what it COSTS is up to ten seconds, because
       the network thread can be inside ping()'s 5 s connect plus 5 s read with
       no stop check in the middle, while the server that sent `stop` waits
       1000 ms and then kills. The stop flag is set, and the process exit takes
       both threads with it: a `stop` and a broken pipe both end inside that
       1000 ms. */
    let code = app.code.load(Ordering::SeqCst);
    app.journal.line(&format!("stopped {code}"));
    std::process::exit(code);
}

fn parse_args(argv: &[String]) -> Result<Args, String> {
    let mut board = None;
    let mut events = None;
    let mut ping = None;
    let mut instance = None;
    let mut dot = None;
    let mut blocking = None;
    let mut version = None;
    let mut log = None;
    let mut settings = None;
    let mut lab = None;
    let mut notify = None;
    let mut add_pc = None;
    let mut icon = true;
    let mut i = 0;
    while i < argv.len() {
        let flag = argv[i].as_str();
        let value = || -> Result<String, String> {
            argv.get(i + 1)
                .cloned()
                .ok_or_else(|| format!("{flag} needs a value"))
        };
        /* the one flag that takes no value, so the step is its own */
        if flag == "--no-icon" {
            icon = false;
            i += 1;
            continue;
        }
        match flag {
            "--board" => board = Some(value()?),
            "--events" => events = Some(value()?),
            "--ping" => ping = Some(value()?),
            "--instance" => instance = Some(value()?),
            "--dot" => dot = Some(value()?),
            "--blocking" => blocking = Some(value()?),
            "--version" => version = Some(value()?),
            "--log" => log = Some(value()?),
            "--settings" => settings = Some(value()?),
            "--lab" => lab = Some(value()?),
            "--notify" => notify = Some(value()?),
            "--add-pc" => add_pc = Some(value()?),
            other => return Err(format!("unknown argument {other}")),
        }
        i += 2;
    }
    let need = |name: &str, v: Option<String>| v.ok_or_else(|| format!("missing {name}"));
    let board = need("--board", board)?;
    let events = need("--events", events)?;
    let ping = need("--ping", ping)?;
    let instance = need("--instance", instance)?;
    let version = need("--version", version)?;
    let dot = Dot::parse(&need("--dot", dot)?).ok_or("--dot must be waiting, quiet or blocking")?;
    let blocking: u32 = need("--blocking", blocking)?
        .parse()
        .map_err(|_| "--blocking must be a whole number".to_string())?;
    /* Every URL is parsed here rather than at first use, so a typo is exit 2
       at once instead of a tray that silently never attaches. */
    for (name, raw) in [("--board", &board), ("--events", &events), ("--ping", &ping)] {
        url::parse(raw).ok_or_else(|| format!("{name} is not an http URL: {raw}"))?;
    }
    /* the two optional ones join the SAME loop, so a typo in either is exit 2
       exactly like a typo in the other three rather than a menu line that opens
       nothing when somebody finally clicks it */
    for (name, raw) in [("--settings", &settings), ("--lab", &lab), ("--notify", &notify), ("--add-pc", &add_pc)] {
        if let Some(v) = raw {
            url::parse(v).ok_or_else(|| format!("{name} is not an http URL: {v}"))?;
        }
    }
    if instance.is_empty() {
        return Err("--instance must not be empty".into());
    }
    Ok(Args {
        board,
        events,
        ping,
        instance,
        dot,
        blocking,
        version,
        icon,
        log: log.map(PathBuf::from),
        settings,
        lab,
        notify,
        add_pc,
    })
}

/* A DIRECTORY OF THIS TEST RUN'S OWN, under the OS temp dir. The removals and
   the root resolution are probed there and never against the real Start Menu,
   the real registry or the real home. */
#[cfg(test)]
pub fn scratch(tag: &str) -> PathBuf {
    use std::sync::atomic::AtomicU32;
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let mut path = std::env::temp_dir();
    path.push(format!("askerdo-tray-{tag}-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&path);
    std::fs::create_dir_all(&path).expect("a scratch directory");
    path
}

fn say(line: &str) {
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

/* A windows-subsystem binary owns no console, so the two hand flags borrow
   the one that launched them. A redirected stdout (every test, and the
   server) already works without this; a person typing the flag at a prompt
   would otherwise see nothing at all. */
fn attach_console() {
    unsafe {
        windows_sys::Win32::System::Console::AttachConsole(
            windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::parse_args;

    fn argv(extra: &[&str]) -> Vec<String> {
        let mut v: Vec<String> = [
            "--board",
            "http://127.0.0.1:4321/s/",
            "--events",
            "http://127.0.0.1:4321/s/api/events",
            "--ping",
            "http://127.0.0.1:4321/s/ping",
            "--instance",
            "inst01",
            "--dot",
            "waiting",
            "--blocking",
            "0",
            "--version",
            "9.9.9",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        v.extend(extra.iter().map(|s| s.to_string()));
        v
    }

    #[test]
    fn the_icon_is_on_unless_no_icon_says_otherwise() {
        assert!(parse_args(&argv(&[])).unwrap().icon);
        assert!(!parse_args(&argv(&["--no-icon"])).unwrap().icon);
    }

    /* the flag takes NO value, so the argument after it is still parsed as a
       flag of its own: the one place a wrong step would eat the next pair */
    #[test]
    fn no_icon_takes_no_value_and_rides_beside_log() {
        let args = parse_args(&argv(&["--no-icon", "--log", "C:/tmp/tray.log"])).unwrap();
        assert!(!args.icon);
        assert_eq!(args.log.unwrap().to_string_lossy(), "C:/tmp/tray.log");
        let other = parse_args(&argv(&["--log", "C:/tmp/tray.log", "--no-icon"])).unwrap();
        assert!(!other.icon);
        assert!(other.log.is_some());
    }

    /* THE MENU'S TWO LINKS. Both optional, in either order, beside the
       two required flags, and both absent is a valid argv: an
       absent flag means the menu omits that line. */
    #[test]
    fn the_two_menu_urls_are_optional_and_order_free() {
        let none = parse_args(&argv(&[])).unwrap();
        assert!(none.settings.is_none());
        assert!(none.lab.is_none());
        assert!(none.notify.is_none());
        assert!(none.add_pc.is_none());
        let add = parse_args(&argv(&["--add-pc", "http://127.0.0.1:4321/s/add-pc"])).unwrap();
        assert_eq!(add.add_pc.as_deref(), Some("http://127.0.0.1:4321/s/add-pc"));

        let both = parse_args(&argv(&[
            "--settings",
            "http://127.0.0.1:4321/s/notifications",
            "--lab",
            "http://127.0.0.1:4321/s/lab/alerts",
        ]))
        .unwrap();
        assert_eq!(
            both.settings.as_deref(),
            Some("http://127.0.0.1:4321/s/notifications")
        );
        assert_eq!(both.lab.as_deref(), Some("http://127.0.0.1:4321/s/lab/alerts"));

        let flipped = parse_args(&argv(&[
            "--lab",
            "http://127.0.0.1:4321/s/lab/alerts",
            "--settings",
            "http://127.0.0.1:4321/s/notifications",
        ]))
        .unwrap();
        assert_eq!(flipped.lab, both.lab);
        assert_eq!(flipped.settings, both.settings);

        /* one without the other, which is what an older server would send */
        let one = parse_args(&argv(&["--settings", "http://127.0.0.1:4321/s/notifications"])).unwrap();
        assert!(one.settings.is_some());
        assert!(one.lab.is_none());
    }

    /* and they ride beside the two flags that take no value and one value */
    #[test]
    fn the_two_menu_urls_ride_beside_no_icon_and_log() {
        let args = parse_args(&argv(&[
            "--settings",
            "http://127.0.0.1:4321/s/notifications",
            "--no-icon",
            "--lab",
            "http://127.0.0.1:4321/s/lab/alerts",
            "--log",
            "C:/tmp/tray.log",
        ]))
        .unwrap();
        assert!(!args.icon);
        assert_eq!(args.log.unwrap().to_string_lossy(), "C:/tmp/tray.log");
        assert!(args.settings.is_some());
        assert!(args.lab.is_some());
    }

    /* THE SAME url::parse LOOP the other three go through, so a typo is exit 2
       at once rather than a menu line that opens nothing when it is clicked. */
    #[test]
    fn a_menu_url_that_is_not_an_http_url_is_exit_2() {
        for bad in ["/s/notifications", "notifications", "", "ftp://x/y"] {
            assert!(
                parse_args(&argv(&["--settings", bad])).is_err(),
                "--settings {bad}"
            );
            assert!(parse_args(&argv(&["--lab", bad])).is_err(), "--lab {bad}");
            assert!(parse_args(&argv(&["--notify", bad])).is_err(), "--notify {bad}");
            assert!(parse_args(&argv(&["--add-pc", bad])).is_err(), "--add-pc {bad}");
        }
    }

    /* THE THIRD URL, and it is a flag of its own rather than the settings page
       reused: the settings PAGE takes no POST (measured, a 404), so the pause
       verb goes to the api route beside it. */
    #[test]
    fn the_pause_route_is_its_own_flag() {
        let args = parse_args(&argv(&[
            "--notify",
            "http://127.0.0.1:4321/s/api/notify",
            "--settings",
            "http://127.0.0.1:4321/s/notifications",
        ]))
        .unwrap();
        assert_eq!(
            args.notify.as_deref(),
            Some("http://127.0.0.1:4321/s/api/notify")
        );
        assert_ne!(args.notify, args.settings, "the page and the route are two URLs");
        /* absent is valid: an older server that names no route */
        assert!(parse_args(&argv(&["--settings", "http://127.0.0.1:4321/s/notifications"]))
            .unwrap()
            .notify
            .is_none());
    }

    /* NO PROCESS IS SPAWNED ANYWHERE IN THIS CRATE BUT opener.rs: an unflagged
       std::process::Command from a console-less image is the popup window the
       design refuses. The needle is assembled so this file is not its own hit. */
    #[test]
    fn no_source_file_outside_opener_spawns_a_process_through_the_std_command_builder() {
        let needle = String::from("Command") + "::new";
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut seen = 0;
        let mut opener = String::new();
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            seen += 1;
            if path.file_name().and_then(|n| n.to_str()) == Some("opener.rs") {
                opener = text;
                continue;
            }
            assert!(
                !text.contains(&needle),
                "{} names the std process builder",
                path.display()
            );
        }
        assert!(seen >= 14, "the source directory was not read: {seen} files");
        /* THE ONE FILE THAT MAY NAME IT SETS THE FLAGS, once per builder: a
           child with no creation flags is a console window on a board click.
           WHICH flags is pinned by value in opener.rs's plan test. */
        assert!(opener.contains(&needle), "opener.rs no longer starts anything");
        assert_eq!(
            opener.matches(&needle).count(),
            opener.matches("creation_flags(").count(),
            "every Command in opener.rs sets the creation flags"
        );
        /* and nulls the three standard handles, so the server's control
           pipe never reaches an editor or a terminal. */
        assert_eq!(
            opener.matches(&needle).count() * 3,
            opener.matches("Stdio::null()").count(),
            "every Command in opener.rs nulls the three standard handles"
        );
    }

    /* THE SELF-REAP HAS A CODE OF ITS OWN. net.rs quits with
       it after two ping failures, and the whole point is that it is NOT 0: the
       server reads a 0 after an attach as the person choosing Exit from the
       menu and refuses every alert until its next start, which is the wrong
       reading of a server that stalled and recovered, and an impossible one
       under --no-icon, where there is no menu at all. Every code stays
       distinct: a reader of a log deserves to know which half ended it. */
    #[test]
    fn the_self_reap_has_its_own_exit_code() {
        assert_eq!(super::EXIT_GONE, 6);
        let codes = [
            super::EXIT_OK,
            super::EXIT_ARGS,
            super::EXIT_REGISTER,
            super::EXIT_INSTANCE,
            super::EXIT_TRAY,
            super::EXIT_GONE,
        ];
        for (i, a) in codes.iter().enumerate() {
            for b in codes.iter().skip(i + 1) {
                assert_ne!(a, b, "two exit codes collided");
            }
        }
    }
}
