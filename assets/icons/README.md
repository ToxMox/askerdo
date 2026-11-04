Provenance: this file, manifest.json, validation-report.json, export.mjs and package.json are copied verbatim from the t.ask&ding icon package delivered 2026-09-08; export.mjs and its package.json are DOCUMENTATION of how the rasters were cut and are never run here, no dependency is installed for them, and the committed bytes are the delivered ones.
Re-cut 2026-09-08, the app icon being the mark alone with no rounded tile and in the dark set's colours: app.ico was rebuilt from mark.svg with its two tile paths removed and the remaining drawing uniformly enlarged and centred to fill the canvas the way this package composes its tray faces, kept in the repo as app-mark-dark.svg beside this file; app.ico's 16, 24, 32 and 48 frames ARE this package's own tray-quiet.ico frames byte for byte, and its 64, 128 and 256 frames were rendered from that SVG by a one-off headless browser script that is not part of this repo and not a build step. The manifest's frame table for app.ico is unchanged and still describes the file exactly; its source field still names mark.svg, which this line qualifies. Every other file of the package is as delivered.
Re-cut again 2026-09-09, carrying the line above to the whole set: no background tile on ANY icon, the mark alone filling the usable icon space. The three favicons the board serves (favicon.svg, favicon-quiet.svg, favicon-blocking.svg, committed at assets/) are each the DELIVERED face with its two tile paths removed and the rest of the drawing uniformly enlarged and centred at this package's OWN tray fit, the one manifest.json carries as framing.tray16 (painted bounds 10.55 5.15 59.95 56.75, scale 1.2403100775193798, translation -11.720930232558144 -6.387596899224807), which makes the quiet face's drawing app-mark-dark.svg's body byte for byte; the tile's gradient stays in their defs unused, as it does there. Those same three served files are ALSO the board's own mark: the sidebar's head wears one of them beside the tab buttons and the folded rail shows it with the menu button, so the browser tab and the board's chrome are one drawing in one state and there is no fourth face to keep in step. Their three 32 px rasters (favicon-32.png, favicon-quiet-32.png, favicon-blocking-32.png) were re-rendered from the re-cut SVGs by the same one-off headless browser script. The manifest's export rows for those three PNGs are unchanged and still describe them exactly; their source fields still name the favicon SVGs, which are the files re-cut.
Re-cut in the same round, 2026-09-09: the five app rasters (app-48.png, app-64.png, app-96.png, app-128.png, app-256.png) are the same tile-less drawing as everything else. app-48.png, app-64.png, app-96.png and app-128.png were rendered from app-mark-dark.svg at their own size by the same script; app-256.png IS app.ico's own 256 frame, an 8 bit RGBA PNG of that same drawing at that same size, lifted byte for byte, and a fresh 256 render was made to check and decoded to that frame's pixels channel for channel. The manifest's export rows for the five are unchanged and still describe them exactly, file, type and size; their source fields still name mark.svg, which this line qualifies as the two above qualify theirs. Opaque pixels, delivered then re-cut: 2236 of 2304 to 1089 at 48, 3960 of 4096 to 1879 at 64, 8888 of 9216 to 3926 at 96, 15752 of 16384 to 6904 at 128, 62858 of 65536 to 26627 at 256. test/icons.test.mjs pins those counts, the top and bottom edges, the first and last painted column the package's own fit puts them at, and the app-256.png identity, so a re-render that drifts fails the suite.
Renamed: the product is AskerDo, and every string this package carries of its own is left exactly as delivered, manifest.json's slug, package.json's name and app-mark-dark.svg's label included, because the provenance line above says these are the delivered bytes and nothing at runtime reads any of the three; test/icons.test.mjs pins app-mark-dark.svg's label as delivered.
The tray's own popup is the one alert surface and no Windows toast is raised, so the five app rasters have no reader: they stay committed as the package's exports, wired to nothing, and app.ico remains the exe's icon and the Start Menu shortcut's.

