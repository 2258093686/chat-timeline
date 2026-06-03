import { describe, it, expect, vi } from 'vitest';
import { isViewToHost, ViewToHost, HostToView } from '../../src/messaging/protocol';
import { HostMessageHandler } from '../../src/messaging/host';
import { ISessionManager } from '../../src/session/SessionManager';
import { Session, SessionSummary, Turn } from '../../src/model/types';
import { Emitter } from '../../src/util/event';

describe('M7 protocol validation', () => {
  it('accepts all valid ViewToHost shapes', () => {
    const valid: ViewToHost[] = [
      { type: 'ready' },
      { type: 'refresh' },
      { type: 'selectSession', sessionId: 's' },
      { type: 'selectTurn', turnId: 't' },
      { type: 'search', keyword: 'k' },
      { type: 'toggleStar', turnId: 't' },
      { type: 'copy', target: 'prompt', turnId: 't' },
      { type: 'copy', target: 'response', turnId: 't' },
      { type: 'setLayout', layout: 'detail' },
      { type: 'setLayout', layout: 'compact' },
    ];
    for (const v of valid) {
      expect(isViewToHost(v)).toBe(true);
    }
  });

  it('rejects malformed/malicious messages', () => {
    expect(isViewToHost(null)).toBe(false);
    expect(isViewToHost('hi')).toBe(false);
    expect(isViewToHost({})).toBe(false);
    expect(isViewToHost({ type: 'unknown' })).toBe(false);
    expect(isViewToHost({ type: 'selectSession' })).toBe(false);
    expect(isViewToHost({ type: 'copy', target: 'evil', turnId: 't' })).toBe(false);
    expect(isViewToHost({ type: 'setLayout', layout: 'huge' })).toBe(false);
  });
});

function makeTurn(id: string, prompt: string, response: string): Turn {
  return {
    id,
    index: 1,
    prompt,
    responseMarkdown: response,
    summary: prompt,
    status: 'completed',
    hasCode: false,
    files: [],
    length: 'short',
    charCount: prompt.length + response.length,
    toolCallCount: 0,
  };
}

function makeManager(overrides: Partial<ISessionManager> = {}): ISessionManager {
  const session: Session = {
    id: 's1',
    title: 'T',
    workspaceId: 'ws',
    turns: [makeTurn('t1', 'hello', 'world'), makeTurn('t2', 'foo', 'bar')],
  };
  const summaries: SessionSummary[] = [{ id: 's1', title: 'T', workspaceId: 'ws', turnCount: 2 }];
  const stars = new Set<string>(['t1']);
  return {
    onDidUpdate: new Emitter<void>().event,
    listSessions: () => summaries,
    selectSession: vi.fn(async (id: string) => (id === 's1' ? session : undefined)),
    getCurrent: () => session,
    search: (kw: string) => session.turns.filter((t) => t.prompt.includes(kw)),
    toggleStar: vi.fn(),
    isStarred: (id: string) => stars.has(id),
    getParseFailureCount: () => 0,
    start: vi.fn(async () => undefined),
    dispose: vi.fn(),
    ...overrides,
  };
}

function makeHandler(manager = makeManager()) {
  const posted: HostToView[] = [];
  const copied: string[] = [];
  let layout: 'detail' | 'compact' = 'detail';
  const handler = new HostMessageHandler({
    manager,
    post: (m) => posted.push(m),
    copyToClipboard: (t) => copied.push(t),
    getLayout: () => layout,
    setLayout: (l) => (layout = l),
  });
  return { handler, posted, copied, manager, getLayout: () => layout };
}

describe('M7 host routing', () => {
  it('ready → sends sessions and layout', async () => {
    const { handler, posted } = makeHandler();
    await handler.handle({ type: 'ready' });
    expect(posted.find((m) => m.type === 'sessions')).toBeTruthy();
    expect(posted.find((m) => m.type === 'layout')).toBeTruthy();
  });

  it('selectSession → posts session with stars', async () => {
    const { handler, posted } = makeHandler();
    await handler.handle({ type: 'selectSession', sessionId: 's1' });
    const msg = posted.find((m) => m.type === 'session');
    expect(msg).toBeTruthy();
    if (msg && msg.type === 'session') {
      expect(msg.session.id).toBe('s1');
      expect(msg.stars).toEqual(['t1']);
    }
  });

  it('selectSession missing → error', async () => {
    const { handler, posted } = makeHandler();
    await handler.handle({ type: 'selectSession', sessionId: 'nope' });
    expect(posted.find((m) => m.type === 'error')).toBeTruthy();
  });

  it('search → returns matching turn ids only', async () => {
    const { handler, posted } = makeHandler();
    await handler.handle({ type: 'search', keyword: 'foo' });
    const msg = posted.find((m) => m.type === 'searchResult');
    expect(msg && msg.type === 'searchResult' && msg.turnIds).toEqual(['t2']);
  });

  it('toggleStar → delegates to manager', async () => {
    const mgr = makeManager();
    const { handler } = makeHandler(mgr);
    await handler.handle({ type: 'toggleStar', turnId: 't2' });
    expect(mgr.toggleStar).toHaveBeenCalledWith('t2');
  });

  it('copy → writes resolved text to clipboard', async () => {
    const { handler, copied } = makeHandler();
    await handler.handle({ type: 'copy', target: 'prompt', turnId: 't1' });
    expect(copied).toEqual(['hello']);
    await handler.handle({ type: 'copy', target: 'response', turnId: 't2' });
    expect(copied).toEqual(['hello', 'bar']);
  });

  it('setLayout → applies and echoes layout', async () => {
    const { handler, posted, getLayout } = makeHandler();
    await handler.handle({ type: 'setLayout', layout: 'compact' });
    expect(getLayout()).toBe('compact');
    expect(posted.some((m) => m.type === 'layout' && m.layout === 'compact')).toBe(true);
  });

  it('invalid message → dropped, no throw', async () => {
    const warn = vi.fn();
    const handler = new HostMessageHandler({
      manager: makeManager(),
      post: () => undefined,
      copyToClipboard: () => undefined,
      getLayout: () => 'detail',
      setLayout: () => undefined,
      warn,
    });
    await handler.handle({ type: 'evil' });
    expect(warn).toHaveBeenCalled();
  });
});
