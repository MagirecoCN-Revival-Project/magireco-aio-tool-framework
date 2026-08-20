import { formatRef, type ResourceRef } from '@aio/core';
import type { Manifest } from './manifest.js';
import type { OriginPool } from './origins.js';

/**
 * 资源客户端：插件拿资源的**唯一**入口。
 *
 * 插件不碰 URL、不碰 fetch、不知道 CDN 有几条线。它只说「给我这条 ref 的
 * `texture` 那一份」。换 CDN、加备份源、把某批资源下架，全都不需要动插件——
 * 这就是「把 assets 从网站里分离出去」在代码层面的判据：**网站源码里
 * grep 不到任何资源路径**。
 */

/** 一个候选下载点。base 单独带着，失败时才知道该给哪条线路记账。 */
export interface Candidate {
  readonly url: string;
  readonly base: string;
}

export interface ResolvedPart {
  readonly role: string;
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

export interface ResourceClientOptions {
  readonly origins: OriginPool;
  readonly manifests: readonly Manifest[];
  readonly fetchImpl?: typeof fetch;
  readonly subtle?: Pick<SubtleCrypto, 'digest'>;
}

export class ResourceClient {
  readonly #origins: OriginPool;
  readonly #manifests = new Map<string, Manifest>();
  readonly #fetch: typeof fetch;
  readonly #subtle: Pick<SubtleCrypto, 'digest'> | undefined;

  constructor(options: ResourceClientOptions) {
    this.#origins = options.origins;
    for (const m of options.manifests) {
      this.#manifests.set(`${m.universe}:${m.kind}`, m);
    }
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#subtle = options.subtle ?? globalThis.crypto?.subtle;
  }

  /** 有没有这条资源。UI 用它决定按钮画不画——**查不到就不画，不要画了再报错**。 */
  has(ref: ResourceRef): boolean {
    return this.#manifests.get(`${ref.universe}:${ref.kind}`)?.has(ref) ?? false;
  }

  resolve(ref: ResourceRef): ResolvedResource {
    const manifest = this.#manifests.get(`${ref.universe}:${ref.kind}`);
    if (manifest === undefined) {
      throw new ResourceUnavailableError(ref, `没有加载 ${ref.universe}:${ref.kind} 的清单`);
    }
    const entry = manifest.lookup(ref);
    if (entry === null) {
      // 已下架的资源走的就是这条路。调用方应当降级提示，而不是白屏。
      throw new ResourceUnavailableError(ref, '清单里没有这条目（可能已下架）');
    }

    const bases = this.#origins.order();
    return {
      ref,
      parts: entry.parts.map((part) => ({
        role: part.role,
        candidates: bases.map((base) => ({ base, url: `${base}${part.path}` })),
        ...(part.bytes === undefined ? {} : { bytes: part.bytes }),
        ...(part.sha256 === undefined ? {} : { sha256: part.sha256 }),
        ...(part.encoding === undefined ? {} : { encoding: part.encoding }),
      })),
    };
  }

  /**
   * 取一份 part 的字节，逐源回退。
   *
   * 成功/失败都回报给 OriginPool，所以冷却状态是**跨资源共享**的：一条线路挂了，
   * 后续所有资源自动跳过它，而不是每条资源各自再撞一次。
   */
  async fetchPart(ref: ResourceRef, role: string): Promise<ArrayBuffer> {
    const resolved = this.resolve(ref);
    const part = resolved.parts.find((p) => p.role === role);
    if (part === undefined) {
      throw new ResourceUnavailableError(ref, `没有 role=${JSON.stringify(role)} 的 part`);
    }

    const errors: string[] = [];
    for (const { url, base } of part.candidates) {
      try {
        const res = await this.#fetch(url);
        if (!res.ok) {
          this.#origins.reportFailure(base);
          errors.push(`${url} → HTTP ${res.status}`);
          continue;
        }
        const buf = await res.arrayBuffer();
        if (part.sha256 !== undefined) {
          const actual = await this.#sha256Hex(buf);
          if (actual !== part.sha256) {
            // 内容不对不算这条线路「通了」。地址不是身份，sha256 才是——
            // 与客户端 baseline 同一条原则。
            this.#origins.reportFailure(base);
            errors.push(`${url} → sha256 不符`);
            continue;
          }
        }
        this.#origins.reportSuccess(base);
        return buf;
      } catch (err) {
        this.#origins.reportFailure(base);
        errors.push(`${url} → ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new ResourceUnavailableError(ref, `所有源都失败：${errors.join('；')}`);
  }

  async #sha256Hex(buf: ArrayBuffer): Promise<string> {
    if (this.#subtle === undefined) {
      throw new Error('当前环境没有 WebCrypto，无法校验 sha256');
    }
    const digest = await this.#subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
