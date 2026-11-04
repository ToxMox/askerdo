/* THE OPEN FRAME: the SERVER builds the frame from a
 * record's own refs, so nothing here parses a template, resolves a path, names
 * a program, writes a file or touches the icon. Three shapes and no fourth. */
use std::os::windows::process::CommandExt;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;
use windows_sys::Win32::Foundation::{GetLastError, HWND, LPARAM};
use windows_sys::Win32::System::Com::CoUninitialize;
use windows_sys::Win32::System::Threading::{
    CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW, DETACHED_PROCESS, PROCESS_CREATION_FLAGS,
};
use windows_sys::Win32::UI::Shell::{
    SEE_MASK_INVOKEIDLIST, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW, ShellExecuteExW, ShellExecuteW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, IsWindowVisible, SW_SHOWNORMAL, SetForegroundWindow,
};

use crate::App;
use crate::registry::wide;
use crate::tray;

/* serve.rs's own constant and reasoning: this image owns no console, so a
 * console child would make one. CREATE_NO_WINDOW is ignored beside the detach
 * and named anyway, so dropping the detach cannot silently lose it. */
pub const FLAGS: PROCESS_CREATION_FLAGS =
    CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;

/* Greater than 32 is success, which is the whole of ShellExecuteW's contract:
 * anything at or below it is an error code in a pointer's clothing. */
const SHELL_OK: isize = 32;

/* The two verbs lib/open-in.mjs puts on a frame, and nothing else reaches
 * the shell. `runas` would raise a UAC prompt. */
pub const VERBS: [&str; 2] = ["open", "openas"];

/* lib/open-in.mjs's OPEN_KINDS verbatim, the two lists kept equal by hand
 * (docs/desktop-capabilities.md says so). */
pub const OPEN_KINDS: [&str; 7] = [
    "open", "openwith", "reveal", "editor", "project", "terminal", "claude",
];

/* The picker is the shell's context-menu route, which comes
 * up with or without an association, and NOASYNC is the documented flag for a
 * caller that has no message loop and returns at once. */
const PICKER_KIND: &str = "openwith";
pub const PICKER_MASK: u32 = SEE_MASK_INVOKEIDLIST | SEE_MASK_NOASYNC;

#[derive(Debug, PartialEq, Eq)]
pub enum Frame {
    Verb { kind: String, verb: String, path: String },
    Url { kind: String, url: String },
    Exec { kind: String, exe: String, args: Vec<String> },
}

impl Frame {
    pub fn kind(&self) -> &str {
        match self {
            Frame::Verb { kind, .. } | Frame::Url { kind, .. } | Frame::Exec { kind, .. } => kind,
        }
    }
}

/* The call this frame becomes, as a VALUE, so a test pins the mask and the
 * verb per opener without a shell or a desktop under it. */
#[derive(Debug, PartialEq, Eq)]
pub enum Call {
    Shell { verb: String, path: String },
    Picker { mask: u32, verb: String, path: String },
    Url { url: String },
    Exec { exe: String, args: Vec<String>, flags: PROCESS_CREATION_FLAGS },
}

/* the window an open starts comes to the front, since a person
 * just asked for it. The plain call is the one a probe measured; the
 * bound is where the poll for the window gives up. */
pub const FRONT_CALL: &str = "SetForegroundWindow";
pub const FRONT_WAIT_MS: u64 = 2000;

#[derive(Debug, PartialEq, Eq)]
pub struct Front {
    pub call: &'static str,
    pub wait_ms: u64,
}

/* Every shape puts a window on screen that a person just asked for, so every
 * shape raises it; the match is spelled out so a fourth shape has to decide. */
