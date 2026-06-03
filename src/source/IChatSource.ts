// M1 数据源层接口。
// 设计依据：detailed-design §4.1。M4 只依赖该接口，不关心 local/participant。

import { Event } from '../util/event';

/** 一个原始会话文件 */
export interface RawSessionFile {
  workspaceId: string;
  sessionId: string;
  filePath: string;
  /** 原始 JSON 对象（未解析为领域模型） */
  raw: unknown;
}

export interface IChatSource {
  /** 启动：建立监听等 */
  start(): Promise<void>;
  /** 停止：释放 watcher 等资源 */
  dispose(): void;
  /** 拉取所有原始会话（已定位文件并读出 JSON 对象） */
  loadRawSessions(): Promise<RawSessionFile[]>;
  /** 数据变化事件（watcher 触发，已去抖） */
  readonly onDidChange: Event<void>;
}
