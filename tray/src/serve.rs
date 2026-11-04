/* `--serve`: the scheduled task's action, and the only path in this exe that
 * starts anything.
 *
 * WHY IT EXISTS. A board server spawned by the Node hook that
 * noticed it was down would be a child of the Claude session, inside Claude's
 * Windows job, and that job can keep an old MSIX package alive through a
 * Claude update. A process the Task Scheduler creates lands outside every
 * Claude job, in the interactive user's own task job, in the desktop session.
 * So the launcher is a per-user scheduled task, and the task needs an ACTION that starts node and shows no window.
 *
 * WHY THE ACTION IS THIS EXE. A task whose action is node.exe itself comes up
 * with a console: measured 2026-09-09, a visible Windows Terminal window of
 * class CASCADIA_HOSTING_WINDOW_CLASS for the whole life of the process, and
 * with the legacy host a ConsoleWindowClass window just as visible. A node
 * launcher script only shortens that to a flash of about a tenth of a second,
 * and a flash is a window. This exe is a GUI-subsystem image
 * (#![windows_subsystem = "windows"]), so CreateProcess gives it no console at
 * all: it is windowless BY CONSTRUCTION rather than by suppression, so no
 * popup window can ever appear.
 *
 * THE RULES THIS PATH KEEPS, and they are the same three --open keeps with one
 * word changed:
 *   - IT WRITES NOTHING. No AUMID key, no Start Menu shortcut, no icon, no
 *     stream, no store read. Those belong to the resident run, and a launcher
 *     that touched them would churn shared machine state four times a day.
 *   - IT STARTS ONE PROCESS AND LEAVES. CreateProcessW, close both handles,
 *     exit 0. Nothing is waited on: the task instance ends at once, the task
 *     returns to Ready, and the server it made outlives it (the task's job
 *     carries no KILL_ON_JOB_CLOSE, measured).
 *   - THE SERVER SCRIPT IS NOT AN ARGUMENT. It is resolved from this exe's own
 *     path, which is what makes the registered action self-describing: the
 *     action names one file, and a task left over from an older release is
 *     detectable from the exe path alone. --root IS an argument, because the
 *     store root is the one thing the exe must not assume (--open assumes it,
 *     and says so, for a CLICK; a launcher registered by the ensure is handed
 *     the root the ensure used).
 */
use std::path::{Path, PathBuf};
use std::ptr::null;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError};
use windows_sys::Win32::System::Threading::{
    CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW, CreateProcessW, DETACHED_PROCESS,
    PROCESS_INFORMATION, PROCESS_CREATION_FLAGS, STARTUPINFOW,
};

use crate::journal::Journal;
use crate::registry::wide;
use crate::{EXIT_ARGS, EXIT_OK};

/* Resolved from PATH by CreateProcessW itself (lpApplicationName is null), so
   the board runs the same node every hook runs: C:\Program Files\nodejs\node.exe
   on a default install, outside the Claude package, which is why no locked file is
   ever in the picture. */
pub const NODE: &str = "node.exe";

/* Relative to the exe's own directory: assets/ is where the exe ships, so its
   parent is the checkout and hooks/board-server.mjs is one join away. */
pub const SERVER_SCRIPT: &str = "board-server.mjs";

/* THE CREATION FLAGS.
 *
 * DETACHED_PROCESS gives the child no console at all, which is what node's own
 * `detached: true` sets: no window, and no conhost.exe beside the server
 * either. CREATE_NEW_PROCESS_GROUP goes with it, matching node's detach too.
 * CREATE_NO_WINDOW gives a console app a console with no window, and Windows
 * documents it as IGNORED when DETACHED_PROCESS is set, so it changes nothing
 * here and costs nothing. It is named so that a future change that drops
 * DETACHED_PROCESS does not silently lose the windowless promise with it. */
pub const FLAGS: PROCESS_CREATION_FLAGS =
    CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;

/* `--serve` is a mode, like `--open` and the two registry flags, and not a
   flag of the resident run: it is read before parse_args, which knows nothing
   of it. */
