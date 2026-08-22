import { formatRef, type ResourceRef } from '@aio/core';

/**
 * 资源提供者契约（ADR 0002 第一层）。
 *
 * 插件只经 `host.resources` 拿资源（铁律 3）。既然插件已经不碰 URL，那 URL
 * 后面是 CDN、是本地目录、还是一个离线包，本来就该与它无关——这个接口把
 * 「本来就该」变成「在类型上就是」。
 *
 * 判据可证伪：
 *
 * > 换一个 provider，插件与宿主**零改动**。
 * > 一致性套件（`test/conformance.ts`）不 import 任何具体实现，
 * > 任何实现装进去都必须全绿。
 *
 * 现有实现：
 *
 *   - `ManifestCdnProvider` —— 清单 + 多源回退 + sha256（COS / EdgeOne）
 *   - `StaticProvider`      —— 一张 ref → 绝对 URL 的表，离线包与本地研究用
 */

/** 一个候选下载点。base 单独带着，失败时才知道该给哪条线路记账。 */
export interface Candidate {
  readonly url: string;
  readonly base: string;
}

export interface ResolvedPart {
  readonly role: string;
  /**
   * 清单里登记的相对路径（不含 base）。
   *
   * 包装既有查看器时用得上：它们大多按**文件路径**索引资源，而不是按 role
   * （有的查看器要的是 `Record<路径, URL>`，有的 fetch 拦截器要按
   * 原路径改写）。不给出路径的话，插件只能从 URL 里减去 base 反推，
   * 那是把资源层的内部约定漏给插件——正是铁律 3 要避免的。
   */
  readonly path: string;
  /** 按当前选路顺序排好的候选，逐条回退。 */
  readonly candidates: readonly Candidate[];
  readonly bytes?: number;
  readonly sha256?: string;
  readonly encoding?: 'gzip';
}

export interface ResolvedResource {
  readonly ref: ResourceRef;
  readonly parts: readonly ResolvedPart[];
}

export class ResourceUnavailableError extends Error {
  constructor(
    readonly ref: ResourceRef,
    reason: string,
  ) {
    super(`资源 ${formatRef(ref)} 不可用：${reason}`);
    this.name = 'ResourceUnavailableError';
  }
}

export interface ResourceProvider {
  /**
   * 有没有这条资源。
   *
   * UI 用它决定按钮画不画——**查不到就不画，不要画了再报错**。
   * 必须是同步的：`can()` 在渲染路径上被调用。
   */
  has(ref: ResourceRef): boolean;

  /**
   * 解析成若干 part，每个 part 带按选路顺序排好的候选。
   *
   * 查不到时抛 `ResourceUnavailableError`——**下架走的就是这条路**，
   * 调用方应当降级提示而不是白屏。
   */
  resolve(ref: ResourceRef): ResolvedResource;

  /** 取一份 part 的字节，逐候选回退。校验不过的字节一律不接受。 */
  fetchPart(ref: ResourceRef, role: string): Promise<ArrayBuffer>;
}

/** 十六进制 sha256。两个实现共用，避免各写一份然后只改一处。 */
export async function sha256Hex(
  subtle: Pick<SubtleCrypto, 'digest'> | undefined,
  buf: ArrayBuffer,
): Promise<string> {
  if (subtle === undefined) {
    throw new Error('当前环境没有 WebCrypto，无法校验 sha256');
  }
  const digest = await subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