# t.ask&ding icon package

Machine slug: t-ask-and-ding. Selected design: A / Longer check, C2 Candy Circuit, Compact.

Latest refinement: the edited Illustrator master defines all sizes. Its check path, bubble, marker, stroke widths, gradients and tile are preserved exactly. Illustrator styles are written as SVG presentation attributes for portability; the normalized master renders pixel-identically to the edited input at 512 px. No automatic positioning or angle correction is applied. Check stroke width is 6 units and bubble/ring stroke width is 5.7 units in the edited 64-unit master.

## Decisions carried over from the approved design

- The supplied format brief is applied to file names, sizes and encodings. The selected artwork takes priority over the pasted redesign instructions.
- Quiet and mark.svg keep the approved hollow pink ring. They have no filled status marker. The requested empty corner is intentionally not applied.
- The approved palette is retained, including the orange check on the transparent light variant. The pasted no-orange rule is intentionally not applied.
- Waiting uses the existing blue status color. Blocking uses the selected Amber option: #FFB300 on dark surfaces and #E68A00 on light surfaces. Quiet retains its hollow pink ring. The only per-state artwork change is the marker fill and color.
- Root tray ICOs use the approved cream-check variant on #202020 and other dark taskbars. The tray-light-*.ico files use the orange-check variant on #F3F3F3 and other light taskbars. The app must switch these files when the taskbar theme changes. A single ICO does not automatically recolor itself with the Windows theme. Do not use the orange-check variant on a dark taskbar.
- The chat outline occupies part of the bottom-right quadrant. A runtime count badge with a diameter of 75% of the icon covers the check, outline and part of the status marker. The requested clear quadrant cannot be provided without changing the approved design. The included preview shows this conflict. The application must not assume the bottom-right area is reserved.
- App and favicon SVGs share the approved dark rounded tile. The tile is artwork; its outside corners are transparent. Tray faces use the same mark paths and circle as the large app artwork, without the tile. The previous separate tray redraw is superseded. Check position, angle, stroke ratios and ring proportions are consistent at every size.
- No outer padding is added. The entire app drawing is uniformly enlarged until the tile reaches all four canvas edges. Each tray drawing is uniformly enlarged and centered until its painted height fills the canvas. Because the tray mark is taller than it is wide, some side space remains as a consequence of preserving its proportions. Rings remain circular; strokes, check shape and relative spacing are not distorted. Internal space within the tile is part of the approved design.

## Export settings

SVG is the source of truth. All SVG viewBoxes are 0 0 64 64. Every size uses the exact edited master geometry. The 16- and 20-pixel source filenames are retained for integration compatibility but contain identical artwork. Separate hand-hinting is intentionally superseded by the request for consistent geometry and preserved proportions. Exact painted bounds, uniform transforms and edited path data are recorded in manifest.json; no additional padding is applied during raster export.

Raster exports are generated directly from SVG with Sharp 0.35.4 in sRGB, with 8-bit RGBA and real alpha, no matte, and no metadata copied from the host. No PNG quantization is used. Fully transparent DIB pixels have zero RGB. DIB rows are bottom-up BGRA with straight alpha, a 40-byte BITMAPINFOHEADER, doubled stored height, BI_RGB compression value 0, and a DWORD-aligned 1-bit AND mask. Mask bits are 1 where alpha is zero. The tray has no PNG-compressed frames.

