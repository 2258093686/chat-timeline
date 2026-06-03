import type { Session, SessionSummary } from '../model/types';
import type { ISessionParser, ParseContext } from './ISessionParser';
import { SessionParserV3 } from './v3/sessionParserV3';

/** Reads the top-level `version` of a raw session object (best-effort). */
function readVersion(raw: unknown): number {
  if (raw && typeof raw === 'object' && 'version' in raw) {
    const v = (raw as { version: unknown }).version;
    if (typeof v === 'number') {
      return v;
    }
  }
  return 0;
}

/**
 * Dispatches a raw session to the matching parser by `version`.
 * Unknown versions fall back to the closest (highest) parser and log a warning
 * instead of crashing (fault tolerance).
 */
export class ParserRegistry {
  private readonly parsers: ISessionParser[];

  constructor(parsers?: ISessionParser[], private readonly warn: (m: string) => void = () => {}) {
    this.parsers = parsers ?? [new SessionParserV3()];
  }

  private select(version: number): ISessionParser | undefined {
    const exact = this.parsers.find((p) => p.canParse(version));
    if (exact) {
      return exact;
    }
    if (this.parsers.length > 0) {
      this.warn(`chat-timeline: unknown session version ${version}, using fallback parser.`);
      return this.parsers[this.parsers.length - 1];
    }
    return undefined;
  }

  parseSummary(raw: unknown, ctx: ParseContext): SessionSummary | null {
    try {
      const parser = this.select(readVersion(raw));
      return parser ? parser.parseSummary(raw, ctx) : null;
    } catch (err) {
      this.warn(`chat-timeline: parseSummary failed for ${ctx.filePath}: ${String(err)}`);
      return null;
    }
  }

  parseSession(raw: unknown, ctx: ParseContext): Session | null {
    try {
      const parser = this.select(readVersion(raw));
      return parser ? parser.parseSession(raw, ctx) : null;
    } catch (err) {
      this.warn(`chat-timeline: parseSession failed for ${ctx.filePath}: ${String(err)}`);
      return null;
    }
  }
}
