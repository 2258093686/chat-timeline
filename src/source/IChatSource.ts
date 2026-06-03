import type * as vscode from 'vscode';

/** A raw session file (located + read, not yet parsed into the domain model). */
export interface RawSessionFile {
  workspaceId: string;
  sessionId: string;
  filePath: string;
  /** Raw JSON object (unparsed into the domain model). */
  raw: unknown;
}

/** Abstract chat data source. M4 depends only on this, not on local vs participant. */
export interface IChatSource {
  /** Start: set up watchers etc. */
  start(): Promise<void>;
  /** Stop: release watchers etc. */
  dispose(): void;
  /** Load all raw session files (located + parsed JSON). */
  loadRawSessions(): Promise<RawSessionFile[]>;
  /** Data-change event (already debounced). */
  readonly onDidChange: vscode.Event<void>;
}
