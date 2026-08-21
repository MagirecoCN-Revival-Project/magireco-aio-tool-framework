import type { PageOverride, SiteConfig } from './config.js';

/**
 * SEO 组装。
 *
 * 这一层存在的理由：**2,400 个页面的内容全在浏览器里由插件渲染，
 * 爬虫看到的会是空壳。** 所以边缘侧必须自己产出标题、描述、canonical、
 * JSON-LD 与 sitemap，不能指望前端跑完再说。
 */

export interface PageMeta {
  readonly title: string;
  readonly description?: string;
  readonly canonicalPath?: string;
  readonly robots?: 'index' | 'noindex';
  readonly jsonld?: unknown;
  readonly image?: string;
}

export interface ResolvedMeta {
  readonly title: string;
  readonly description: string;
  readonly canonical: string;
  readonly robots: 'index' | 'noindex';
  readonly jsonld: unknown | null;
  readonly image: string | null;
}

/** 全站开关 + 前缀 + 单页覆盖，三者叠出最终的 index / noindex。 */
export function resolveRobots(
  config: SiteConfig,
  pathname: string,
  pageDefault: 'index' | 'noindex' | undefined,
  override: PageOverride | undefined,
): 'index' | 'noindex' {
  // 单页覆盖优先级最高——个别页面要临时收掉时不必动全站设置。
  if (override?.robots !== undefined) return override.robots;
  // 全站 none 是总闸，任何页面级 index 都盖不过它。收到通知时一键收缩用。
  if (config.seo.indexing === 'none') return 'noindex';
  if (pageDefault === 'noindex') return 'noindex';
  if (config.seo.indexing === 'all') return 'index';
  // selective：只有落在允许前缀里的才索引
  return config.seo.indexablePrefixes.some((p) => pathname === p || pathname.startsWith(p))
    ? 'index'
    : 'noindex';
}

export function resolveMeta(
  config: SiteConfig,
  pathname: string,
  meta: PageMeta,
): ResolvedMeta {
  const override = config.overrides[pathname];
  const title = override?.title ?? meta.title;
  const description = override?.description ?? meta.description ?? config.seo.defaultDescription;
  const canonicalPath = meta.canonicalPath ?? pathname;
  return {
    title: config.seo.titleTemplate.replace('%s', title),
    description,
    canonical: `${config.seo.canonicalOrigin}${canonicalPath}`,
    robots: resolveRobots(config, pathname, meta.robots, override),
    jsonld: meta.jsonld ?? null,
    image: meta.image ?? null,
  };
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);
}

/** 产出 `<head>` 里那几行。JSON-LD 用 `<\/` 转义，防脚本提前闭合。 */
export function renderHead(m: ResolvedMeta): string {
  const lines = [
    `<title>${escapeHtml(m.title)}</title>`,
    `<meta name="description" content="${escapeHtml(m.description)}">`,
    `<link rel="canonical" href="${escapeHtml(m.canonical)}">`,
    `<meta name="robots" content="${m.robots === 'index' ? 'index,follow' : 'noindex,nofollow'}">`,
    `<meta property="og:title" content="${escapeHtml(m.title)}">`,
    `<meta property="og:description" content="${escapeHtml(m.description)}">`,
    `<meta property="og:url" content="${escapeHtml(m.canonical)}">`,
    `<meta property="og:type" content="website">`,
  ];
  if (m.image !== null) {
    lines.push(`<meta property="og:image" content="${escapeHtml(m.image)}">`);
    lines.push(`<meta name="twitter:card" content="summary_large_image">`);
  }
  if (m.jsonld !== null) {
    const json = JSON.stringify(m.jsonld).replace(/<\//g, '<\\/');
    lines.push(`<script type="application/ld+json">${json}</script>`);
  }
  return lines.join('\n');
}

export interface SitemapEntry {
  readonly path: string;
  readonly changefreq?: string;
  readonly lastmod?: string;
}

export function renderSitemap(origin: string, entries: readonly SitemapEntry[]): string {
  const urls = entries.map((e) => {
    const parts = [`    <loc>${escapeHtml(origin + e.path)}</loc>`];
    if (e.lastmod !== undefined) parts.push(`    <lastmod>${e.lastmod}</lastmod>`);
    if (e.changefreq !== undefined) parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
    return `  <url>\n${parts.join('\n')}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function renderRobotsTxt(config: SiteConfig): string {
  if (config.seo.indexing === 'none') {
    // 全站关索引时不要再给 sitemap——那等于一边说别收一边递清单。
    return 'User-agent: *\nDisallow: /\n';
  }
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /admin/', 'Disallow: /api/'];
  if (config.seo.canonicalOrigin !== '') {
    lines.push('', `Sitemap: ${config.seo.canonicalOrigin}/sitemap.xml`);
  }
  return `${lines.join('\n')}\n`;
}
