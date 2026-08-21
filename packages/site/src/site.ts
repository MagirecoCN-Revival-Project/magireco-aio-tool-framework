import type { CapabilityId } from '@aio/core';
import { pluginEnabled, type SiteConfig } from './config.js';
import { RouteTable, type RouteDef, type RouteMatch } from './routes.js';
import {
  renderRobotsTxt, renderSitemap, resolveMeta,
  type PageMeta, type ResolvedMeta, type SitemapEntry,
} from './seo.js';

/**
 * 站点：把插件的**边缘那一半**装起来。
 *
 * `@aio/kernel` 的 `Plugin` 是浏览器侧的——它管交互。CMS 还需要边缘侧：
 * 路由、服务端渲染、SEO 元信息。两半由**同一个插件 id** 绑在一起，
 * 于是后台的一个开关同时管住两边：
 *
 *   关掉 adv-player  →  边缘：/story/:id 404，且不进 sitemap
 *                   →  浏览器：剧本行上的播放按钮消失
 *
 * 这是「统一管理」在代码上的落点。两半各写一套开关，迟早出现
 * 「后台显示关着，页面还在」这种查不出来的状态。
 */

export interface EdgePlugin {
  readonly id: string;
  readonly routes: readonly RouteDef[];
  /**
   * 渲染一个页面。返回 null 表示这条路径下没有这个东西（404），
   * 例如 `/character/9999`。
   */
  render(match: RouteMatch): Promise<EdgePage | null> | EdgePage | null;
}

export interface EdgePage {
  readonly meta: PageMeta;
  /** 服务端渲染出来的主体。爬虫看到的就是这一段。 */
  readonly html: string;
  /** 这个页面在浏览器里会用到哪些能力 → 决定下发哪些插件 chunk。 */
  readonly needs?: readonly CapabilityId[];
  /** 缓存标签，用于内容更新后精确 purge。 */
  readonly cacheTags?: readonly string[];
}

export interface RenderedPage {
  readonly status: 200;
  readonly meta: ResolvedMeta;
  readonly html: string;
  readonly needs: readonly CapabilityId[];
  readonly cacheTags: readonly string[];
  readonly pluginId: string;
}

export interface NotFound {
  readonly status: 404;
  readonly reason: 'no-route' | 'plugin-disabled' | 'not-found' | 'taken-down';
}

export type SiteResponse = RenderedPage | NotFound;

/**
 * 下架清单。
 *
 * **单独一份、单独一条读取路径。** 站点配置放 KV（最终一致，边缘缓存最长
 * 60 秒），而下架不能等 60 秒——版权方来函时那一分钟是实打实的暴露。
 * 所以这份走 Blob 的强一致模式读，代价是每次请求多一次强一致读，
 * 只在需要判定下架的路径上做。
 */
export interface TakedownList {
  /** 被下架的 ref 前缀，如 `a:scenario/310241`、`a:sprite/`。 */
  readonly refPrefixes: readonly string[];
  /** 被下架的路径前缀。 */
  readonly pathPrefixes: readonly string[];
}

export const EMPTY_TAKEDOWN: TakedownList = { refPrefixes: [], pathPrefixes: [] };

export function isTakenDown(list: TakedownList, pathname: string, refs: readonly string[]): boolean {
  if (list.pathPrefixes.some((p) => pathname === p || pathname.startsWith(p))) return true;
  return refs.some((r) => list.refPrefixes.some((p) => r === p || r.startsWith(p)));
}

export interface SiteOptions {
  readonly config: SiteConfig;
  readonly takedown?: TakedownList;
  /** 浏览器侧能力 → 提供它的插件 id。用于判断页面需要的能力还在不在。 */
  readonly capabilityProviders?: Readonly<Record<CapabilityId, readonly string[]>>;
}

export class Site {
  readonly #routes = new RouteTable();
  readonly #plugins = new Map<string, EdgePlugin>();
  #config: SiteConfig;
  #takedown: TakedownList;
  #providers: Readonly<Record<CapabilityId, readonly string[]>>;

