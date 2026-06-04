import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isViewToHost } from '../src/messaging/protocol';

test('accepts every well-formed ViewToHost message', () => {
  const valid: unknown[] = [
    { type: 'ready' },
    { type: 'refresh' },
    { type: 'selectSession', sessionId: 's' },
    { type: 'selectSession', sessionId: 's', focusTurnId: 't' },
    { type: 'selectTurn', turnId: 't' },
    { type: 'search', keyword: 'foo', scope: 'current', target: 'both' },
    { type: 'search', keyword: 'foo', scope: 'global', target: 'prompt' },
    { type: 'search', keyword: 'foo', scope: 'global', target: 'response' },
    { type: 'toggleStar', turnId: 't' },
    { type: 'copy', target: 'prompt', turnId: 't' },
    { type: 'copy', target: 'response', turnId: 't' }
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
    { type: 'selectSession', sessionId: 's', focusTurnId: 5 },
    { type: 'search', keyword: 5, scope: 'current', target: 'both' },
    { type: 'search', keyword: 'foo' },
    { type: 'search', keyword: 'foo', scope: 'current' },
    { type: 'search', keyword: 'foo', scope: 'everywhere', target: 'both' },
    { type: 'search', keyword: 'foo', scope: 'global', target: 'evil' },
    { type: 'copy', target: 'evil', turnId: 't' },
    { type: 'copy', target: 'prompt' }
  ];
  for (const m of invalid) {
    assert.equal(isViewToHost(m), false, JSON.stringify(m));
  }
});
