# Changelog

All notable changes to the **chat-timeline** extension are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [1.6.9]

### Changed
- Replaced the 🔍 emoji on the search button with a crisp inline SVG magnifier
  icon that renders consistently across platforms and follows the theme color.

## [1.6.8]

### Added
- A dedicated **search (🔍) button** next to the clear (✕) button in the search
  box, plus **Enter** support, so a search can be re-run without first clearing
  the previous keyword.

### Fixed
- Keyword matches in the **detail pane** (question and answer content) are now
  highlighted during single-session search, not just in the timeline list.
- After running a single-session search, toggling **Global search** on and then
  off now correctly returns to the single-session results instead of getting
  stuck on the global results.

## [1.6.7]

### Fixed
- Keyword highlighting now also appears when searching **within a single
  session**, not just in global search. Matching text in each turn's summary is
  wrapped in `<mark>`, and highlights are cleared when the search is cleared.

## [1.6.6]

### Changed
- The `Q` / `A` letters in the **Match scope** prefix are now rendered slightly
  smaller than the `≡` icon for a more balanced look.

## [1.6.5]

### Changed
- Normalized the **Match scope** prefix typography so the `Q` / `A` letters and
  the `≡` icon render at the same visual weight and size.

## [1.6.4]

### Changed
- The **Match scope** prefix now shows the compact three-line icon (`≡`) for the
  "Question & answer" scope instead of the wider "Q+A" text.

## [1.6.3]

### Fixed
- Clicking the embedded **Match scope** prefix had no visible effect because the
  search box used `overflow: hidden`, which clipped the dropdown menu. Replaced
  it with per-corner border radii so the menu can overflow and show again.

## [1.6.2]

### Fixed
- The **Match scope** prefix no longer floats outside the search box. The search
  box itself is now the bordered container, with the scope label embedded on the
  left and a vertical divider separating it from the input.

### Changed
- The **settings (⚙)** button now sits in a button group with a vertical divider
  on its left, vertically aligned with the divider in the session row below.

## [1.6.1]

### Changed
- The **Match scope** control is now a prefix label *inside* the search box
  (left side, before the text input), visually blending with the input field
  like a native search filter chip. The dropdown still opens on click.

## [1.6.0]

### Changed
- Moved the **Match scope** control out of the settings menu and into the
  search bar as its own dropdown (a `Q+A` / `Q` / `A` button next to the search
  box), since it is a search filter rather than a global setting.
- The **More settings** (⚙) and **sort** buttons no longer use a blue active
  background — the toolbar stays neutral.
- The sort button now shows a single arrow indicating direction: `↓` for newest
  first and `↑` for oldest first (instead of the bidirectional `⇅`).
- Renamed the follow toggle to **Follow active chat**, matching its actual
  behaviour of tracking whichever chat is currently active.

## [1.5.3]

### Fixed
- The "More settings" (⚙) popup now also closes when you click outside the
  webview entirely (e.g. into the editor or another panel). Such clicks never
  reach the webview's document, so a `window` blur listener was added to close
  the menu when the view loses focus.

## [1.5.2]

### Fixed
- The "More settings" (⚙) popup now closes when you click anywhere outside it,
  instead of only closing when you click the ⚙ button again. The outside-click
  detection was rewritten to use a single always-on document click listener
  scoped to the menu wrapper, which is more reliable than the previous
  capture-phase `mousedown` handler.

## [1.5.1]

### Fixed
- "Follow newest session" now reliably tracks the most recently *changed*
  session instead of only switching when a brand-new session id first appeared.
  Previously it usually fired just once, because a new chat only enters the list
  after its first completed turn, making the "new id" detection miss most
  switches. Now, while following is on, the view always jumps to whichever
  session was updated most recently; a manual pick of an older session is kept
  until the next change.

## [1.5.0]

### Changed
- "Follow latest" now means **Follow newest session** (renamed in the settings
  menu). When enabled, the timeline automatically switches to the most recent
  Copilot session as soon as a brand-new one appears, so starting a new chat
  jumps the view to it. When disabled, the current session stays put.
  - Manually picking an older session from the dropdown is respected and no
    longer turns following off; the view only jumps again once a *newer*
    session shows up.
  - Following is decoupled from in-session turn selection: clicking a turn no
    longer disables following, and an active session no longer force-scrolls to
    its latest turn on every refresh.

## [1.4.1]

### Changed
- Moved the match-scope control and the starred-only filter into the
  "More settings" (⚙) popup menu:
  - The menu now starts with a "Match scope" subheading and three radio items
    (Question & answer, Question only, Answer only).
  - A "Starred only" toggle was added below the global-search and follow-latest
    toggles.
  - The toolbar's `Q+A` button and the session row's starred-filter button were
    removed, leaving only the search box + ⚙ on the search row and the session
    dropdown + sort button on the session row.

## [1.4.0]

### Changed
- Reorganized the toolbar buttons:
  - Search row: `Q+A` match-scope button, then a "More settings" (⚙) button
    that opens a popup menu containing the global-search and follow-latest
    toggles (shown as checkable icon + label items). New global settings will
    live here too.
  - Session row: sort button, then the starred-only filter button.

## [1.3.1]

### Added
- The session dropdown now shows each session's turn count in parentheses,
  e.g. "My session (12)".

## [1.3.0]

### Added
- "Show starred only" toggle (☆/★) in the session-row toolbar. When enabled,
  the timeline shows only starred turns; it combines with the search filter and
  the preference is persisted. Un-starring a turn while the filter is on hides
  it immediately.

