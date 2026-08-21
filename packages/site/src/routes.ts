/**
 * 路由：URL → 插件页面。
 *
 * 模式语法只有两种段：静态段与 `:param`。**没有正则、没有可选段。**
 * 路由表是 sitemap 的来源，越花哨越难枚举，而枚举不出来的路由等于没有 SEO。
 */

export interface RouteMatch {
  readonly pattern: string;
  readonly pathname: string;
  readonly params: Readonly<Record<string, string>>;
}

export interface RouteDef {
  /** 形如 `/character/:id` 或 `/about`。必须以 / 开头。 */
  readonly pattern: string;
  /**
   * 枚举这条路由下的全部具体 URL，用于生成 sitemap。
   * 带 `:param` 的路由**必须**提供，否则它永远进不了 sitemap。
   */
  readonly enumerate?: () => Promise<readonly string[]> | readonly string[];
  /** 这一类页面的变更频率提示，写进 sitemap。 */
  readonly changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
}

export class RouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteError';
  }
}

const SEG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PARAM = /^:[a-z][a-zA-Z0-9]*$/;

interface Compiled {
  readonly pattern: string;
  readonly segments: readonly string[];
  readonly specificity: number;
  readonly pluginId: string;
  readonly def: RouteDef;
}

export function compilePattern(pattern: string): readonly string[] {
  if (!pattern.startsWith('/')) throw new RouteError(`路由 ${pattern} 必须以 / 开头`);
  if (pattern === '/') return [];
  if (pattern.endsWith('/')) throw new RouteError(`路由 ${pattern} 不要以 / 结尾`);
  const segs = pattern.slice(1).split('/');
  for (const s of segs) {
    if (!PARAM.test(s) && !SEG.test(s)) throw new RouteError(`路由 ${pattern} 的段 ${s} 非法`);
  }
  return segs;
}

/** 规范化请求路径：去掉尾斜杠、折叠重复斜杠。根路径保持 `/`。 */
export function normalizePath(pathname: string): string {
  const collapsed = `/${pathname.split('/').filter(Boolean).join('/')}`;
  return collapsed;
}

export class RouteTable {
  readonly #routes: Compiled[] = [];

  add(pluginId: string, def: RouteDef): void {
    const segments = compilePattern(def.pattern);
    const existing = this.#routes.find((r) => r.pattern === def.pattern);
    if (existing !== undefined) {
      throw new RouteError(
        `路由 ${def.pattern} 被 ${existing.pluginId} 与 ${pluginId} 同时注册`,
      );
    }
    // 静态段比参数段更具体：/character/new 应当赢过 /character/:id。
    // 不这么排的话，注册顺序会决定行为，而注册顺序是隐式的。
    const specificity = segments.reduce((n, s) => n + (s.startsWith(':') ? 1 : 2), 0);
    this.#routes.push({ pattern: def.pattern, segments, specificity, pluginId, def });
    this.#routes.sort((a, b) =>
      b.segments.length - a.segments.length ||
      b.specificity - a.specificity ||
      a.pattern.localeCompare(b.pattern));
  }

  /** 匹配一个路径。`isEnabled` 用来跳过被关掉的插件——关掉即 404。 */
  match(
    pathname: string,
    isEnabled: (pluginId: string) => boolean = () => true,
  ): (RouteMatch & { pluginId: string; def: RouteDef }) | null {
    const path = normalizePath(pathname);
    const parts = path === '/' ? [] : path.slice(1).split('/');
    for (const r of this.#routes) {
      if (r.segments.length !== parts.length) continue;
      if (!isEnabled(r.pluginId)) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < r.segments.length; i++) {
        const seg = r.segments[i] as string;
        const got = parts[i] as string;
        if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(got);
        else if (seg !== got) { ok = false; break; }
      }
      if (ok) return { pattern: r.pattern, pathname: path, params, pluginId: r.pluginId, def: r.def };
    }
    return null;
  }

  /** 全部路由，按插件过滤。 */
  all(isEnabled: (pluginId: string) => boolean = () => true): readonly Compiled[] {
    return this.#routes.filter((r) => isEnabled(r.pluginId));
  }

  /** 带参数却没有 enumerate 的路由——它们进不了 sitemap，应当在 CI 里报出来。 */
  unenumerable(): readonly string[] {
    return this.#routes
      .filter((r) => r.segments.some((s) => s.startsWith(':')) && r.def.enumerate === undefined)
      .map((r) => r.pattern);
  }
}
