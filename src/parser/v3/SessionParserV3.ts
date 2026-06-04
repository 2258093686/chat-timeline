import type {
  LengthBucket,
  Session,
  SessionSummary,
  Turn,
  TurnFileRef,
  TurnImage,
  TurnStatus
} from '../../model/types';
import type { ISessionParser, ParseContext } from '../ISessionParser';

const SUMMARY_LEN = 80;
const DEFAULT_LONG_THRESHOLD = 2000;

// ---- safe accessors -------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Strip provider prefixes from a modelId -> display name. */
function modelDisplayName(modelId: unknown): string | undefined {
  const id = str(modelId);
  if (!id) {
    return undefined;
  }
  const slash = id.lastIndexOf('/');
  const name = slash >= 0 ? id.slice(slash + 1) : id;
  return name.trim() || undefined;
}

/** Extract text from a single response segment (handles several shapes). */
function segmentText(seg: unknown): string {
  if (typeof seg === 'string') {
    return seg;
  }
  if (!isObj(seg)) {
    return '';
  }
  const kind = str(seg.kind);
  // Only text-bearing segments contribute to the rendered markdown.
  if (kind && kind !== 'markdown') {
    return '';
  }
  const value = seg.value;
  if (typeof value === 'string') {
    return value;
  }
  // MarkdownString shape: { value: { value: "..." } }
  if (isObj(value) && typeof value.value === 'string') {
    return value.value;
  }
  return '';
}

/**
 * Clean up reconstructed response markdown.
 *
 * When the assistant edits code via tools, the streamed response keeps the
 * surrounding code-fence markers (``` ... ```) as text segments, but the
 * actual code lives in non-text segments that we drop. The leftover fences
 * concatenate into empty code blocks that render as blank boxes. Remove those
 * empty fenced blocks and collapse the excess blank lines they leave behind.
 */
