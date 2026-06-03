import type { Session, SessionSummary } from '../model/types';

export interface ParseContext {
  workspaceId: string;
  filePath: string;
}

export interface ISessionParser {
  /** Whether this parser can handle the given version. */
  canParse(version: number): boolean;
  /** Top-level -> summary (list level, lightweight). */
  parseSummary(raw: unknown, ctx: ParseContext): SessionSummary | null;
  /** Full -> domain model (detail level). */
  parseSession(raw: unknown, ctx: ParseContext): Session | null;
}
