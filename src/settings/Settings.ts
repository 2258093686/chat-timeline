// M9 配置 Settings —— 设置项读取与变更监听。
// 设计依据：detailed-design §10、proposal §4。
// 为便于在 Node 下单测，本模块不在运行时 import vscode，而是依赖注入的最小配置门面。

import { Emitter, Event } from '../util/event';

export type Layout = 'detail' | 'compact';
export type SourceKind = 'local' | 'participant';

/** 设置项形状（用于 onDidChange 派发变更键） */
export interface SettingsShape {
  layout: Layout;
  source: SourceKind;
  storagePath: string;
  refreshDebounceMs: number;
  relativeTime: boolean;
  longThreshold: number;
}

export interface ISettings {
  get layout(): Layout;
  get source(): SourceKind;
  get storagePath(): string;
  get refreshDebounceMs(): number;
  get relativeTime(): boolean;
  get longThreshold(): number;
  readonly onDidChange: Event<keyof SettingsShape>;
  dispose(): void;
}

/** 读取某 section 配置项的最小门面（对应 vscode.WorkspaceConfiguration.get） */
export interface ConfigReader {
  get<T>(key: string, defaultValue: T): T;
}

/** 配置门面：提供读取与变更订阅，隔离 vscode API。 */
export interface ConfigProvider {
  /** 返回 chatTimeline section 的读取器 */
  getConfiguration(): ConfigReader;
  /**
   * 订阅配置变更。回调收到一个判定函数：给定完整配置键（如 'chatTimeline.layout'）
   * 返回该键是否受本次变更影响。
   */
  onDidChangeConfiguration(listener: (affects: (section: string) => boolean) => void): { dispose(): void };
}

const SECTION = 'chatTimeline';

const KEYS: (keyof SettingsShape)[] = [
  'layout',
  'source',
  'storagePath',
  'refreshDebounceMs',
  'relativeTime',
  'longThreshold',
];

export class Settings implements ISettings {
  private readonly emitter = new Emitter<keyof SettingsShape>();
  private readonly subscription: { dispose(): void };

  readonly onDidChange: Event<keyof SettingsShape> = this.emitter.event;

  constructor(private readonly provider: ConfigProvider) {
    this.subscription = provider.onDidChangeConfiguration((affects) => {
      for (const key of KEYS) {
        if (affects(`${SECTION}.${key}`)) {
          this.emitter.fire(key);
        }
      }
    });
  }

  private read<T>(key: keyof SettingsShape, defaultValue: T): T {
    return this.provider.getConfiguration().get<T>(key as string, defaultValue);
  }

  get layout(): Layout {
    const v = this.read<string>('layout', 'detail');
    return v === 'compact' ? 'compact' : 'detail';
  }

  get source(): SourceKind {
    const v = this.read<string>('source', 'local');
    return v === 'participant' ? 'participant' : 'local';
  }

  get storagePath(): string {
    return this.read<string>('storagePath', '');
  }

  get refreshDebounceMs(): number {
    const v = this.read<number>('refreshDebounceMs', 500);
    return Number.isFinite(v) && v >= 0 ? v : 500;
  }

  get relativeTime(): boolean {
    return this.read<boolean>('relativeTime', true);
  }

  get longThreshold(): number {
    const v = this.read<number>('longThreshold', 2000);
    return Number.isFinite(v) && v > 0 ? v : 2000;
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}
