// M2 解析层接口与版本上下文。
// 设计依据：detailed-design §5.1。依赖 M3。

import { Session, SessionSummary } from '../model/types';

export interface ParseContext {
  workspaceId: string;
  filePath: string;
  /** 长对话字符阈值（来自设置 chatTimeline.longThreshold） */
  longThreshold?: number;
}

export interface ISessionParser {
  /** 能否解析该 version */
  canParse(version: number): boolean;
  /** 顶层 → 摘要（列表级，轻量） */
  parseSummary(raw: unknown, ctx: ParseContext): SessionSummary | null;
  /** 完整 → 领域模型（详情级） */
  parseSession(raw: unknown, ctx: ParseContext): Session | null;
}