pub fn front(call: &Call) -> Option<Front> {
    match call {
        Call::Shell { .. } | Call::Picker { .. } | Call::Url { .. } | Call::Exec { .. } => {
            Some(Front { call: FRONT_CALL, wait_ms: FRONT_WAIT_MS })
        }
    }
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

/* Exactly ONE of the three shapes, checked before anything is called: a frame
 * carrying both a url and an exe is two instructions and this exe follows
 * neither. */
pub fn parse(data: &str) -> Result<Frame, String> {
    let Ok(value) = serde_json::from_str::<Value>(data) else {
        return Err("the frame was not JSON".into());
    };
    let kind = text(&value, "kind").unwrap_or_default();
    if kind.is_empty() {
        return Err("the frame named no kind".into());
    }
    if !OPEN_KINDS.contains(&kind.as_str()) {
        return Err(format!("the frame named a kind this exe does not open: {kind}"));
    }
    let verb = text(&value, "verb");
    let path = text(&value, "path");
    let url = text(&value, "url");
    let exe = text(&value, "exe");
    let shapes = [verb.is_some() || path.is_some(), url.is_some(), exe.is_some()];
    if shapes.iter().filter(|seen| **seen).count() != 1 {
        return Err("the frame is not exactly one of the three shapes".into());
    }
    if let Some(url) = url {
        if url.is_empty() {
            return Err("the frame carried an empty url".into());
        }
        return Ok(Frame::Url { kind, url });
    }
    if let Some(exe) = exe {
        if exe.is_empty() {
            return Err("the frame carried an empty program".into());
        }
        /* an absent args is an empty argv, and a non-string entry is dropped
           rather than stringified: the server sends strings */
        let args = value
            .get("args")
            .and_then(|v| v.as_array())
            .map(|list| {
                list.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        return Ok(Frame::Exec { kind, exe, args });
    }
    let (Some(verb), Some(path)) = (verb, path) else {
        return Err("the frame carried a verb with no path, or a path with no verb".into());
    };
    if verb.is_empty() || path.is_empty() {
        return Err("the frame carried an empty verb or path".into());
    }
    if !VERBS.contains(&verb.as_str()) {
        return Err(format!("the frame named a verb this exe does not run: {verb}"));
    }
    Ok(Frame::Verb { kind, verb, path })
}

/* The `openwith` kind alone goes through the context-menu route, and
 * every other verb keeps the plain call. Pure, so the tests read it. */
pub fn plan(frame: &Frame) -> Call {
    match frame {
        Frame::Verb { kind, verb, path } if kind == PICKER_KIND => Call::Picker {
            mask: PICKER_MASK,
            verb: verb.clone(),
            path: path.clone(),
        },
        Frame::Verb { verb, path, .. } => {
            Call::Shell { verb: verb.clone(), path: path.clone() }
        }
        Frame::Url { url, .. } => Call::Url { url: url.clone() },
        Frame::Exec { exe, args, .. } => Call::Exec {
            exe: exe.clone(),
            args: args.clone(),
            flags: FLAGS,
        },
    }
}

fn shell_verb(verb: &str, path: &str) -> isize {
    unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            wide(verb).as_ptr(),
            wide(path).as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        ) as isize
    }
}

/* The ExW call is the one that instantiates a shell extension, which is
 * why the whole frame runs on an STA of its own. */
fn shell_picker(mask: u32, verb: &str, path: &str) -> (bool, u32) {
    let verb_w = wide(verb);
    let path_w = wide(path);
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = mask;
    info.lpVerb = verb_w.as_ptr();
    info.lpFile = path_w.as_ptr();
    info.nShow = SW_SHOWNORMAL;
    let ok = unsafe { ShellExecuteExW(&mut info) } != 0;
    let code = if ok { 0 } else { unsafe { GetLastError() } };
    (ok, code)
}

fn failed(code: isize) -> &'static str {
    if code > SHELL_OK { "" } else { " (a failure)" }
}

/* A titled visible top-level window is the only kind a person sees, and an
 * eight character read is enough to know a title is there. */
fn titled(hwnd: HWND) -> bool {
    let mut buf = [0u16; 8];
    unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) > 0 }
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> i32 {
    let list = unsafe { &mut *(lparam as *mut Vec<isize>) };
    if unsafe { IsWindowVisible(hwnd) } != 0 && titled(hwnd) {
        list.push(hwnd as isize);
    }
    1
}

fn top_windows() -> Vec<isize> {
    let mut list: Vec<isize> = Vec::new();
    unsafe { EnumWindows(Some(collect), &mut list as *mut Vec<isize> as LPARAM) };
    list
}

/* THE WINDOW IS FOUND BY DIFFERENCE, not by pid: a folder open is served by a
 * file manager that was already running, so the shell answers no process to
 * match (measured). One journal word when none appears. */
