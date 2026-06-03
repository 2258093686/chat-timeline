import { describe, it, expect, vi } from 'vitest';
import { Settings, ConfigProvider, ConfigReader } from '../../src/settings/Settings';

function makeProvider(values: Record<string, unknown>) {
  let changeListener: ((affects: (section: string) => boolean) => void) | undefined;
  const reader: ConfigReader = {
    get<T>(key: string, defaultValue: T): T {
      return (key in values ? (values[key] as T) : defaultValue);
    },
  };
  const provider: ConfigProvider = {
    getConfiguration: () => reader,
    onDidChangeConfiguration: (listener) => {
      changeListener = listener;
      return { dispose: () => (changeListener = undefined) };
    },
  };
  return {
    provider,
    fireChange(changedKeys: string[]) {
      changeListener?.((section) => changedKeys.includes(section));
    },
  };
}

describe('M9 Settings getters', () => {
  it('reads configured values', () => {
    const { provider } = makeProvider({
      layout: 'compact',
      source: 'participant',
      storagePath: '/tmp/ws',
      refreshDebounceMs: 1000,
      relativeTime: false,
      longThreshold: 500,
    });
    const s = new Settings(provider);
    expect(s.layout).toBe('compact');
    expect(s.source).toBe('participant');
    expect(s.storagePath).toBe('/tmp/ws');
    expect(s.refreshDebounceMs).toBe(1000);
    expect(s.relativeTime).toBe(false);
    expect(s.longThreshold).toBe(500);
  });

  it('falls back to defaults for missing / invalid values', () => {
    const { provider } = makeProvider({ refreshDebounceMs: -1, longThreshold: 0, layout: 'weird' });
    const s = new Settings(provider);
    expect(s.layout).toBe('detail');
    expect(s.source).toBe('local');
    expect(s.storagePath).toBe('');
    expect(s.refreshDebounceMs).toBe(500);
    expect(s.relativeTime).toBe(true);
    expect(s.longThreshold).toBe(2000);
  });
});

describe('M9 Settings onDidChange', () => {
  it('dispatches changed keys', () => {
    const { provider, fireChange } = makeProvider({});
    const s = new Settings(provider);
    const seen: string[] = [];
    s.onDidChange((key) => seen.push(key));
    fireChange(['chatTimeline.layout', 'chatTimeline.source']);
    expect(seen).toContain('layout');
    expect(seen).toContain('source');
    expect(seen).not.toContain('storagePath');
  });

  it('does not dispatch unrelated config changes', () => {
    const { provider, fireChange } = makeProvider({});
    const s = new Settings(provider);
    const cb = vi.fn();
    s.onDidChange(cb);
    fireChange(['editor.fontSize']);
    expect(cb).not.toHaveBeenCalled();
  });
});
