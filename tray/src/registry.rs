/* The registry: the AppUserModelId key older releases wrote, removed,
 * and the taskbar's theme, read.
 *
 * HKCU\Software\Classes\AppUserModelId\ToxMox.AskerDo gave the toast header's
 * AUMID a settings row and delivery; the notification platform was its only
 * reader (docs/desktop-capabilities.md). The tray's windows wear
 * the AUMID through the process and the Start Menu shortcut, never this key.
 */
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows_sys::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, KEY_READ, RegCloseKey, RegDeleteKeyW, RegDeleteTreeW, RegOpenKeyExW,
    RegQueryValueExW,
};

use crate::AUMID;

fn key_path() -> String {
    format!("Software\\Classes\\AppUserModelId\\{AUMID}")
}

/* Ok(true) when the key was there and is gone, Ok(false) when there was none,
   which is every start after the first. */
pub fn remove() -> Result<bool, String> {
    let path = key_path();
    if !key_exists(&path) {
        return Ok(false);
    }
    delete_key(&path)?;
    Ok(true)
}

fn delete_key(text: &str) -> Result<(), String> {
    let path = wide(text);
    let rc = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, path.as_ptr()) };
    if rc != ERROR_SUCCESS && rc != ERROR_FILE_NOT_FOUND {
        return Err(format!("could not delete the AUMID key (error {rc})"));
    }
    /* RegDeleteTree takes the named subkey with it, but a key that survived
       for any reason must not be left half emptied, so the leftover is
       deleted outright and the absence is what this reports. */
    if key_exists(text) {
        let rc = unsafe { RegDeleteKeyW(HKEY_CURRENT_USER, path.as_ptr()) };
        if rc != ERROR_SUCCESS && rc != ERROR_FILE_NOT_FOUND {
            return Err(format!("could not delete the AUMID key (error {rc})"));
        }
    }
    if key_exists(text) {
        return Err("the AUMID key is still present after the delete".into());
    }
    Ok(())
}

/* THE TASKBAR'S THEME, and the only reading of it this exe makes.
 *
 * HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize carries two
 * DWORDs and they are not the same setting: `SystemUsesLightTheme` is the one
 * the TASKBAR, the tray and the Start menu follow, and `AppsUseLightTheme` is
 * the one app windows follow. A person can and often does set them apart, so
 * reading the apps value here would put a cream check on a white taskbar for
 * every such person. Only the system value is read.
 *
 * A missing key, a missing value or any error is None, which icon::taskbar_from
 * reads as dark: that is the Windows default and the set the mark was drawn for
 * first, so the failure mode is the common case rather than a blank tray. */
pub fn system_uses_light_theme() -> Option<u32> {
    let path = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");
    let mut key: HKEY = null_mut();
    let rc = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, KEY_READ, &mut key) };
    if rc != ERROR_SUCCESS {
        return None;
    }
    let guard = KeyGuard(key);
    read_dword(guard.0, "SystemUsesLightTheme")
}

fn key_exists(text: &str) -> bool {
    let path = wide(text);
    let mut key: HKEY = null_mut();
    let rc = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, KEY_READ, &mut key) };
    if rc == ERROR_SUCCESS {
        unsafe { RegCloseKey(key) };
        return true;
    }
    false
}

struct KeyGuard(HKEY);

impl Drop for KeyGuard {
    fn drop(&mut self) {
        unsafe { RegCloseKey(self.0) };
    }
}

fn read_dword(key: HKEY, name: &str) -> Option<u32> {
    let wname = wide(name);
    let mut value: u32 = 0;
    let mut size: u32 = 4;
    let rc = unsafe {
        RegQueryValueExW(
            key,
            wname.as_ptr(),
            null_mut(),
            null_mut(),
            &mut value as *mut u32 as *mut u8,
            &mut size,
        )
    };
    if rc != ERROR_SUCCESS {
        return None;
    }
    Some(value)
}

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
