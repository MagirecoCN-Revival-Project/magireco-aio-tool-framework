/**
 * `@aio/embed` —— 把能力**嵌出去**的那一面。
 *
 * 别的站（合作的 wiki、第三方资料站）在自己的页面里放一个 iframe，
 * 就能得到我们的查看器；他们不需要装 npm 包、不需要懂内核、
 * 也拿不到我们的任何内部对象——**通道里只过数据**。
 *
 * ```
 *   他们的页面                      我们的边缘
 *   ┌────────────────┐              ┌──────────────────────┐
 *   │ <iframe src=   │ ──── GET ──▶ │ resolveEmbed()       │
 *   │  …/embed/…  >  │              │  ├ 解析（拒裸 ID）    │
 *   │                │ ◀── HTML ─── │  ├ 下架判定           │
 *   │  message 监听  │ ◀ postMessage│  ├ 插件开关           │
 *   └────────────────┘              │  └ CSP frame-ancestors│
 *                                   └──────────────────────┘
 * ```
 *
 * ## 装不装它，宿主都自洽
 *
 * 不装 `@aio/embed` 的宿主就是「不对外提供嵌入」，别的什么都不少。
 * 这是本仓库那条判据在这一层的兑现：少装一个模块，少一项能力，不塌。
 *
 * ## 三条必须一起看的约束
 *
 * - **铁律 1**：嵌入 URL 里的 ref 走 `parseRef`，裸 ID 直接 400。
 *   嵌入 URL 是**别人手写**的，比任何内部调用都更需要这道闸。
 * - **铁律 10**：准入用的是与浏览器侧同一个插件 id、同一个开关。
 *   后台关掉一个插件，嵌在别人页面上的那些当场 404，而不是继续放。
 * - **铁律 11**：下架在请求期再判一次。嵌入 URL 散在别人的页面里，
 *   重建我们的站碰不到它们——只有请求期这一道拦得住。
 */
export {
  EMBED_PREFIX,
  EmbedError,
  buildEmbedUrl,
  parseEmbedRequest,
} from './request.js';
export type { EmbedRequest } from './request.js';

export {
  DENY_ALL,
  EmbedPolicyError,
  embedCsp,
  frameAncestors,
  isAllowedAncestor,
  parsePolicy,
} from './policy.js';
export type { EmbedPolicy } from './policy.js';

export {
  EMBED_PROTOCOL_VERSION,
  MAX_EMBED_HEIGHT,
  eventMessage,
  isEmbedMessage,
  readyMessage,
  resizeMessage,
} from './protocol.js';
export type {
  EmbedEventMessage,
  EmbedMessage,
  EmbedReadyMessage,
  EmbedResizeMessage,
} from './protocol.js';

export { resolveEmbed } from './resolve.js';

export { EMBED_CORPUS, corpusCapabilities, runCorpus } from './corpus.js';
export type { CorpusCase, CorpusFailure, CorpusRunner } from './corpus.js';
export type { EmbedAllowed, EmbedDecision, EmbedOptions, EmbedRejected } from './resolve.js';
