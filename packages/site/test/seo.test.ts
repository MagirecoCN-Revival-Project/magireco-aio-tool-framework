import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, escapeHtml, loadConfig, renderHead, renderRobotsTxt,
  renderSitemap, resolveMeta, resolveRobots, type SiteConfig,
} from '@aio/site';

const base: SiteConfig = loadConfig({
  version: 1,
  seo: {
    siteName: '资料站', titleTemplate: '%s · 资料站',
    defaultDescription: '默认描述', indexing: 'selective',
    indexablePrefixes: ['/character'], canonicalOrigin: 'https://a.example',
  },
}).config;

describe('robots 判定', () => {
  it('selective：只有落在允许前缀里的才索引', () => {
    expect(resolveRobots(base, '/character/1001', undefined, undefined)).toBe('index');
    expect(resolveRobots(base, '/story/310241', undefined, undefined)).toBe('noindex');
  });

  it('全站 none 是总闸，页面级 index 也盖不过', () => {
    const off = { ...base, seo: { ...base.seo, indexing: 'none' as const } };
    expect(resolveRobots(off, '/character/1001', 'index', undefined)).toBe('noindex');
  });

  it('单页覆盖优先级最高——临时收掉个别页面不必动全站', () => {
    expect(resolveRobots(base, '/character/1001', 'index', { robots: 'noindex' })).toBe('noindex');
    expect(resolveRobots(base, '/story/1', undefined, { robots: 'index' })).toBe('index');
  });

  it('页面自己声明 noindex 时，selective 也不会把它拉回来', () => {
    expect(resolveRobots(base, '/character/1001', 'noindex', undefined)).toBe('noindex');
  });
});

describe('meta 组装', () => {
  it('套标题模板、补默认描述、拼 canonical', () => {
    const m = resolveMeta(base, '/character/1001', { title: '角色甲' });
    expect(m.title).toBe('角色甲 · 资料站');
    expect(m.description).toBe('默认描述');
    expect(m.canonical).toBe('https://a.example/character/1001');
    expect(m.robots).toBe('index');
  });

  it('覆盖项盖过页面自己的标题与描述', () => {
    const cfg = { ...base, overrides: { '/character/1001': { title: 'T', description: 'D' } } };
    const m = resolveMeta(cfg, '/character/1001', { title: '角色甲', description: '原描述' });
    expect(m.title).toBe('T · 资料站');
    expect(m.description).toBe('D');
  });
});

describe('渲染', () => {
  it('转义 HTML，不让内容打断标签', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    const head = renderHead(resolveMeta(base, '/x', { title: '<script>alert(1)</script>' }));
    expect(head).not.toContain('<script>alert');
    expect(head).toContain('&lt;script&gt;');
  });

  it('JSON-LD 里的 </ 被转义，防脚本提前闭合', () => {
    const head = renderHead(resolveMeta(base, '/x', {
      title: 'T', jsonld: { name: '</script><img onerror=1>' },
    }));
    expect(head).not.toContain('</script><img');
    expect(head).toContain('<\\/script>');
  });

  it('sitemap 只列给出的条目', () => {
    const xml = renderSitemap('https://a.example', [
      { path: '/character/1001', changefreq: 'weekly' },
    ]);
    expect(xml).toContain('<loc>https://a.example/character/1001</loc>');
    expect(xml).toContain('<changefreq>weekly</changefreq>');
  });

  it('全站关索引时 robots.txt 不再递 sitemap', () => {
    const off = { ...base, seo: { ...base.seo, indexing: 'none' as const } };
    const txt = renderRobotsTxt(off);
    expect(txt).toContain('Disallow: /');
    expect(txt).not.toContain('Sitemap:');
  });

  it('正常时挡掉后台与 API，并递 sitemap', () => {
    const txt = renderRobotsTxt(base);
    expect(txt).toContain('Disallow: /admin/');
    expect(txt).toContain('Sitemap: https://a.example/sitemap.xml');
  });

  it('默认配置没有 canonicalOrigin 时不产出空 Sitemap 行', () => {
    expect(renderRobotsTxt(DEFAULT_CONFIG)).not.toContain('Sitemap:');
  });
});
