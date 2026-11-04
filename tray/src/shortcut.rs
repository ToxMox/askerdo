/* The Start Menu shortcut: an AskerDo entry in Start whose click opens the
 * board (open.rs), carrying the AUMID the tray's windows wear so the
 * shell takes the two for one app.
 *
 * Two rules:
 *   - IDEMPOTENT: the file is parsed before it is written and a shortcut that
 *     already names this exe and this AUMID is left alone, so a tray that
 *     starts twenty times a day writes the Start Menu zero times.
 *   - READ BACK: the saved file is read from disk again and the AUMID, the
 *     exe's directory and the `--open` argument have to BE in it, or this
 *     reports the failure. The caller journals it and carries on: a missing
 *     shortcut costs Start its entry, never the tray.
 *
 * The undo is one step, and --unregister does it:
 *   del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\AskerDo.lnk"
 */
use std::path::{Path, PathBuf};

use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
    CoTaskMemAlloc, CoUninitialize, IPersistFile,
};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
use windows::core::{GUID, Interface, PCWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::System::Variant::VT_LPWSTR;

use crate::{AUMID, DISPLAY_NAME, ICON_FILE};

/* PKEY_AppUserModel_ID, the one property that makes a shortcut an identity:
   {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, property 5. */
const PKEY_APPUSERMODEL_ID: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0x9F4C2855_9F79_4B39_A8D0_E1D42DE1D5F3),
    pid: 5,
};

/* The file name is the name Start shows, so it carries the display name and
   the one extension Windows reads a link from. */
fn link_name() -> String {
    format!("{DISPLAY_NAME}.lnk")
}

/* %APPDATA%\Microsoft\Windows\Start Menu\Programs, the per-user Start Menu:
   never the all-users one under ProgramData, which needs elevation and would
   outlive this user's plugin. */
fn programs_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var_os("APPDATA")
        .ok_or_else(|| "APPDATA names no directory".to_string())?;
    let mut path = PathBuf::from(appdata);
    path.push("Microsoft");
    path.push("Windows");
    path.push("Start Menu");
    path.push("Programs");
    Ok(path)
}

pub fn link_path() -> Result<PathBuf, String> {
    Ok(programs_dir()?.join(link_name()))
}

fn exe_path() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("the running exe has no path ({e})"))
}

/* The mark the shortcut wears: the committed .ico that ships beside the exe. */
fn icon_path() -> Result<PathBuf, String> {
    let mut path = exe_path()?;
    path.pop();
    path.push(ICON_FILE);
    Ok(path)
}

/* Both halves of the read-back, and of the idempotence test, are done on the
   BYTES of the saved link rather than by re-opening it through COM: a shell
   link holds its property-store strings and its working directory as UTF-16
   runs, so a file carrying both is a file the shell will resolve, and a file
   carrying neither is one no amount of COM success would have made good.

   The WORKING DIRECTORY is what stands for the target here, because a shell
   link does not store the target path verbatim at all: measured on the file
   this code writes, the AUMID is there once as UTF-16 and the full exe path
   is nowhere in the 2051 bytes, since the target rides an item id list and a
   LinkInfo that holds the name alone. The working directory IS stored whole,
   and it is the exe's own directory, so a plugin update that lands the assets
   in a new versioned cache path rewrites the link. */
fn holds(bytes: &[u8], needle: &str) -> bool {
    let wide: Vec<u8> = needle
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .collect();
    if wide.is_empty() || bytes.len() < wide.len() {
        return false;
    }
    bytes.windows(wide.len()).any(|w| w == wide)
}

/* The ARGUMENT the link carries, and the whole reason a click on it does
   anything: the target with no arguments is the resident
   run missing every flag it needs, which is exit 2 and a flash of nothing. With
   this it is open.rs's mode: read the store's board folder, open the running
   board, exit 0. The arguments ARE stored verbatim in a shell link, as a UTF-16
   StringData run, so the read-back below reaches them the same way it reaches
   the AUMID, and a link written without the argument carries no such run and
   is rewritten exactly once. */
pub const LINK_ARGS: &str = "--open";

fn is_current(path: &PathBuf, dir: &str) -> bool {
    match std::fs::read(path) {
        Ok(bytes) => holds(&bytes, AUMID) && holds(&bytes, dir) && holds(&bytes, LINK_ARGS),
        Err(_) => false,
    }
}

/* The resident start's gate: a copy run from another store's board/tray/<build>
   folder (a sandbox or a rehearsal) leaves the person's link alone, since the
   link would name that copy. --register still writes it on request. */
pub fn from_other_store(live: Option<&Path>) -> bool {
    match exe_path() {
        Ok(exe) => other_store(&exe, live),
        Err(_) => false,
    }
}

fn other_store(exe: &Path, live: Option<&Path>) -> bool {
    let named = |p: Option<&Path>, n: &str| {
        p.and_then(|p| p.file_name()).map_or(false, |f| f.eq_ignore_ascii_case(n))
    };
    let tray = exe.parent().and_then(|b| b.parent());
    let board = tray.and_then(|t| t.parent());
    if !named(tray, "tray") || !named(board, "board") {
        return false;
    }
    let norm = |p: &Path| {
        p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase()
    };
    match (board.and_then(|b| b.parent()), live) {
        (Some(store), Some(live)) => norm(store) != norm(live),
        _ => true,
    }
}

