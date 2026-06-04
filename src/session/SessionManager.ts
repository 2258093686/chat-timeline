import * as vscode from 'vscode';
import type { Session, SessionSummary, Turn } from '../model/types';
import type { GlobalSearchHit, MatchTarget } from '../messaging/protocol';
import type { IChatSource, RawSessionFile } from '../source/IChatSource';
import type { ParserRegistry } from '../parser/parserRegistry';
import type { IStarStore } from '../store/starStore';

export interface ISessionManager {
  readonly onDidUpdate: vscode.Event<void>;
  refresh(): Promise<void>;
  listSessions(): SessionSummary[];
  selectSession(id: string): Promise<Session | undefined>;
  getCurrent(): Session | undefined;
  search(keyword: string, target: MatchTarget): Turn[];
  searchGlobal(keyword: string, target: MatchTarget): GlobalSearchHit[];
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
  /** Parsed-session cache (cleared on refresh) to keep global search cheap. */
  private parsedCache = new Map<string, Session>();

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
    this.parsedCache.clear();
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

  search(keyword: string, target: MatchTarget): Turn[] {
    const kw = keyword.trim().toLowerCase();
    if (!kw || !this.current) {
      return this.current?.turns ?? [];
    }
    return this.current.turns.filter((t) => this.matches(t, kw, target));
  }

  /** Search every session; returns a flat list of matching turns with context. */
  searchGlobal(keyword: string, target: MatchTarget): GlobalSearchHit[] {
    const kw = keyword.trim().toLowerCase();
    if (!kw) {
      return [];
    }
    const hits: GlobalSearchHit[] = [];
    for (const summary of this.summaries) {
      const parsed = this.getParsed(summary.id);
      if (!parsed) {
        continue;
      }
      for (const t of parsed.turns) {
        if (!this.matches(t, kw, target)) {
          continue;
        }
        hits.push({
          sessionId: parsed.id,
          sessionTitle: parsed.title,
          turnId: t.id,
          index: t.index,
          summary: t.summary,
          snippet: this.makeSnippet(t, kw, target),
          prompt: t.prompt,
          responseMarkdown: t.responseMarkdown,
          processMarkdown: t.processMarkdown,
          answerMarkdown: t.answerMarkdown,
          images: t.images,
          model: t.model,
          status: t.status,
          timestamp: t.timestamp
        });
      }
    }
    return hits;
  }

  /** Whether a turn matches the keyword within the requested target fields. */
  private matches(turn: Turn, kw: string, target: MatchTarget): boolean {
    const inPrompt = target !== 'response' && turn.prompt.toLowerCase().includes(kw);
    const inResponse =
      target !== 'prompt' && turn.responseMarkdown.toLowerCase().includes(kw);
    return inPrompt || inResponse;
  }

  /** Build a short excerpt around the first keyword match (prompt preferred). */
  private makeSnippet(turn: Turn, kw: string, target: MatchTarget): string {
    const sources: string[] = [];
    if (target !== 'response') {
      sources.push(turn.prompt);
    }
    if (target !== 'prompt') {
      sources.push(turn.responseMarkdown);
    }
    for (const text of sources) {
      const idx = text.toLowerCase().indexOf(kw);
      if (idx === -1) {
        continue;
      }
      const start = Math.max(0, idx - 30);
      const end = Math.min(text.length, idx + kw.length + 50);
      let snip = text.slice(start, end).replace(/\s+/g, ' ').trim();
      if (start > 0) {
        snip = '…' + snip;
      }
      if (end < text.length) {
        snip = snip + '…';
      }
      return snip;
    }
    return turn.summary;
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

  /** Parse-with-cache, used by global search to avoid re-parsing each keystroke. */
  private getParsed(id: string): Session | undefined {
    const cached = this.parsedCache.get(id);
    if (cached) {
      return cached;
    }
    const parsed = this.parseDetail(id);
    if (parsed) {
      this.parsedCache.set(id, parsed);
    }
    return parsed;
  }
}
