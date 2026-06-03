// M2 解析层：版本分发注册表。
// 设计依据：detailed-design §5.1。未知版本回退到最接近的解析器并告警，不崩溃。

import { Session, SessionSummary } from '../model/types';
import { ISessionParser, ParseContext } from './ISessionParser';
import { SessionParserV3 } from './v3/SessionParserV3';

function readVersion(raw: unknown): number | undefined {
  if (typeof raw === 'object' && raw !== null) {
    const v = (raw as Record<string, unknown>).version;
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v;
    }
  }
  return undefined;
}

export class ParserRegistry {
  private readonly parsers: ISessionParser[];

  constructor(
    parsers?: ISessionParser[],
    private readonly warn: (msg: string) => void = () => undefined,
  ) {
    this.parsers = parsers ?? [new SessionParserV3()];
  }

  /** 为给定 raw 选择解析器：精确匹配优先，否则回退到最接近版本的解析器。 */
  select(raw: unknown): ISessionParser | undefined {
    const version = readVersion(raw);
    if (version !== undefined) {
      const exact = this.parsers.find((p) => p.canParse(version));
      if (exact) {
        return exact;
      }
      this.warn(`Unknown session version ${version}; falling back to closest parser.`);
    } else {
      this.warn('Session has no version field; falling back to closest parser.');
    }
    // 回退：当前只有 V3，直接返回首个解析器（最接近）。
    return this.parsers[0];
  }

  parseSummary(raw: unknown, ctx: ParseContext): SessionSummary | null {
    const parser = this.select(raw);
    if (!parser) {
      return null;
    }
    try {
      return parser.parseSummary(raw, ctx);
    } catch (err) {
      this.warn(`parseSummary failed for ${ctx.filePath}: ${String(err)}`);
      return null;
    }
  }

  parseSession(raw: unknown, ctx: ParseContext): Session | null {
    const parser = this.select(raw);
    if (!parser) {
      return null;
    }
    try {
      return parser.parseSession(raw, ctx);
    } catch (err) {
      this.warn(`parseSession failed for ${ctx.filePath}: ${String(err)}`);
      return null;
    }
  }
}
