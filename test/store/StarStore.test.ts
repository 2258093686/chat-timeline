import { describe, it, expect } from 'vitest';
import { StarStore, MementoLike } from '../../src/store/StarStore';

class InMemoryMemento implements MementoLike {
  private store = new Map<string, unknown>();
  get<T>(key: string, defaultValue: T): T {
    return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
  }
  update(key: string, value: unknown): void {
    this.store.set(key, value);
  }
}

describe('M5 StarStore', () => {
  it('toggles and reports starred state', () => {
    const m = new InMemoryMemento();
    const store = new StarStore(m);
    expect(store.isStarred('t1')).toBe(false);
    store.toggle('t1');
    expect(store.isStarred('t1')).toBe(true);
    store.toggle('t1');
    expect(store.isStarred('t1')).toBe(false);
  });

  it('all() returns current stars', () => {
    const store = new StarStore(new InMemoryMemento());
    store.toggle('a');
    store.toggle('b');
    expect(store.all().sort()).toEqual(['a', 'b']);
  });

  it('persists and round-trips through the memento', () => {
    const m = new InMemoryMemento();
    const store1 = new StarStore(m);
    store1.toggle('x');
    store1.toggle('y');
    // New instance reads from the same backing memento.
    const store2 = new StarStore(m);
    expect(store2.isStarred('x')).toBe(true);
    expect(store2.isStarred('y')).toBe(true);
    expect(store2.all().sort()).toEqual(['x', 'y']);
  });

  it('tolerates non-array persisted value', () => {
    const m = new InMemoryMemento();
    m.update('chatTimeline.stars', 'corrupt');
    const store = new StarStore(m);
    expect(store.all()).toEqual([]);
  });
});
