import { describe, expect, it, vi } from 'vitest';
import { parseRef } from '@aio/core';
import { Manifest, ManifestError, OriginPool, ManifestCdnProvider, ResourceUnavailableError } from '@aio/resource';

const spriteManifest = Manifest.from({
  version: 1,
  universe: 'a',
  kind: 'sprite',
  entries: {
    'a:sprite/100100/d_r': {
      parts: [
        { path: '100100/mini_100100_d_r.ExportJson', role: 'definition', bytes: 12000 },
        { path: '100100/mini_100100_d_r0.plist', role: 'atlas' },
        { path: '100100/mini_100100_d_r0.png', role: 'texture', bytes: 40213 },
      ],
    },
  },
});

const scenarioManifest = Manifest.from({
  version: 1,
  universe: 'a',
  kind: 'scenario',
  entries: {
    // 无 variant 的通用条目：语言无关的资源用得上
    'a:scenario/310241': { parts: [{ path: '310241/ja.json', role: 'script' }] },
    'a:scenario/310241@zh': { parts: [{ path: '310241/zh.json', role: 'script' }] },
  },
});

function client(fetchImpl?: typeof fetch, subtle?: Pick<SubtleCrypto, 'digest'>) {
  return new ManifestCdnProvider({
    origins: new OriginPool(
      [
        { base: 'https://fast.example/', weight: 80 },
        { base: 'https://slow.example/', weight: 10 },
      ],
      { failuresBeforeCooldown: 1, cooldownMs: 10_000, now: () => 0 },
    ),
    manifests: [spriteManifest, scenarioManifest],
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
    ...(subtle === undefined ? {} : { subtle }),
  });
}

describe('Manifest', () => {
  it('拒绝逃出 base 的路径', () => {
    for (const bad of ['../secret', '/etc/passwd', 'https://evil.example/x', 'a//b']) {
      expect(() =>
        Manifest.from({
          version: 1,
          universe: 'a',
          kind: 'sprite',
          entries: { 'a:sprite/1': { parts: [{ path: bad, role: 'x' }] } },
        }),
      ).toThrow(ManifestError);
    }
  });

  it('拒绝与声明不符的条目、空 parts、重复 role', () => {
    expect(() =>
      Manifest.from({
        version: 1, universe: 'a', kind: 'sprite',
        entries: { 'b:sprite/1': { parts: [{ path: 'a', role: 'x' }] } },
      }),
    ).toThrow(/却包含条目/);
    expect(() =>
      Manifest.from({ version: 1, universe: 'a', kind: 'sprite', entries: { 'a:sprite/1': { parts: [] } } }),
    ).toThrow(/没有任何 part/);
    expect(() =>
      Manifest.from({
        version: 1, universe: 'a', kind: 'sprite',
        entries: { 'a:sprite/1': { parts: [{ path: 'a', role: 'x' }, { path: 'b', role: 'x' }] } },
      }),
    ).toThrow(/重复/);
  });

  it('variant 先精确匹配，再退回通用条目', () => {
    expect(scenarioManifest.lookup(parseRef('a:scenario/310241@zh'))!.parts[0]!.path).toBe('310241/zh.json');
    // @en 没有专属条目 → 退回无 variant 的那条
    expect(scenarioManifest.lookup(parseRef('a:scenario/310241@en'))!.parts[0]!.path).toBe('310241/ja.json');
    expect(scenarioManifest.lookup(parseRef('a:scenario/999'))).toBeNull();
  });
});

