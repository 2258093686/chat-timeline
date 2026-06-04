import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ParserRegistry } from '../src/parser/parserRegistry';
import { SessionParserV3 } from '../src/parser/v3/sessionParserV3';

const here = path.dirname(fileURLToPath(import.meta.url));
const readFixture = (name: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(here, 'fixtures', name), 'utf8'));

const ctx = { workspaceId: 'ws', filePath: 'x.json' };

test('parses a normal v3 session into turns', () => {
  const reg = new ParserRegistry();
  const session = reg.parseSession(readFixture('v3-sample.json'), ctx);
  assert.ok(session);
  // empty third request is filtered out
  assert.equal(session!.turns.length, 2);
  assert.equal(session!.title, 'Sample session title');

  const [t1, t2] = session!.turns;
  assert.equal(t1.index, 1);
  assert.equal(t1.model, 'claude-sonnet-4');
  assert.equal(t1.status, 'completed');
  assert.equal(t1.hasCode, true);
  assert.equal(t1.toolCallCount, 2);
  assert.equal(t1.files.length, 1);
  assert.equal(t1.files[0].name, 'index.ts');

  assert.equal(t2.model, 'gpt-5');
  assert.equal(t2.status, 'error');
  assert.equal(t2.errorMessage, 'Request failed');
});

test('summary filters empty sessions and counts valid turns', () => {
  const reg = new ParserRegistry();
  const summary = reg.parseSummary(readFixture('v3-sample.json'), ctx);
  assert.ok(summary);
  assert.equal(summary!.turnCount, 2);
});

test('empty session yields null summary', () => {
  const reg = new ParserRegistry();
  const raw = { version: 3, sessionId: 's', requests: [{ message: { text: '' } }] };
  assert.equal(reg.parseSummary(raw, ctx), null);
});

test('broken / partial JSON degrades gracefully without throwing', () => {
  const reg = new ParserRegistry();
  const session = reg.parseSession(readFixture('v3-broken.json'), ctx);
  assert.ok(session);
  // req-ok + req-no-timestamp are valid; the null-message one is skipped
  assert.equal(session!.turns.length, 2);
  // unknown kinds ignored, known text kept
  assert.match(session!.turns[0].responseMarkdown, /kept text/);
  assert.doesNotMatch(session!.turns[0].responseMarkdown, /should be ignored/);
  // plain string segment supported
  assert.match(session!.turns[1].responseMarkdown, /plain string segment/);
});

test('unknown version falls back to closest parser instead of crashing', () => {
  const warnings: string[] = [];
  const reg = new ParserRegistry([new SessionParserV3()], (m) => warnings.push(m));
  const raw = { version: 99, sessionId: 's', requests: [{ requestId: 'r', message: { text: 'hi' }, response: [] }] };
  const session = reg.parseSession(raw, ctx);
  assert.ok(session);
  assert.equal(session!.turns.length, 1);
  assert.equal(warnings.length, 1);
});

test('long threshold drives the length bucket', () => {
  const parser = new SessionParserV3(10);
  const raw = {
    version: 3,
    sessionId: 's',
    requests: [{ requestId: 'r', message: { text: 'a long enough prompt' }, response: [] }]
  };
  const session = parser.parseSession(raw, ctx);
  assert.equal(session!.turns[0].length, 'long');
});

test('non-object raw returns null', () => {
  const reg = new ParserRegistry();
  assert.equal(reg.parseSession(null, ctx), null);
  assert.equal(reg.parseSummary(42, ctx), null);
});
