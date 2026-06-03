// M2 解析层：version 3 解析器。
// 设计依据：detailed-design §3、§5.2、§5.3。全字段安全访问，任何缺失/类型不符均降级不抛异常。

import {
  Session,
  SessionSummary,
  Turn,
  TurnFileRef,
  TurnStatus,
  LengthBucket,
} from '../../model/types';
import { ISessionParser, ParseContext } from '../ISessionParser';

const DEFAULT_LONG_THRESHOLD = 2000;
const SUMMARY_LEN = 60;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** 去掉常见前缀，把 modelId 映射成展示名。 */
function mapModel(modelId: unknown): string | undefined {
  const id = asString(modelId);
  if (!id) {
    return undefined;
  }
  const slash = id.lastIndexOf('/');
  const name = slash >= 0 ? id.slice(slash + 1) : id;
  return name || undefined;
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/** 从一条 request 的 message 中取提问全文。 */
function extractPrompt(message: unknown): string {
  if (isObject(message)) {
    const text = asString(message.text);
    if (text !== undefined) {
      return text;
    }
    // 退而求其次：拼接 parts 里的文本。
    const parts = asArray(message.parts);
    const collected = parts
      .map((p) => (isObject(p) ? asString(p.text) : undefined))
      .filter((s): s is string => !!s);
    if (collected.length) {
      return collected.join('');
    }
  }
  return asString(message) ?? '';
}

/** 拼接 response[] 为 Markdown，并顺带收集文件引用、是否含代码。 */
function extractResponse(response: unknown): {
  markdown: string;
  files: TurnFileRef[];
  hasFencedCode: boolean;
} {
  const items = asArray(response);
  const parts: string[] = [];
  const files: TurnFileRef[] = [];
  const seen = new Set<string>();

  const addFile = (path: string | undefined) => {
    if (!path) {
      return;
    }
    if (seen.has(path)) {
      return;
    }
    seen.add(path);
    files.push({ name: basename(path), path });
  };

  for (const item of items) {
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    if (!isObject(item)) {
      continue;
    }
    const kind = asString(item.kind);
    // 无 kind 但含 value，或 kind === 'markdown'：当作正文片段。
    if (kind === undefined || kind === 'markdown') {
      const value = item.value;
      if (typeof value === 'string') {
        parts.push(value);
      } else if (isObject(value) && typeof value.value === 'string') {
        // markdown 片段有时形如 { value: { value: '...' } }
        parts.push(value.value);
      }
      continue;
    }
    if (kind === 'inlineReference') {
      const ref = item.inlineReference ?? item.reference ?? item;
      if (isObject(ref)) {
        addFile(asString(ref.fsPath) ?? asString(ref.path));
        const uri = ref.uri;
        if (isObject(uri)) {
          addFile(asString(uri.fsPath) ?? asString(uri.path));
        }
      }
      continue;
    }
    // 其它已知/未知 kind（toolInvocationSerialized / progressTaskSerialized / 未知）→ 可忽略。
  }

  const markdown = parts.join('');
  const hasFencedCode = /```/.test(markdown);
  return { markdown, files, hasFencedCode };
}

function extractContentReferenceFiles(raw: unknown): TurnFileRef[] {
  const refs = isObject(raw) ? asArray(raw.contentReferences) : [];
  const out: TurnFileRef[] = [];
  for (const r of refs) {
    if (!isObject(r)) {
      continue;
    }
    const ref = r.reference;
    let path: string | undefined;
    if (isObject(ref)) {
      path = asString(ref.fsPath) ?? asString(ref.path);
      const uri = ref.uri;
      if (!path && isObject(uri)) {
        path = asString(uri.fsPath) ?? asString(uri.path);
      }
    } else if (typeof ref === 'string') {
      path = ref;
    }
    if (path) {
      out.push({ name: basename(path), path });
    }
  }
  return out;
}

function determineStatus(request: Record<string, unknown>): { status: TurnStatus; errorMessage?: string } {
  const result = request.result;
  if (isObject(result)) {
    const err = result.errorDetails;
    if (isObject(err)) {
      return { status: 'error', errorMessage: asString(err.message) ?? 'Error' };
    }
  }
  if (request.isCanceled === true) {
    return { status: 'in-progress' };
  }
  return { status: 'completed' };
}

function countToolCalls(request: Record<string, unknown>): number {
  const result = request.result;
  if (!isObject(result)) {
    return 0;
  }
  const metadata = result.metadata;
  if (!isObject(metadata)) {
    return 0;
  }
  const rounds = asArray(metadata.toolCallRounds);
  let count = 0;
  for (const round of rounds) {
    if (isObject(round)) {
      count += asArray(round.toolCalls).length;
    }
  }
  return count;
}

function hasCodeBlocks(request: Record<string, unknown>): boolean {
  const result = request.result;
  if (isObject(result)) {
    const metadata = result.metadata;
    if (isObject(metadata) && asArray(metadata.codeBlocks).length > 0) {
      return true;
    }
  }
  return false;
}

function makeSummary(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > SUMMARY_LEN ? oneLine.slice(0, SUMMARY_LEN) + '…' : oneLine;
}

function mergeFiles(a: TurnFileRef[], b: TurnFileRef[]): TurnFileRef[] {
  const out: TurnFileRef[] = [];
  const seen = new Set<string>();
  for (const f of [...a, ...b]) {
    if (!seen.has(f.path)) {
      seen.add(f.path);
      out.push(f);
    }
  }
  return out;
}

/** 判断一轮是否为"有效轮"：有提问文本，或有任何响应内容。 */
function isValidTurn(prompt: string, responseMarkdown: string): boolean {
  return prompt.trim().length > 0 || responseMarkdown.trim().length > 0;
}

export class SessionParserV3 implements ISessionParser {
  canParse(version: number): boolean {
    return version === 3;
  }

  parseSummary(raw: unknown, ctx: ParseContext): SessionSummary | null {
    if (!isObject(raw)) {
      return null;
    }
    const id = asString(raw.sessionId) ?? '';
    if (!id) {
      return null;
    }
    const requests = asArray(raw.requests);
    // 列表级：粗略统计有效轮数（轻量，不完整解析 response）。
    let turnCount = 0;
    for (const req of requests) {
      if (!isObject(req)) {
        continue;
      }
      const prompt = extractPrompt(req.message);
      const hasResponse = asArray(req.response).length > 0;
      if (prompt.trim().length > 0 || hasResponse) {
        turnCount++;
      }
    }
    const title = this.resolveTitle(raw, requests);
    return {
      id,
      title,
      workspaceId: ctx.workspaceId,
      lastMessageDate: asNumber(raw.lastMessageDate),
      turnCount,
    };
  }

  parseSession(raw: unknown, ctx: ParseContext): Session | null {
    if (!isObject(raw)) {
      return null;
    }
    const id = asString(raw.sessionId) ?? '';
    if (!id) {
      return null;
    }
    const longThreshold = ctx.longThreshold ?? DEFAULT_LONG_THRESHOLD;
    const lastMessageDate = asNumber(raw.lastMessageDate);
    const requests = asArray(raw.requests);
    const turns: Turn[] = [];
    let index = 0;

    for (const req of requests) {
      try {
        if (!isObject(req)) {
          continue;
        }
        const turn = this.parseTurn(req, index + 1, lastMessageDate, longThreshold);
        if (turn) {
          index++;
          turns.push(turn);
        }
      } catch {
        // 单轮失败：跳过，不影响其它轮（§5.3）。
        continue;
      }
    }

    // 按时间升序排序（缺失时间的保持原序，置后）。
    turns.sort((a, b) => (a.timestamp ?? Number.MAX_SAFE_INTEGER) - (b.timestamp ?? Number.MAX_SAFE_INTEGER));
    // 排序后重排序号。
    turns.forEach((t, i) => (t.index = i + 1));

    return {
      id,
      title: this.resolveTitle(raw, requests),
      workspaceId: ctx.workspaceId,
      creationDate: asNumber(raw.creationDate),
      lastMessageDate,
      turns,
    };
  }

  private parseTurn(
    req: Record<string, unknown>,
    fallbackIndex: number,
    sessionLastMessageDate: number | undefined,
    longThreshold: number,
  ): Turn | null {
    const prompt = extractPrompt(req.message);
    const { markdown, files: respFiles, hasFencedCode } = extractResponse(req.response);

    if (!isValidTurn(prompt, markdown)) {
      return null;
    }

    const { status, errorMessage } = determineStatus(req);
    const hasCode = hasCodeBlocks(req) || hasFencedCode;
    const files = mergeFiles(respFiles, extractContentReferenceFiles(req));
    const charCount = prompt.length + markdown.length;
    const length: LengthBucket = charCount > longThreshold ? 'long' : 'short';
    const timestamp = asNumber(req.timestamp) ?? sessionLastMessageDate;
    const id = asString(req.requestId) ?? `turn-${fallbackIndex}`;

    return {
      id,
      index: fallbackIndex,
      prompt,
      responseMarkdown: markdown,
      summary: makeSummary(prompt),
      timestamp,
      model: mapModel(req.modelId),
      status,
      errorMessage,
      hasCode,
      files,
      length,
      charCount,
      toolCallCount: countToolCalls(req),
      usage: undefined, // best-effort：本地文件无 token/credits 字段（§3.5）。
    };
  }

  private resolveTitle(raw: Record<string, unknown>, requests: unknown[]): string {
    const custom = asString(raw.customTitle);
    if (custom && custom.trim()) {
      return custom.trim();
    }
    for (const req of requests) {
      if (isObject(req)) {
        const prompt = extractPrompt(req.message);
        if (prompt.trim()) {
          return makeSummary(prompt);
        }
      }
    }
    return '(untitled)';
  }
}
