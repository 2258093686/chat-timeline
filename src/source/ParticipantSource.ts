// M1 数据源 B：@timeline 聊天入口（后期）。
// 设计依据：detailed-design §4.4。MVP 仅留接口与占位，实现同一 IChatSource 契约。

import { Emitter, Event } from '../util/event';
import { IChatSource, RawSessionFile } from './IChatSource';

export class ParticipantSource implements IChatSource {
  private readonly emitter = new Emitter<void>();
  readonly onDidChange: Event<void> = this.emitter.event;

  async start(): Promise<void> {
    // 占位：后期用官方 Chat Participant API 注册 @timeline 并记录每轮。
  }

  dispose(): void {
    this.emitter.dispose();
  }

  async loadRawSessions(): Promise<RawSessionFile[]> {
    // 占位：尚未实现，返回空集合（优雅降级）。
    return [];
  }
}
