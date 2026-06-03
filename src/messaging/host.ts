// M7 通信层：宿主侧消息处理。
// 设计依据：detailed-design §9.2。校验消息合法性，路由到 SessionManager 等，回发 HostToView。

import { HostToView, Layout, ViewToHost, isViewToHost } from './protocol';
import { ISessionManager } from '../session/SessionManager';

export interface HostHandlerDeps {
  manager: ISessionManager;
  /** 发送消息到 Webview */
  post: (msg: HostToView) => void;
  /** 写剪贴板（注入以便测试） */
  copyToClipboard: (text: string) => unknown;
  /** 读取/设置布局 */
  getLayout: () => Layout;
  setLayout: (layout: Layout) => unknown;
  warn?: (msg: string) => void;
}

export class HostMessageHandler {
  constructor(private readonly deps: HostHandlerDeps) {}

  /** 处理一条来自 Webview 的原始消息。非法消息被静默丢弃（仅告警）。 */
  async handle(raw: unknown): Promise<void> {
    if (!isViewToHost(raw)) {
      this.deps.warn?.(`Dropped invalid message from webview: ${safeStringify(raw)}`);
      return;
    }
    const msg: ViewToHost = raw;
    try {
      await this.route(msg);
    } catch (err) {
      this.deps.warn?.(`Error handling ${msg.type}: ${String(err)}`);
      this.deps.post({ type: 'error', message: String(err) });
    }
  }

  private async route(msg: ViewToHost): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.sendSessions();
        this.deps.post({ type: 'layout', layout: this.deps.getLayout() });
        return;
      case 'refresh':
        await this.reloadAndSend();
        return;
      case 'selectSession': {
        const session = await this.deps.manager.selectSession(msg.sessionId);
        if (session) {
          this.deps.post({ type: 'session', session, stars: this.starsFor(session.turns.map((t) => t.id)) });
        } else {
          this.deps.post({ type: 'error', message: `Session not found: ${msg.sessionId}` });
        }
        return;
      }
      case 'selectTurn':
        // 详情区渲染由 Webview 本地完成（会话详情已一次性下发）；宿主无需额外处理。
        return;
      case 'search': {
        const turns = this.deps.manager.search(msg.keyword);
        this.deps.post({ type: 'searchResult', turnIds: turns.map((t) => t.id) });
        return;
      }
      case 'toggleStar':
        this.deps.manager.toggleStar(msg.turnId);
        return;
      case 'copy': {
        const text = this.resolveCopyText(msg.target, msg.turnId);
        if (text !== undefined) {
          await this.deps.copyToClipboard(text);
        }
        return;
      }
      case 'setLayout':
        await this.deps.setLayout(msg.layout);
        this.deps.post({ type: 'layout', layout: msg.layout });
        return;
      default: {
        const _exhaustive: never = msg;
        void _exhaustive;
        return;
      }
    }
  }

  sendSessions(): void {
    this.deps.post({
      type: 'sessions',
      sessions: this.deps.manager.listSessions(),
      failures: this.deps.manager.getParseFailureCount(),
    });
  }

  private async reloadAndSend(): Promise<void> {
    this.sendSessions();
    const current = this.deps.manager.getCurrent();
    if (current) {
      this.deps.post({ type: 'session', session: current, stars: this.starsFor(current.turns.map((t) => t.id)) });
    }
  }

  private starsFor(turnIds: string[]): string[] {
    return turnIds.filter((id) => this.deps.manager.isStarred(id));
  }

  private resolveCopyText(target: 'prompt' | 'response', turnId: string): string | undefined {
    const current = this.deps.manager.getCurrent();
    const turn = current?.turns.find((t) => t.id === turnId);
    if (!turn) {
      return undefined;
    }
    return target === 'prompt' ? turn.prompt : turn.responseMarkdown;
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
