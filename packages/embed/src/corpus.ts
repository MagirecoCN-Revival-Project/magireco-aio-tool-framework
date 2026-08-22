import type { CapabilityId } from '@aio/core';

/**
 * 嵌入面准入判定的**语言中立一致性语料**。
 *
 * ## 为什么需要它
 *
 * 宿主不止一个（架构文档 §七），而准入判定必须在**宿主那一侧**跑——
 * 它要读下架清单、看插件开关。宿主换成 Java / PHP / Go 的时候，
 * `resolveEmbed()` 这份 TS 实现跟不过去，那边得再写一份。
 *
 * **两份实现的判据会分歧，而且不报错。** 这不是推演：本仓库的 MediaWiki
 * 扩展里那份 ref 预检，最初与 `parseRef` 在 22 条样本里分歧了 2 条——
 * 一条放过了没登记的 kind，另一条放过了 `a:character/../etc`，
 * 也就是路径穿越的形状。两条都是「PHP 更松」，而 wiki 上看着一切正常。
 *
 * 所以判据不能只活在 TS 里。这份语料是**数据**，任何语言都读得动：
 * 新宿主写完自己的实现，拿它跑一遍，条条对上才算接进来了。
 *
 * ## 它不是测试，是契约
 *
 * `runCorpus()` 只是顺手给 TS 侧用的跑法。语料本身序列化成 JSON
 * （`tools/emit-embed-corpus.mjs`），Java 的 JUnit、PHP 的 PHPUnit、
 * Go 的 testing 都能直接吃。
 *
 * ## 加用例的规矩
 *
 * 只加**判据**，不加实现细节。「下架优先于能力判定」是判据；
 * 「错误信息里有几个字」不是——那会把别的语言的实现逼成翻译腔。
 */

export interface CorpusCase {
  /** 人能读懂的名字。分歧时它会出现在报错里，所以要说清楚**验的是什么判据**。 */
  readonly name: string;
  readonly pathname: string;
  readonly search: string;
  /** 插件开关。没登记的插件视为开着，与 `@aio/site` 的 `pluginEnabled` 一致。 */
  readonly disabledPlugins: readonly string[];
  readonly takedownRefPrefixes: readonly string[];
  readonly providers: Readonly<Record<string, readonly string[]>>;
  readonly expect: {
    readonly status: 200 | 400 | 404;
    /** 只在非 200 时有意义。**这是判据的一部分**：报错的理由必须一致。 */
    readonly reason?: string;
  };
}

const P = { 'sprite.show': ['sprite-play'], 'adv.play': ['adv-play'] } as Readonly<
  Record<string, readonly string[]>
>;
const NONE: readonly string[] = [];

