import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { StoragePathResolver, StorageRootNotFoundError } from '../src/source/storagePathResolver';

test('level 3: user override wins over everything', async () => {
  const root = path.join('C:', 'custom', 'workspaceStorage');
  const resolver = new StoragePathResolver({
    userStoragePath: root,
    globalStorageFsPath: 'C:/whatever/globalStorage/ext',
    exists: (p) => p === root
  });
  assert.equal(await resolver.resolveWorkspaceStorageRoot(), root);
});

test('level 3: user override given the User dir appends workspaceStorage', async () => {
  const userDir = path.join('C:', 'custom', 'User');
  const expected = path.join(userDir, 'workspaceStorage');
  const resolver = new StoragePathResolver({
    userStoragePath: userDir,
    exists: (p) => p === expected
  });
  assert.equal(await resolver.resolveWorkspaceStorageRoot(), expected);
});

test('level 1: derives from globalStorageUri', async () => {
  const userRoot = path.join('C:', 'Users', 'me', 'AppData', 'Roaming', 'Code', 'User');
  const globalStorage = path.join(userRoot, 'globalStorage', 'some.ext');
  const expected = path.join(userRoot, 'workspaceStorage');
  const resolver = new StoragePathResolver({
    userStoragePath: '',
    globalStorageFsPath: globalStorage,
    exists: (p) => p === expected
  });
  assert.equal(await resolver.resolveWorkspaceStorageRoot(), expected);
});

test('level 2: platform fallback on win32 scans distro dirs', async () => {
  const appData = path.join('C:', 'Users', 'me', 'AppData', 'Roaming');
  process.env.APPDATA = appData;
  const expected = path.join(appData, 'Code - Insiders', 'User', 'workspaceStorage');
  const resolver = new StoragePathResolver({
    userStoragePath: '',
    globalStorageFsPath: undefined,
    platform: 'win32',
    homedir: path.join('C:', 'Users', 'me'),
    exists: (p) => p === expected
  });
  assert.equal(await resolver.resolveWorkspaceStorageRoot(), expected);
});

test('level 2: platform fallback on linux', async () => {
  const home = '/home/me';
  const expected = path.join(home, '.config', 'Code', 'User', 'workspaceStorage');
  const resolver = new StoragePathResolver({
    userStoragePath: '',
    platform: 'linux',
    homedir: home,
    exists: (p) => p === expected
  });
  assert.equal(await resolver.resolveWorkspaceStorageRoot(), expected);
});

test('throws a recognizable error when nothing resolves', async () => {
  const resolver = new StoragePathResolver({
    userStoragePath: '',
    platform: 'darwin',
    homedir: '/Users/me',
    exists: () => false
  });
  await assert.rejects(
    () => resolver.resolveWorkspaceStorageRoot(),
    StorageRootNotFoundError
  );
});

test('configured-but-missing override throws', async () => {
  const resolver = new StoragePathResolver({
    userStoragePath: 'C:/does/not/exist',
    exists: () => false
  });
  await assert.rejects(() => resolver.resolveWorkspaceStorageRoot(), StorageRootNotFoundError);
});