describe('ManifestCdnProvider', () => {
  it('resolve 出多源候选，按选路顺序', () => {
    const r = client().resolve(parseRef('a:sprite/100100/d_r'));
    expect(r.parts.map((p) => p.role)).toEqual(['definition', 'atlas', 'texture']);
    expect(r.parts[2]!.candidates.map((c) => c.url)).toEqual([
      'https://fast.example/100100/mini_100100_d_r0.png',
      'https://slow.example/100100/mini_100100_d_r0.png',
    ]);
    expect(r.parts[2]!.candidates[0]!.base).toBe('https://fast.example/');
  });

  it('resolve 带出清单里的相对路径——包装既有查看器要按路径索引', () => {
    const r = client().resolve(parseRef('a:sprite/100100/d_r'));
    // 不带 path 的话，插件只能从 URL 里减去 base 反推，那是把资源层的内部
    // 约定漏给插件（铁律 3）。实测过的那个查看器要的就是 Record<路径, URL>。
    expect(r.parts[2]!.path).toBe('100100/mini_100100_d_r0.png');
    expect(r.parts.every((p) => p.path.length > 0)).toBe(true);
    // path 是相对的：不含 base，拼接由资源层负责。
    expect(r.parts.some((p) => p.path.startsWith('http'))).toBe(false);
  });

  it('has() 决定按钮画不画；下架的资源直接查不到', () => {
    const c = client();
    expect(c.has(parseRef('a:sprite/100100/d_r'))).toBe(true);
    expect(c.has(parseRef('a:sprite/999999/d_r'))).toBe(false);
    expect(() => c.resolve(parseRef('a:sprite/999999/d_r'))).toThrow(/可能已下架/);
  });

  it('没有清单的 kind 报得清楚', () => {
    expect(() => client().resolve(parseRef('a:voice/x'))).toThrow(/没有加载 a:voice 的清单/);
  });

  it('首源失败自动回退次源，并给失败源记账', () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith('https://fast.example/')) return new Response(null, { status: 503 });
      return new Response(new Uint8Array([1, 2, 3]));
    }) as unknown as typeof fetch;

    const c = client(fetchImpl);
    return c.fetchPart(parseRef('a:sprite/100100/d_r'), 'texture').then(async (buf) => {
      expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
      // 快源已被记失败并进冷却 → 下一条资源直接从慢源开始
      const next = c.resolve(parseRef('a:sprite/100100/d_r'));
      expect(next.parts[0]!.candidates[0]!.base).toBe('https://slow.example/');
    });
  });

  it('sha256 不符视为该源失败并继续回退，而不是接受坏字节', async () => {
    const good = new Uint8Array([9, 9, 9]);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith('https://fast.example/')) return new Response(new Uint8Array([0, 0, 0]));
      return new Response(good);
    }) as unknown as typeof fetch;

    // 一个只认 good 内容的假 digest
    const subtle: Pick<SubtleCrypto, 'digest'> = {
      digest: async (_alg, data) => {
        const bytes = new Uint8Array(data as ArrayBuffer);
        const marker = bytes[0] === 9 ? 0xaa : 0xbb;
        return new Uint8Array([marker]).buffer;
      },
    };

    const c = new ManifestCdnProvider({
      origins: new OriginPool([
        { base: 'https://fast.example/', weight: 80 },
        { base: 'https://slow.example/', weight: 10 },
      ]),
      manifests: [
        Manifest.from({
          version: 1, universe: 'a', kind: 'sprite',
          entries: { 'a:sprite/1': { parts: [{ path: 'a.png', role: 'texture', sha256: 'aa' }] } },
        }),
      ],
      fetchImpl,
      subtle,
    });

    const buf = await c.fetchPart(parseRef('a:sprite/1'), 'texture');
    expect(new Uint8Array(buf)).toEqual(good);
  });

  it('所有源都失败时抛出，且把每条失败原因带上', async () => {
    const fetchImpl = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    await expect(client(fetchImpl).fetchPart(parseRef('a:sprite/100100/d_r'), 'texture')).rejects.toThrow(
      ResourceUnavailableError,
    );
  });

  it('role 不存在报得清楚', async () => {
    await expect(client().fetchPart(parseRef('a:sprite/100100/d_r'), 'nope')).rejects.toThrow(/role/);
  });
});
