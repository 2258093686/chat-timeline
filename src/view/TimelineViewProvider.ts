import * as vscode from 'vscode';
import type { HostToView } from '../messaging/protocol';
import { isViewToHost } from '../messaging/protocol';
import type { SessionManager } from '../session/sessionManager';
import type { Settings } from '../settings/settings';

export class TimelineViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'chatTimeline.view';

  private view: vscode.WebviewView | undefined;
  private updateSub: vscode.Disposable | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private manager: SessionManager,
    private readonly settings: Settings
  ) {
    this.updateSub = this.manager.onDidUpdate(() => this.pushState());
  }

  /** Re-wire to a freshly recreated SessionManager (e.g. after a settings change). */
  rebind(manager: SessionManager): void {
    this.updateSub?.dispose();
    this.manager = manager;
    this.updateSub = this.manager.onDidUpdate(() => this.pushState());
    this.pushState();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'media')]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((raw) => this.onMessage(raw));
  }

  private post(message: HostToView): void {
    void this.view?.webview.postMessage(message);
  }

  reveal(): void {
    this.view?.show?.(true);
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (!isViewToHost(raw)) {
      return; // ignore malformed / unexpected messages
    }
    switch (raw.type) {
      case 'ready':
        this.post({ type: 'layout', layout: this.settings.layout });
        this.pushState();
        break;
      case 'refresh':
        this.post({ type: 'loading' });
        await this.manager.refresh();
        break;
      case 'selectSession': {
        await this.manager.selectSession(raw.sessionId);
        this.pushSession();
        break;
      }
      case 'search': {
        const turns = this.manager.search(raw.keyword);
        this.post({ type: 'searchResult', turnIds: turns.map((t) => t.id) });
        break;
      }
      case 'toggleStar':
        this.manager.toggleStar(raw.turnId);
        break;
      case 'copy': {
        const turn = this.manager
          .getCurrent()
          ?.turns.find((t) => t.id === raw.turnId);
        if (turn) {
          const text = raw.target === 'prompt' ? turn.prompt : turn.responseMarkdown;
          await vscode.env.clipboard.writeText(text);
          void vscode.window.setStatusBarMessage(
            `Chat Timeline: copied ${raw.target}`,
            1500
          );
        }
        break;
      }
      case 'setLayout':
        await this.settings.setLayout(raw.layout);
        this.post({ type: 'layout', layout: raw.layout });
        break;
      case 'selectTurn':
        // selection is handled entirely in the webview; no host action needed
        break;
    }
  }

  private pushState(): void {
    const sessions = this.manager.listSessions();
    if (sessions.length === 0) {
      this.post({ type: 'empty', reason: 'no-sessions' });
      return;
    }
    this.post({
      type: 'sessions',
      sessions,
      activeSessionId: this.manager.getCurrentId()
    });
    this.pushSession();
  }

  private pushSession(): void {
    const session = this.manager.getCurrent();
    if (session) {
      this.post({ type: 'session', session, stars: this.manager.stars() });
    }
  }

  toggleLayout(): void {
    const next = this.settings.layout === 'detail' ? 'compact' : 'detail';
    void this.settings.setLayout(next).then(() => {
      this.post({ type: 'layout', layout: next });
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'style.css')
    );
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Chat Timeline</title>
</head>
<body>
  <div id="app">
    <header id="toolbar">
      <select id="sessionSelect" title="Select session" aria-label="Select session"></select>
      <div id="searchWrap">
        <input id="search" type="text" placeholder="Search turns…" aria-label="Search turns" />
      </div>
      <button id="sortBtn" class="icon-btn" title="Toggle sort order">⇅</button>
      <button id="followBtn" class="icon-btn" title="Follow latest">📌</button>
      <button id="layoutBtn" class="icon-btn" title="Toggle layout">▭</button>
      <button id="refreshBtn" class="icon-btn" title="Refresh">⟳</button>
    </header>
    <div id="timeline" class="timeline" tabindex="0"></div>
    <div id="dragbar" title="Drag to resize"></div>
    <section id="detail" class="detail"></section>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