  constructor(options: SiteOptions) {
    this.#config = options.config;
    this.#takedown = options.takedown ?? EMPTY_TAKEDOWN;
    this.#providers = options.capabilityProviders ?? {};
  }

  register(plugin: EdgePlugin): void {
    if (this.#plugins.has(plugin.id)) {
      throw new Error(`边缘插件 ${plugin.id} 重复注册`);
    }
    this.#plugins.set(plugin.id, plugin);
    for (const def of plugin.routes) this.#routes.add(plugin.id, def);
  }

  /** 热更新配置。边缘函数每次请求从 KV 读回来后调这个。 */
  setConfig(config: SiteConfig): void {
    this.#config = config;
  }

  setTakedown(list: TakedownList): void {
    this.#takedown = list;
  }

  get config(): SiteConfig {
    return this.#config;
  }

  #enabled = (pluginId: string): boolean => pluginEnabled(this.#config, pluginId);

  async handle(pathname: string): Promise<SiteResponse> {
    // 先判下架：被下架的路径连路由都不该走到，免得插件白做一次渲染。
    if (isTakenDown(this.#takedown, pathname, [])) {
      return { status: 404, reason: 'taken-down' };
    }

    // 匹配时不看开关，为的是把「没这条路由」与「插件被关了」分开报——
    // 后台要看得出是哪一种，压成一个 404 会让排查无从下手。
    const raw = this.#routes.match(pathname);
    if (raw === null) return { status: 404, reason: 'no-route' };
    if (!this.#enabled(raw.pluginId)) return { status: 404, reason: 'plugin-disabled' };

    const plugin = this.#plugins.get(raw.pluginId);
    /* c8 ignore next */
    if (plugin === undefined) return { status: 404, reason: 'no-route' };

    const page = await plugin.render(raw);
    if (page === null) return { status: 404, reason: 'not-found' };

    // 页面自己声明的 ref 也要过下架判定（角色页引用了被下架的精灵等）
    const refs = (page.cacheTags ?? []).filter((t) => t.includes(':'));
    if (isTakenDown(this.#takedown, raw.pathname, refs)) {
      return { status: 404, reason: 'taken-down' };
    }

    // 页面需要的能力，若其提供者被关掉，就不下发对应 chunk。
    // 页面本身照常渲染——少一项能力，页面依然自洽。
    const needs = (page.needs ?? []).filter((cap) =>
      (this.#providers[cap] ?? []).some((id) => this.#enabled(id)));

    return {
      status: 200,
      meta: resolveMeta(this.#config, raw.pathname, page.meta),
      html: page.html,
      needs,
      cacheTags: [...(page.cacheTags ?? []), `rev:${this.#config.revision}`],
      pluginId: raw.pluginId,
    };
  }

  /**
   * 生成 sitemap。只收**开着的插件** + **可索引** + **未下架**的页面。
   *
   * 这三道过滤必须在这里合并做一次：分散在别处的话，后台关了一个插件
   * 而 sitemap 还在递它的 URL，搜索引擎会一直来撞 404。
   */
  async sitemap(): Promise<string> {
    if (this.#config.seo.indexing === 'none') {
      return renderSitemap(this.#config.seo.canonicalOrigin, []);
    }
    const entries: SitemapEntry[] = [];
    for (const r of this.#routes.all(this.#enabled)) {
      const paths = r.def.enumerate === undefined
        ? [r.def.pattern]
        : await r.def.enumerate();
      for (const p of paths) {
        if (p.includes(':')) continue;                       // 没展开的模板不进
        if (isTakenDown(this.#takedown, p, [])) continue;
        const meta = resolveMeta(this.#config, p, { title: '' });
        if (meta.robots !== 'index') continue;
        entries.push(r.def.changefreq === undefined
          ? { path: p }
          : { path: p, changefreq: r.def.changefreq });
      }
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return renderSitemap(this.#config.seo.canonicalOrigin, entries);
  }

  robots(): string {
    return renderRobotsTxt(this.#config);
  }

  /** 带参数却没法枚举的路由——CI 里报出来，否则它们永远进不了 sitemap。 */
  unenumerableRoutes(): readonly string[] {
    return this.#routes.unenumerable();
  }
}
