/* The optional log, one line per event in local time.
 *
 * It exists to be read by a person diagnosing a tray, and by the harness that
 * measures the alert's stream-byte-to-popup time, so it is plain text, append
 * only, and utterly unbuffered: a line that is still in a buffer when the
 * process is killed is a line that was not written. No path means no log and
 * no file handle at all, which is the normal case (the server passes --log
 * only when ASKERDO_TRAY_LOG names one).
 *
 * Every write is fail-open. A log that cannot be written costs a line and
 * never a tray.
 */
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use windows_sys::Win32::Foundation::SYSTEMTIME;
use windows_sys::Win32::System::SystemInformation::GetLocalTime;

pub struct Journal {
    path: Option<PathBuf>,
    /* one writer at a time, so two threads cannot interleave half lines */
    gate: Mutex<()>,
}

impl Journal {
    pub fn open(path: Option<PathBuf>) -> Journal {
        Journal { path, gate: Mutex::new(()) }
    }

    pub fn on(&self) -> bool {
        self.path.is_some()
    }

    pub fn line(&self, text: &str) {
        let Some(path) = self.path.as_ref() else { return };
        let _guard = self.gate.lock();
        let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
            return;
        };
        let _ = writeln!(file, "{} {}", stamp(), text);
        let _ = file.flush();
    }
}

/* Local time from the OS, formatted by hand: a date crate for one line of
   output would be a dependency bought with somebody else's licence. */
fn stamp() -> String {
    let mut t: SYSTEMTIME = unsafe { std::mem::zeroed() };
    unsafe { GetLocalTime(&mut t) };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds
    )
}
