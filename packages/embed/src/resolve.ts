import type { CapabilityId } from '@aio/core';
import { formatRef } from '@aio/core';
import { EMPTY_TAKEDOWN, isTakenDown, pluginEnabled } from '@aio/site';
import type { SiteConfig, TakedownList } from '@aio/site';
import { EmbedError, parseEmbedRequest } from './request.js';
import type { EmbedRequest } from './request.js';
import { embedCsp } from './policy.js';
import type { EmbedPolicy } from './policy.js';

export interface EmbedOptions {
  readonly config: SiteConfig;
  readonly policy: EmbedPolicy;
  readonly takedown?: TakedownList;
  /** 能力 → 提供它的插件 id。与 `@aio/site` 用的是**同一张表**（铁律 10）。 */
  readonly capabilityProviders: Readonly<Record<CapabilityId, readonly string[]>>;
  /**
   * 放行的响应可以被边缘缓存多少秒。**缺省 0 = 不缓存。**
   *
   * ## 这个数字就是你的下架暴露窗口
   *
   * 缓存住的响应**不会再经过这里**——不重新读下架清单、不重新看插件开关。
   * 所以 `cacheSeconds: 300` 的意思是「收到下架通知后，最坏还要 300 秒
   * 才对所有人生效」（外加一次 purge 能不能追上）。
   *
   * 缺省取 0 而不是某个「合理值」：铁律 11 要的是请求期每次都判，
   * 而任何非 0 值都是对它的**削弱**。削弱可以，但必须是有人明确写下这个
   * 数字、并知道自己在拿什么换什么——不能是缺省值悄悄替他做了决定。
   *
   * ## 拿什么换
   *
   * 换的是**函数调用次数与 CPU 时间**。嵌入 URL 长在别人的页面上，
   * 流量不由我们控制：一个页面上了热门，或者有人对着嵌入 URL 打，
   * 烧的都是我们的配额。缓存是这条路径上唯一真正有效的省法——
   * 命中缓存的请求根本不会触发函数。
   *
   * 所以这是个**成本与合规的直接对赌**，没有两全的选项。
   * 部署侧怎么定，见 `docs/guide/edge.md`。
   */
  readonly cacheSeconds?: number;
}

export interface EmbedAllowed {
  readonly status: 200;
  readonly request: EmbedRequest;
  /** 由哪个插件来服务。目录 id 必须与浏览器侧 manifest 的 id 相同。 */
  readonly pluginId: string;
  /** 必须原样下发的响应头。 */
  readonly headers: Readonly<Record<string, string>>;
}

export interface EmbedRejected {
  readonly status: 400 | 404;
  readonly reason:
    | EmbedError['code']
    | 'no-provider'
    | 'plugin-disabled'
    | 'taken-down';
  readonly message: string;
}

export type EmbedDecision = EmbedAllowed | EmbedRejected;

/**
 * 缓存指令。缺省（0 或没写）一律 `no-store`。
 *
 * 非整数、负数、NaN 都当成 0——**坏输入落到最安全的那一侧**。
 * 反过来（当成「很大的值」或直接抛）都更糟：前者悄悄开了个长暴露窗口，
 * 后者让一个手滑的配置把整个嵌入面打成 500。
 */
function cacheControl(seconds: number | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return 'no-store';
  }
  const n = Math.floor(seconds);
  // s-maxage 单独写：共享缓存（边缘）与浏览器可以不同，而省配额靠的是前者。
  return `public, max-age=${n}, s-maxage=${n}`;
}

/**
 * 嵌入面的**唯一**准入判定。
 *
 * 判定顺序是有讲究的，从「与内容无关」到「与内容有关」：
 *
 * 1. **解析** —— 路径、能力、ref、参数。裸 ID 在这一步就被挡住（铁律 1）。
 * 2. **下架** —— 排在能力判定之前。被下架的东西不该因为「恰好没有插件提供
 *    这个能力」而报成 404 no-provider：那会让下架看起来像功能缺失，
 *    排查时分不清是真下架了还是配置错了。
 * 3. **插件开关** —— 与浏览器侧同一个 id、同一个开关（铁律 10）。
 * 4. 放行。
 *
 * ## 为什么下架要在请求期再判一次
 *
 * 构建期把它排除出产物与 sitemap 只解决「找不到」，解决不了「已经被谁
 * 抄走了 URL 直接来访」——尤其嵌入 URL 天然是散播在别人页面上的。
 * 这正是铁律 11 那两处必须都做的原因，嵌入面把这件事放大了：
 * 一条嵌入 URL 可能躺在几十个 wiki 页面里，重建我们的站不会动它们一根汗毛。
 */
export function resolveEmbed(
  pathname: string,
  search: string | URLSearchParams,
  options: EmbedOptions,
): EmbedDecision {
  let request: EmbedRequest;
  try {
    request = parseEmbedRequest(pathname, search);
  } catch (e) {
    if (e instanceof EmbedError) {
      // 「不认识这个能力」是 404 而不是 400：请求本身没写错，
      // 是这个东西在这个部署里不存在。
      const status = e.code === 'unknown-capability' ? 404 : 400;
      return { status, reason: e.code, message: e.message };
    }
    /* c8 ignore next */
    throw e;
  }

  const takedown = options.takedown ?? EMPTY_TAKEDOWN;
  const ref = formatRef(request.ref);
  if (isTakenDown(takedown, pathname, [ref])) {
    return { status: 404, reason: 'taken-down', message: `${ref} 已下架` };
  }

  const providers = options.capabilityProviders[request.capability] ?? [];
  if (providers.length === 0) {
    return {
      status: 404,
      reason: 'no-provider',
      message: `这个部署里没有实现 ${request.capability} 的插件`,
    };
  }
  const live = providers.find((id) => pluginEnabled(options.config, id));
  if (live === undefined) {
    return {
      status: 404,
      reason: 'plugin-disabled',
      message: `提供 ${request.capability} 的插件都被关掉了`,
    };
  }

  return {
    status: 200,
    request,
    pluginId: live,
    headers: {
      'Content-Security-Policy': embedCsp(options.policy),
      // 嵌入面**永不进索引**。它是别人页面里的一块 UI，不是一个页面：
      // 被索引会与真正的资料页构成重复内容，而且用户从搜索点进来看到的是
      // 一个没有导航、没有上下文的裸组件。
      'X-Robots-Tag': 'noindex, nofollow',
      // 缓存策略是**显式**的。不写的话由平台默认决定，而平台默认是我们
      // 不知道、也不该赌的东西——同一份产物换个托管就换个行为。
      'Cache-Control': cacheControl(options.cacheSeconds),
      // 配置改了要让边缘缓存失效，与 @aio/site 的 cacheTags 同源。
      // ref 单独成一个 tag：下架时要能只 purge 掉那一条，
      // 而不是把整个嵌入面的缓存都清了。
      'Cache-Tag': `embed,rev:${options.config.revision},${ref}`,
      Vary: 'Origin',
    },
  };
}
