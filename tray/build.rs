/* The version resource and the exe icon.
 *
 * Windows reads a file's description, product name and version out of a
 * VERSIONINFO resource, and Explorer reads its icon out of the first icon
 * group, so both are compiled in here rather than left to whatever the linker
 * defaults to. The icon is the icon package's APP IDENTITY (assets/app.ico:
 * the mark ALONE with the hollow ring, no tile behind it, enlarged to fill
 * its canvas in the dark set's colours, classic frames from 16 to 128 and a
 * 256 PNG frame), which is also the file the AUMID key points IconUri at and
 * the file the Start Menu shortcut wears, so the exe in Explorer, the toast
 * header, the Settings row and the tray corner are one drawing. app.ico carries no
 * tile, and its small frames ARE the tray faces' own frames, so at no size do
 * the identity and the tray corner disagree.
 *
 * This runs only on Windows targets; anywhere else it is a no-op, so a
 * `cargo check` on another host still parses the crate.
 */
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../assets/app.ico");
    if std::env::var("CARGO_CFG_WINDOWS").is_err() {
        return;
    }
    let mut res = winresource::WindowsResource::new();
    res.set_icon("../assets/app.ico");
    res.set("FileDescription", "AskerDo");
    res.set("ProductName", "AskerDo");
    res.set("InternalName", "askerdo-tray");
    res.set("OriginalFilename", "askerdo-tray.exe");
    res.set("CompanyName", "ToxMox");
    res.set("LegalCopyright", "MIT licensed");
    /* FileVersion and ProductVersion come from CARGO_PKG_VERSION, which is the
       crate version in Cargo.toml and is kept equal to the plugin's. */
    if let Err(e) = res.compile() {
        panic!("could not compile the version resource: {e}");
    }
}