export const EMBED_CORPUS: readonly CorpusCase[] = [
  {
    name: '正常放行',
    pathname: '/embed/sprite.show',
    search: 'ref=a:sprite/100100/d_r',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 200 },
  },
  {
    name: '铁律 1：裸 ID 拒收',
    pathname: '/embed/sprite.show',
    search: 'ref=100101',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 400, reason: 'bad-ref' },
  },
  {
    name: '铁律 1：没有 kind 段也算裸 ID',
    pathname: '/embed/sprite.show',
    search: 'ref=sprite/100100',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 400, reason: 'bad-ref' },
  },
  {
    name: '路径穿越的形状必须拒收',
    pathname: '/embed/sprite.show',
    search: 'ref=a:sprite/../etc',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 400, reason: 'bad-ref' },
  },
  {
    name: '没登记的 kind 拒收',
    pathname: '/embed/sprite.show',
    search: 'ref=a:nope/1',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 400, reason: 'bad-ref' },
  },
  {
    name: '大写 universe 拒收——形状要管，否则不同来源对不上',
    pathname: '/embed/sprite.show',
    search: 'ref=A:sprite/1',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 400, reason: 'bad-ref' },
  },
  {
    name: '没见过的 universe 照常放行——成员资格是数据，不是解析器该知道的',
    pathname: '/embed/sprite.show',
    search: 'ref=zz:sprite/1',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 200 },
  },
  {
    name: '能力接不了这个 kind',
    pathname: '/embed/adv.play',
    search: 'ref=a:character/1001',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 400, reason: 'kind-mismatch' },
  },
  {
    name: '没登记的能力是 404 不是 400——请求没写错，是这东西不存在',
    pathname: '/embed/nope.thing',
    search: 'ref=a:character/1',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 404, reason: 'unknown-capability' },
  },
  {
    name: '缺 ref',
    pathname: '/embed/sprite.show',
    search: '',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 400, reason: 'bad-ref' },
  },
  {
    name: '契约没登记的参数丢掉，不报错——契约会长出新参数',
    pathname: '/embed/sprite.show',
    search: 'ref=a:sprite/1&utm_source=wiki&futureParam=9',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 200 },
  },
  {
    name: '登记了但值不合法要报错：布尔只认 1/0/true/false',
    pathname: '/embed/adv.play',
    search: 'ref=a:scenario/1&auto=no',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 400, reason: 'bad-param' },
  },
  {
    name: '登记了但值不合法要报错：空串不是数字',
    pathname: '/embed/adv.play',
    search: 'ref=a:scenario/1&line=',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 400, reason: 'bad-param' },
  },
  {
    name: '铁律 11：下架的 ref 拒收',
    pathname: '/embed/sprite.show',
    search: 'ref=a:sprite/100100/d_r',
    disabledPlugins: NONE,
    takedownRefPrefixes: ['a:sprite/100100'],
    providers: P,
    expect: { status: 404, reason: 'taken-down' },
  },
  {
    name: '铁律 11：下架是前缀匹配，不是整串相等',
    pathname: '/embed/sprite.show',
    search: 'ref=a:sprite/100100/d_r',
    disabledPlugins: NONE,
    takedownRefPrefixes: ['a:sprite/'],
    providers: P,
    expect: { status: 404, reason: 'taken-down' },
  },
  {
    name: '🔴 下架判定排在能力判定之前——否则分不清是真下架还是没装插件',
    pathname: '/embed/sprite.show',
    search: 'ref=a:sprite/100100',
    disabledPlugins: NONE,
    takedownRefPrefixes: ['a:sprite/'],
    providers: {},
    expect: { status: 404, reason: 'taken-down' },
  },
  {
    name: '铁律 10：插件关掉，嵌在别人页面上的当场 404',
    pathname: '/embed/sprite.show',
    search: 'ref=a:sprite/100100/d_r',
    disabledPlugins: ['sprite-play'],
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 404, reason: 'plugin-disabled' },
  },
  {
    name: '这个部署没装实现，与「被关掉」分开报',
    pathname: '/embed/sprite.show',
    search: 'ref=a:sprite/1',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: {},
    expect: { status: 404, reason: 'no-provider' },
  },
  {
    name: '多个提供者时只要还有一个开着就放行',
    pathname: '/embed/sprite.show',
    search: 'ref=a:sprite/1',
    disabledPlugins: ['off-one'],
    takedownRefPrefixes: NONE,
    providers: { 'sprite.show': ['off-one', 'sprite-play'] },
    expect: { status: 200 },
  },
  {
    name: '路径形状不对',
    pathname: '/embed/a/b',
    search: 'ref=a:sprite/1',
    disabledPlugins: NONE,
    takedownRefPrefixes: NONE,
    providers: P,
    expect: { status: 400, reason: 'bad-path' },
  },
];

/** 把一条用例喂给任意实现所需的形状。宿主实现照这个签名包一层即可。 */
export type CorpusRunner = (c: CorpusCase) => { status: number; reason?: string };

export interface CorpusFailure {
  readonly name: string;
  readonly want: { status: number; reason?: string };
  readonly got: { status: number; reason?: string };
}

/**
 * 跑一遍语料，返回**分歧列表**（空数组 = 全对）。
 *
 * 不抛错、不打印：调用方是 vitest 还是 JUnit 还是一个校验脚本，
 * 由它自己决定怎么报。
 */
export function runCorpus(run: CorpusRunner): readonly CorpusFailure[] {
  const bad: CorpusFailure[] = [];
  for (const c of EMBED_CORPUS) {
    const got = run(c);
    const okStatus = got.status === c.expect.status;
    const okReason = c.expect.reason === undefined || got.reason === c.expect.reason;
    if (!okStatus || !okReason) {
      bad.push({ name: c.name, want: c.expect, got });
    }
  }
  return bad;
}

/** 语料里出现过的能力，供宿主预检自己认不认得全。 */
export function corpusCapabilities(): readonly CapabilityId[] {
  const set = new Set<string>();
  for (const c of EMBED_CORPUS) {
    const m = /^\/embed\/([^/]+)$/.exec(c.pathname);
    if (m !== null) set.add(m[1] as string);
  }
  return [...set] as CapabilityId[];
}
