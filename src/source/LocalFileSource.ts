import * as fs from 'fs/promises';
import * as fssync from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { IChatSource, RawSessionFile } from './IChatSource';
import type { IStoragePathResolver } from './storagePathResolver';

/**
 * Data source A (default): reads & watches local Copilot Chat session files
 * under `<workspaceStorage>/<workspaceId>/chatSessions/<sessionId>.json`.
 */
export class LocalFileSource implements IChatSource {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private watchers: fssync.FSWatcher[] = [];
  private debounceTimer: NodeJS.Timeout | undefined;
  private rootWatcher: fssync.FSWatcher | undefined;

  constructor(
    private readonly resolver: IStoragePathResolver,
    private readonly debounceMs: number
  ) {}

  async start(): Promise<void> {
    await this.setupWatchers();
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.teardownWatchers();
    this.rootWatcher?.close();
    this.rootWatcher = undefined;
    this._onDidChange.dispose();
  }

  async loadRawSessions(): Promise<RawSessionFile[]> {
    const root = await this.resolver.resolveWorkspaceStorageRoot();
    const result: RawSessionFile[] = [];

    let workspaceDirs: string[] = [];
    try {
      workspaceDirs = await fs.readdir(root);
    } catch {
      return result;
    }

    for (const workspaceId of workspaceDirs) {
      const chatDir = path.join(root, workspaceId, 'chatSessions');
      let files: string[];
      try {
        files = await fs.readdir(chatDir);
      } catch {
        continue; // workspace without chatSessions
      }
      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }
        const filePath = path.join(chatDir, file);
        try {
          const text = await fs.readFile(filePath, 'utf8');
          const raw = JSON.parse(text) as unknown;
          result.push({
            workspaceId,
            sessionId: path.basename(file, '.json'),
            filePath,
            raw
          });
        } catch {
          // Skip unreadable / invalid-JSON files; never throw (fault tolerance).
        }
      }
    }
    return result;
  }

  private async setupWatchers(): Promise<void> {
    this.teardownWatchers();
    let root: string;
    try {
      root = await this.resolver.resolveWorkspaceStorageRoot();
    } catch {
      return; // nothing to watch yet; refresh will surface the error
    }

    let workspaceDirs: string[] = [];
    try {
      workspaceDirs = await fs.readdir(root);
    } catch {
      return;
    }

    // Watch the root so newly created workspaces are picked up.
    try {
      this.rootWatcher = fssync.watch(root, { persistent: false }, () => {
        this.scheduleChange();
        // Re-arm watchers since a new workspace may have appeared.
        void this.rearm();
      });
    } catch {
      /* ignore */
    }

    for (const workspaceId of workspaceDirs) {
      const chatDir = path.join(root, workspaceId, 'chatSessions');
      try {
        if (!fssync.existsSync(chatDir)) {
          continue;
        }
        const w = fssync.watch(chatDir, { persistent: false }, () => this.scheduleChange());
        this.watchers.push(w);
      } catch {
        /* ignore individual watch failures */
      }
    }
  }

  private rearmTimer: NodeJS.Timeout | undefined;
  private async rearm(): Promise<void> {
    if (this.rearmTimer) {
      return;
    }
    this.rearmTimer = setTimeout(() => {
      this.rearmTimer = undefined;
      void this.setupWatchers();
    }, Math.max(1000, this.debounceMs));
  }

  private teardownWatchers(): void {
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers = [];
  }

  private scheduleChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this._onDidChange.fire();
    }, this.debounceMs);
  }
}
