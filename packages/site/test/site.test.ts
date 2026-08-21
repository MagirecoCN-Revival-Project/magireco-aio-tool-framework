import { describe, expect, it } from 'vitest';
import { Kernel } from '@aio/kernel';
import { createHeadlessSurfaceProvider, definePlugin } from '@aio/plugin-sdk';
import { Registry } from '@aio/registry';
import { Manifest, ManifestCdnProvider, OriginPool } from '@aio/resource';
import { parseRef } from '@aio/core';
import { Site, loadConfig, type EdgePlugin, type SiteConfig } from '@aio/site';

function cfg(over: Record<string, unknown> = {}): SiteConfig {
  return loadConfig({
    version: 1,
    seo: {
      siteName: '站', titleTemplate: '%s · 站', defaultDescription: 'D',
      indexing: 'all', canonicalOrigin: 'https://a.example',
    },
    ...over,
  }).config;
}

const storyPlugin: EdgePlugin = {
  id: 'adv-player',
  routes: [{ pattern: '/story/:id', changefreq: 'monthly',
             enumerate: () => ['/story/310241', '/story/310233'] }],
  render: (m) =>
    m.params['id'] === '310241'
      ? { meta: { title: `剧情 ${m.params['id']}` }, html: '<article>剧情正文</article>',
          needs: ['adv.play'], cacheTags: [`a:scenario/${m.params['id']}`] }
      : null,
};

const codexPlugin: EdgePlugin = {
  id: 'codex',
  routes: [{ pattern: '/character/:id', enumerate: () => ['/character/1001'] },
           { pattern: '/about' }],
  render: (m) => ({
    meta: { title: m.pattern === '/about' ? '关于' : `角色 ${m.params['id']}` },
    html: '<article>档案</article>',
    needs: ['sprite.show', 'model3d.show'],
    ...(m.params['id'] ? { cacheTags: [`a:character/${m.params['id']}`] } : {}),
  }),
};

function makeSite(config = cfg(), takedown?: Parameters<typeof Site.prototype.setTakedown>[0]) {
  const site = new Site({
    config,
    capabilityProviders: {
      'adv.play': ['adv-player'],
      'sprite.show': ['sprite-viewer'],
      'model3d.show': ['model-3d'],
    },
  });
  site.register(storyPlugin);
  site.register(codexPlugin);
  if (takedown) site.setTakedown(takedown);
  return site;
}

describe('页面渲染', () => {
  it('渲染出带 SEO 的服务端 HTML——爬虫看到的就是这一段', async () => {
    const r = await makeSite().handle('/story/310241');
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.html).toContain('剧情正文');
    expect(r.meta.title).toBe('剧情 310241 · 站');
    expect(r.meta.canonical).toBe('https://a.example/story/310241');
    expect(r.meta.robots).toBe('index');
  });

  it('插件说没有就是 404', async () => {
    const r = await makeSite().handle('/story/999999');
    expect(r).toEqual({ status: 404, reason: 'not-found' });
  });

  it('没有这条路由与插件被关掉，是两种 404——后台要分得出', async () => {
    expect(await makeSite().handle('/nope')).toEqual({ status: 404, reason: 'no-route' });
    const off = makeSite(cfg({ plugins: { 'adv-player': { enabled: false } } }));
    expect(await off.handle('/story/310241')).toEqual({ status: 404, reason: 'plugin-disabled' });
  });

  it('cacheTags 带上配置版本号——改了配置旧缓存必须失效', async () => {
    const c = { ...cfg(), revision: 7 };
    const site = makeSite(c);
    const r = await site.handle('/story/310241');
    if (r.status !== 200) throw new Error('应当 200');
    expect(r.cacheTags).toContain('rev:7');
    expect(r.cacheTags).toContain('a:scenario/310241');
  });
});

