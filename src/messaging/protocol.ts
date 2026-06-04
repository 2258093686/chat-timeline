// Typed host <-> webview message protocol (M7). Shared by both sides.
import type { Session, SessionSummary, TurnImage, TurnStatus } from '../model/types';

export type SortOrder = 'newest' | 'oldest';

/** Search scope: only the current session, or across all sessions. */
export type SearchScope = 'current' | 'global';

/** Which part of a turn the keyword must match. */
export type MatchTarget = 'prompt' | 'response' | 'both';

/** A single global-search hit (a matching turn in some session). */
export interface GlobalSearchHit {
  sessionId: string;
  sessionTitle: string;
  turnId: string;
  index: number;
  summary: string;
  /** A short excerpt of the text around the first keyword match. */
  snippet: string;
  /** Full question text, so the detail pane can render without a round-trip. */
  prompt: string;
  /** Full answer markdown, so the detail pane can render without a round-trip. */
  responseMarkdown: string;
  /** Intermediate process narration (collapsed in the detail pane). */
  processMarkdown?: string;
  /** Final answer markdown (text after the last tool call). */
  answerMarkdown: string;
  /** Images attached to the prompt, ready to render. */
  images: TurnImage[];
  model?: string;
  status: TurnStatus;
  timestamp?: number;
}

/** Messages sent from the webview to the host. */
export type ViewToHost =
  | { type: 'ready' }
  | { type: 'selectSession'; sessionId: string; focusTurnId?: string }
  | { type: 'selectTurn'; turnId: string }
  | { type: 'search'; keyword: string; scope: SearchScope; target: MatchTarget }
  | { type: 'toggleStar'; turnId: string }
  | { type: 'copy'; target: 'prompt' | 'response'; turnId: string }
  | { type: 'refresh' };

/** Messages sent from the host to the webview. */
export type HostToView =
  | { type: 'sessions'; sessions: SessionSummary[]; activeSessionId?: string }
  | { type: 'session'; session: Session; stars: string[] }
  | { type: 'searchResult'; turnIds: string[] }
  | { type: 'globalSearchResult'; hits: GlobalSearchHit[] }
  | { type: 'loading' }
  | { type: 'empty'; reason: 'no-data' | 'no-sessions' }
  | { type: 'error'; message: string };

/**
 * Validate that an arbitrary value is a well-formed ViewToHost message.
 * Host-side guard against malformed / malicious messages.
 */
export function isViewToHost(value: unknown): value is ViewToHost {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const m = value as Record<string, unknown>;
  switch (m.type) {
    case 'ready':
    case 'refresh':
      return true;
    case 'selectSession':
      return (
        typeof m.sessionId === 'string' &&
        (m.focusTurnId === undefined || typeof m.focusTurnId === 'string')
      );
    case 'selectTurn':
    case 'toggleStar':
      return typeof m.turnId === 'string';
    case 'search':
      return (
        typeof m.keyword === 'string' &&
        (m.scope === 'current' || m.scope === 'global') &&
        (m.target === 'prompt' || m.target === 'response' || m.target === 'both')
      );
    case 'copy':
      return (
        (m.target === 'prompt' || m.target === 'response') &&
        typeof m.turnId === 'string'
      );
    default:
      return false;
  }
}
