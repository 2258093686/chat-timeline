import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructJsonl } from '../src/source/jsonlSession';

const snapshot = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    kind: 0,
    v: { version: 3, sessionId: 's', requests: [{ message: { text: 'hi' }, response: [{ value: 'a' }] }], ...extra }
  });

test('returns the snapshot when there are no deltas', () => {
  const out = reconstructJsonl(snapshot()) as any;
  assert.equal(out.version, 3);
  assert.equal(out.requests[0].response.length, 1);
});

test('kind:1 sets a scalar at the path (last write wins)', () => {
  const text = [
    snapshot(),
    JSON.stringify({ kind: 1, k: ['requests', 0, 'completionTokens'], v: 10 }),
    JSON.stringify({ kind: 1, k: ['requests', 0, 'completionTokens'], v: 42 })
  ].join('\n');
  const out = reconstructJsonl(text) as any;
  assert.equal(out.requests[0].completionTokens, 42);
});

test('kind:2 appends array items to the path', () => {
  const text = [
    snapshot(),
    JSON.stringify({ kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'b' }, { value: 'c' }] }),
    JSON.stringify({ kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'd' }] })
  ].join('\n');
  const out = reconstructJsonl(text) as any;
  assert.deepEqual(out.requests[0].response.map((s: any) => s.value), ['a', 'b', 'c', 'd']);
});

test('ignores malformed lines, blank lines and unknown kinds', () => {
  const text = [
    snapshot(),
    '',
    'not json',
    JSON.stringify({ kind: 99, k: ['x'], v: 1 }),
    JSON.stringify({ kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'z' }] })
  ].join('\n');
  const out = reconstructJsonl(text) as any;
  assert.deepEqual(out.requests[0].response.map((s: any) => s.value), ['a', 'z']);
});

test('returns undefined when no snapshot is present', () => {
  const text = JSON.stringify({ kind: 1, k: ['a'], v: 1 });
  assert.equal(reconstructJsonl(text), undefined);
});

test('deltas before a snapshot are ignored', () => {
  const text = [
    JSON.stringify({ kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'early' }] }),
    snapshot()
  ].join('\n');
  const out = reconstructJsonl(text) as any;
  assert.deepEqual(out.requests[0].response.map((s: any) => s.value), ['a']);
});
