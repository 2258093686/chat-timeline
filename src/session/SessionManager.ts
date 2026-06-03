// M4 会话管理 SessionManager。
// 设计依据：detailed-design §6。汇聚 Source + Parser + Store：列表/排序/过滤/选中/搜索/星标。

import { Emitter, Event } from '../util/event';
import { Session, SessionSummary, Turn } from '../model/types';
import { IChatSource, RawSessionFile } from '../source/IChatSource';
import { ParserRegistry } from '../parser/ParserRegistry';
import { ParseContext } from '../parser/ISessionParser';
import { IStarStore } from '../store/StarStore';

export interface ISessionManager {
  readonly onDidUpdate: Event<void>;
  listSessions(): SessionSummary[];
  selectSession(id: string): Promise<Session | undefined>;
  getCurrent(): Session | undefined;
  search(keyword: string): Turn[];
  toggleStar(turnId: string): void;
  isStarred(turnId: string): boolean;
  /** 解析失败的会话数（供 UI 提示"部分会话解析失败"） */
  getParseFailureCount(): number;
  start(): Promise<void>;
  dispose(): void;
}

export interface SessionManagerDeps {
  source: IChatSource;
  parser: ParserRegistry;
  store: IStarStore;
  longThreshold?: () => number;
  warn?: (msg: string) => void;
}

export class SessionManager implements ISessionManager {
  private readonly emitter = new Emitter<void>();
  readonly onDidUpdate: Event<void> = this.emitter.event;

  private raws: RawSessionFile[] = [];
  private summaries: SessionSummary[] = [];
  private current: Session | undefined;
  private parseFailures = 0;
  private changeSub: { dispose(): void } | undefined;

  constructor(private readonly deps: SessionManagerDeps) {}

  async start(): Promise<void> {
    this.changeSub = this.deps.source.onDidChange(() => {
      void this.reload();
    });
    await this.deps.source.start();
    await this.reload();
  }

  dispose(): void {
    this.changeSub?.dispose();
    this.deps.source.dispose();
    this.emitter.dispose();
  }

  private get longThreshold(): number {
    return this.deps.longThreshold?.() ?? 2000;
  }

  private ctxFor(raw: RawSessionFile): ParseContext {
    return { workspaceId: raw.workspaceId, filePath: raw.filePath, longThreshold: this.longThreshold };
  }

  async reload(): Promise<void> {
    this.parseFailures = 0;
    try {
      this.raws = await this.deps.source.loadRawSessions();
    } catch (err) {
      this.deps.warn?.(`loadRawSessions failed: ${String(err)}`);
      this.raws = [];
    }

    const summaries: SessionSummary[] = [];
    for (const raw of this.raws) {
      const summary = this.deps.parser.parseSummary(raw.raw, this.ctxFor(raw));
      if (!summary) {
        this.parseFailures++;
        continue;
      }
      // 过滤空会话（无有效轮）。
      if (summary.turnCount <= 0) {
        continue;
      }
      summaries.push(summary);
    }
    // 最近会话：按 lastMessageDate 降序。
    summaries.sort((a, b) => (b.lastMessageDate ?? 0) - (a.lastMessageDate ?? 0));
    this.summaries = summaries;

    // 若当前选中会话仍存在，刷新其详情；否则保持。
    if (this.current) {
      const refreshed = await this.selectSession(this.current.id);
      if (!refreshed) {
        this.current = undefined;
      }
    }

    this.emitter.fire();
  }

  listSessions(): SessionSummary[] {
    return this.summaries;
  }

  async selectSession(id: string): Promise<Session | undefined> {
    const raw = this.raws.find((r) => r.sessionId === id);
    if (!raw) {
      return undefined;
    }
    const session = this.deps.parser.parseSession(raw.raw, this.ctxFor(raw));
    if (!session) {
      this.deps.warn?.(`Failed to parse session ${id}`);
      return undefined;
    }
    this.current = session;
    return session;
  }

  getCurrent(): Session | undefined {
    return this.current;
  }

  search(keyword: string): Turn[] {
    if (!this.current) {
      return [];
    }
    const kw = keyword.trim().toLowerCase();
    if (!kw) {
      return this.current.turns;
    }
    return this.current.turns.filter(
      (t) =>
        t.prompt.toLowerCase().includes(kw) ||
        t.responseMarkdown.toLowerCase().includes(kw),
    );
  }

  toggleStar(turnId: string): void {
    this.deps.store.toggle(turnId);
  }

  isStarred(turnId: string): boolean {
    return this.deps.store.isStarred(turnId);
  }

  getParseFailureCount(): number {
    return this.parseFailures;
  }
}
