// 极简事件发射器，签名与 vscode.Event 兼容（(listener) => Disposable）。
// 纯逻辑模块用它替代运行时依赖 vscode.EventEmitter，便于在 Node 下单测。

export interface Disposable {
  dispose(): void;
}

export type Event<T> = (listener: (e: T) => void) => Disposable;

export class Emitter<T> {
  private listeners = new Set<(e: T) => void>();

  readonly event: Event<T> = (listener: (e: T) => void): Disposable => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  fire(data: T): void {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
