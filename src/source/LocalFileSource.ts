// M1 数据源 A：本地文件源。
// 设计依据：detailed-design §4.3、§3.1。遍历 <root>/*/chatSessions/*.json，监听 + 去抖。

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Emitter, Event } from '../util/event';
import { IChatSource, RawSessionFile } from './IChatSource';
import { IStoragePathResolver } from './StoragePathResolver';
import { replayJsonl } from './jsonlReplay';

export interface LocalFileSourceOptions {
  resolver: IStoragePathResolver;
  /** 刷新去抖时长（ms），来自设置 chatTimeline.refreshDebounceMs */
  debounceMs?: number;
  /**
   * 仅扫描/监听该工作区目录（workspaceStorage 下的哈希文件夹名）。
   * 设置后只返回当前工作区自己的会话，避免与其它工作区串扰。
   * 不设置时遍历全部工作区（向后兼容）。
   */
  workspaceId?: string;
  /** 日志/告警回调 */
  warn?: (msg: string) => void;
}

export class LocalFileSource implements IChatSource {
  private readonly emitter = new Emitter<void>();
  private readonly resolver: IStoragePathResolver;
  private readonly debounceMs: number;
  private readonly workspaceId: string | undefined;
  private readonly warn: (msg: string) => void;

  private watchers: fs.FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private rootCache: string | undefined;

  readonly onDidChange: Event<void> = this.emitter.event;

  constructor(opts: LocalFileSourceOptions) {
    this.resolver = opts.resolver;
    this.debounceMs = opts.debounceMs ?? 500;
    this.workspaceId = opts.workspaceId;
    this.warn = opts.warn ?? (() => undefined);
  }

  async start(): Promise<void> {
    const root = await this.getRoot();
    await this.setupWatchers(root);
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
    this.watchers = [];
    this.emitter.dispose();
  }

  async loadRawSessions(): Promise<RawSessionFile[]> {
    const root = await this.getRoot();
    const workspaceDirs = await this.listWorkspaceDirs(root);

    const out: RawSessionFile[] = [];
    for (const workspaceId of workspaceDirs) {
      const sessionsDir = path.join(root, workspaceId, 'chatSessions');
      let files: string[];
      try {
        files = await fsp.readdir(sessionsDir);
      } catch {
        continue; // 该工作区无 chatSessions 目录
      }
      for (const file of files) {
        const isJsonl = file.endsWith('.jsonl');
        const isJson = file.endsWith('.json');
        if (!isJsonl && !isJson) {
          continue;
        }
        const filePath = path.join(sessionsDir, file);
        const sessionId = path.basename(file, isJsonl ? '.jsonl' : '.json');
        try {
          const text = await fsp.readFile(filePath, 'utf8');
          // .jsonl 为 append-only 日志，需回放重建快照；.json 直接解析（向后兼容）。
          const raw = isJsonl ? replayJsonl(text) : JSON.parse(text);
          // 文件名即 sessionId，回放结果可能缺该字段，补齐以便解析器识别。
          if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).sessionId === undefined) {
            (raw as Record<string, unknown>).sessionId = sessionId;
          }
          out.push({
            workspaceId,
            sessionId,
            filePath,
            raw,
          });
        } catch (err) {
          // 单文件读取/解析失败不影响其它文件（容错）。
          this.warn(`Failed to read session file "${filePath}": ${String(err)}`);
        }
      }
    }
    return out;
  }

  private async getRoot(): Promise<string> {
    if (!this.rootCache) {
      this.rootCache = await this.resolver.resolveWorkspaceStorageRoot();
    }
    return this.rootCache;
  }

  /** 返回要处理的工作区目录列表：限定到当前工作区，或（未限定时）全部。 */
  private async listWorkspaceDirs(root: string): Promise<string[]> {
    if (this.workspaceId) {
      return [this.workspaceId];
    }
    try {
      return await fsp.readdir(root);
    } catch (err) {
      this.warn(`Cannot read workspaceStorage root "${root}": ${String(err)}`);
      return [];
    }
  }

  private async setupWatchers(root: string): Promise<void> {
    const workspaceDirs = await this.listWorkspaceDirs(root);
    for (const workspaceId of workspaceDirs) {
      const sessionsDir = path.join(root, workspaceId, 'chatSessions');
      if (!fs.existsSync(sessionsDir)) {
        continue;
      }
      try {
        const watcher = fs.watch(sessionsDir, { persistent: false }, () => this.scheduleChange());
        this.watchers.push(watcher);
      } catch (err) {
        this.warn(`Failed to watch "${sessionsDir}": ${String(err)}`);
      }
    }
  }

  private scheduleChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.emitter.fire();
    }, this.debounceMs);
  }
}
