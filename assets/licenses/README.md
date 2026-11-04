# Vendored license notices

Vendored prebuilt; rebuild with node scripts/build-viewer.mjs. Runtime code
stays zero-dependency: these packages are compiled into assets/ and never
installed at runtime.

Every package whose code is compiled into a shipped bundle has a notice here,
not just the direct dependencies: a bundle built here is derived from the
esbuild metafile inputs, and a bundle vendored ALREADY BUILT from the
dependency closure of the package it came from, which over-covers rather
than under-covers. This file is generated; never hand-edit it.

The tray executable is the one shipped artifact this file does not list crate
by crate: assets/askerdo-tray.exe is built from the Rust crate in tray/
and carries its own notice beside this one at licenses/askerdo-tray.txt,
regenerated with node scripts/build-tray.mjs --licenses-only.

## assets/highlight.min.js

- `highlight.js@11.12.0` (BSD-3-Clause) -> `highlight.js.txt`

## assets/markdown-it.min.js

- `argparse@2.0.1` (Python-2.0) -> `argparse.txt`
- `entities@4.5.0` (BSD-2-Clause) -> `entities.txt`
- `linkify-it@5.0.2` (MIT) -> `linkify-it.txt`
- `markdown-it@14.3.0` (MIT) -> `markdown-it.txt`
- `mdurl@2.1.0` (MIT) -> `mdurl.txt`
- `punycode.js@2.3.1` (MIT) -> `punycode.js.txt`
- `uc.micro@2.1.0` (MIT) -> `uc.micro.txt`

## assets/purify.min.js

- `dompurify@3.4.14` (MPL-2.0 OR Apache-2.0) -> `dompurify.txt`