## [1.2.12]

### Changed
- The lint script now also covers the `media` (webview) sources, not just
  `src`, so unused variables and other issues there are caught too.

## [1.2.11]

### Changed
- Cleaned up a code comment that mixed Chinese and English; all source
  comments are now English-only.

## [1.2.10]

### Fixed
- The timeline's vertical connector line no longer appears broken when
  scrolling: each node now draws its own rail segment, so the line stays
  continuous regardless of how far the list is scrolled.

## [1.2.9]

### Changed
- Reverted the match-scope dropdown back to a cycling Q+A / Q / A button, and
  grouped it with the global-search toggle so the search row's trailing buttons
  align with the session row's sort / follow buttons.

## [1.2.8]

### Changed
- Removed the redundant refresh button from the session row; use the native
  refresh button in the view title bar instead.
- Moved the global-search toggle to the right end of the search row.
- Replaced the Q+A / Q / A cycle button with a dropdown for picking the match
  scope (question, answer, or both).

## [1.2.7]

### Changed
- Tidied the session-row toolbar: the sort / follow / refresh icon buttons are
  now grouped into one cluster with a subtle separator from the session
  dropdown, with consistent spacing and centered icons.

## [1.2.6]

### Changed
- Clicking a prompt image in the detail pane now opens a full-screen lightbox
  overlay (like VS Code Copilot) instead of expanding inline. Close it with the
  ✕ button, by clicking the backdrop, or by pressing ESC.

## [1.2.5]

### Added
- Images attached to a prompt (pasted screenshots, etc.) are now shown in the
  detail pane below the question text, as thumbnails. Click a thumbnail to
  toggle full size. They are read from the session's embedded base64 data, so
  no external files are needed.

## [1.2.4]

### Added
- The detail pane now has a **✕ close** button (in the action row) that hides
  the pane; it reopens when another turn or search result is selected.
- Intermediate "process / thinking" narration (text between tool calls) is now
  collapsed into an expandable **Process / thinking** section, so the final
  answer no longer competes with it for space. Search still matches the full
  text.

## [1.2.3]

### Changed
- The **← Back to results** action moved from a top-of-timeline banner into the
  detail pane's action row (next to Copy prompt), styled like **Open in
  session ↗**.
- Model name is now plain blue text (border/badge box removed).
- Turn summaries clamp to two lines, then ellipsize.

### Removed
- The per-turn badge row (code, file refs, long, tool calls, token usage) was
  removed to reduce visual clutter.

## [1.2.2]

### Added
- After using **Open in session ↗** to jump from a global search result, a
  **← Back to search results** banner appears at the top of the session
  timeline; clicking it restores the previous grouped result list (the keyword
  also remains in the search box, so re-searching works too).

### Fixed
- Removed the stray empty code-block boxes (large blank gaps) in answer
  previews. They came from leftover ``` fence markers when the assistant's
  code edits — whose actual content lives in dropped tool segments — were
  reconstructed. Empty fenced blocks and excess blank lines are now stripped.

## [1.2.1]

### Changed
- **Current-session search now hides non-matching turns** instead of dimming
  them, so only the turns containing the keyword remain visible.
- **Global search results no longer auto-navigate.** Clicking a result previews
  its question & answer (with the keyword highlighted) in the detail pane while
  keeping the result list in place; a new **Open in session ↗** button in the
  detail header performs the actual jump only when you choose to.

## [1.2.0]

### Changed
- **Global search now mirrors VS Code's Search view.** Results are grouped into
  collapsible *session folders* (the session title is the folder, with a match
  count badge), and each matching turn is shown as an excerpt with the keyword
  **highlighted**. Clicking an excerpt jumps to that turn in its session.

### Added
- **Match-target filter.** A new toolbar toggle cycles between matching the
  keyword in *question + answer* (`Q+A`), *question only* (`Q`), or
  *answer only* (`A`). It applies to both current-session and global search and
  the choice is persisted.

## [1.1.0]

### Changed
- **Two-row toolbar.** Search and session selection are no longer crammed onto
  one row: the keyword search sits on top, the session dropdown below it.
- **Search controls.** A scope toggle to the left of the search box switches
  between *current session* and *global* (all sessions) search, and a clear
  button inside the box wipes the keyword in one click. The scope choice is
  persisted.
- **Global search results** are shown as a flat list of matching turns across
  every session; clicking a result jumps straight to that turn in its session.
- **Sessions** are ordered by last-activity time (newest first); for the
  `.jsonl` format the timestamp is derived from the most recent turn.
- **Turn nodes** now show a concrete date-time (e.g. `06-03 17:24`) instead of a
  relative "x hours ago", and the model name is shown on the right in a blue
  bordered badge.
- **Detail pane is always visible.** Clicking a turn lists the AI answer right
  below the question, with a thinner divider between them.

### Removed
- The **compact/detail layout toggle** (button, command, and `chatTimeline.layout`
  setting) — the detail view is now always on.

## [1.0.2]

### Added
- Support for VS Code's newer append-log `.jsonl` chat session format: each
  session is reconstructed from its base snapshot plus incremental deltas
  (`kind:1` set, `kind:2` array append) into the same shape the v3 parser
  consumes. The legacy `.json` format is still supported.

## [1.0.1]

### Fixed
- The session list now shows only the **current workspace's** chat sessions
  instead of every workspace's, derived from the extension's workspace storage
  id. Falls back to all workspaces when no workspace is open.

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