function cleanResponseMarkdown(md: string): string {
  if (!md) {
    return md;
  }
  // Drop fenced code blocks whose body is only whitespace.
  let out = md.replace(/```[^\n]*\n\s*```/g, '');
  // Collapse 3+ consecutive newlines into a single blank line.
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

/** Kinds that represent an executed/prepared tool call (a "process" step). */
const TOOL_KINDS = new Set(['toolInvocationSerialized', 'prepareToolInvocation']);

/**
 * Split a response into its intermediate "process" narration (text between
 * tool calls) and the final answer (text after the last tool call).
 *
 * The full concatenation is returned as `full` for search/preview, while the
 * detail pane can show `process` collapsed and `answer` expanded.
 */
function splitResponseParts(response: unknown[]): {
  full: string;
  process?: string;
  answer: string;
} {
  let lastToolIdx = -1;
  for (let i = 0; i < response.length; i++) {
    const seg = response[i];
    const kind = isObj(seg) ? str(seg.kind) : undefined;
    if (kind && TOOL_KINDS.has(kind)) {
      lastToolIdx = i;
    }
  }

  let processRaw = '';
  let answerRaw = '';
  for (let i = 0; i < response.length; i++) {
    const text = segmentText(response[i]);
    if (i <= lastToolIdx) {
      processRaw += text;
    } else {
      answerRaw += text;
    }
  }

  const full = cleanResponseMarkdown(processRaw + answerRaw);
  let process = cleanResponseMarkdown(processRaw);
  let answer = cleanResponseMarkdown(answerRaw);

  // If nothing remains after the last tool call, fall back to showing the
  // whole thing as the answer (don't hide everything behind the collapse).
  if (!answer) {
    answer = process;
    process = '';
  }

  return { full, process: process || undefined, answer };
}

/** Collect file refs from response inlineReference + contentReferences. */
function collectFiles(response: unknown[], contentRefs: unknown[]): TurnFileRef[] {
  const byPath = new Map<string, TurnFileRef>();

  const addUri = (uri: unknown, fallbackName?: string): void => {
    if (!isObj(uri)) {
      return;
    }
    const fsPath = str(uri.fsPath) ?? str(uri.path) ?? str(uri.external);
    if (!fsPath) {
      return;
    }
    const name = fallbackName ?? fsPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? fsPath;
    if (!byPath.has(fsPath)) {
      byPath.set(fsPath, { name, path: fsPath });
    }
  };

  for (const seg of response) {
    if (!isObj(seg)) {
      continue;
    }
    if (seg.kind === 'inlineReference' && isObj(seg.inlineReference)) {
      const ref = seg.inlineReference;
      const loc = isObj(ref.location) ? ref.location : undefined;
      const uri = loc && isObj(loc.uri) ? loc.uri : ref.uri;
      addUri(uri, str(ref.name));
    }
  }

  for (const ref of contentRefs) {
    if (!isObj(ref)) {
      continue;
    }
    const reference = ref.reference;
    if (isObj(reference) && (reference.fsPath || reference.path)) {
      addUri(reference);
    } else if (isObj(ref.value)) {
      addUri(ref.value);
    }
  }

  return Array.from(byPath.values());
}

/**
 * Collect images the user attached to the prompt. They live in
 * `request.variableData.variables[]` as `{ kind:'image', mimeType,
 * value:{ $base64 } }`. We turn each into a ready-to-render data URI.
 */
function collectImages(variableData: unknown): TurnImage[] {
  const images: TurnImage[] = [];
  if (!isObj(variableData)) {
    return images;
  }
  for (const v of arr(variableData.variables)) {
    if (!isObj(v) || v.kind !== 'image') {
      continue;
    }
    const mimeType = str(v.mimeType) ?? 'image/png';
    const value = v.value;
    const base64 = isObj(value) ? str(value.$base64) : undefined;
    if (!base64) {
      continue;
    }
    images.push({
      mimeType,
      dataUri: `data:${mimeType};base64,${base64}`,
      name: str(v.name)
    });
  }
  return images;
}

function countToolCalls(metadata: unknown): number {
  if (!isObj(metadata)) {
    return 0;
  }
  let count = 0;
  for (const round of arr(metadata.toolCallRounds)) {
    if (isObj(round)) {
      count += arr(round.toolCalls).length;
    }
  }
  return count;
}

function hasCodeBlocks(metadata: unknown, responseMarkdown: string): boolean {
  if (isObj(metadata) && arr(metadata.codeBlocks).length > 0) {
    return true;
  }
  return /```/.test(responseMarkdown);
}

function deriveStatus(request: Record<string, unknown>): {
  status: TurnStatus;
  errorMessage?: string;
} {
  const result = isObj(request.result) ? request.result : undefined;
  const errorDetails = result && isObj(result.errorDetails) ? result.errorDetails : undefined;
  if (errorDetails) {
    return { status: 'error', errorMessage: str(errorDetails.message) ?? 'Error' };
  }
  if (request.isCanceled === true) {
    return { status: 'in-progress' };
  }
  return { status: 'completed' };
}

// ---- parser ---------------------------------------------------------------

export class SessionParserV3 implements ISessionParser {
  constructor(private readonly longThreshold: number = DEFAULT_LONG_THRESHOLD) {}

  canParse(version: number): boolean {
    return version === 3;
  }

  parseSummary(raw: unknown, ctx: ParseContext): SessionSummary | null {
    if (!isObj(raw)) {
      return null;
    }
    const requests = arr(raw.requests);
    const validCount = requests.filter((r) => this.isValidRequest(r)).length;
    if (validCount === 0) {
      return null; // empty session — filtered out
    }
    const title = this.deriveTitle(raw, requests);
    return {
      id: str(raw.sessionId) ?? ctx.filePath,
      title,
      workspaceId: ctx.workspaceId,
      lastMessageDate: this.deriveLastMessageDate(raw, requests),
      turnCount: validCount
    };
  }

  parseSession(raw: unknown, ctx: ParseContext): Session | null {
    if (!isObj(raw)) {
      return null;
    }
    const requests = arr(raw.requests);
    const turns: Turn[] = [];
    let index = 0;
    for (const req of requests) {
      if (!this.isValidRequest(req)) {
        continue;
      }
      try {
        const turn = this.parseTurn(req as Record<string, unknown>, index + 1, num(raw.lastMessageDate));
        turns.push(turn);
        index++;
      } catch {
        // Skip an individual broken request without failing the whole session.
      }
    }

    turns.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    turns.forEach((t, i) => (t.index = i + 1));

    return {
      id: str(raw.sessionId) ?? ctx.filePath,
      title: this.deriveTitle(raw, requests),
      workspaceId: ctx.workspaceId,
      creationDate: num(raw.creationDate),
      lastMessageDate: this.deriveLastMessageDate(raw, requests),
      turns
    };
  }

  private isValidRequest(req: unknown): boolean {
    if (!isObj(req)) {
      return false;
    }
    const message = isObj(req.message) ? req.message : undefined;
    const text = message ? str(message.text) : undefined;
    return !!text && text.trim().length > 0;
  }

  private deriveLastMessageDate(
    raw: Record<string, unknown>,
    requests: unknown[]
  ): number | undefined {
    const top = num(raw.lastMessageDate);
    if (top !== undefined) {
      return top;
    }
    // Newer `.jsonl` snapshots may omit the top-level lastMessageDate; fall
    // back to the latest request timestamp so recent-first ordering still works.
    let latest: number | undefined;
    for (const req of requests) {
      if (!isObj(req)) {
        continue;
      }
      const ts = num(req.timestamp);
      if (ts !== undefined && (latest === undefined || ts > latest)) {
        latest = ts;
      }
    }
    return latest;
  }

  private deriveTitle(raw: Record<string, unknown>, requests: unknown[]): string {
    const custom = str(raw.customTitle);
    if (custom && custom.trim()) {
      return custom.trim();
    }
    const first = requests.find((r) => this.isValidRequest(r));
    if (isObj(first) && isObj(first.message)) {
      const text = str(first.message.text) ?? '';
      return this.summarize(text) || 'Untitled session';
    }
    return 'Untitled session';
  }

  private summarize(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > SUMMARY_LEN ? clean.slice(0, SUMMARY_LEN) + '…' : clean;
  }

  private parseTurn(
    req: Record<string, unknown>,
    index: number,
    sessionLastDate?: number
  ): Turn {
    const message = isObj(req.message) ? req.message : {};
    const prompt = str(message.text) ?? '';
    const response = arr(req.response);

    const parts = splitResponseParts(response);
    const responseMarkdown = parts.full;

    const result = isObj(req.result) ? req.result : undefined;
    const metadata = result && isObj(result.metadata) ? result.metadata : undefined;

    const { status, errorMessage } = deriveStatus(req);
    const files = collectFiles(response, arr(req.contentReferences));
    const images = collectImages(req.variableData);
    const toolCallCount = countToolCalls(metadata);
    const hasCode = hasCodeBlocks(metadata, responseMarkdown);

    const charCount = prompt.length + responseMarkdown.length;
    const length: LengthBucket = charCount >= this.longThreshold ? 'long' : 'short';

    const timestamp = num(req.timestamp) ?? sessionLastDate;

    return {
      id: str(req.requestId) ?? `turn-${index}`,
      index,
      prompt,
      responseMarkdown,
      processMarkdown: parts.process,
      answerMarkdown: parts.answer,
      summary: this.summarize(prompt),
      timestamp,
      model: modelDisplayName(req.modelId),
      status,
      errorMessage,
      hasCode,
      files,
      images,
      length,
      charCount,
      toolCallCount,
      usage: undefined // local files carry no token/credits — gracefully hidden
    };
  }
}
