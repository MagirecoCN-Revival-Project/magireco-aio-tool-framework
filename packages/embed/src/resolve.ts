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
      // 配置改了要让边缘缓存失效，与 @aio/site 的 cacheTags 同源。
      'Cache-Tag': `embed,rev:${options.config.revision},${ref}`,
      Vary: 'Origin',
    },
  };
}
