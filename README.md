# chat-timeline

Explore and navigate VS Code Chat conversation history through a visual timeline. Trace your questions, understand how context evolved, and revisit past interactions — all from a dedicated side panel.

## Features

- **Visual timeline** of each chat session: every turn is a node colored by status (green = completed, gray = in‑progress, red = error).
- **Rich node badges**: turn index, time (relative or absolute), model name, a `</>` marker when the answer contains code, response length, tool‑call count, and attached files.
- **Session picker** to switch between recorded chat sessions, sorted by most recent activity.
- **Full‑text search** across prompts and responses within the selected session, highlighting matches.
- **Detail view** showing the full prompt and rendered Markdown answer (with syntax highlighting) and one‑click copy.
- **Star** important turns; stars persist across restarts.
- **Two layouts**: `detail` (timeline + detail pane) and `compact` (timeline only). Toggle from the toolbar or the view title.
- **Safe by design**: the webview uses a strict Content‑Security‑Policy, raw HTML in messages is escaped, and nothing is ever uploaded.

## How it works

The extension reads VS Code's locally stored chat session files (`workspaceStorage/*/chatSessions/*.json`). The storage location is resolved automatically from the official extension‑context APIs, with a platform fallback. If automatic detection fails, set the path manually (see settings below).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `chatTimeline.layout` | `detail` | Timeline layout: `detail` or `compact`. |
| `chatTimeline.source` | `local` | Data source: `local` (read local session files) or `participant` (reserved). |
| `chatTimeline.storagePath` | `""` | Manual override for the VS Code storage root. Leave empty to auto‑detect. |
| `chatTimeline.refreshDebounceMs` | `500` | Debounce (ms) for file‑watch driven refreshes. |
| `chatTimeline.relativeTime` | `true` | Show relative times (e.g. `5m ago`) instead of absolute clock times. |
| `chatTimeline.longThreshold` | `2000` | Character count above which a response is marked as `long`. |

## Commands

- **Chat Timeline: Refresh** (`chatTimeline.refresh`) — reload sessions from disk.
- **Chat Timeline: Toggle Layout** (`chatTimeline.toggleLayout`) — switch between detail and compact.

## Install (from VSIX)

```powershell
code --install-extension chat-timeline-1.0.0.vsix
```

Then open the **Chat Timeline** view from the Activity Bar.

## Develop

```powershell
npm install
npm run compile   # type-check + bundle host & webview
npm test          # run unit tests (node:test + tsx)
npm run lint      # ESLint
npm run package   # produce the .vsix
```

## License

This project is licensed under the terms in the LICENSE file.
