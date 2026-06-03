// M6 视图层：宿主侧 WebviewViewProvider。
// 设计依据：detailed-design §8、§11。加载 media 资源，设置 CSP（禁内联脚本，防注入），接入 M7 host。

import * as vscode from 'vscode';
import { HostMessageHandler } from '../messaging/host';
import { HostToView, Layout } from '../messaging/protocol';
import { ISessionManager } from '../session/SessionManager';
import { ISettings } from '../settings/Settings';

export class TimelineViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'chatTimeline.view';

  private view: vscode.WebviewView | undefined;
  private handler: HostMessageHandler | undefined;
  private updateSub: { dispose(): void } | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly manager: ISessionManager,
    private readonly settings: ISettings,
    private readonly setLayout: (layout: Layout) => Thenable<void>,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const webview = webviewView.webview;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist'), vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    this.handler = new HostMessageHandler({
      manager: this.manager,
      post: (msg) => this.post(msg),
      copyToClipboard: (text) => vscode.env.clipboard.writeText(text),
      getLayout: () => this.settings.layout,
      setLayout: (layout) => this.setLayout(layout),
      warn: (m) => console.warn('[chat-timeline]', m),
    });

    webview.onDidReceiveMessage((msg) => this.handler?.handle(msg));

    this.updateSub = this.manager.onDidUpdate(() => {
      this.handler?.sendSessions();
    });

    webview.html = this.getHtml(webview);
  }

  /** 当布局设置变更时，通知 Webview。 */
  notifyLayout(layout: Layout): void {
    this.post({ type: 'layout', layout });
  }

  dispose(): void {
    this.updateSub?.dispose();
  }

  private post(msg: HostToView): void {
    void this.view?.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'style.css'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Chat Timeline</title>
</head>
<body data-layout="detail">
  <div class="toolbar">
    <select id="session-select" title="Select session"></select>
    <button id="refresh-btn" class="icon-btn" title="Refresh">⟳</button>
    <button id="layout-btn" class="icon-btn wide" title="Toggle layout">Compact</button>
  </div>
  <div class="search-row">
    <input id="search-box" type="search" placeholder="Search in this session…" />
  </div>
  <div id="status-bar"></div>
  <div id="node-list"></div>
  <div id="detail-pane"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
