// M1 子模块：可移植路径解析。
// 设计依据：detailed-design §4.2。三级回退定位 workspaceStorage 根目录，绝不写死绝对路径。

import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync } from 'node:fs';

export interface IStoragePathResolver {
  /** 返回 workspaceStorage 根目录绝对路径；全部失败抛出可识别错误 */
  resolveWorkspaceStorageRoot(): Promise<string>;
}

/** 可注入的环境依赖，便于单测。 */
export interface ResolverEnv {
  /** 来自 context.globalStorageUri.fsPath（首选，自动适配 OS/发行版） */
  globalStorageFsPath?: string;
  /** 来自 context.storageUri.fsPath（工作区级，可反推 workspaceStorage 根） */
  storageFsPath?: string;
  /** 用户兜底设置 chatTimeline.storagePath（最高优先级） */
  storagePathSetting?: string;
  platform?: NodeJS.Platform;
  homedir?: () => string;
  /** 路径是否存在（默认 fs.existsSync），测试可注入 */
  exists?: (p: string) => boolean;
}

/** 错误标识，便于 M8 识别并提示用户手动配置。 */
export class StoragePathNotFoundError extends Error {
  readonly code = 'CHAT_TIMELINE_STORAGE_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'StoragePathNotFoundError';
  }
}

const DISTRO_DIRS = ['Code', 'Code - Insiders', 'Code - Exploration', 'VSCodium', 'Cursor'];

export class StoragePathResolver implements IStoragePathResolver {
  private readonly exists: (p: string) => boolean;
  private readonly platform: NodeJS.Platform;
  private readonly homedir: () => string;

  constructor(private readonly env: ResolverEnv = {}) {
    this.exists = env.exists ?? existsSync;
    this.platform = env.platform ?? process.platform;
    this.homedir = env.homedir ?? os.homedir;
  }

  async resolveWorkspaceStorageRoot(): Promise<string> {
    // 级别 3（最高优先级）：用户兜底设置。
    const setting = this.env.storagePathSetting?.trim();
    if (setting) {
      return setting;
    }

    // 级别 1（首选）：由官方 API 路径反推 User 根目录。
    const fromApi = this.fromOfficialApi();
    if (fromApi && this.exists(fromApi)) {
      return fromApi;
    }

    // 级别 2：平台回退 + 候选发行版目录扫描。
    const fromPlatform = this.fromPlatform();
    if (fromPlatform) {
      return fromPlatform;
    }

    throw new StoragePathNotFoundError(
      'Unable to locate the Copilot Chat data directory. Please set "chatTimeline.storagePath" manually.',
    );
  }

  /** globalStorageUri: <User>/globalStorage/<ext> → <User>/workspaceStorage；
   *  storageUri:       <User>/workspaceStorage/<wsid>/<ext> → <User>/workspaceStorage */
  private fromOfficialApi(): string | undefined {
    const g = this.env.globalStorageFsPath;
    if (g) {
      // dirname(globalStorage/<ext>) = globalStorage ; dirname = User
      const userRoot = path.dirname(path.dirname(g));
      return path.join(userRoot, 'workspaceStorage');
    }
    const s = this.env.storageFsPath;
    if (s) {
      // <User>/workspaceStorage/<wsid>/<ext> → 上溯两级得 workspaceStorage
      return path.dirname(path.dirname(s));
    }
    return undefined;
  }

  private fromPlatform(): string | undefined {
    const home = this.homedir();
    const userBaseCandidates: string[] = [];
    if (this.platform === 'win32') {
      const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
      for (const d of DISTRO_DIRS) {
        userBaseCandidates.push(path.join(appData, d, 'User'));
      }
    } else if (this.platform === 'darwin') {
      for (const d of DISTRO_DIRS) {
        userBaseCandidates.push(path.join(home, 'Library', 'Application Support', d, 'User'));
      }
    } else {
      // linux / other
      const configHome = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
      for (const d of DISTRO_DIRS) {
        userBaseCandidates.push(path.join(configHome, d, 'User'));
      }
    }

    for (const base of userBaseCandidates) {
      const ws = path.join(base, 'workspaceStorage');
      if (this.exists(ws)) {
        return ws;
      }
    }
    return undefined;
  }
}