fn raise_new(before: &[isize], front: &Front) -> String {
    let deadline = Instant::now() + Duration::from_millis(front.wait_ms);
    loop {
        if let Some(hwnd) = top_windows().into_iter().find(|h| !before.contains(h)) {
            let ok = unsafe { SetForegroundWindow(hwnd as HWND) };
            return format!(", {} returned {ok}", front.call);
        }
        if Instant::now() >= deadline {
            return ", no window".into();
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/* The journal tail for one call, and the only place a Win32 opener runs. The
 * url shape reads its answer like the verb shape does, so a scheme with no
 * handler is visible rather than silent. */
fn run(call: &Call) -> String {
    /* the snapshot is taken BEFORE the call, since the window the call makes
       is the one that is new after it. */
    let front = front(call);
    let before = if front.is_some() { top_windows() } else { Vec::new() };
    let tail = match call {
        Call::Shell { verb, path } => {
            let code = shell_verb(verb, path);
            format!("ShellExecuteW {verb} returned {code}{}", failed(code))
        }
        Call::Picker { mask, verb, path } => {
            let (ok, code) = shell_picker(*mask, verb, path);
            format!("ShellExecuteExW {verb} returned {ok} (error {code})")
        }
        Call::Url { url } => {
            let code = tray::shell_open(url);
            format!("ShellExecuteW open returned {code}{} {url}", failed(code))
        }
        Call::Exec { exe, args, flags } => {
            /* THE ARGV IS AN ARRAY END TO END, so Rust's std does the Windows
               quoting and lib/open-in.mjs's redline holds on both sides. The
               three handles are null, so the control pipe goes no further. */
            match std::process::Command::new(exe)
                .args(args)
                .creation_flags(*flags)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                Ok(_) => format!("started {exe}"),
                Err(e) => format!("{exe} would not start: {e}"),
            }
        }
    };
    match front {
        Some(f) => tail + &raise_new(&before, &f),
        None => tail,
    }
}

/* ONE JOURNAL LINE PER OPEN. The shell shapes run on a SHORT-LIVED STA OF
 * THEIR OWN (shortcut.rs's precedent), because the network thread is
 * COINIT_MULTITHREADED and the picker route instantiates a shell extension.
 * The command shape runs on that thread too: its wait for the window must
 * not sit on the network thread. */
pub fn apply(app: &Arc<App>, data: &str) {
    let frame = match parse(data) {
        Ok(frame) => frame,
        Err(why) => {
            app.journal.line(&format!("open refused: {why}"));
            return;
        }
    };
    let kind = frame.kind().to_string();
    let call = plan(&frame);
    let app = Arc::clone(app);
    std::thread::spawn(move || {
        let hr = tray::com_apartment();
        if hr < 0 {
            app.journal
                .line(&format!("open {kind}: no apartment (0x{:08x})", hr as u32));
        }
        app.journal.line(&format!("open {kind}: {}", run(&call)));
        unsafe { CoUninitialize() };
    });
}

/* WHAT IS PINNED HERE is the frame reading, the refusals and the CALL each frame
 * plans: every decision made before a Win32 call. The calls themselves need a
 * shell and a desktop; the plan does not. */
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_three_shapes_parse_and_nothing_else_does() {
        assert_eq!(
            parse(r#"{"kind":"open","verb":"open","path":"C:\\x\\a.md"}"#).unwrap(),
            Frame::Verb {
                kind: "open".into(),
                verb: "open".into(),
                path: "C:\\x\\a.md".into(),
            }
        );
        assert_eq!(
            parse(r#"{"kind":"editor","url":"vscode://file/C:/x/a.md:42:7"}"#).unwrap(),
            Frame::Url {
                kind: "editor".into(),
                url: "vscode://file/C:/x/a.md:42:7".into(),
            }
        );
        assert_eq!(
            parse(r#"{"kind":"terminal","exe":"wt.exe","args":["-d","C:\\x"]}"#).unwrap(),
            Frame::Exec {
                kind: "terminal".into(),
                exe: "wt.exe".into(),
                args: vec!["-d".into(), "C:\\x".into()],
            }
        );
    }

    /* A frame carrying two shapes is two instructions, and this exe follows
       neither: the refusal is one line and no call. */
    #[test]
    fn a_frame_that_is_not_exactly_one_shape_is_refused() {
        assert!(parse(r#"{"kind":"editor","url":"vscode://x","exe":"code"}"#).is_err());
        assert!(parse(r#"{"kind":"open","verb":"open"}"#).is_err());
        assert!(parse(r#"{"kind":"open","path":"C:\\x"}"#).is_err());
        assert!(parse(r#"{"kind":"open"}"#).is_err());
        assert!(parse(r#"{"verb":"open","path":"C:\\x"}"#).is_err());
        assert!(parse(r#"{"kind":"open","verb":"","path":"C:\\x"}"#).is_err());
        assert!(parse(r#"{"kind":"terminal","exe":""}"#).is_err());
        assert!(parse(r#"{"kind":"editor","url":""}"#).is_err());
        assert!(parse("not json at all").is_err());
    }

    /* An empty args is an argv of one, which is what a command template naming a
       program and no arguments builds. */
    #[test]
    fn an_absent_or_empty_args_is_an_empty_argv() {
        assert_eq!(
            parse(r#"{"kind":"editor","exe":"code"}"#).unwrap(),
            Frame::Exec { kind: "editor".into(), exe: "code".into(), args: Vec::new() }
        );
        assert_eq!(
            parse(r#"{"kind":"editor","exe":"code","args":[]}"#).unwrap(),
            Frame::Exec { kind: "editor".into(), exe: "code".into(), args: Vec::new() }
        );
    }

    /* THE ARGUMENT SURVIVES THE ARRAY: a space, a quote and a backslash are
       carried as one element and never re-split, which is the redline both ends
       of the wire keep. */
    #[test]
    fn an_argument_carrying_a_space_a_quote_and_a_backslash_survives_whole() {
        let frame = parse(r#"{"kind":"editor","exe":"code","args":["C:\\a b\\say \"hi\".md"]}"#)
            .unwrap();
        assert_eq!(
            frame,
            Frame::Exec {
                kind: "editor".into(),
                exe: "code".into(),
                args: vec!["C:\\a b\\say \"hi\".md".into()],
            }
        );
    }

    /* THE FLAGS, pinned by value beside serve.rs's own pin, so a rename or a
       refactor cannot quietly put a console window back. */
    #[test]
    fn the_creation_flags_carry_no_new_console() {
        assert_eq!(FLAGS, 0x0800_0208);
        assert_eq!(FLAGS & 0x0000_0010, 0, "CREATE_NEW_CONSOLE is not set");
    }

    /* A verb the server never sends is refused BEFORE any shell call, and
       the sentence names it. */
    #[test]
    fn a_verb_this_exe_does_not_run_is_refused_by_name() {
        let why = parse(r#"{"kind":"open","verb":"runas","path":"C:\\x\\setup.exe"}"#).unwrap_err();
        assert_eq!(why, "the frame named a verb this exe does not run: runas");
        assert!(parse(r#"{"kind":"open","verb":"print","path":"C:\\x\\a.md"}"#).is_err());
        assert_eq!(VERBS, ["open", "openas"]);
    }

    /* And a kind the server never sends, with the seven pinned by value
       against lib/open-in.mjs's OPEN_KINDS. */
    #[test]
    fn a_kind_this_exe_does_not_open_is_refused_by_name() {
        let why = parse(r#"{"kind":"shell","verb":"open","path":"C:\\x\\a.md"}"#).unwrap_err();
        assert_eq!(why, "the frame named a kind this exe does not open: shell");
        assert_eq!(
            OPEN_KINDS,
            ["open", "openwith", "reveal", "editor", "project", "terminal", "claude"]
        );
    }

    /* The refusal words the exe writes, pinned so a reader of a journal and a
       reader of this file see the same sentences. */
    #[test]
    fn the_refusal_sentences_are_the_ones_the_journal_carries() {
        assert_eq!(parse("{").unwrap_err(), "the frame was not JSON");
        assert_eq!(parse("{}").unwrap_err(), "the frame named no kind");
        assert_eq!(
            parse(r#"{"kind":"editor","url":"vscode://x","exe":"code"}"#).unwrap_err(),
            "the frame is not exactly one of the three shapes"
        );
        assert_eq!(
            parse(r#"{"kind":"editor","url":""}"#).unwrap_err(),
            "the frame carried an empty url"
        );
        assert_eq!(
            parse(r#"{"kind":"terminal","exe":""}"#).unwrap_err(),
            "the frame carried an empty program"
        );
        assert_eq!(
            parse(r#"{"kind":"open","verb":"open"}"#).unwrap_err(),
            "the frame carried a verb with no path, or a path with no verb"
        );
        assert_eq!(
            parse(r#"{"kind":"open","verb":"","path":"C:\\x"}"#).unwrap_err(),
            "the frame carried an empty verb or path"
        );
    }

    /* The call per opener BY VALUE, which is the shape a test
       can pin without a shell. */
    #[test]
    fn the_picker_is_the_context_menu_route_and_nothing_else_is() {
        assert_eq!(
            plan(&parse(r#"{"kind":"openwith","verb":"openas","path":"C:\\x\\a.md"}"#).unwrap()),
            Call::Picker {
                mask: 0x0000_010C,
                verb: "openas".into(),
                path: "C:\\x\\a.md".into(),
            }
        );
        assert_eq!(PICKER_MASK, 0x0000_010C, "SEE_MASK_INVOKEIDLIST | SEE_MASK_NOASYNC");
        assert_eq!(
            plan(&parse(r#"{"kind":"open","verb":"open","path":"C:\\x\\a.md"}"#).unwrap()),
            Call::Shell { verb: "open".into(), path: "C:\\x\\a.md".into() }
        );
        assert_eq!(
            plan(&parse(r#"{"kind":"reveal","verb":"open","path":"C:\\x"}"#).unwrap()),
            Call::Shell { verb: "open".into(), path: "C:\\x".into() }
        );
    }

    #[test]
    fn the_url_and_command_shapes_plan_the_calls_they_name() {
        assert_eq!(
            plan(&parse(r#"{"kind":"claude","url":"claude://code/new?folder=C%3A%2Fx"}"#).unwrap()),
            Call::Url { url: "claude://code/new?folder=C%3A%2Fx".into() }
        );
        assert_eq!(
            plan(&parse(r#"{"kind":"terminal","exe":"wt.exe","args":["-d","C:\\x"]}"#).unwrap()),
            Call::Exec {
                exe: "wt.exe".into(),
                args: vec!["-d".into(), "C:\\x".into()],
                flags: FLAGS,
            }
        );
    }

    /* every shape brings its window to the front, with the call's
       name and the poll's bound pinned by value and no desktop under them. */
    #[test]
    fn every_shape_plans_the_same_foreground_call() {
        for shape in [
            r#"{"kind":"reveal","verb":"open","path":"C:\\x"}"#,
            r#"{"kind":"openwith","verb":"openas","path":"C:\\x\\a.md"}"#,
            r#"{"kind":"editor","url":"vscode://file/C:/x/a.md:42:7"}"#,
            r#"{"kind":"terminal","exe":"wt.exe","args":["-d","C:\\x"]}"#,
        ] {
            assert_eq!(
                front(&plan(&parse(shape).unwrap())),
                Some(Front { call: "SetForegroundWindow", wait_ms: 2000 }),
                "{shape}"
            );
        }
        assert_eq!(FRONT_CALL, "SetForegroundWindow");
        assert_eq!(FRONT_WAIT_MS, 2000);
    }

    /* The kind travels with the frame, because the journal line names it and the
       picker is chosen by it. */
    #[test]
    fn every_frame_carries_its_kind() {
        assert_eq!(
            parse(r#"{"kind":"project","url":"vscode://file/C:/x/"}"#).unwrap().kind(),
            "project"
        );
        assert_eq!(
            parse(r#"{"kind":"terminal","exe":"wt.exe"}"#).unwrap().kind(),
            "terminal"
        );
        assert_eq!(
            parse(r#"{"kind":"openwith","verb":"openas","path":"C:\\x\\a.md"}"#)
                .unwrap()
                .kind(),
            "openwith"
        );
    }
}