Format references: [Microsoft alpha icon and mask notes](https://devblogs.microsoft.com/oldnewthing/20101021-00/?p=12483), [Microsoft icon image formats](https://devblogs.microsoft.com/oldnewthing/20231025-00/?p=108925).

## Files

|File|Purpose|Export settings|
|-|-|-|
|mark-quiet.svg|quiet app mark with edited dark tile|64-unit SVG; exact edited Illustrator geometry; transparent outside the tile|
|favicon-quiet.svg|quiet board favicon|Exact copy of mark-quiet.svg|
|mark-waiting.svg|waiting app mark with edited dark tile|64-unit SVG; exact edited Illustrator geometry; transparent outside the tile|
|favicon.svg|waiting board favicon|Exact copy of mark-waiting.svg|
|mark-blocking.svg|blocking app mark with edited dark tile|64-unit SVG; exact edited Illustrator geometry; transparent outside the tile|
|favicon-blocking.svg|blocking board favicon|Exact copy of mark-blocking.svg|
|mark.svg|App identity for exe, toast header and Settings|64-unit SVG; identical to mark-quiet.svg; approved hollow pink ring retained|
|tray-light-source-16-quiet.svg|light quiet tray source for 16 px|64-unit SVG; exact edited master geometry; 16 and 20 source files are identical for compatibility|
|tray-light-source-16-waiting.svg|light waiting tray source for 16 px|64-unit SVG; exact edited master geometry; 16 and 20 source files are identical for compatibility|
|tray-light-source-16-blocking.svg|light blocking tray source for 16 px|64-unit SVG; exact edited master geometry; 16 and 20 source files are identical for compatibility|
|tray-light-source-20-quiet.svg|light quiet tray source for 20 px|64-unit SVG; exact edited master geometry; 16 and 20 source files are identical for compatibility|
|tray-light-source-20-waiting.svg|light waiting tray source for 20 px|64-unit SVG; exact edited master geometry; 16 and 20 source files are identical for compatibility|
|tray-light-source-20-blocking.svg|light blocking tray source for 20 px|64-unit SVG; exact edited master geometry; 16 and 20 source files are identical for compatibility|
|tray-dark-source-16-quiet.svg|dark quiet tray source for 16 px|64-unit SVG; exact edited master geometry; 16 and 20 source files are identical for compatibility|
|tray-dark-source-16-waiting.svg|dark waiting tray source for 16 px|64-unit SVG; exact edited master geometry; 16 and 20 source files are identical for compatibility|
|tray-dark-source-16-blocking.svg|dark blocking tray source for 16 px|64-unit SVG; exact edited master geometry; 16 and 20 source files are identical for compatibility|
|tray-dark-source-20-quiet.svg|dark quiet tray source for 20 px|64-unit SVG; exact edited master geometry; 16 and 20 source files are identical for compatibility|
|tray-dark-source-20-waiting.svg|dark waiting tray source for 20 px|64-unit SVG; exact edited master geometry; 16 and 20 source files are identical for compatibility|
|tray-dark-source-20-blocking.svg|dark blocking tray source for 20 px|64-unit SVG; exact edited master geometry; 16 and 20 source files are identical for compatibility|
|tray-waiting.ico|waiting tray face for a dark taskbar; cream check|16, 20, 24, 32, 48 px; classic BI_RGB DIB; straight BGRA; 8-bit alpha; AND mask|
|tray-quiet.ico|quiet tray face for a dark taskbar; cream check|16, 20, 24, 32, 48 px; classic BI_RGB DIB; straight BGRA; 8-bit alpha; AND mask|
|tray-blocking.ico|blocking tray face for a dark taskbar; cream check|16, 20, 24, 32, 48 px; classic BI_RGB DIB; straight BGRA; 8-bit alpha; AND mask|
|tray-light-waiting.ico|waiting tray face for a light taskbar; orange check|16, 20, 24, 32, 48 px; classic BI_RGB DIB; straight BGRA; 8-bit alpha; AND mask|
|tray-light-quiet.ico|quiet tray face for a light taskbar; orange check|16, 20, 24, 32, 48 px; classic BI_RGB DIB; straight BGRA; 8-bit alpha; AND mask|
|tray-light-blocking.ico|blocking tray face for a light taskbar; orange check|16, 20, 24, 32, 48 px; classic BI_RGB DIB; straight BGRA; 8-bit alpha; AND mask|
|app.ico|Exe, Explorer, taskbar and Windows Settings|16, 24, 32, 48, 64, 128 px classic 32-bit DIB; 256 px RGBA PNG; from mark.svg|
|app-48.png|Toast header and app identity|48 x 48 px; sRGB RGBA; 8-bit channels; true alpha; from mark.svg|
|app-64.png|Toast header and app identity|64 x 64 px; sRGB RGBA; 8-bit channels; true alpha; from mark.svg|
|app-96.png|Toast header and app identity|96 x 96 px; sRGB RGBA; 8-bit channels; true alpha; from mark.svg|
|app-128.png|Toast header and app identity|128 x 128 px; sRGB RGBA; 8-bit channels; true alpha; from mark.svg|
|app-256.png|Toast header and app identity|256 x 256 px; sRGB RGBA; 8-bit channels; true alpha; from mark.svg|
|favicon-32.png|waiting board favicon|32 x 32 px; sRGB RGBA; true alpha; from favicon.svg|
|favicon-quiet-32.png|quiet board favicon|32 x 32 px; sRGB RGBA; true alpha; from favicon-quiet.svg|
|favicon-blocking-32.png|blocking board favicon|32 x 32 px; sRGB RGBA; true alpha; from favicon-blocking.svg|
|manifest.json|Portable source-to-export mapping and exact colors|JSON; relative filenames only|
|export.mjs|Re-export rasters from the included SVG sources|Node.js; Sharp 0.35.4; no host-specific paths|
|package.json|Portable exporter dependency and command|npm run export after installing the pinned dependency|
|README.md|File inventory, colors, provenance and integration decisions|ASCII Markdown|
|validation-report.json|Measured format, alpha, privacy, native Windows and browser checks|JSON; generated after validation|
|preview.png|App, status, tray-size and badge review sheet|RGBA PNG; includes labels and simulated runtime badges; not an app icon|
|preview.html|Self-contained review page|HTML; embedded artwork and sample taskbar backgrounds|

## Exact colors

|Use|Hex|
|-|-|
|Dark body gradient|#3ACFFF, #9B91FF, #FF62C4|
|Light body gradient|#0077B8, #7856CB, #CE238E|
|App tile gradient|#28183D, #100C20|
|Tile rim|#FFFFFF at 20% opacity, as saved in the edited master|
|Dark check|#FFF3DA|
|Light check|#E8540B|
|Tray popup Done and Closed, dark (the mark's check keeps its own colors)|#86EFAC|
|Tray popup Done and Closed, light|#15803D|
|Quiet ring, dark|#FF6AC8|
|Quiet ring, light|#DF1989|
|Waiting marker, dark app and dark tray|#39C9FF|
|Waiting marker, light tray|#008AC7|
|Blocking marker, dark app and dark tray|#FFB300|
|Blocking marker, light tray|#E68A00|
|Transparent pixels|Alpha 0, no matte|
|Preview-only taskbar backgrounds|#202020, #F3F3F3|
|Preview-only badge and pixel digits|#FB7185, #FFFFFF|
|Preview-only page, panels and labels|#131321, #202031, #393E53, #FAF6FF, #A8B3CB|

## Provenance

The artwork was drawn from scratch for this project using SVG paths, circles and gradients. No stock artwork, icon fonts, embedded raster assets or external image resources are used. Icon SVGs contain no rendered text. Review-page labels use system fonts and are not part of the icon files.

## Integration handoff

Use the exact root filenames for a dark taskbar: tray-waiting.ico, tray-quiet.ico and tray-blocking.ico. On a light taskbar select tray-light-waiting.ico, tray-light-quiet.ico and tray-light-blocking.ico instead. Switch on taskbar theme changes; do not infer taskbar appearance from the web board theme. Read validation-report.json for observed checks and the design conflicts above before integrating the runtime count badge. This package does not change the application code or claim that runtime integration has been tested.