pub fn requested(argv: &[String]) -> bool {
    argv.iter().any(|a| a == "--serve")
}

/* The store root the ensure used. No default: a launcher that guessed would
   start a board over the wrong store and answer pings from it, which is worse
   than not starting at all. */
pub fn root(argv: &[String]) -> Option<String> {
    value(argv, "--root").filter(|v| !v.is_empty())
}

/* The one optional companion, the same flag every other mode takes. */
pub fn log_path(argv: &[String]) -> Option<PathBuf> {
    value(argv, "--log").map(PathBuf::from)
}

fn value(argv: &[String], flag: &str) -> Option<String> {
    let mut i = 0;
    while i < argv.len() {
        if argv[i] == flag {
            return argv.get(i + 1).cloned();
        }
        i += 1;
    }
    None
}

/* <checkout>/assets/askerdo-tray.exe -> <checkout>/hooks/board-server.mjs.
   Two parents and two joins, with the separators the platform writes. */
pub fn server_script(exe: &Path) -> Option<PathBuf> {
    let checkout = exe.parent()?.parent()?;
    Some(checkout.join("hooks").join(SERVER_SCRIPT))
}

/* The command line CreateProcessW parses. The first token is quoted so a node
   installed under a path with a space still resolves, and both values after it
   are quoted for the same reason. */
pub fn command_line(script: &Path, root: &str) -> String {
    format!(
        "\"{}\" \"{}\" --root \"{}\"",
        NODE,
        script.display(),
        root
    )
}

/* One process, both handles closed, exit 0. A failure is one journal line and
   exit 2, and the ensure that ran the task learns about it the way it learns
   about every other failure to come up: its bounded ping wait times out and it
   reports `failed` with the wait in the detail. No other launcher stands
   behind this one, so there is nothing to fall back to here. */
pub fn run(journal: &Journal, argv: &[String]) -> i32 {
    let Some(root) = root(argv) else {
        journal.line("serve: --root is required and names the store root");
        return EXIT_ARGS;
    };
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            journal.line(&format!("serve: the running exe has no path ({e})"));
            return EXIT_ARGS;
        }
    };
    let Some(script) = server_script(&exe) else {
        journal.line("serve: the exe sits in no checkout");
        return EXIT_ARGS;
    };
    let line = command_line(&script, &root);
    match create(&line) {
        Ok(pid) => {
            journal.line(&format!("serve: started pid {pid} for {line}"));
            EXIT_OK
        }
        Err(e) => {
            journal.line(&format!("serve: {e} for {line}"));
            EXIT_ARGS
        }
    }
}

