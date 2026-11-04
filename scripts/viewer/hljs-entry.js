/* The highlight.js browser build, because the published package has none.
 *
 * markdown-it and DOMPurify each ship a ready UMD dist inside their tarball and
 * are vendored out of it byte for byte; highlight.js publishes CommonJS and ESM
 * module trees only, so scripts/build-viewer.mjs bundles this file into
 * assets/highlight.min.js instead. COMMON is the deliberate language set
 * (docs/file-refs-spec.md names it): the full registry is several times the size for languages a
 * file ref will effectively never carry, and a language the set does not know
 * falls back to plain text on the viewer page rather than to a guess.
 *
 * PowerShell is the one addition to that set: on Windows a .ps1 is as ordinary
 * a ref as .sh is anywhere else, and common carries bash but not powershell.
 */
import hljs from 'highlight.js/lib/common';
import powershell from 'highlight.js/lib/languages/powershell';

hljs.registerLanguage('powershell', powershell);

window.hljs = hljs;
