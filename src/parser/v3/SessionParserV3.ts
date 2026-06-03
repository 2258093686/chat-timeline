import type {
  LengthBucket,
  Session,
  SessionSummary,
  Turn,
  TurnFileRef,
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
      lastMessageDate: num(raw.lastMessageDate),
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
      lastMessageDate: num(raw.lastMessageDate),
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

    let responseMarkdown = '';
    for (const seg of response) {
      responseMarkdown += segmentText(seg);
    }

    const result = isObj(req.result) ? req.result : undefined;
    const metadata = result && isObj(result.metadata) ? result.metadata : undefined;

    const { status, errorMessage } = deriveStatus(req);
    const files = collectFiles(response, arr(req.contentReferences));
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
      summary: this.summarize(prompt),
      timestamp,
      model: modelDisplayName(req.modelId),
      status,
      errorMessage,
      hasCode,
      files,
      length,
      charCount,
      toolCallCount,
      usage: undefined // local files carry no token/credits — gracefully hidden
    };
  }
}
