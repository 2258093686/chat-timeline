# Changelog

All notable changes to the **chat-timeline** extension are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0]

First complete release. All milestones integrated, all quality gates green
(type-check + bundle, 64 unit tests, ESLint).

### Milestones

- **0.1.0 — M1 Source**: local chat-session file source with storage-path
  resolver (official API + platform fallback) and debounced file watching;
  reserved participant source.
- **0.2.0 — M2 Parser**: v3 session parser and a versioned parser registry
  with fault-tolerant decoding.
- **0.3.0 — M3 Model**: core domain types (`Turn`, `Session`, summaries, stars).
- **0.4.0 — M4 Session**: `SessionManager` orchestrating load, parse, select,
  search and star.
- **0.5.0 — M5 Store**: `StarStore` persisting starred turns via memento.
- **0.6.0 — M6 Webview**: timeline rendering, Markdown detail view, search
  filtering, and the CSP-hardened `WebviewViewProvider`.
- **0.7.0 — M7 Messaging**: typed view↔host protocol and host message handler.
- **0.8.0 — M8 Extension**: activation wiring, commands and settings reactions.
- **0.9.0 — M9 Settings**: typed settings facade with change events.

### Added

- Visual chat timeline with status-colored nodes and rich badges.
- Session picker, in-session full-text search, and starring.
- Detail pane with rendered Markdown and copy actions.
- `detail` / `compact` layouts and toggle command.
- Six configurable settings under `chatTimeline.*`.
