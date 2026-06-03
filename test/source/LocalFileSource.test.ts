import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalFileSource } from '../../src/source/LocalFileSource';
import { IStoragePathResolver } from '../../src/source/StoragePathResolver';

const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures', 'workspaceStorage');

function fixedResolver(root: string): IStoragePathResolver {
  return { resolveWorkspaceStorageRoot: async () => root };
}

describe('M1 LocalFileSource.loadRawSessions', () => {
  it('reads chatSessions/*.json and *.jsonl across workspaces', async () => {
    const src = new LocalFileSource({ resolver: fixedResolver(FIXTURE_ROOT) });
    const raws = await src.loadRawSessions();
    // ws-alpha: session-good.json + session-log.jsonl = 2; ws-beta: 2 files = 4 total
    expect(raws).toHaveLength(4);
    const ids = raws.map((r) => r.sessionId).sort();
    expect(ids).toContain('session-good');
    expect(ids).toContain('session-log');
    const alpha = raws.find((r) => r.sessionId === 'session-good')!;
    expect(alpha.workspaceId).toBe('ws-alpha');
    expect((alpha.raw as any).version).toBe(3);
    src.dispose();
  });

  it('replays .jsonl logs into a v3-shaped snapshot with sessionId injected', async () => {
    const src = new LocalFileSource({ resolver: fixedResolver(FIXTURE_ROOT), workspaceId: 'ws-alpha' });
    const raws = await src.loadRawSessions();
    const log = raws.find((r) => r.sessionId === 'session-log')!;
    const raw = log.raw as any;
    expect(raw.sessionId).toBe('session-log'); // injected from filename
    expect(Array.isArray(raw.requests)).toBe(true);
    expect(raw.requests).toHaveLength(2);
    // kind:1 set on an existing array index must be applied (reverse answer)
    expect(raw.requests[1].response[0].value).toBe('Call .reverse().');
    expect(raw.lastMessageDate).toBe(1700000100000);
    src.dispose();
  });

  it('returns empty when root missing', async () => {
    const src = new LocalFileSource({ resolver: fixedResolver(path.join(FIXTURE_ROOT, 'nope')) });
    expect(await src.loadRawSessions()).toEqual([]);
    src.dispose();
  });

  it('only reads the current workspace when workspaceId is set', async () => {
    const src = new LocalFileSource({ resolver: fixedResolver(FIXTURE_ROOT), workspaceId: 'ws-alpha' });
    const raws = await src.loadRawSessions();
    expect(raws.every((r) => r.workspaceId === 'ws-alpha')).toBe(true);
    expect(raws.map((r) => r.sessionId).sort()).toEqual(['session-good', 'session-log']);
    src.dispose();
  });
});

describe('M1 LocalFileSource watcher debounce', () => {
  let tmpRoot: string;
  const sources: LocalFileSource[] = [];

  afterEach(() => {
    for (const s of sources.splice(0)) {
      s.dispose();
    }
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('fires onDidChange once after multiple rapid writes', async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-watch-'));
    const sessionsDir = path.join(tmpRoot, 'ws1', 'chatSessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'a.json'), '{}');

    const src = new LocalFileSource({ resolver: fixedResolver(tmpRoot), debounceMs: 80 });
    sources.push(src);
    await src.start();

    let fired = 0;
    src.onDidChange(() => fired++);

    // Multiple rapid writes within the debounce window.
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(sessionsDir, `a.json`), JSON.stringify({ n: i }));
    }

    await new Promise((r) => setTimeout(r, 250));
    expect(fired).toBe(1);
  });
});
