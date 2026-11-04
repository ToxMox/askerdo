---
name: measure
description: Re-measure Claude Code display capabilities with the shipped test cards (desktop app or terminal)
---

# Re-measure display capabilities

1. Pick the doc for the current surface: `${CLAUDE_PLUGIN_ROOT}/docs/desktop-capabilities.md` (desktop app) or `${CLAUDE_PLUGIN_ROOT}/docs/tui-capabilities.md` (terminal, editor extension, SSH). Read its "Test card" section.
2. Send the test card verbatim as one reply, then ask the user for a screenshot of how it rendered.
3. Compare the screenshot against the doc's capability matrix and report deltas as a short list: device, what the matrix claims, what the screenshot shows.
4. The docs are plugin-owned files, so local edits are lost on update: for lasting changes, suggest an issue or PR at https://github.com/ToxMox/askerdo with the deltas and the app version measured.
