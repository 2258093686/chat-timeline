import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionParserV3 } from '../../src/parser/v3/SessionParserV3';
import { ParserRegistry } from '../../src/parser/ParserRegistry';
import { ParseContext } from '../../src/parser/ISessionParser';

const FIX = join(__dirname, '..', 'fixtures', 'workspaceStorage');

function loadJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(join(FIX, ...segments), 'utf8'));
}

const ctx = (workspaceId: string, filePath = 'f.json'): ParseContext => ({ workspaceId, filePath });

describe('M2 SessionParserV3.parseSession', () => {
  const parser = new SessionParserV3();
  const raw = loadJson('ws-alpha', 'chatSessions', 'session-good.json');
  const session = parser.parseSession(raw, ctx('ws-alpha'))!;

  it('parses session metadata and uses customTitle', () => {
    expect(session.id).toBe('11111111-aaaa-bbbb-cccc-222222222222');
    expect(session.title).toBe('Regex key filtering');
    expect(session.workspaceId).toBe('ws-alpha');
    expect(session.lastMessageDate).toBe(1755141999000);
  });

  it('filters invalid (empty) turns', () => {
    // 3 requests, last one is empty → 2 valid turns.
    expect(session.turns).toHaveLength(2);
  });

  it('extracts response markdown and detects code', () => {
    const t = session.turns[0];
    expect(t.responseMarkdown).toContain('const re = /^key_/;');
    expect(t.hasCode).toBe(true);
  });

  it('collects files from inlineReference and contentReferences (deduped by path)', () => {
    const t = session.turns[0];
    const names = t.files.map((f) => f.name).sort();
    expect(names).toContain('keys.ts');
    expect(names).toContain('README.md');
  });

  it('counts tool calls', () => {
    expect(session.turns[0].toolCallCount).toBe(2);
  });

  it('maps model id by stripping prefix', () => {
    expect(session.turns[0].model).toBe('gpt-5');
    expect(session.turns[1].model).toBe('claude-sonnet-4');
  });

  it('marks error status from errorDetails', () => {
    const errTurn = session.turns[1];
    expect(errTurn.status).toBe('error');
    expect(errTurn.errorMessage).toBe('Model timed out');
  });

  it('uses timestamp and orders ascending', () => {
    expect(session.turns[0].timestamp).toBe(1755140981000);
    expect(session.turns[0].index).toBe(1);
    expect(session.turns[1].index).toBe(2);
  });

  it('usage is undefined (best-effort, not in local file)', () => {
    expect(session.turns[0].usage).toBeUndefined();
  });

  it('ignores unknown response kinds without throwing', () => {
    // session-good has a "someFutureUnknownKind" item; parse succeeded above.
    expect(session.turns[0].responseMarkdown).not.toContain('ignore me');
  });
});

describe('M2 parseSummary', () => {
  const parser = new SessionParserV3();
  it('produces lightweight summary with valid turn count', () => {
    const raw = loadJson('ws-alpha', 'chatSessions', 'session-good.json');
    const s = parser.parseSummary(raw, ctx('ws-alpha'))!;
    expect(s.id).toBe('11111111-aaaa-bbbb-cccc-222222222222');
    expect(s.turnCount).toBe(2);
    expect(s.title).toBe('Regex key filtering');
  });

  it('empty session has turnCount 0', () => {
    const raw = loadJson('ws-beta', 'chatSessions', 'session-empty.json');
    const s = parser.parseSummary(raw, ctx('ws-beta'))!;
    expect(s.turnCount).toBe(0);
  });
});

describe('M2 fault tolerance', () => {
  const parser = new SessionParserV3();

  it('handles missing timestamp / requestId / plain-string response', () => {
    const raw = loadJson('ws-beta', 'chatSessions', 'session-partial.json');
    const s = parser.parseSession(raw, ctx('ws-beta'))!;
    expect(s.turns).toHaveLength(1);
    const t = s.turns[0];
    expect(t.id).toBeTruthy();
    expect(t.timestamp).toBe(1755200000000); // fell back to lastMessageDate
    expect(t.responseMarkdown).toContain('plain string fragment');
  });

  it('returns null for non-object / missing sessionId', () => {
    expect(parser.parseSession(null, ctx('x'))).toBeNull();
    expect(parser.parseSession({ version: 3 }, ctx('x'))).toBeNull();
    expect(parser.parseSummary('nope', ctx('x'))).toBeNull();
  });

  it('does not throw on totally malformed requests array', () => {
    const raw = { version: 3, sessionId: 's', requests: [null, 42, 'x', { message: 5, response: 7 }] };
    expect(() => parser.parseSession(raw, ctx('x'))).not.toThrow();
    const s = parser.parseSession(raw, ctx('x'))!;
    expect(s.turns).toHaveLength(0);
  });
});

describe('M2 ParserRegistry version dispatch', () => {
  it('selects V3 for version 3', () => {
    const reg = new ParserRegistry();
    const s = reg.parseSession(loadJson('ws-alpha', 'chatSessions', 'session-good.json'), ctx('ws-alpha'));
    expect(s).not.toBeNull();
  });

  it('falls back with a warning for unknown version, no throw', () => {
    const warnings: string[] = [];
    const reg = new ParserRegistry(undefined, (m) => warnings.push(m));
    const s = reg.parseSession({ version: 99, sessionId: 's', requests: [] }, ctx('x'));
    expect(s).not.toBeNull();
    expect(warnings.some((w) => w.includes('99'))).toBe(true);
  });

  it('warns when version field absent', () => {
    const warnings: string[] = [];
    const reg = new ParserRegistry(undefined, (m) => warnings.push(m));
    reg.parseSummary({ sessionId: 's', requests: [] }, ctx('x'));
    expect(warnings.some((w) => w.includes('no version'))).toBe(true);
  });
});
