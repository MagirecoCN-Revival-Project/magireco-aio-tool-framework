/**
 * 嵌入面：准入判定 + 吐 HTML（EdgeOne Pages Function）。
 *
 * ## 为什么这个函数**自己**返回 HTML，而不是 next() 拿静态产物
 *
 * **EdgeOne Pages 在路由冲突时静态优先。** 官方文档写明：Edge Functions 与
 * Node.js Functions 的路由若与静态资源冲突，请求优先被路由到静态资源，
 * 函数不会被触发（2026-08-22 查证）。
 *
 * 所以只要 `out/embed/sprite.show.html` 存在，这个文件就是一段死代码，
 * 而准入判定整个不存在。后果不是「函数没生效」这么轻：
 *
 * - 被下架的 ref 照常放出去（铁律 11 的请求期那一道失效）；
 * - 后台关掉的插件，嵌在别人页面上的还在放（铁律 10 失效）；
 * - **谁都能把这个页面套进 iframe**——`frame-ancestors` 只能由响应头下发
 *   （CSP 规范明确规定它在 `<meta>` 里被忽略），发不出去等于开放点击劫持。
 *   而这件事不报错、页面照常显示。
 *
 * 于是构建后由 `tools/pack-embed-pages.mjs` 把 `out/embed/` 整个搬进
 * `pages.generated.js` 并删掉原目录：那条路径下没有静态产物了，
 * 函数才会被触发，HTML 也就只能由它来给。
 *
 * ## 哪些约束在这里，哪些不在
 *
 * | 约束 | 在哪 | 为什么 |
 * |---|---|---|
 * | `frame-ancestors` | **只能在这里** | CSP 规范：`<meta>` 里被忽略 |
 * | 下架、插件开关 | **只能在这里** | 静态页读不到 KV/Blob |
 * | `noindex` | 页面里也有一份 | 能由静态携带的就别只靠响应头 |
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
import { EMBED_PAGES } from './pages.generated.js';

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
  // 下架单独走强一致读（Blob），不跟配置一起放 KV。
  //
  // 官方文档（2026-08-22 核实）：
  //   - KV 最终一致，**边缘缓存最长 60 秒**——那一分钟是实打实的暴露；
  //   - Blob 默认也是最终一致，但**可对单次读切到强一致**，立即读到最新值。
  //     官方同时写明这会增加读延迟，「should be used only when absolutely
  //     necessary」——所以只有下架清单这一处用它，站点配置照旧走 KV。
  //
  // 🚧 **速率/次数配额没查到**：官方限额页在当前环境取不到，未经复核不写数字
  //    （见 repository-policy.json 的 platform_limits.storage.rate_limits）。
  //    这条路径每个请求做一次强一致读，配额若紧，热门嵌入会打满。
  //    打满后走下面的 fail-closed：503，而不是放行。
  //
  //    真上线前必须拿到那两个数字。要是紧到扛不住，可选的缓解是给这份清单
  //    加一个**很短**的进程内缓存（几秒），用一个**明确写出来的**暴露窗口
  //    换掉大部分读——但那是要拍板的取舍，不是实现顺手加的。
  try {
    // 🚧🔴 `consistency: 'strong'` 这个**选项名尚未核实**（官方限额/存储文档
    //     在当前环境取不到）。这不是小事：选项名写错的话，SDK 多半**静默忽略**
    //     它，于是这里退回最终一致读——看起来一切正常，而下架的生效窗口
    //     悄悄变回分钟级。正是铁律 11 要防的那种失效。
    //
    //     上线前必须核实两件事，并把结论写回 repository-policy.json：
    //       1. 请求单次强一致读的确切写法；
    //       2. 怎么**验证**它真的生效了（能观测到就写个探针，观测不到就
    //          用一次真实下架去实测传播延迟）。
    const raw = await env.AIO_BLOB.get('takedown.json', {
      type: 'json',
      consistency: 'strong',
    });
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

const deny = (status) =>
  new Response(null, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const capability = params.capability;

  const takedown = await readTakedown(env);
  if (takedown === null) {
    return new Response('下架清单暂时读不到，嵌入面已暂停', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }

  const config = await readConfig(env);
  const decision = resolveEmbed(`/embed/${capability}`, url.search, {
    config,
    policy: policyFrom(env),
    takedown,
    capabilityProviders: PROVIDERS,
  });

  if (decision.status !== 200) {
    // 理由只回给日志，不回给调用方：区分「被下架」与「插件关了」
    // 对外是信息泄露（能探测出哪些东西存在过）。
    console.warn(`[embed] ${decision.status} ${decision.reason}: ${decision.message}`);
    return deny(decision.status);
  }

  const html = EMBED_PAGES[capability];
  if (html === undefined) {
    // 判定放行了却没有页面，说明生成物与契约表不同步。
    // 这是我们自己的构建问题，不该表现成对调用方的 404。
    console.error(`[embed] 判定放行 ${capability} 但 pages.generated.js 里没有它`);
    return deny(404);
  }

  return new Response(html, {
    status: 200,
    headers: {
      ...decision.headers,
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}
