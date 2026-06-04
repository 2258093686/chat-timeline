import * as vscode from 'vscode';
import type { HostToView } from '../messaging/protocol';
import { isViewToHost } from '../messaging/protocol';
import type { SessionManager } from '../session/sessionManager';

export class TimelineViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'chatTimeline.view';

  private view: vscode.WebviewView | undefined;
  private updateSub: vscode.Disposable | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private manager: SessionManager
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
        if (raw.scope === 'global') {
          const hits = this.manager.searchGlobal(raw.keyword, raw.target);
          this.post({ type: 'globalSearchResult', hits });
        } else {
          const turns = this.manager.search(raw.keyword, raw.target);
          this.post({ type: 'searchResult', turnIds: turns.map((t) => t.id) });
        }
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
      <div class="search-row">
        <div id="searchWrap">
          <div class="menu-wrap">
            <button id="scopeBtn" class="icon-btn scope-trigger" title="Match scope" aria-haspopup="true" aria-expanded="false">≡</button>
            <div id="scopeMenu" class="menu hidden" role="menu">
              <div class="menu-title">Match scope</div>
              <button id="targetBoth" class="menu-item" role="menuitemradio" type="button" data-target="both">
                <span class="menu-check"></span><span class="menu-icon">≡</span><span class="menu-label">Question &amp; answer</span>
              </button>
              <button id="targetPrompt" class="menu-item" role="menuitemradio" type="button" data-target="prompt">
                <span class="menu-check"></span><span class="menu-icon">Q</span><span class="menu-label">Question only</span>
              </button>
              <button id="targetResponse" class="menu-item" role="menuitemradio" type="button" data-target="response">
                <span class="menu-check"></span><span class="menu-icon">A</span><span class="menu-label">Answer only</span>
              </button>
            </div>
          </div>
          <input id="search" type="text" placeholder="Search turns…" aria-label="Search turns" />
          <button id="searchBtn" class="search-go" title="Search" aria-label="Search"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"><path fill="currentColor" d="M11.74 10.85a6 6 0 1 0-.9.9l3.2 3.2a.64.64 0 0 0 .9-.9l-3.2-3.2ZM7 11.7a4.7 4.7 0 1 1 0-9.4 4.7 4.7 0 0 1 0 9.4Z"/></svg></button>
          <button id="clearBtn" class="clear-btn" title="Clear" aria-label="Clear search">✕</button>
        </div>
        <div class="btn-group">
        <div class="menu-wrap">
          <button id="moreBtn" class="icon-btn" title="More settings" aria-haspopup="true" aria-expanded="false">⚙</button>
          <div id="moreMenu" class="menu hidden" role="menu">
            <button id="scopeItem" class="menu-item" role="menuitemcheckbox" type="button">
              <span class="menu-check"></span><span class="menu-icon">🌐</span><span class="menu-label">Global search</span>
            </button>
            <button id="followItem" class="menu-item" role="menuitemcheckbox" type="button">
              <span class="menu-check"></span><span class="menu-icon">📌</span><span class="menu-label">Follow active chat</span>
            </button>
            <button id="starItem" class="menu-item" role="menuitemcheckbox" type="button">
              <span class="menu-check"></span><span class="menu-icon">★</span><span class="menu-label">Starred only</span>
            </button>
          </div>
        </div>
        </div>
      </div>
      <div class="session-row">
        <select id="sessionSelect" title="Select session" aria-label="Select session"></select>
        <div class="btn-group">
          <button id="sortBtn" class="icon-btn" title="Sort: newest first">↓</button>
        </div>
      </div>
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
