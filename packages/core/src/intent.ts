import type { RefKind, ResourceRef } from './ref.js';

/**
 * 能力（Capability）与意图（Intent）。
 *
 * 框架里模块之间**不互相 import，也不互相知道对方存在**。剧情阅读器不 import
 * ADV 播放器；它只是发一个意图：
 *
 *     host.request({ capability: 'adv.play', ref: parseRef('a:scenario/310241@zh'),
 *                    params: { line: 42 } })
 *
 * 内核负责找到声明了 `adv.play` 且接受 `scenario` 的插件，把它装载到一个
 * surface 上。没装 ADV 插件时 `host.can('adv.play', ref)` 返回 false，
 * 阅读器**根本不渲染那个按钮**——这就是"插件化"与"放个跳转链接"的区别：
 * 少装一个插件，宿主依然自洽，只是少一项能力。
 */

/** 能力标识约定：`<域>.<动词>`，如 `adv.play`、`sprite.show`、`voice.play`。 */
export type CapabilityId = string;

export const CAPABILITY_ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

export interface Capability {
  readonly id: CapabilityId;
  /** 能处理哪些 kind 的 ref。空数组视为「不接受任何 ref」，等于没用。 */
  readonly accepts: readonly RefKind[];
  /** 同一能力有多个提供者时按此排序，大者优先。缺省 0。 */
  readonly priority?: number;
  /** 人类可读，用于「用哪个打开」这类选择界面。 */
  readonly title?: string;
}

/** surface 的呈现方式。由发起方**建议**，宿主可否决（比如窄屏一律用 sheet）。 */
export type SurfaceHint = 'inline' | 'modal' | 'sheet' | 'dock';

export interface Intent {
  readonly capability: CapabilityId;
  readonly ref: ResourceRef;
  /** 能力自定义参数，如 ADV 的起播行号。内核不解释它。 */
  readonly params?: Readonly<Record<string, unknown>>;
  readonly surface?: SurfaceHint;
  /** 谁发起的。用于日志与「回到来处」。 */
  readonly source?: string;
}

export function isValidCapabilityId(id: string): boolean {
  return CAPABILITY_ID_RE.test(id);
}

export function capabilityAccepts(cap: Capability, kind: RefKind): boolean {
  return cap.accepts.includes(kind);
}
