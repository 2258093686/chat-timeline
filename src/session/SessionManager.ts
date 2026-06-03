import * as vscode from 'vscode';
import type { Session, SessionSummary, Turn } from '../model/types';
import type { IChatSource, RawSessionFile } from '../source/IChatSource';
import type { ParserRegistry } from '../parser/parserRegistry';
import type { IStarStore } from '../store/starStore';

export interface ISessionManager {
  readonly onDidUpdate: vscode.Event<void>;
  refresh(): Promise<void>;
  listSessions(): SessionSummary[];
  selectSession(id: string): Promise<Session | undefined>;
  getCurrent(): Session | undefined;
  search(keyword: string): Turn[];
  toggleStar(turnId: string): void;
  isStarred(turnId: string): boolean;
  stars(): string[];
}

export class SessionManager implements ISessionManager {
  private readonly _onDidUpdate = new vscode.EventEmitter<void>();
  readonly onDidUpdate = this._onDidUpdate.event;

  private rawById = new Map<string, RawSessionFile>();
  private summaries: SessionSummary[] = [];
  private current: Session | undefined;
  private currentId: string | undefined;
  private changeSub: vscode.Disposable | undefined;

  constructor(
    private readonly source: IChatSource,
    private readonly parser: ParserRegistry,
    private readonly store: IStarStore
  ) {}

  async start(): Promise<void> {
    await this.source.start();
    this.changeSub = this.source.onDidChange(() => {
      void this.refresh();
    });
    await this.refresh();
  }

  dispose(): void {
    this.changeSub?.dispose();
    this.source.dispose();
    this._onDidUpdate.dispose();
  }

  async refresh(): Promise<void> {
    const raws = await this.source.loadRawSessions();
    this.rawById.clear();
    const summaries: SessionSummary[] = [];
    for (const raw of raws) {
      this.rawById.set(raw.sessionId, raw);
      const summary = this.parser.parseSummary(raw.raw, {
        workspaceId: raw.workspaceId,
        filePath: raw.filePath
      });
      if (summary) {
        // ensure the summary id matches the file's session id for lookup
        summary.id = raw.sessionId;
        summaries.push(summary);
      }
    }
    summaries.sort((a, b) => (b.lastMessageDate ?? 0) - (a.lastMessageDate ?? 0));
    this.summaries = summaries;

    // Re-resolve current selection (or auto-pick most recent).
    if (this.currentId && this.rawById.has(this.currentId)) {
      this.current = this.parseDetail(this.currentId);
    } else {
      this.currentId = summaries[0]?.id;
      this.current = this.currentId ? this.parseDetail(this.currentId) : undefined;
    }
    this._onDidUpdate.fire();
  }

  listSessions(): SessionSummary[] {
    return this.summaries;
  }

  async selectSession(id: string): Promise<Session | undefined> {
    this.currentId = id;
    this.current = this.parseDetail(id);
    return this.current;
  }

  getCurrent(): Session | undefined {
    return this.current;
  }

  getCurrentId(): string | undefined {
    return this.currentId;
  }

  search(keyword: string): Turn[] {
    const kw = keyword.trim().toLowerCase();
    if (!kw || !this.current) {
      return this.current?.turns ?? [];
    }
    return this.current.turns.filter(
      (t) =>
        t.prompt.toLowerCase().includes(kw) ||
        t.responseMarkdown.toLowerCase().includes(kw)
    );
  }

  toggleStar(turnId: string): void {
    this.store.toggle(turnId);
    this._onDidUpdate.fire();
  }

  isStarred(turnId: string): boolean {
    return this.store.isStarred(turnId);
  }

  stars(): string[] {
    return this.store.all();
  }

  private parseDetail(id: string): Session | undefined {
    const raw = this.rawById.get(id);
    if (!raw) {
      return undefined;
    }
    return (
      this.parser.parseSession(raw.raw, {
        workspaceId: raw.workspaceId,
        filePath: raw.filePath
      }) ?? undefined
    );
  }
}
