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

test('strips empty fenced code blocks left over from tool edits', () => {
  const reg = new ParserRegistry();
  const raw = {
    version: 3,
    requests: [
      {
        requestId: 'r1',
        message: { text: 'edit something' },
        response: [
          { value: { value: 'Now SessionManager:' } },
          { value: { value: '\n```\n' } },
          { value: { value: '\n```\n' } },
          { value: { value: '\n```\n' } },
          { value: { value: '\n```\n' } },
          { value: { value: 'Done.' } }
        ]
      }
    ]
  };
  const session = reg.parseSession(raw, ctx);
  assert.ok(session);
  const md = session!.turns[0].responseMarkdown;
  // No empty code fences and no big blank-line runs remain.
  assert.equal(/```/.test(md), false);
  assert.equal(/\n{3,}/.test(md), false);
  assert.equal(md, 'Now SessionManager:\n\nDone.');
});

test('splits process narration from the final answer around tool calls', () => {
  const reg = new ParserRegistry();
  const raw = {
    version: 3,
    requests: [
      {
        requestId: 'r1',
        message: { text: 'do work' },
        response: [
          { value: { value: 'Now let me read the file.' } },
          { kind: 'prepareToolInvocation' },
          { kind: 'toolInvocationSerialized' },
          { value: { value: '\n```\n' } },
          { value: { value: '\n```\n' } },
          { value: { value: 'Now apply the edit.' } },
          { kind: 'toolInvocationSerialized' },
          { value: { value: 'Done. All green.' } }
        ]
      }
    ]
  };
  const session = reg.parseSession(raw, ctx);
  assert.ok(session);
  const t = session!.turns[0];
  // Narration before the last tool call is the collapsed process part.
  assert.equal(t.processMarkdown, 'Now let me read the file.\n\nNow apply the edit.');
  // Text after the last tool call is the final answer.
  assert.equal(t.answerMarkdown, 'Done. All green.');
  // responseMarkdown stays the full concatenation (used for search).
  assert.ok(t.responseMarkdown.includes('Now let me read the file.'));
  assert.ok(t.responseMarkdown.includes('Done. All green.'));
});

test('answer-only turns have no process section', () => {
  const reg = new ParserRegistry();
  const raw = {
    version: 3,
    requests: [
      {
        requestId: 'r1',
        message: { text: 'hi' },
        response: [{ value: { value: 'Just a plain answer.' } }]
      }
    ]
  };
  const session = reg.parseSession(raw, ctx)!;
  const t = session.turns[0];
  assert.equal(t.processMarkdown, undefined);
  assert.equal(t.answerMarkdown, 'Just a plain answer.');
});

test('extracts pasted prompt images as data URIs', () => {
  const reg = new ParserRegistry();
  const raw = {
    version: 3,
    requests: [
      {
        requestId: 'r1',
        message: { text: 'look at this' },
        response: [{ value: { value: 'Sure.' } }],
        variableData: {
          variables: [
            {
              kind: 'image',
              name: '粘贴的图像',
              mimeType: 'image/png',
              value: { $base64: 'iVBORw0KGgo=' }
            },
            { kind: 'file', name: 'x.ts' }
          ]
        }
      }
    ]
  };
  const session = reg.parseSession(raw, ctx)!;
  const t = session.turns[0];
  assert.equal(t.images.length, 1);
  assert.equal(t.images[0].mimeType, 'image/png');
  assert.equal(t.images[0].name, '粘贴的图像');
  assert.equal(t.images[0].dataUri, 'data:image/png;base64,iVBORw0KGgo=');
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
