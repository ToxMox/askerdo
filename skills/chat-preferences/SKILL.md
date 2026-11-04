---
name: chat-preferences
description: Print your personalized claude.ai chat preferences text, ready to paste into claude.ai Settings > personal preferences
---

# Export the claude.ai chat preferences

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/hooks/sync.mjs" --chat-prefs`.
2. Show the output in a fenced block and tell the user to paste it into claude.ai Settings, personal preferences. Claude chat reads nothing from disk, which is why it needs its own pasted copy; the text is deliberately an ethos rather than a rulebook, because in chat the likely failure is over-formatting.
3. The same text is saved as `claude-chat-preferences.md` in the plugin data directory; the session-start sync compares against it and nudges when the saved config has drifted from what was last pasted.
4. If no config exists yet, point the user at `/askerdo:configure` instead.
