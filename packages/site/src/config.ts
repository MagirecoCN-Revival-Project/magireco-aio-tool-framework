import type { CapabilityId } from '@aio/core';

/**
 * 站点配置——CMS 的「设置」那一层。
 *
 * ## 存哪里
 *
 * 这份配置活在 EdgeOne KV 里，由后台写、边缘函数读。**KV 是最终一致的，
 * 边缘缓存最长 60 秒**——后台改一个开关，最坏情况下要 60 秒才全网生效。
 *
 * 对绝大多数设置（导航、SEO 文案、插件开关）这没问题。**只有一件事不能等：
 * 下架。** 版权方来函要求下架时 60 秒的窗口是不可接受的，所以 `takedown`
 * 单独走 Blob 的强一致模式读，见 `TakedownList` 的说明。
 *
 * ## 为什么不做内容编辑器
 *
 * 这个站的内容 95% 是**生成的**，不是编辑出来的：725 篇剧情、241 个角色、
 * 1,404 条卡牌都来自交叉表与资源清单。真正需要人编辑的只有站点设置、
 * 导航、公告，以及个别页面的 SEO 覆盖。
 *
 * 所以这里没有 `posts` / `pages` 这类表——**内容是管道产物，配置才是内容管理**。
 */

export interface PluginSetting {
  /** 关掉之后：边缘侧的路由 404 且不进 sitemap，浏览器侧的能力入口消失。 */
  readonly enabled: boolean;
  /** 后台上的备注，说明为什么关着。 */
  readonly note?: string;
}

export interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly children?: readonly NavItem[];
}

export type IndexingMode =
  /** 全站允许索引。 */
  | 'all'
  /** 全站 noindex。总开关，用于收到通知后立刻收缩可见面。 */
  | 'none'
  /** 只索引显式标了 index 的路径前缀，其余 noindex。默认。 */
  | 'selective';

export interface SeoSettings {
  readonly siteName: string;
  /** 标题模板，`%s` 是页面标题。 */
  readonly titleTemplate: string;
  readonly defaultDescription: string;
  readonly indexing: IndexingMode;
  /** `indexing: 'selective'` 时，允许索引的路径前缀。 */
  readonly indexablePrefixes: readonly string[];
  /** 站点规范域名，用于 canonical 与 sitemap。 */
  readonly canonicalOrigin: string;
}

/** 单页 SEO 覆盖：路径 → 覆盖项。少量人工干预用。 */
export interface PageOverride {
  readonly title?: string;
  readonly description?: string;
  readonly robots?: 'index' | 'noindex';
}

export interface SiteConfig {
  readonly version: number;
  /** 每次保存自增，用作边缘缓存的一部分。改了配置必须让旧缓存失效。 */
  readonly revision: number;
  readonly plugins: Readonly<Record<string, PluginSetting>>;
  readonly nav: readonly NavItem[];
  readonly seo: SeoSettings;
  readonly overrides: Readonly<Record<string, PageOverride>>;
}

export class SiteConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteConfigError';
  }
}

