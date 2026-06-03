import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';

/** Locates the VS Code `User/workspaceStorage` root in a portable way. */
export interface IStoragePathResolver {
  /** Returns the absolute workspaceStorage root path; throws a recognizable error when all levels fail. */
  resolveWorkspaceStorageRoot(): Promise<string>;
}

/** Recognizable error thrown when the storage root cannot be located. */
export class StorageRootNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageRootNotFoundError';
  }
}

export interface ResolverDeps {
  /** User-provided override (chatTimeline.storagePath). Empty = unset. */
  userStoragePath: string;
  /** context.globalStorageUri.fsPath, used to reverse-derive the User root. */
  globalStorageFsPath?: string;
  platform?: NodeJS.Platform;
  homedir?: string;
  /** Test seam for existence checks. */
  exists?: (p: string) => boolean;
}

function defaultExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** Candidate VS Code distribution directory names (most common first). */
const DISTRO_DIRS = [
  'Code',
  'Code - Insiders',
  'Code - Exploration',
  'VSCodium',
  'VSCodium - Insiders'
];

/**
 * Three-level fallback (highest priority last):
 *   1. Official API: reverse-derive from context.globalStorageUri.
 *   2. Platform fallback: process.platform + homedir + distro scan.
 *   3. User override: chatTimeline.storagePath (wins when set).
 */
export class StoragePathResolver implements IStoragePathResolver {
  constructor(private readonly deps: ResolverDeps) {}

  async resolveWorkspaceStorageRoot(): Promise<string> {
    const exists = this.deps.exists ?? defaultExists;
    const platform = this.deps.platform ?? process.platform;
    const home = this.deps.homedir ?? os.homedir();

    // 3. User override — highest priority when set.
    const override = (this.deps.userStoragePath ?? '').trim();
    if (override.length > 0) {
      const root = path.basename(override) === 'workspaceStorage'
        ? override
        : path.join(override, 'workspaceStorage');
      if (exists(root)) {
        return root;
      }
      if (exists(override)) {
        return override;
      }
      throw new StorageRootNotFoundError(
        `Configured chatTimeline.storagePath does not exist: ${override}`
      );
    }

    // 1. Official API: globalStorage is `<User>/globalStorage/...`; go up to <User>.
    const fromApi = this.deriveFromGlobalStorage(this.deps.globalStorageFsPath);
    if (fromApi && exists(fromApi)) {
      return fromApi;
    }

    // 2. Platform fallback: build the User dir per OS, scan distro names.
    for (const distro of DISTRO_DIRS) {
      const userDir = this.userDirForPlatform(platform, home, distro);
      if (!userDir) {
        continue;
      }
      const root = path.join(userDir, 'workspaceStorage');
      if (exists(root)) {
        return root;
      }
    }

    throw new StorageRootNotFoundError(
      'Unable to locate the Copilot Chat data directory. Please set "chatTimeline.storagePath" manually.'
    );
  }

  /** `<User>/globalStorage` -> `<User>/workspaceStorage`. */
  private deriveFromGlobalStorage(globalStorageFsPath?: string): string | undefined {
    if (!globalStorageFsPath) {
      return undefined;
    }
    // globalStorageUri = <User>/globalStorage/<extId>
    // walk up until we find a parent whose name is globalStorage.
    let dir = globalStorageFsPath;
    for (let i = 0; i < 4; i++) {
      const base = path.basename(dir);
      const parent = path.dirname(dir);
      if (base === 'globalStorage') {
        return path.join(parent, 'workspaceStorage');
      }
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
    return undefined;
  }

  private userDirForPlatform(
    platform: NodeJS.Platform,
    home: string,
    distro: string
  ): string | undefined {
    switch (platform) {
      case 'win32': {
        const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
        return path.join(appData, distro, 'User');
      }
      case 'darwin':
        return path.join(home, 'Library', 'Application Support', distro, 'User');
      default:
        // linux & others
        return path.join(home, '.config', distro, 'User');
    }
  }
}

/** Convenience factory from a VS Code extension context + user setting. */
export function createResolver(
  context: vscode.ExtensionContext,
  userStoragePath: string
): StoragePathResolver {
  return new StoragePathResolver({
    userStoragePath,
    globalStorageFsPath: context.globalStorageUri?.fsPath
  });
}