describe('🔴 一个开关同时管住两半', () => {
  it('关掉 adv-player：边缘 404、不进 sitemap、浏览器侧能力消失', async () => {
    const config = cfg({ plugins: { 'adv-player': { enabled: false } } });

    // ── 边缘侧 ──────────────────────────────────────────────
    const site = makeSite(config);
    expect((await site.handle('/story/310241')).status).toBe(404);
    expect(await site.sitemap()).not.toContain('/story/');
    expect(await site.sitemap()).toContain('/character/1001');

    // ── 浏览器侧：同一个 pluginId，同一个开关 ─────────────────
    const kernel = new Kernel({
      resources: new ManifestCdnProvider({
        origins: new OriginPool([{ base: 'https://a.example/' }]),
        manifests: [Manifest.from({
          version: 1, universe: 'a', kind: 'scenario',
          entries: { 'a:scenario/310241@zh': { parts: [{ path: 's.json', role: 'script' }] } },
        })],
      }),
      registry: Registry.empty(),
      surfaces: createHeadlessSurfaceProvider(),
    });
    const adv = definePlugin({
      manifest: { id: 'adv-player', version: '0', title: 'ADV', isolation: 'inline',
                  provides: [{ id: 'adv.play', accepts: ['scenario'] }] },
      mount: async () => ({ suspend: () => {}, resume: () => {}, dispose: () => {} }),
    });
    const scenario = parseRef('a:scenario/310241@zh');

    // 宿主启动时按同一份配置决定装不装
    if (config.plugins['adv-player']?.enabled !== false) kernel.register(adv);
    expect(kernel.can('adv.play', scenario)).toBe(false);
  });

  it('页面声明需要的能力，若提供者被关掉就不下发对应 chunk', async () => {
    const site = makeSite(cfg({ plugins: { 'sprite-viewer': { enabled: false } } }));
    const r = await site.handle('/character/1001');
    if (r.status !== 200) throw new Error('应当 200');
    // 页面照常渲染，只是少一项能力——宿主依然自洽
    expect(r.html).toContain('档案');
    expect(r.needs).toEqual(['model3d.show']);
  });
});

describe('sitemap', () => {
  it('只收开着的插件 + 可索引 + 未下架的页面', async () => {
    const site = makeSite();
    const xml = await site.sitemap();
    expect(xml).toContain('/story/310241');
    expect(xml).toContain('/character/1001');
    expect(xml).toContain('/about');
    expect(xml).toContain('<changefreq>monthly</changefreq>');
  });

  it('selective 模式下只列允许前缀', async () => {
    const site = makeSite(cfg({
      seo: { siteName: '站', titleTemplate: '%s · 站', defaultDescription: 'D',
             indexing: 'selective', indexablePrefixes: ['/character'],
             canonicalOrigin: 'https://a.example' },
    }));
    const xml = await site.sitemap();
    expect(xml).toContain('/character/1001');
    expect(xml).not.toContain('/story/');
  });

  it('全站关索引时 sitemap 是空的', async () => {
    const site = makeSite(cfg({
      seo: { siteName: '站', titleTemplate: '%s', defaultDescription: '',
             indexing: 'none', canonicalOrigin: 'https://a.example' },
    }));
    expect(await site.sitemap()).not.toContain('<loc>');
  });

  it('没展开的模板不会漏进 sitemap', async () => {
    const site = new Site({ config: cfg() });
    site.register({ id: 'x', routes: [{ pattern: '/thing/:id' }], render: () => null });
    expect(await site.sitemap()).not.toContain(':id');
    expect(site.unenumerableRoutes()).toEqual(['/thing/:id']);
  });
});

describe('下架', () => {
  it('按路径前缀下架：直接 404，不走插件渲染', async () => {
    const site = makeSite(cfg(), { refPrefixes: [], pathPrefixes: ['/story/'] });
    expect(await site.handle('/story/310241')).toEqual({ status: 404, reason: 'taken-down' });
    expect((await site.handle('/character/1001')).status).toBe(200);
  });

  it('按 ref 前缀下架：页面引用了被下架的资源也 404', async () => {
    const site = makeSite(cfg(), { refPrefixes: ['a:scenario/310241'], pathPrefixes: [] });
    expect(await site.handle('/story/310241')).toEqual({ status: 404, reason: 'taken-down' });
  });

  it('下架的页面不进 sitemap', async () => {
    const site = makeSite(cfg(), { refPrefixes: [], pathPrefixes: ['/story/'] });
    const xml = await site.sitemap();
    expect(xml).not.toContain('/story/');
    expect(xml).toContain('/character/1001');
  });

  it('前缀是前缀，不是完全匹配', async () => {
    const site = makeSite(cfg(), { refPrefixes: ['a:scenario/'], pathPrefixes: [] });
    expect((await site.handle('/story/310241')).status).toBe(404);
  });
});

describe('注册', () => {
  it('拒绝重复注册同一插件', () => {
    const site = makeSite();
    expect(() => site.register(codexPlugin)).toThrow(/重复注册/);
  });

  it('setConfig 热更新——边缘函数每次请求从 KV 读回来后调它', async () => {
    const site = makeSite();
    expect((await site.handle('/story/310241')).status).toBe(200);
    site.setConfig(cfg({ plugins: { 'adv-player': { enabled: false } } }));
    expect((await site.handle('/story/310241')).status).toBe(404);
  });
});
