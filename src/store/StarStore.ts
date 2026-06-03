// M5 状态存储 Store —— 星标（F）持久化，用 globalState（跨工作区共享）。
// 设计依据：detailed-design §7、proposal §3.8-F。

/** 最小持久化门面，对应 vscode.Memento 的子集。 */
export interface MementoLike {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void> | void;
}

export interface IStarStore {
  isStarred(turnId: string): boolean;
  toggle(turnId: string): void;
  all(): string[];
}

const STORAGE_KEY = 'chatTimeline.stars';

export class StarStore implements IStarStore {
  private readonly stars: Set<string>;

  constructor(private readonly memento: MementoLike) {
    const persisted = memento.get<string[]>(STORAGE_KEY, []);
    this.stars = new Set(Array.isArray(persisted) ? persisted : []);
  }

  isStarred(turnId: string): boolean {
    return this.stars.has(turnId);
  }

  toggle(turnId: string): void {
    if (this.stars.has(turnId)) {
      this.stars.delete(turnId);
    } else {
      this.stars.add(turnId);
    }
    void this.memento.update(STORAGE_KEY, [...this.stars]);
  }

  all(): string[] {
    return [...this.stars];
  }
}
