import type * as vscode from 'vscode';

/** Persists user-generated data not present in the files: stars (enhanced info F). */
export interface IStarStore {
  isStarred(turnId: string): boolean;
  toggle(turnId: string): void;
  all(): string[];
}

const KEY = 'chatTimeline.stars';

export class StarStore implements IStarStore {
  private set: Set<string>;

  constructor(private readonly memento: vscode.Memento) {
    const existing = memento.get<string[]>(KEY, []);
    this.set = new Set(existing);
  }

  isStarred(turnId: string): boolean {
    return this.set.has(turnId);
  }

  toggle(turnId: string): void {
    if (this.set.has(turnId)) {
      this.set.delete(turnId);
    } else {
      this.set.add(turnId);
    }
    void this.memento.update(KEY, Array.from(this.set));
  }

  all(): string[] {
    return Array.from(this.set);
  }
}
