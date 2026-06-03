// M3 领域模型 Model —— 纯数据类型定义（公共契约）。
// 设计依据：detailed-design §2。本文件不依赖任何其他模块，也不含运行时逻辑。

/** 一轮问答的完成状态 */
export type TurnStatus = 'completed' | 'in-progress' | 'error';

/** 对话长度的粗略分级（需求 3.8-D） */
export type LengthBucket = 'short' | 'long';

/** 该轮引用/涉及的文件 */
export interface TurnFileRef {
  /** 显示用文件名，如 TestX.json */
  name: string;
  /** 完整路径（可能为 file:// uri 或 fsPath） */
  path: string;
}

/** 用量信息（best-effort，本地文件通常不含，见 §3.5） */
export interface TurnUsage {
  /** 是否为估算值 */
  estimated: boolean;
  tokens?: number;
  credits?: number;
}

/** 一轮问答（时间线上的一个节点） */
export interface Turn {
  /** 原始 requestId，全局唯一，作为节点 key */
  id: string;
  /** 在会话内的序号，从 1 开始（#1、#2…） */
  index: number;
  /** 用户提问全文 */
  prompt: string;
  /** 回复全文（已拼接为 Markdown 文本） */
  responseMarkdown: string;
  /** 提问摘要（前 N 字，UI 默认显示） */
  summary: string;
  /** 发生时间（epoch ms），可能为 undefined（旧格式无 timestamp） */
  timestamp?: number;
  /** 所用模型的展示名，如 claude-opus-4.8；无法识别时为 undefined */
  model?: string;
  /** 完成状态（增强信息 A） */
  status: TurnStatus;
  /** 出错时的错误信息（status==='error' 时有值） */
  errorMessage?: string;
  /** 是否包含代码块（增强信息 B） */
  hasCode: boolean;
  /** 涉及的文件（增强信息 C） */
  files: TurnFileRef[];
  /** 长度分级（增强信息 D） */
  length: LengthBucket;
  /** 提问 + 回复字符数（length 的计算依据，便于 UI 自定义阈值） */
  charCount: number;
  /** 工具调用次数（增强信息 E） */
  toolCallCount: number;
  /** 用量信息（尽力而为，需求 3.9）；解析不到则为 undefined */
  usage?: TurnUsage;
}

/** 一个会话 */
export interface Session {
  /** sessionId */
  id: string;
  /** 标题：优先 customTitle，否则取首轮提问摘要 */
  title: string;
  /** 该会话所属工作区目录名（workspaceId），用于跨工作区区分 */
  workspaceId: string;
  /** 创建时间 */
  creationDate?: number;
  /** 最后一条消息时间（用于"最近会话"排序） */
  lastMessageDate?: number;
  /** 所有轮次（已过滤无效轮，按时间升序） */
  turns: Turn[];
}

/** 会话的轻量摘要，用于顶部会话选择器（不含 turns，避免大数据） */
export interface SessionSummary {
  id: string;
  title: string;
  workspaceId: string;
  lastMessageDate?: number;
  turnCount: number;
}

/** 星标记录：以 turn.id 为键。序列化为 string[]。 */
export type StarSet = Set<string>;
