// M8 扩展入口 Extension —— 注册视图/命令/设置，装配各模块。
// 设计依据：detailed-design §11。

import * as vscode from 'vscode';
import * as path from 'node:path';
import { Settings, ConfigProvider, ConfigReader, Layout } from './settings/Settings';
import { StarStore } from './store/StarStore';
import { ParserRegistry } from './parser/ParserRegistry';
import { StoragePathResolver } from './source/StoragePathResolver';
import { LocalFileSource } from './source/LocalFileSource';
import { ParticipantSource } from './source/ParticipantSource';
import { IChatSource } from './source/IChatSource';
import { SessionManager } from './session/SessionManager';
import { TimelineViewProvider } from './view/TimelineViewProvider';

const disposables: vscode.Disposable[] = [];
let activeSource: IChatSource | undefined;
let manager: SessionManager | undefined;

function makeConfigProvider(): ConfigProvider {
  return {
    getConfiguration(): ConfigReader {
      const cfg = vscode.workspace.getConfiguration('chatTimeline');
      return { get: <T>(key: string, def: T) => cfg.get<T>(key, def) };
    },
    onDidChangeConfiguration(listener) {
      return vscode.workspace.onDidChangeConfiguration((e) =>
        listener((section) => e.affectsConfiguration(section)),
      );
    },
  };
}

function createSource(settings: Settings, context: vscode.ExtensionContext): IChatSource {
  if (settings.source === 'participant') {
    return new ParticipantSource();
  }
  const resolver = new StoragePathResolver({
    globalStorageFsPath: context.globalStorageUri.fsPath,
    storageFsPath: context.storageUri?.fsPath,
    storagePathSetting: settings.storagePath,
  });
  // 仅展示当前工作区的会话。context.storageUri 形如
  // .../workspaceStorage/<hash>/<extId>，其上一级目录名 <hash> 即工作区标识，
  // chatSessions 与扩展存储目录同级（workspaceStorage/<hash>/chatSessions）。
  const workspaceId = context.storageUri
    ? path.basename(path.dirname(context.storageUri.fsPath))
    : undefined;
  return new LocalFileSource({
    resolver,
    debounceMs: settings.refreshDebounceMs,
    workspaceId,
    warn: (m) => console.warn('[chat-timeline]', m),
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const settings = new Settings(makeConfigProvider());
  const store = new StarStore(context.globalState);
  const parser = new ParserRegistry(undefined, (m) => console.warn('[chat-timeline]', m));

  const setLayout = (layout: Layout): Thenable<void> =>
    vscode.workspace
      .getConfiguration('chatTimeline')
      .update('layout', layout, vscode.ConfigurationTarget.Global);

  let provider: TimelineViewProvider;

  const buildManager = (): SessionManager => {
    activeSource = createSource(settings, context);
    const m = new SessionManager({
      source: activeSource,
      parser,
      store,
      longThreshold: () => settings.longThreshold,
      warn: (msg) => console.warn('[chat-timeline]', msg),
    });
    return m;
  };

  manager = buildManager();
  provider = new TimelineViewProvider(context.extensionUri, manager, settings, setLayout);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TimelineViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // 启动数据源（捕获定位失败，提示用户手动配置）。
  try {
    await manager.start();
  } catch (err) {
    void vscode.window.showWarningMessage(
      `Chat Timeline: ${String((err as Error)?.message ?? err)}`,
    );
  }

  // 命令。
  context.subscriptions.push(
    vscode.commands.registerCommand('chatTimeline.refresh', () => manager?.reload()),
    vscode.commands.registerCommand('chatTimeline.toggleLayout', () => {
      const next: Layout = settings.layout === 'detail' ? 'compact' : 'detail';
      void setLayout(next);
    }),
  );

  // 设置变更：source 变更 → 重建数据源；layout 变更 → 通知 Webview。
  context.subscriptions.push(
    settings.onDidChange(async (key) => {
      if (key === 'layout') {
        provider.notifyLayout(settings.layout);
      } else if (key === 'source' || key === 'storagePath' || key === 'refreshDebounceMs') {
        manager?.dispose();
        manager = buildManager();
        provider = new TimelineViewProvider(context.extensionUri, manager, settings, setLayout);
        // 注意：视图已注册，重建 manager 后需重新解析视图——VS Code 会在下次显示时调用。
        try {
          await manager.start();
        } catch (err) {
          void vscode.window.showWarningMessage(`Chat Timeline: ${String((err as Error)?.message ?? err)}`);
        }
      }
    }),
  );

  disposables.push(settings, provider);
  context.subscriptions.push({ dispose: () => deactivate() });
}

export function deactivate(): void {
  manager?.dispose();
  manager = undefined;
  activeSource = undefined;
  for (const d of disposables.splice(0)) {
    try {
      d.dispose();
    } catch {
      // ignore
    }
  }
}
