// M7 通信层：宿主 ↔ Webview 共享协议。
// 设计依据：detailed-design §9.1。所有消息为可序列化纯对象。

import { Session, SessionSummary } from '../model/types';

export type Layout = 'detail' | 'compact';

/** Webview → 宿主 */
export type ViewToHost =
  | { type: 'ready' }
  | { type: 'selectSession'; sessionId: string }
  | { type: 'selectTurn'; turnId: string }
  | { type: 'search'; keyword: string }
  | { type: 'toggleStar'; turnId: string }
  | { type: 'copy'; target: 'prompt' | 'response'; turnId: string }
  | { type: 'refresh' }
  | { type: 'setLayout'; layout: Layout };

/** 宿主 → Webview */
export type HostToView =
  | { type: 'sessions'; sessions: SessionSummary[]; failures: number }
  | { type: 'session'; session: Session; stars: string[] }
  | { type: 'searchResult'; turnIds: string[] }
  | { type: 'layout'; layout: Layout }
  | { type: 'error'; message: string };

export type ViewToHostType = ViewToHost['type'];
export type HostToViewType = HostToView['type'];

const VIEW_TO_HOST_TYPES: ViewToHostType[] = [
  'ready',
  'selectSession',
  'selectTurn',
  'search',
  'toggleStar',
  'copy',
  'refresh',
  'setLayout',
];

/** 校验来自 Webview 的消息是否为合法 ViewToHost（防意外/恶意消息）。 */
export function isViewToHost(msg: unknown): msg is ViewToHost {
  if (typeof msg !== 'object' || msg === null) {
    return false;
  }
  const m = msg as Record<string, unknown>;
  const type = m.type;
  if (typeof type !== 'string' || !VIEW_TO_HOST_TYPES.includes(type as ViewToHostType)) {
    return false;
  }
  switch (type) {
    case 'ready':
    case 'refresh':
      return true;
    case 'selectSession':
      return typeof m.sessionId === 'string';
    case 'selectTurn':
    case 'toggleStar':
      return typeof m.turnId === 'string';
    case 'search':
      return typeof m.keyword === 'string';
    case 'copy':
      return (m.target === 'prompt' || m.target === 'response') && typeof m.turnId === 'string';
    case 'setLayout':
      return m.layout === 'detail' || m.layout === 'compact';
    default:
      return false;
  }
}
