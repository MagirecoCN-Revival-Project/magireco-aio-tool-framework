import { formatRef, parseRef, type ResourceRef } from '@aio/core';
import { assertSafePath } from './manifest.js';
import {
  ResourceUnavailableError,
  sha256Hex,
  type ResolvedPart,
  type ResolvedResource,
  type ResourceProvider,
} from './provider.js';

/**
 * 一张 ref → 绝对 URL 的表。
 *
 * **这是第二个实现，它的存在本身就是那条抽象的验收**（ADR 0002 的反向检查：
 * 第二个实现出现之前，接口是在为尚未发生的事付钱）。用途都是真的：
 *
 *   - **离线包**：素材随分发落地，`file://` 或 `blob:` 也能喂进来；
 *   - **本地研究**：指向本机目录服务，不必起 CDN；
 *   - **测试**：不需要清单文档与选路策略就能造资源。
 *
 * 与 `ManifestCdnProvider` 的区别只在「地址从哪来」：
 * 前者按清单 + 权重选路，这里直接给死。**接口一模一样，所以插件与宿主
 * 换过来零改动**——这正是要验证的那件事。
 *
 * 没有多源回退（一条 ref 一组固定地址），但**保留 sha256 校验**：
 * 地址不是身份，离线包同样会被篡改或损坏。
 */

export interface StaticPart {
  readonly role: string;
  /** 相对路径，只作标识用；实际取用走 `url`。 */
  readonly path: string;
  readonly url: string;
  readonly bytes?: number;
  readonly sha256?: string;
  readonly encoding?: 'gzip';
}

export interface StaticProviderOptions {
  /** key 是完整 ref 字符串，如 `a:sprite/100100/d_r`。 */
  readonly entries: Readonly<Record<string, readonly StaticPart[]>>;
  readonly fetchImpl?: typeof fetch;
  readonly subtle?: Pick<SubtleCrypto, 'digest'>;
}

export class StaticProvider implements ResourceProvider {
  readonly #entries = new Map<string, readonly ResolvedPart[]>();
  readonly #fetch: typeof fetch;
  readonly #subtle: Pick<SubtleCrypto, 'digest'> | undefined;

  constructor(options: StaticProviderOptions) {
    for (const [key, parts] of Object.entries(options.entries)) {
      // key 必须是合法 ref——裸 ID 在这里同样没有意义（铁律 1）。
      // 解析失败直接抛，不做「宽松模式」。
      const ref = parseRef(key);
      if (parts.length === 0) {
        throw new ResourceUnavailableError(ref, '条目没有任何 part');
      }
      const roles = new Set<string>();
      for (const p of parts) {
        assertSafePath(p.path);
        if (roles.has(p.role)) {
          throw new ResourceUnavailableError(ref, `role ${JSON.stringify(p.role)} 重复`);
        }
        roles.add(p.role);
      }
      this.#entries.set(formatRef(ref), parts.map(toResolved));
    }
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#subtle = options.subtle ?? globalThis.crypto?.subtle;
  }

  has(ref: ResourceRef): boolean {
    return this.#entries.has(formatRef(ref));
  }

  resolve(ref: ResourceRef): ResolvedResource {
    const parts = this.#entries.get(formatRef(ref));
    if (parts === undefined) {
      throw new ResourceUnavailableError(ref, '这张表里没有这条目（可能已下架）');
    }
    return { ref, parts };
  }

  async fetchPart(ref: ResourceRef, role: string): Promise<ArrayBuffer> {
    const part = this.resolve(ref).parts.find((p) => p.role === role);
    if (part === undefined) {
      throw new ResourceUnavailableError(ref, `没有 role=${JSON.stringify(role)} 的 part`);
    }
    const candidate = part.candidates[0];
    /* c8 ignore next */
    if (candidate === undefined) throw new ResourceUnavailableError(ref, '没有候选地址');

    const res = await this.#fetch(candidate.url);
    if (!res.ok) {
      throw new ResourceUnavailableError(ref, `${candidate.url} → HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    if (part.sha256 !== undefined) {
      const actual = await sha256Hex(this.#subtle, buf);
      if (actual !== part.sha256) {
        // 离线包一样会损坏或被篡改。地址不是身份。
        throw new ResourceUnavailableError(ref, `${candidate.url} → sha256 不符`);
      }
    }
    return buf;
  }
}

function toResolved(p: StaticPart): ResolvedPart {
  return {
    role: p.role,
    path: p.path,
    // 单一地址：没有多源回退，但候选数组的形状保持一致，调用方不用分支。
    candidates: [{ base: '', url: p.url }],
    ...(p.bytes === undefined ? {} : { bytes: p.bytes }),
    ...(p.sha256 === undefined ? {} : { sha256: p.sha256 }),
    ...(p.encoding === undefined ? {} : { encoding: p.encoding }),
  };
}
