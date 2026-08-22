import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildStoryRouterUrl,
  findStoryRoute,
  normalizeRouterBaseUrl,
  storyRoutesManifestUrl,
} from '../ui/story-router-contract.js';

const sourceKey = 'story-v6:20260816t013548z:character:0';
const manifest = {
  version: 1,
  bridgeRevision: 1,
  sourceCatalog: 'story-v6',
  catalogRevision: '20260816t013548z',
  targets: {
    reader: { indexEntries: 3012 },
    adv: {
      handoffReady: false,
      readerRevision: '65f221f2aaa5a9fe161ed32e03e4dfbb93d4746d',
    },
  },
  routes: [{
    sourceKey,
    reader: { storyId: '310011' },
    adv: { chapterId: '310011', section: '310011-1 Section 1' },
  }],
};

test('normalizes a fixed Story Router root', () => {
  assert.equal(normalizeRouterBaseUrl('https://router.example/base/'), 'https://router.example/base');
  assert.equal(storyRoutesManifestUrl('https://router.example/base'), 'https://router.example/base/story-routes.json');
  assert.throws(() => normalizeRouterBaseUrl('javascript:alert(1)'), /HTTP/);
  assert.throws(() => normalizeRouterBaseUrl('https://user@router.example/'), /无认证/);
});

test('builds only Reader or ADV relay URLs', () => {
  assert.equal(
    buildStoryRouterUrl('https://router.example', sourceKey, 'reader'),
    'https://router.example/open?source=story-v6%3A20260816t013548z%3Acharacter%3A0&target=reader',
  );
  assert.throws(
    () => buildStoryRouterUrl('https://router.example', sourceKey, 'https://other.example'),
    /reader 或 adv/,
  );
});

test('fails closed for missing or stale catalog rows', () => {
  assert.equal(findStoryRoute(manifest, sourceKey)?.reader.storyId, '310011');
  assert.equal(findStoryRoute(manifest, 'story-v6:20260816t013548z:character:1'), null);
  assert.throws(
    () => findStoryRoute(manifest, 'story-v6:20260817t013548z:character:0'),
    /版本/,
  );
});

test('registers the Halo console route with ESM shared dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aio-halo-ui-'));
  try {
    const ui = join(root, 'ui');
    await mkdir(ui, { recursive: true });
    await cp(new URL('../ui/main.js', import.meta.url), join(ui, 'main.js'));
    await cp(
      new URL('../ui/story-router-contract.js', import.meta.url),
      join(ui, 'story-router-contract.js'),
    );
    const packages = {
      '@halo-dev/ui-shared': 'export const definePlugin = (value) => value;\n',
      '@halo-dev/components': 'export const IconPlug = {};\n',
      vue: [
        'export const defineComponent = (value) => value;',
        'export const h = (...args) => ({ args });',
        'export const markRaw = (value) => value;',
        'export const ref = (value) => ({ value });',
      ].join('\n'),
    };
    for (const [name, source] of Object.entries(packages)) {
      const packageRoot = join(root, 'node_modules', ...name.split('/'));
      await mkdir(packageRoot, { recursive: true });
      await writeFile(
        join(packageRoot, 'package.json'),
        JSON.stringify({ name, type: 'module', exports: './index.js' }),
      );
      await writeFile(join(packageRoot, 'index.js'), source);
    }
    const loaded = await import(pathToFileURL(join(ui, 'main.js')).href);
    assert.equal(loaded.default.routes[0].route.path, '/aio-story-router');
    assert.equal(loaded.default.routes[0].route.meta.title, 'AIO 剧情路由桥');
    assert.deepEqual(loaded.default.extensionPoints, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