export const DEFAULT_CONFIG: SiteConfig = {
  version: 1,
  revision: 0,
  plugins: {},
  nav: [],
  seo: {
    siteName: '',
    titleTemplate: '%s',
    defaultDescription: '',
    // 默认 selective 而不是 all：新上线的路由默认不进索引，
    // 要索引得显式加前缀。反过来（默认全收）意味着任何人加一条路由
    // 都会顺带把它推给搜索引擎，而没人会在加路由时想到这件事。
    indexing: 'selective',
    indexablePrefixes: [],
    canonicalOrigin: '',
  },
  overrides: {},
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 校验并补全从 KV 读回来的配置。
 *
 * **坏配置一律回退到默认值并报告问题，绝不抛错。** 这份东西在边缘函数里
 * 每次请求都要读；一个手滑写坏的 JSON 不该让整站 500。
 */
export function loadConfig(raw: unknown): { config: SiteConfig; problems: readonly string[] } {
  const problems: string[] = [];
  if (!isPlainObject(raw)) {
    return { config: DEFAULT_CONFIG, problems: ['配置不是对象，已回退默认值'] };
  }
  if (raw['version'] !== 1) {
    problems.push(`不认识的配置版本 ${String(raw['version'])}，已回退默认值`);
    return { config: DEFAULT_CONFIG, problems };
  }

  const plugins: Record<string, PluginSetting> = {};
  if (isPlainObject(raw['plugins'])) {
    for (const [id, v] of Object.entries(raw['plugins'])) {
      if (!isPlainObject(v) || typeof v['enabled'] !== 'boolean') {
        problems.push(`插件设置 ${id} 格式不对，按「关闭」处理`);
        plugins[id] = { enabled: false };
        continue;
      }
      plugins[id] = typeof v['note'] === 'string'
        ? { enabled: v['enabled'], note: v['note'] }
        : { enabled: v['enabled'] };
    }
  }

  const seoRaw = isPlainObject(raw['seo']) ? raw['seo'] : {};
  const indexing = seoRaw['indexing'];
  const seo: SeoSettings = {
    siteName: str(seoRaw['siteName'], DEFAULT_CONFIG.seo.siteName),
    titleTemplate: str(seoRaw['titleTemplate'], DEFAULT_CONFIG.seo.titleTemplate),
    defaultDescription: str(seoRaw['defaultDescription'], DEFAULT_CONFIG.seo.defaultDescription),
    indexing:
      indexing === 'all' || indexing === 'none' || indexing === 'selective'
        ? indexing
        : DEFAULT_CONFIG.seo.indexing,
    indexablePrefixes: strArray(seoRaw['indexablePrefixes']),
    canonicalOrigin: str(seoRaw['canonicalOrigin'], '').replace(/\/+$/, ''),
  };
  if (indexing !== undefined && seo.indexing !== indexing) {
    problems.push(`indexing 取值 ${String(indexing)} 非法，已用 ${seo.indexing}`);
  }
  if (!seo.titleTemplate.includes('%s')) {
    problems.push('titleTemplate 里没有 %s，页面标题会被丢掉；已回退默认模板');
    return {
      config: { ...DEFAULT_CONFIG, plugins, seo: { ...seo, titleTemplate: '%s' } },
      problems,
    };
  }

  const overrides: Record<string, PageOverride> = {};
  if (isPlainObject(raw['overrides'])) {
    for (const [path, v] of Object.entries(raw['overrides'])) {
      if (!isPlainObject(v)) {
        problems.push(`覆盖项 ${path} 格式不对，已忽略`);
        continue;
      }
      const robots = v['robots'];
      overrides[path] = {
        ...(typeof v['title'] === 'string' ? { title: v['title'] } : {}),
        ...(typeof v['description'] === 'string' ? { description: v['description'] } : {}),
        ...(robots === 'index' || robots === 'noindex' ? { robots } : {}),
      };
    }
  }

  return {
    config: {
      version: 1,
      revision: typeof raw['revision'] === 'number' ? raw['revision'] : 0,
      plugins,
      nav: Array.isArray(raw['nav']) ? (raw['nav'] as NavItem[]) : [],
      seo,
      overrides,
    },
    problems,
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function strArray(v: unknown): readonly string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** 插件开没开。**没登记的插件视为开着**——新装的插件不该默认隐身。 */
export function pluginEnabled(config: SiteConfig, pluginId: string): boolean {
  return config.plugins[pluginId]?.enabled ?? true;
}

/** 这个页面在浏览器里要用的能力，有没有被开关砍掉。 */
export function capabilityAllowed(
  config: SiteConfig,
  providers: Readonly<Record<CapabilityId, readonly string[]>>,
  capability: CapabilityId,
): boolean {
  return (providers[capability] ?? []).some((id) => pluginEnabled(config, id));
}
