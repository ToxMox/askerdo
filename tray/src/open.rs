/* `--open`: the Start Menu shortcut's click, and the only path in this exe
 * that reads the store at all.
 *
 * A shortcut is a thing a person clicks, and this click opens the running
 * board, which is what the tray's own "Open board" menu item does and what the
 * icon's double click does.
 *
 * THE RULES THIS PATH KEEPS, all three of them narrow:
 *   - NO ARGV FROM A SERVER. There is no server in this picture: a person
 *     clicked a Start Menu entry. The port and the secret come off the store's
 *     own board folder, the same two files hub-store mints and the server
 *     reads, under the default store root and nowhere else.
 *   - IT STARTS NOTHING. A store with no server behind it is Node's business
 *     (lib/board-ensure.mjs), never the exe's: a click that found no board
 *     journals one line and exits 0, so a person who clicked out of habit gets
 *     silence rather than an error box or a browser tab onto a dead port.
 *   - IT WRITES NOTHING. Two file reads and one POST to the ping route, which
 *     answers 204 out of memory and touches no record.
 */
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::journal::Journal;
use crate::{http, tray, url};

/* A click must not hang on a socket. The board's ping is synchronous and
   answered out of memory, and a port with nothing behind it refuses at once on
   loopback, so the only case this budget bounds is a port held by something
   that never answers. 1500 ms is the handshake probe's own budget, kept here
   rather than the stream's 5 s: this process has a person waiting on it. */
const PROBE: Duration = Duration::from_millis(1500);

/* `--open` is a mode, like `--register` and `--unregister`, and not a flag of
   the resident run: it is read before parse_args, which knows nothing of it. */
pub fn requested(argv: &[String]) -> bool {
    argv.iter().any(|a| a == "--open")
}

/* The one optional companion, exactly the flag the resident run takes, so a
   person diagnosing a click gets the same file the tray writes. Absent means
   no log and no line anywhere, which is the normal case. */
pub fn log_path(argv: &[String]) -> Option<PathBuf> {
    let mut i = 0;
    while i < argv.len() {
        if argv[i] == "--log" {
            return argv.get(i + 1).map(PathBuf::from);
        }
        i += 1;
    }
    None
}

/* The store root bin/askerdo.mjs resolves: ~/.claude/askerdo. The home is
   USERPROFILE, which is what Node's homedir() reads on Windows. */
pub fn store_root() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE")?;
    Some(store_root_in(Path::new(&home)))
}

fn store_root_in(home: &Path) -> PathBuf {
    home.join(".claude").join("askerdo")
}

/* The board URL the "Open board" menu item opens: the loopback form, never the
   askerdo.localhost name. The boundary is the OS resolver ShellExecute hands
   the URL to, which knows no such name; the browsers resolve `*.localhost`
   themselves, Chromium and Firefox both (measured 2026-09-15). */
pub fn board_url(port: u16, secret: &str) -> String {
    format!("http://127.0.0.1:{port}/{secret}/")
}

/* hub-store's own rule for the two files, kept here so a half-written or
   hand-edited board folder cannot become a URL: 32 hex characters and a port
   in range. A file that fails it is read as no board at all. */
pub fn identity(port_text: &str, secret_text: &str) -> Option<(u16, String)> {
    let secret = secret_text.trim();
    if secret.len() != 32 || !secret.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return None;
    }
    let port: u16 = port_text.trim().parse().ok()?;
    if port == 0 {
        return None;
    }
    Some((port, secret.to_string()))
}

fn read_identity(root: &Path) -> Option<(u16, String)> {
    let port = std::fs::read_to_string(root.join("board").join("port")).ok()?;
    let secret = std::fs::read_to_string(root.join("board").join("secret")).ok()?;
    identity(&port, &secret)
}

/* Is anything answering on that port, and is it a board? The ping route is the
   liveness signal the handshake and the tray's self-reap both key on, and it
   writes nothing. A 2xx is a board; anything else, and any socket error, is a
   port that answers nothing as far as a click is concerned. */
fn answers(url_text: &str) -> Result<(), String> {
    let target = url::parse(url_text).ok_or_else(|| "the ping URL will not parse".to_string())?;
    let headers = [(
        "User-Agent",
        format!("askerdo-tray/{}", env!("CARGO_PKG_VERSION")),
    )];
    let req = http::Request {
        method: "POST",
        url: &target,
        headers: &headers,
        body: Some(&[]),
        connect_timeout: PROBE,
        io_timeout: PROBE,
    };
    let resp = http::send(req).map_err(|e| e.to_string())?;
    if !(200..300).contains(&resp.status) {
        return Err(format!("the ping answered {}", resp.status));
    }
    Ok(())
}

/* One line either way, and exit 0 either way: the caller exits 0 whatever this
   returns, because a click that found no board is not a failure a person can
   act on. */
pub fn run(journal: &Journal) {
    let Some(root) = store_root() else {
        journal.line("open: USERPROFILE names no directory");
        return;
    };
    let Some((port, secret)) = read_identity(&root) else {
        journal.line("open: no board identity in the store");
        return;
    };
    let url_text = board_url(port, &secret);
    if let Err(e) = answers(&format!("http://127.0.0.1:{port}/{secret}/ping")) {
        journal.line(&format!("open: port {port} answers nothing ({e})"));
        return;
    }
    tray::shell_open(&url_text);
    journal.line(&format!("open {url_text}"));
}

#[cfg(test)]
mod tests {
    use super::*;

    /* THE ARGV. `--open` is its own mode and takes no value, and the one flag
       that rides beside it is `--log`, in either order. */
    #[test]
    fn open_is_a_mode_of_its_own_and_the_log_rides_beside_it() {
        let argv = |v: &[&str]| -> Vec<String> { v.iter().map(|s| s.to_string()).collect() };
        assert!(requested(&argv(&["--open"])));
        assert!(requested(&argv(&["--log", "C:/tmp/t.log", "--open"])));
        assert!(!requested(&argv(&["--register"])));
        assert!(!requested(&argv(&["--board", "http://127.0.0.1:1/s/"])));
        assert!(log_path(&argv(&["--open"])).is_none());
        assert_eq!(
            log_path(&argv(&["--open", "--log", "C:/tmp/t.log"]))
                .unwrap()
                .to_string_lossy(),
            "C:/tmp/t.log"
        );
        assert_eq!(
            log_path(&argv(&["--log", "C:/tmp/t.log", "--open"]))
                .unwrap()
                .to_string_lossy(),
            "C:/tmp/t.log"
        );
    }

    /* THE URL, from a port and a secret: byte for byte the `--board` value the
       server hands the resident run, so the click and the menu item open the
       same address. A secret or a port the store could not have written is no
       board at all. */
    #[test]
    fn the_url_is_the_loopback_form_the_menu_item_opens() {
        let secret = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            board_url(59715, secret),
            "http://127.0.0.1:59715/0123456789abcdef0123456789abcdef/"
        );
        assert_eq!(
            identity(" 17435\n", "0123456789abcdef0123456789abcdef\n"),
            Some((17435, secret.to_string()))
        );
        assert_eq!(identity("17435", "0123456789ABCDEF0123456789abcdef"), None);
        assert_eq!(identity("17435", "0123456789abcdef"), None);
        assert_eq!(identity("0", secret), None);
        assert_eq!(identity("70000", secret), None);
        assert_eq!(identity("", secret), None);
    }
}
