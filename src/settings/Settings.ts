import * as vscode from 'vscode';

export type Source = 'local' | 'participant';

interface SettingsShape {
  source: Source;
  storagePath: string;
  refreshDebounceMs: number;
  relativeTime: boolean;
  longThreshold: number;
}

/** Thin wrapper over workspace configuration; hides VS Code API from other modules. */
export class Settings {
  private readonly _onDidChange = new vscode.EventEmitter<keyof SettingsShape>();
  readonly onDidChange = this._onDidChange.event;

  private readonly disposable: vscode.Disposable;

  constructor() {
    this.disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      const keys: (keyof SettingsShape)[] = [
        'source',
        'storagePath',
        'refreshDebounceMs',
        'relativeTime',
        'longThreshold'
      ];
      for (const key of keys) {
        if (e.affectsConfiguration(`chatTimeline.${key}`)) {
          this._onDidChange.fire(key);
        }
      }
    });
  }

  private cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('chatTimeline');
  }

  get source(): Source {
    return this.cfg().get<Source>('source', 'local');
  }

  get storagePath(): string {
    return this.cfg().get<string>('storagePath', '');
  }

  get refreshDebounceMs(): number {
    return this.cfg().get<number>('refreshDebounceMs', 500);
  }

  get relativeTime(): boolean {
    return this.cfg().get<boolean>('relativeTime', true);
  }

  get longThreshold(): number {
    return this.cfg().get<number>('longThreshold', 2000);
  }

  dispose(): void {
    this.disposable.dispose();
    this._onDidChange.dispose();
  }
}
