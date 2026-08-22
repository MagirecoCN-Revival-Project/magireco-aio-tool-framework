/**
 * 嵌入面的**真正准入判定**（EdgeOne Pages Function）。
 *
 * 静态导出的页面发不出 404，也发不出 CSP。这两件事必须由请求路径上的东西做：
 *
 * - **下架**（铁律 11）：嵌入 URL 散在别人的页面里，重建我们的站碰不到它们
 *   一根汗毛。只有请求期这一道拦得住已经被复制出去的链接。
 * - **`frame-ancestors`**：发不出去等于白名单没生效，等于谁都能嵌，
 *   等于开放点击劫持。这条比 404 还要紧——它是**默认失效**的那种：
 *   忘了配，页面照常显示，没有任何报错。
 * - **`X-Robots-Tag: noindex`**：嵌入面被索引会与资料页构成重复内容。
 *
 * 判定本身全在 `@aio/embed` 的 `resolveEmbed()` 里，与浏览器侧、与
 * `@aio/site` 共用同一份判据和**同一张插件开关表**（铁律 10）。
 * 这个文件只负责：读配置 → 调它 → 把结果翻译成 HTTP。
 *
 * ---
 *
 * ## 🚧 待在真实平台上复核
 *
 * 以下三点按 EdgeOne Pages Functions 的文档写成，**尚未在真实环境跑通**
 * （与 `repository-policy.json` 的 `platform_limits.verified=false` 同一性质）：
 *
 * 1. 函数的文件路由是否吃 `[capability]` 这种动态段，以及它与静态产物
 *    `/embed/<cap>/index.html` 谁优先——**必须是函数优先**，否则静态页会
 *    直接命中，这一整道判定形同虚设；
 * 2. `context.next()` 能否取回同路径的静态产物以便改写响应头；
 * 3. KV 与 Blob 的读取 API 名称。
 *
 * 位置上跟着部署配置走：EdgeOne 两个项目的「根目录」都填仓库根（见
 * `docs/guide/deploy.md`），所以 `functions/` 也放在仓库根，而不是
 * `apps/station/` 下面。改了那边的根目录设置，这个目录要跟着挪。
 *
 * 第 1 条是**阻塞项**：如果平台做不到函数优先，就得把嵌入面挪到一个
 * 静态产物不存在的路径（如 `/e/<cap>`），由函数自己回源取 HTML。
 * 在复核之前，不要认为嵌入面的安全约束已经生效。
 */

import { resolveEmbed } from '@aio/embed';
import { loadConfig } from '@aio/site';
// 能力 → 插件 id。**生成物，不要手改**：由 apps/station 的插件目录推导，
// `apps/station/test/providers-snapshot.test.ts` 在 CI 里盯着它别漂。
//
// 早先这里读的是一个手填的环境变量。那等于把铁律 10 的判据交给一次复制粘贴：
// 填漏一条，新插件的能力就嵌不出去，而且不报错——正是「两张表各自自洽」
// 那种查不出来的状态。
import PROVIDERS from './providers.generated.json' with { type: 'json' };

/** 允许把我们嵌进去的来源。逗号分隔，**没有默认值**——留空即谁都不许嵌。 */
function policyFrom(env) {
  const raw = (env && env.AIO_EMBED_ANCESTORS) || '';
  return {
    allowedAncestors: raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
  };
}

async function readConfig(env) {
  try {
    const raw = await env.AIO_KV.get('site-config', { type: 'json' });
    return loadConfig(raw).config;
  } catch {
    // 读不到配置时用默认值继续，而不是 500。
    // 默认值里 plugins 为空 = 全部视为开着，与 @aio/site 的 pluginEnabled 一致。
    return loadConfig(null).config;
  }
}

async function readTakedown(env) {
  // 下架单独走强一致读（Blob），不跟配置一起放 KV：
  // KV 最终一致、边缘缓存最长 60 秒，而下架那一分钟是实打实的暴露。
  try {
    const raw = await env.AIO_BLOB.get('takedown.json', { type: 'json' });
    if (raw && Array.isArray(raw.refPrefixes) && Array.isArray(raw.pathPrefixes)) {
      return raw;
    }
  } catch {
    /* 读失败时落到下面的保守值 */
  }
  // 🔴 读不到下架清单时**不能**当成「没有下架任何东西」。
  // 那是把失败解释成许可。这里返回 null，调用方据此 503——
  // 「暂时打不开」是可接受的，「本该下架的东西照常放出去」不是。
  return null;
}

export async function onRequest(context) {
  const { request, env, params, next } = context;
  const url = new URL(request.url);

  const takedown = await readTakedown(env);
  if (takedown === null) {
    return new Response('下架清单暂时读不到，嵌入面已暂停', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  }

  const config = await readConfig(env);
  const decision = resolveEmbed(
    `/embed/${params.capability}`,
    url.search,
    {
      config,
      policy: policyFrom(env),
      takedown,
      capabilityProviders: PROVIDERS,
    },
  );

  if (decision.status !== 200) {
    // 理由只回给日志，不回给调用方：区分「被下架」与「插件关了」
    // 对外是信息泄露（能探测出哪些东西存在过）。
    console.warn(`[embed] ${decision.status} ${decision.reason}: ${decision.message}`);
    return new Response(null, {
      status: decision.status,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  }

  const res = await next();
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(decision.headers)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