pub fn install() -> Result<(), String> {
    let path = link_path()?;
    let exe = exe_path()?;
    let exe_text = exe.to_string_lossy().to_string();
    let mut home = exe.clone();
    home.pop();
    let home_text = home.to_string_lossy().to_string();
    if is_current(&path, &home_text) {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("could not open the Start Menu directory ({e})"))?;
    }
    let icon = icon_path()?.to_string_lossy().to_string();
    let link = path.to_string_lossy().to_string();
    let home_arg = home_text.clone();

    /* The COM work runs on a thread of its own, which initializes a single
       threaded apartment and tears it down again, so no other thread lives in
       an apartment this code chose. */
    let handle = std::thread::spawn(move || write_link(&link, &exe_text, &home_arg, &icon));
    let written = handle
        .join()
        .map_err(|_| "the shortcut thread panicked".to_string())?;
    written?;

    /* The read-back, off the disk, on the file as it now stands. */
    if !is_current(&path, &home_text) {
        return Err(format!(
            "the shortcut at {} does not carry this AUMID, this exe and {LINK_ARGS}",
            path.display()
        ));
    }
    Ok(())
}

pub fn uninstall() -> Result<(), String> {
    let path = link_path()?;
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("could not delete {} ({e})", path.display())),
    }
    if path.exists() {
        return Err(format!("{} is still there after the delete", path.display()));
    }
    Ok(())
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/* One STA, one shell link, one property, one save. */
fn write_link(path: &str, exe: &str, home: &str, icon: &str) -> Result<(), String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = write_link_inner(path, exe, home, icon);
        CoUninitialize();
        result
    }
}

unsafe fn write_link_inner(path: &str, exe: &str, home: &str, icon: &str) -> Result<(), String> {
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| format!("no shell link object ({e})"))?;
        let exe_w = wide(exe);
        link.SetPath(PCWSTR(exe_w.as_ptr()))
            .map_err(|e| format!("could not set the target ({e})"))?;
        let home_w = wide(home);
        link.SetWorkingDirectory(PCWSTR(home_w.as_ptr()))
            .map_err(|e| format!("could not set the working directory ({e})"))?;
        let args_w = wide(LINK_ARGS);
        link.SetArguments(PCWSTR(args_w.as_ptr()))
            .map_err(|e| format!("could not set the arguments ({e})"))?;
        let icon_w = wide(icon);
        link.SetIconLocation(PCWSTR(icon_w.as_ptr()), 0)
            .map_err(|e| format!("could not set the icon ({e})"))?;
        let desc_w = wide("The AskerDo board tray");
        let _ = link.SetDescription(PCWSTR(desc_w.as_ptr()));

        let store: IPropertyStore = link
            .cast()
            .map_err(|e| format!("the shell link carries no property store ({e})"))?;
        /* The string in a VT_LPWSTR variant belongs to the COM allocator, and
           the property store frees it with CoTaskMemFree. Handing it a Rust
           Vec's buffer instead is a free across two heaps: measured here on
           2026-09-08 as exit 0xC0000374, STATUS_HEAP_CORRUPTION, AFTER the
           link had already been written. So the bytes come from
           CoTaskMemAlloc and nothing below frees them: the store's own clear
           is the free, and a second one here would be the same bug twice. */
        let aumid_w = wide(AUMID);
        let bytes = aumid_w.len() * std::mem::size_of::<u16>();
        let mem = CoTaskMemAlloc(bytes) as *mut u16;
        if mem.is_null() {
            return Err("no memory for the AppUserModelID".to_string());
        }
        std::ptr::copy_nonoverlapping(aumid_w.as_ptr(), mem, aumid_w.len());
        let mut value = PROPVARIANT::default();
        {
            let inner = &mut *value.Anonymous.Anonymous;
            inner.vt = VT_LPWSTR;
            inner.Anonymous.pwszVal = windows::core::PWSTR(mem);
        }
        store
            .SetValue(&PKEY_APPUSERMODEL_ID, &value)
            .map_err(|e| format!("could not set the AppUserModelID ({e})"))?;
        store
            .Commit()
            .map_err(|e| format!("could not commit the property store ({e})"))?;

        let file: IPersistFile = link
            .cast()
            .map_err(|e| format!("the shell link cannot be saved ({e})"))?;
        let path_w = wide(path);
        file.Save(PCWSTR(path_w.as_ptr()), true)
            .map_err(|e| format!("could not save the shortcut ({e})"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_copy_in_another_store_skips_the_link() {
        let live = Path::new("C:/Users/x/.claude/askerdo");
        let copy = |s: &str| PathBuf::from(s);
        assert!(!other_store(&copy("C:\\Users\\x\\.claude\\askerdo\\board\\tray\\abc\\askerdo-tray.exe"), Some(live)));
        assert!(other_store(&copy("C:/tmp/sb/.claude/askerdo/board/tray/abc/askerdo-tray.exe"), Some(live)));
        assert!(!other_store(&copy("C:/cache/askerdo/0.8.14/assets/askerdo-tray.exe"), Some(live)));
    }

    #[test]
    fn holds_finds_a_utf16_run() {
        let bytes: Vec<u8> = "xx".encode_utf16().chain("ToxMox.AskerDo".encode_utf16()).flat_map(|u| u.to_le_bytes()).collect();
        assert!(holds(&bytes, "ToxMox.AskerDo"));
        assert!(!holds(&bytes, "ToxMox.AskerDoer"));
        assert!(!holds(&[], "ToxMox.AskerDo"));
    }

    #[test]
    fn the_link_is_named_with_the_display_name() {
        assert_eq!(link_name(), "AskerDo.lnk");
    }
}
