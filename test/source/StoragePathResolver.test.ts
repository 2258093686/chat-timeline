import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  StoragePathResolver,
  StoragePathNotFoundError,
  ResolverEnv,
} from '../../src/source/StoragePathResolver';

function resolver(env: ResolverEnv) {
  return new StoragePathResolver(env);
}

describe('M1 StoragePathResolver three-level fallback', () => {
  it('level 3: user setting wins over everything', async () => {
    const r = resolver({
      storagePathSetting: '  /custom/ws  ',
      globalStorageFsPath: '/should/not/use/globalStorage/ext',
      exists: () => true,
    });
    expect(await r.resolveWorkspaceStorageRoot()).toBe('/custom/ws');
  });

  it('level 1: derives workspaceStorage from globalStorageUri', async () => {
    const userRoot = path.join('/home', 'u', 'Code', 'User');
    const globalStorage = path.join(userRoot, 'globalStorage', 'vibe.chat-timeline');
    const expected = path.join(userRoot, 'workspaceStorage');
    const r = resolver({
      globalStorageFsPath: globalStorage,
      exists: (p) => p === expected,
    });
    expect(await r.resolveWorkspaceStorageRoot()).toBe(expected);
  });

  it('level 1: derives workspaceStorage from storageUri', async () => {
    const ws = path.join('/home', 'u', 'Code', 'User', 'workspaceStorage');
    const storage = path.join(ws, 'abc123', 'vibe.chat-timeline');
    const r = resolver({
      storageFsPath: storage,
      exists: (p) => p === ws,
    });
    expect(await r.resolveWorkspaceStorageRoot()).toBe(ws);
  });

  it('level 2: platform fallback on win32', async () => {
    const appData = process.env.APPDATA ?? path.join('/home', 'AppData', 'Roaming');
    const expected = path.join(appData, 'Code', 'User', 'workspaceStorage');
    const r = resolver({
      platform: 'win32',
      homedir: () => '/home/u',
      exists: (p) => p === expected,
    });
    expect(await r.resolveWorkspaceStorageRoot()).toBe(expected);
  });

  it('level 2: platform fallback on linux scans distro dirs', async () => {
    const expected = path.join('/home/u', '.config', 'Code - Insiders', 'User', 'workspaceStorage');
    const r = resolver({
      platform: 'linux',
      homedir: () => '/home/u',
      exists: (p) => p === expected,
    });
    expect(await r.resolveWorkspaceStorageRoot()).toBe(expected);
  });

  it('throws an identifiable error when all levels fail', async () => {
    const r = resolver({ platform: 'linux', homedir: () => '/home/u', exists: () => false });
    await expect(r.resolveWorkspaceStorageRoot()).rejects.toBeInstanceOf(StoragePathNotFoundError);
  });
});
