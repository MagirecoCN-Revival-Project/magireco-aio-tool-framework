import { afterEach, describe, expect, it } from 'vitest';
import { ManifestCdnProvider, Manifest, OriginPool, StaticProvider } from '@aio/resource';
import { parseRef } from '@aio/core';

/**
 * 🔴 `fetch` 的 receiver。
 *
 * 浏览器的 `fetch` 是 `Window` 上的方法，规范要求它的 `this` 是 window。
 * 把它存进字段再用 `this.#fetch(url)` 调，receiver 就成了**本对象**，
 * 浏览器抛：
 *
 *     Failed to execute 'fetch' on 'Window': Illegal invocation
 *
 * ## 为什么要专门为它写一条测试
 *
 * **node 的 undici 不检查 receiver。** 所以整套测试在 node 上全绿，
 * 而真浏览器里每一次取资源都失败——2026-08-22 拿真浏览器跑嵌入面时炸出来的，
 * 表现是查看器一片空白、控制台一行 Illegal invocation，
 * 而 471 个测试没有一个红。
 *
 * 这两条测试把 node 上测不到的东西**变成 node 上测得到的**：
 * 不去验「浏览器会不会抛」，而是直接验「我们用什么 receiver 调的」。
 */

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

const ok = (): Response => new Response(new ArrayBuffer(4), { status: 200 });

describe('fetch 的 receiver', () => {
  it('默认实现绑定到 globalThis，而不是 provider 自己', async () => {
    let seen: unknown = 'never called';
    // ESM 是严格模式：以普通函数调用时 this 为 undefined，
    // 只有真的被 bind 过才会是 globalThis。
    globalThis.fetch = function (this: unknown) {
      seen = this;
      return Promise.resolve(ok());
    } as unknown as typeof fetch;

    const p = new StaticProvider({
      entries: { 'a:sprite/1': [{ role: 'main', path: '1.bin', url: 'data:,x' }] },
    });
    await p.fetchPart(parseRef('a:sprite/1'), 'main');

    expect(seen, 'provider 把自己当成了 fetch 的 this').not.toBe(p);
    expect(seen).toBe(globalThis);
  });

  it('调用方传进来的 fetchImpl 不会收到 provider 实例作为 this', async () => {
    // 传进来的是个普通函数，它凭什么收到我们的内部对象。
    let seen: unknown = 'never called';
    const fetchImpl = function (this: unknown): Promise<Response> {
      seen = this;
      return Promise.resolve(ok());
    } as unknown as typeof fetch;

    const provider = new ManifestCdnProvider({
      origins: new OriginPool([{ base: 'https://assets.invalid/', weight: 1 }]),
      manifests: [
        Manifest.from({
          version: 1,
          universe: 'a',
          kind: 'sprite',
          entries: { 'a:sprite/1': { parts: [{ path: 's/1.bin', role: 'main' }] } },
        }),
      ],
      fetchImpl,
    });
    await provider.fetchPart(parseRef('a:sprite/1'), 'main');

    expect(seen).not.toBe(provider);
    expect(seen).toBeUndefined();
  });
});
