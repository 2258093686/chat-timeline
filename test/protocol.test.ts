import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isViewToHost } from '../src/messaging/protocol';

test('accepts every well-formed ViewToHost message', () => {
  const valid: unknown[] = [
    { type: 'ready' },
    { type: 'refresh' },
    { type: 'selectSession', sessionId: 's' },
    { type: 'selectTurn', turnId: 't' },
    { type: 'search', keyword: 'foo' },
    { type: 'toggleStar', turnId: 't' },
    { type: 'copy', target: 'prompt', turnId: 't' },
    { type: 'copy', target: 'response', turnId: 't' },
    { type: 'setLayout', layout: 'detail' },
    { type: 'setLayout', layout: 'compact' }
  ];
  for (const m of valid) {
    assert.equal(isViewToHost(m), true, JSON.stringify(m));
  }
});

test('rejects malformed / malicious messages', () => {
  const invalid: unknown[] = [
    null,
    undefined,
    42,
    'ready',
    {},
    { type: 'unknown' },
    { type: 'selectSession' },
    { type: 'selectSession', sessionId: 5 },
    { type: 'search', keyword: 5 },
    { type: 'copy', target: 'evil', turnId: 't' },
    { type: 'copy', target: 'prompt' },
    { type: 'setLayout', layout: 'huge' }
  ];
  for (const m of invalid) {
    assert.equal(isViewToHost(m), false, JSON.stringify(m));
  }
});
