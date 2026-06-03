import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../../src/session/SessionManager';
import { ParserRegistry } from '../../src/parser/ParserRegistry';
import { IChatSource, RawSessionFile } from '../../src/source/IChatSource';
import { IStarStore } from '../../src/store/StarStore';
import { Emitter } from '../../src/util/event';

function mockSource(raws: RawSessionFile[]) {
  const emitter = new Emitter<void>();
  const src: IChatSource = {
    start: vi.fn(async () => undefined),
    dispose: vi.fn(),
    loadRawSessions: vi.fn(async () => raws),
    onDidChange: emitter.event,
  };
  return { src, emitter };
}

function memoryStore(): IStarStore {
  const set = new Set<string>();
  return {
    isStarred: (id) => set.has(id),
    toggle: (id) => (set.has(id) ? set.delete(id) : set.add(id)),
    all: () => [...set],
  };
}

function rawSession(workspaceId: string, sessionId: string, lastMessageDate: number, prompts: string[]): RawSessionFile {
  return {
    workspaceId,
    sessionId,
    filePath: `${workspaceId}/${sessionId}.json`,
    raw: {
      version: 3,
      sessionId,
      lastMessageDate,
      requests: prompts.map((p, i) => ({
        requestId: `${sessionId}-r${i}`,
        message: { text: p },
        response: [{ value: `answer to ${p}` }],
        timestamp: lastMessageDate - (prompts.length - i) * 1000,
        modelId: 'copilot/gpt-5',
      })),
    },
  };
}

const emptyRaw: RawSessionFile = {
  workspaceId: 'ws',
  sessionId: 'empty',
  filePath: 'ws/empty.json',
  raw: { version: 3, sessionId: 'empty', lastMessageDate: 999, requests: [{ message: { text: '' }, response: [] }] },
};

describe('M4 SessionManager', () => {
  it('filters empty sessions and sorts by lastMessageDate desc', async () => {
    const older = rawSession('ws', 'older', 1000, ['q1']);
    const newer = rawSession('ws', 'newer', 5000, ['q2']);
    const { src } = mockSource([older, emptyRaw, newer]);
    const mgr = new SessionManager({ source: src, parser: new ParserRegistry(), store: memoryStore() });
    await mgr.start();

    const list = mgr.listSessions();
    expect(list.map((s) => s.id)).toEqual(['newer', 'older']); // sorted desc, empty filtered
  });

  it('selectSession triggers detail parse and getCurrent returns it', async () => {
    const s = rawSession('ws', 's1', 2000, ['hello world', 'second q']);
    const { src } = mockSource([s]);
    const mgr = new SessionManager({ source: src, parser: new ParserRegistry(), store: memoryStore() });
    await mgr.start();

    const session = await mgr.selectSession('s1');
    expect(session?.turns).toHaveLength(2);
    expect(mgr.getCurrent()?.id).toBe('s1');
  });

  it('search matches prompt/response in current session', async () => {
    const s = rawSession('ws', 's1', 2000, ['apple pie', 'banana split']);
    const { src } = mockSource([s]);
    const mgr = new SessionManager({ source: src, parser: new ParserRegistry(), store: memoryStore() });
    await mgr.start();
    await mgr.selectSession('s1');

    const hits = mgr.search('banana');
    expect(hits).toHaveLength(1);
    expect(hits[0].prompt).toBe('banana split');

    // matches against response text too
    expect(mgr.search('answer to apple')).toHaveLength(1);
    // empty keyword returns all
    expect(mgr.search('  ')).toHaveLength(2);
  });

  it('toggleStar delegates to store', async () => {
    const store = memoryStore();
    const s = rawSession('ws', 's1', 2000, ['q']);
    const { src } = mockSource([s]);
    const mgr = new SessionManager({ source: src, parser: new ParserRegistry(), store });
    await mgr.start();

    expect(mgr.isStarred('s1-r0')).toBe(false);
    mgr.toggleStar('s1-r0');
    expect(store.isStarred('s1-r0')).toBe(true);
    expect(mgr.isStarred('s1-r0')).toBe(true);
  });

  it('reloads and fires onDidUpdate when source changes', async () => {
    const s = rawSession('ws', 's1', 2000, ['q']);
    const { src, emitter } = mockSource([s]);
    const mgr = new SessionManager({ source: src, parser: new ParserRegistry(), store: memoryStore() });
    await mgr.start();

    const cb = vi.fn();
    mgr.onDidUpdate(cb);
    emitter.fire();
    await new Promise((r) => setTimeout(r, 10));
    expect(cb).toHaveBeenCalled();
  });
});
