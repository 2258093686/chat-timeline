// M1 子模块：chatSessions/<id>.jsonl append-only 日志回放。
// 现实格式（VS Code Copilot Chat）：每行一个事件：
//   { kind: 0, v: <snapshot> }            初始完整快照（含 requests 数组）
//   { kind: 1, k: <path[]>, v: <value> }  在路径处设值
//   { kind: 2, k: <path[]>, v: <array> }  向路径处的数组追加元素
// 路径 k 为分段数组（数字段为数组索引）；兼容旧版以空格分隔的字符串。
// 回放后的 state 与旧版 .json 快照同构，可直接交给 SessionParserV3。

type Json = Record<string, unknown>;

function isIndexToken(token: string | number): boolean {
  return typeof token === 'number' || /^\d+$/.test(token);
}

function toKey(token: string | number): string | number {
  return typeof token === 'number' ? token : /^\d+$/.test(token) ? Number(token) : token;
}

function normalizeKey(k: unknown): Array<string | number> {
  if (Array.isArray(k)) {
    return k as Array<string | number>;
  }
  if (typeof k === 'string') {
    return k.split(' ').filter((t) => t.length > 0);
  }
  return [];
}

/** 沿路径导航并按需创建中间容器，返回末段的 { parent, key }。 */
function resolveParent(
  root: Record<string | number, unknown>,
  tokens: Array<string | number>,
): { parent: Record<string | number, unknown>; key: string | number } {
  let cur = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const key = toKey(tokens[i]);
    if (cur[key] === undefined || cur[key] === null) {
      cur[key] = isIndexToken(tokens[i + 1]) ? [] : {};
    }
    cur = cur[key] as Record<string | number, unknown>;
  }
  return { parent: cur, key: toKey(tokens[tokens.length - 1]) };
}

/** 回放 .jsonl 文本，重建会话状态快照对象。损坏/半写入的行将被跳过。 */
export function replayJsonl(text: string): Json {
  let state: Record<string | number, unknown> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let evt: { kind?: number; k?: unknown; v?: unknown };
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (evt.kind === 0) {
      state = (evt.v as Record<string | number, unknown>) ?? {};
      continue;
    }
    const tokens = normalizeKey(evt.k);
    if (tokens.length === 0) {
      continue;
    }
    const { parent, key } = resolveParent(state, tokens);
    if (evt.kind === 1) {
      parent[key] = evt.v;
    } else if (evt.kind === 2) {
      if (!Array.isArray(parent[key])) {
        parent[key] = [];
      }
      const items = Array.isArray(evt.v) ? evt.v : [evt.v];
      (parent[key] as unknown[]).push(...items);
    }
  }
  return state as Json;
}
