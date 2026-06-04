import * as vscode from 'vscode';
import * as path from 'path';
import { LocalFileSource } from './source/localFileSource';
import { createResolver } from './source/storagePathResolver';
import { ParserRegistry } from './parser/parserRegistry';
import { SessionParserV3 } from './parser/v3/sessionParserV3';
import { SessionManager } from './session/sessionManager';
import { StarStore } from './store/starStore';
import { Settings } from './settings/settings';
import { TimelineViewProvider } from './view/timelineViewProvider';
import type { IChatSource } from './source/IChatSource';

/**
 * The current workspace's storage id: `storageUri` is
 * `<...>/workspaceStorage/<workspaceId>/<extensionId>`, so the workspace id is
 * the parent folder's name. Undefined when no workspace is open.
 */
function currentWorkspaceId(context: vscode.ExtensionContext): string | undefined {
  const fsPath = context.storageUri?.fsPath;
  if (!fsPath) {
    return undefined;
  }
  return path.basename(path.dirname(fsPath));
}

export function activate(context: vscode.ExtensionContext): void {
  const settings = new Settings();
  context.subscriptions.push(settings);

  const store = new StarStore(context.globalState);

  const workspaceId = currentWorkspaceId(context);

  const createSource = (): IChatSource => {
    // Data source B (participant) is future work; always use local for now.
    const resolver = createResolver(context, settings.storagePath);
    return new LocalFileSource(resolver, settings.refreshDebounceMs, workspaceId);
  };

  const parser = new ParserRegistry(
    [new SessionParserV3(settings.longThreshold)],
    (m) => console.warn(m)
  );

  let manager = new SessionManager(createSource(), parser, store);
  const provider = new TimelineViewProvider(context.extensionUri, manager);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TimelineViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  void manager.start();

  context.subscriptions.push(
    vscode.commands.registerCommand('chatTimeline.refresh', () => {
      void manager.refresh();
    })
  );

  // Rebuild the data source when relevant settings change.
  context.subscriptions.push(
    settings.onDidChange((key) => {
      if (key === 'source' || key === 'storagePath' || key === 'refreshDebounceMs') {
        manager.dispose();
        manager = new SessionManager(createSource(), parser, store);
        // Re-wire the provider to the new manager.
        provider.rebind(manager);
        void manager.start();
      }
    })
  );

  context.subscriptions.push({ dispose: () => manager.dispose() });
}

export function deactivate(): void {
  // subscriptions disposed by VS Code
}