fn create(command_line: &str) -> Result<u32, String> {
    let mut line = wide(command_line);
    let mut si: STARTUPINFOW = unsafe { std::mem::zeroed() };
    si.cb = size_of::<STARTUPINFOW>() as u32;
    let mut pi: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    let made = unsafe {
        CreateProcessW(
            /* null, so the first token of the command line is looked up on
               PATH exactly as a shell would look it up */
            null(),
            line.as_mut_ptr(),
            null(),
            null(),
            /* no handle is inherited: this process owns none worth passing and
               the server must not hold one of ours open */
            0,
            FLAGS,
            /* the environment and the working directory are inherited from the
               task, whose WorkingDirectory is C:\ */
            null(),
            null(),
            &si,
            &mut pi,
        )
    };
    if made == 0 {
        return Err(format!("CreateProcessW failed (error {})", unsafe {
            GetLastError()
        }));
    }
    let pid = pi.dwProcessId;
    unsafe {
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
    }
    Ok(pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    /* THE ARGV. `--serve` is its own mode and takes no value; `--root` is
       required and `--log` rides beside it, in either order. */
    #[test]
    fn serve_is_a_mode_of_its_own_and_the_flags_ride_beside_it() {
        let argv = |v: &[&str]| -> Vec<String> { v.iter().map(|s| s.to_string()).collect() };
        assert!(requested(&argv(&["--serve", "--root", "C:/store"])));
        assert!(requested(&argv(&["--log", "C:/tmp/t.log", "--serve"])));
        assert!(!requested(&argv(&["--open"])));
        assert!(!requested(&argv(&["--register"])));
        assert!(!requested(&argv(&["--board", "http://127.0.0.1:1/s/"])));

        assert_eq!(
            root(&argv(&["--serve", "--root", "C:/store"])).unwrap(),
            "C:/store"
        );
        assert_eq!(
            root(&argv(&["--root", "C:/store", "--serve"])).unwrap(),
            "C:/store"
        );
        /* a missing or empty --root is an error rather than a default: the
           caller journals it and exits 2 */
        assert!(root(&argv(&["--serve"])).is_none());
        assert!(root(&argv(&["--serve", "--root"])).is_none());
        assert!(root(&argv(&["--serve", "--root", ""])).is_none());

        assert!(log_path(&argv(&["--serve", "--root", "C:/store"])).is_none());
        assert_eq!(
            log_path(&argv(&["--serve", "--root", "C:/store", "--log", "C:/tmp/t.log"]))
                .unwrap()
                .to_string_lossy(),
            "C:/tmp/t.log"
        );
        assert_eq!(
            log_path(&argv(&["--log", "C:/tmp/t.log", "--serve", "--root", "C:/store"]))
                .unwrap()
                .to_string_lossy(),
            "C:/tmp/t.log"
        );
    }

    /* THE SERVER SCRIPT, from the exe's own path and from nothing else: this
       is what lets the registered action name one file and still describe the
       whole start. */
    #[test]
    fn the_server_script_is_resolved_from_the_exe_path() {
        let exe = Path::new("C:\\cache\\askerdo\\assets\\askerdo-tray.exe");
        assert_eq!(
            server_script(exe).unwrap(),
            Path::new("C:\\cache\\askerdo\\hooks\\board-server.mjs")
        );
        /* a release lands in a new versioned directory, and the script moves
           with the exe rather than being remembered from anywhere */
        let next = Path::new("C:\\cache\\askerdo-0.5.28\\assets\\askerdo-tray.exe");
        assert_eq!(
            server_script(next).unwrap(),
            Path::new("C:\\cache\\askerdo-0.5.28\\hooks\\board-server.mjs")
        );
        assert!(server_script(Path::new("tray.exe")).is_none());
    }

    /* THE COMMAND LINE. Three quoted values and one bare flag, in the order
       node reads them: the interpreter, the script, then --root. */
    #[test]
    fn the_command_line_quotes_the_node_the_script_and_the_root() {
        let script = Path::new("C:\\cache\\askerdo\\hooks\\board-server.mjs");
        assert_eq!(
            command_line(script, "C:\\Store\\askerdo"),
            "\"node.exe\" \"C:\\cache\\askerdo\\hooks\\board-server.mjs\" \
             --root \"C:\\Store\\askerdo\""
        );
        /* a path with a space is the whole reason the quotes are there */
        let spaced = Path::new("C:\\Program Files\\td\\hooks\\board-server.mjs");
        assert_eq!(
            command_line(spaced, "C:\\My Store"),
            "\"node.exe\" \"C:\\Program Files\\td\\hooks\\board-server.mjs\" --root \"C:\\My Store\""
        );
    }

    /* THE CREATION FLAGS, pinned by value so a rename or a refactor cannot
       quietly drop the one that makes the server console-free. */
    #[test]
    fn the_creation_flags_are_the_detached_windowless_set() {
        assert_eq!(CREATE_NO_WINDOW, 0x0800_0000);
        assert_eq!(DETACHED_PROCESS, 0x0000_0008);
        assert_eq!(CREATE_NEW_PROCESS_GROUP, 0x0000_0200);
        assert_eq!(FLAGS, 0x0800_0208);
        /* the three that would put a console or a window back are absent */
        assert_eq!(FLAGS & 0x0000_0010, 0, "CREATE_NEW_CONSOLE is not set");
    }
}
