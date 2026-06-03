// Domain model — pure data types shared across the extension and (a subset) the webview.
// No runtime logic here; this is the common contract.

/** Completion status of a single turn. */
export type TurnStatus = 'completed' | 'in-progress' | 'error';

/** Coarse length bucket for a turn (proposal 3.8-D). */
export type LengthBucket = 'short' | 'long';

/** A file referenced / touched by a turn. */
export interface TurnFileRef {
  /** Display name, e.g. HttpMockServer.cs */
  name: string;
  /** Full path (fsPath or file:// uri). */
  path: string;
}

/** Best-effort usage info (local files usually lack this — proposal 3.9). */
export interface TurnUsage {
  estimated: boolean;
  tokens?: number;
  credits?: number;
}

/** One question/answer turn — a single node on the timeline. */
export interface Turn {
  /** Original requestId, globally unique, used as the node key. */
  id: string;
  /** 1-based index within the session (#1, #2 ...). */
  index: number;
  /** Full user prompt. */
  prompt: string;
  /** Full response, concatenated as Markdown. */
  responseMarkdown: string;
  /** Prompt summary (first N chars, shown by default). */
  summary: string;
  /** Occurrence time (epoch ms). May be undefined for old formats. */
  timestamp?: number;
  /** Display model name, e.g. claude-sonnet-4. Undefined when unknown. */
  model?: string;
  /** Completion status (enhanced info A). */
  status: TurnStatus;
  /** Error message when status === 'error'. */
  errorMessage?: string;
  /** Whether the turn contains code blocks (enhanced info B). */
  hasCode: boolean;
  /** Files involved (enhanced info C). */
  files: TurnFileRef[];
  /** Length bucket (enhanced info D). */
  length: LengthBucket;
  /** prompt + response char count (basis for `length`). */
  charCount: number;
  /** Tool-call count (enhanced info E). */
  toolCallCount: number;
  /** Usage info (best-effort). Undefined when not available. */
  usage?: TurnUsage;
}

/** A chat session. */
export interface Session {
  /** sessionId */
  id: string;
  /** Title: customTitle, else first prompt summary. */
  title: string;
  /** Owning workspaceStorage directory name. */
  workspaceId: string;
  creationDate?: number;
  /** Last message time (used for "recent" ordering). */
  lastMessageDate?: number;
  /** All valid turns, ascending by time. */
  turns: Turn[];
}

/** Lightweight session summary for the top selector (no turns). */
export interface SessionSummary {
  id: string;
  title: string;
  workspaceId: string;
  lastMessageDate?: number;
  turnCount: number;
}
