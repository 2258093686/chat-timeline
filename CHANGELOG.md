# Changelog

All notable changes to the **chat-timeline** extension are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0]

### Added
- Polished pass over all micro-interactions (X1–X8): hover/selection states,
  status-colored dots, draggable detail pane, sort toggle, follow-latest,
  loading/empty/error screens, debounced search, and smooth transitions.
- Full highlight.js token theme mapped to VS Code editor token colors, so code
  blocks in answers adapt to the active light/dark theme.
- `README.md` (features, settings, install) and this `CHANGELOG.md`.

### Changed
- Visual consistency tuned to VS Code theme variables across nodes, badges,
  buttons, and the detail pane.

## [0.2.0]

### Added
- Version-dispatching parser registry with a dedicated v3 parser; unknown
  `kind`s, missing fields, and version mismatches degrade safely without
  throwing.
- Three-level storage-path resolver (official API → platform fallback → user
  override) — no hard-coded absolute paths.
- Typed host ↔ webview message protocol (`ViewToHost` / `HostToView`) with
  host-side validation against malformed or malicious messages.
- Unit tests for the parser, the storage-path resolver, and the protocol
  validator (`node:test` + `tsx`).

### Changed
- Debounced file watcher and two-level lazy loading (summary vs. detail).

## [0.1.0]

### Added
- Initial experience prototype: vertical session timeline of Copilot Chat turns
  rendered as status-colored dots.
- Node badges (index, time, model, code marker, length, tool calls, files),
  session picker, in-session search, detail pane with Markdown + syntax
  highlighting, copy, and star.
- Strict Content-Security-Policy webview; raw HTML in messages is escaped.
