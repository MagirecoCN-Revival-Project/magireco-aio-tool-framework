import { describe, expect, it } from 'vitest';
import { parseRef } from '@aio/core';
import { ResourceUnavailableError, type ResourceProvider } from '@aio/resource';

/**
 * `ResourceProvider` 的一致性套件（ADR 0002 的核心产物）。
 *
 * **本文件不 import 任何具体实现**——只有接口与错误类型。判据因此可证伪：
 *
 * > 换一个 provider，插件与宿主零改动。
 *
 * 「零改动」在没有这套东西之前只是一句愿望。有了它，「某某也是个合格的
 * provider」变成一件能被验证的事，而不是靠读代码相信。
 *
 * 加一个实现（本地目录、离线包、第三方镜像）时，只需要在
 * `providers.conformance.test.ts` 里加一个 fixture，不改这里。
 * 反过来，往接口上加语义时改这里，**所有实现同时被重新检验**。
 */

export interface ProviderFixture {
  readonly name: string;
  /**
   * 造一个 provider，必须包含：
   *
   *   - `PRESENT`：两份 part，role 分别是 `definition` 与 `texture`；
   *   - `WITH_SHA`：一份 role=`texture` 的 part，声明了 sha256（值见 `SHA`）。
   *
   * `fetchImpl` / `subtle` 供 fetch 相关判据注入。
   */
  create(options?: {
    fetchImpl?: typeof fetch;
    subtle?: Pick<SubtleCrypto, 'digest'>;
  }): ResourceProvider;
}

export const PRESENT = parseRef('a:sprite/100100/d_r');
export const ABSENT = parseRef('a:sprite/999999/d_r');
/** 声明了 sha256 的那条，用来验「坏字节一律不接受」。 */
export const WITH_SHA = parseRef('a:sprite/1');
/** 约定的正确摘要，与下面那个假 digest 对应。 */
export const SHA = 'aa';

/** 只认首字节为 9 的内容为「好」，其余算坏——省掉真 WebCrypto。 */
export const fakeSubtle: Pick<SubtleCrypto, 'digest'> = {
  digest: async (_alg, data) => {
    const bytes = new Uint8Array(data as ArrayBuffer);
    return new Uint8Array([bytes[0] === 9 ? 0xaa : 0xbb]).buffer;
  },
};

// 参数钉成 Uint8Array<ArrayBuffer> 而不是裸 Uint8Array：后者可能由
// SharedArrayBuffer 支撑，而 BodyInit 不收那种。
const okFetch = (bytes: Uint8Array<ArrayBuffer>): typeof fetch =>
  (async () => new Response(bytes)) as unknown as typeof fetch;

export function runResourceProviderConformance(fixture: ProviderFixture): void {
  describe(`ResourceProvider 一致性：${fixture.name}`, () => {
    it('has() 对存在的返回 true、不存在的返回 false，且不抛', () => {
      const p = fixture.create();
      // has() 在渲染路径上被调用（can() → 按钮画不画），抛异常会连累整页。
      expect(p.has(PRESENT)).toBe(true);
      expect(p.has(ABSENT)).toBe(false);
    });

    it('resolve() 给出的每份 part 都有 role、相对 path 与至少一个候选', () => {
      const r = fixture.create().resolve(PRESENT);
      expect(r.ref).toEqual(PRESENT);
      expect(r.parts.length).toBeGreaterThan(0);
      for (const part of r.parts) {
        expect(part.role.length).toBeGreaterThan(0);
        expect(part.path.length).toBeGreaterThan(0);
        // path 必须是相对的：拼接是资源层的事，漏给插件就等于漏了内部约定。
        expect(part.path.startsWith('http')).toBe(false);
        expect(part.candidates.length).toBeGreaterThan(0);
        for (const c of part.candidates) {
          expect(c.url.length).toBeGreaterThan(0);
        }
      }
      expect(r.parts.map((p) => p.role)).toContain('texture');
    });

    it('resolve() 不存在的资源抛 ResourceUnavailableError——下架走的就是这条路', () => {
      // 判据是「抛得可辨识」，不是「抛什么消息」：调用方要据此降级提示而非白屏。
      expect(() => fixture.create().resolve(ABSENT)).toThrow(ResourceUnavailableError);
    });

    it('fetchPart() 取回字节', async () => {
      const p = fixture.create({ fetchImpl: okFetch(new Uint8Array([1, 2, 3])) });
      const buf = await p.fetchPart(PRESENT, 'texture');
      expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('fetchPart() 对不存在的 role 报得清楚', async () => {
      const p = fixture.create({ fetchImpl: okFetch(new Uint8Array([1])) });
      await expect(p.fetchPart(PRESENT, 'nope')).rejects.toThrow(/role/);
    });

    it('fetchPart() 对不存在的资源抛 ResourceUnavailableError', async () => {
      const p = fixture.create({ fetchImpl: okFetch(new Uint8Array([1])) });
      await expect(p.fetchPart(ABSENT, 'texture')).rejects.toThrow(ResourceUnavailableError);
    });

    it('sha256 不符时**不接受坏字节**', async () => {
      // 这条是整个接口里最硬的一条：地址不是身份。任何实现都不得为了
      // 「至少给点东西」而返回校验不过的内容——CDN 如此，离线包同样如此。
      const p = fixture.create({
        fetchImpl: okFetch(new Uint8Array([0, 0, 0])), // 首字节非 9 → 坏
        subtle: fakeSubtle,
      });
      await expect(p.fetchPart(WITH_SHA, 'texture')).rejects.toThrow();
    });

    it('sha256 相符时正常返回', async () => {
      const good = new Uint8Array([9, 9, 9]);
      const p = fixture.create({ fetchImpl: okFetch(good), subtle: fakeSubtle });
      await expect(p.fetchPart(WITH_SHA, 'texture')).resolves.toBeDefined();
    });

    it('HTTP 失败不被当成成功', async () => {
      const bad = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
      const p = fixture.create({ fetchImpl: bad });
      await expect(p.fetchPart(PRESENT, 'texture')).rejects.toThrow();
    });
  });
}
