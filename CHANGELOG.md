# Changelog

All notable changes to the **chat-timeline** extension are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.1]

### Added
- A Marketplace icon for the extension listing.

## [1.0.0]

First public release.

### Added
- **Visual timeline** of each chat session: every turn is a node colored by
  status (green = completed, gray = in-progress, red = error).
- **Rich node badges**: turn index, time (relative or absolute), model name, a
  `</>` marker when the answer contains code, response length, tool-call count,
  and attached files.
- **Session picker** to switch between recorded chat sessions, sorted by most
  recent activity.
- **Full-text search** across prompts and responses, with keyword highlighting
  in both the timeline list and the detail pane. Supports single-session and
  global search (results grouped by session, like VS Code's Search view), plus a
  match-scope filter (question, answer, or both).
- **Detail view** showing the full prompt and rendered Markdown answer (with
  theme-aware syntax highlighting), prompt image thumbnails with a full-screen
  lightbox, one-click copy, and a collapsible "Process / thinking" section.
- **Star** important turns and a "starred only" filter; stars persist across
  restarts.
- **Auto-refresh** via a debounced file watcher that follows the active chat
  session.
- **Safe by design**: strict Content-Security-Policy in the webview, escaped raw
  HTML, and no data ever leaves your machine.
