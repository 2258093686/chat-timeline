// Typed host <-> webview message protocol (M7). Shared by both sides.
import type { Session, SessionSummary } from '../model/types';

export type Layout = 'detail' | 'compact';
export type SortOrder = 'newest' | 'oldest';

/** Messages sent from the webview to the host. */
export type ViewToHost =
  | { type: 'ready' }
  | { type: 'selectSession'; sessionId: string }
  | { type: 'selectTurn'; turnId: string }
  | { type: 'search'; keyword: string }
  | { type: 'toggleStar'; turnId: string }
  | { type: 'copy'; target: 'prompt' | 'response'; turnId: string }
  | { type: 'refresh' }
  | { type: 'setLayout'; layout: Layout };

/** Messages sent from the host to the webview. */
export type HostToView =
  | { type: 'sessions'; sessions: SessionSummary[]; activeSessionId?: string }
  | { type: 'session'; session: Session; stars: string[] }
  | { type: 'searchResult'; turnIds: string[] }
  | { type: 'layout'; layout: Layout }
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
      return typeof m.sessionId === 'string';
    case 'selectTurn':
    case 'toggleStar':
      return typeof m.turnId === 'string';
    case 'search':
      return typeof m.keyword === 'string';
    case 'copy':
      return (
        (m.target === 'prompt' || m.target === 'response') &&
        typeof m.turnId === 'string'
      );
    case 'setLayout':
      return m.layout === 'detail' || m.layout === 'compact';
    default:
      return false;
  }
}
