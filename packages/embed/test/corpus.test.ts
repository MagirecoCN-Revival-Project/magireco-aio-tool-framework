import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_CONFIG } from '@aio/site';
import type { SiteConfig } from '@aio/site';
import { EMBED_CORPUS, resolveEmbed, runCorpus } from '@aio/embed';
import type { CapabilityId } from '@aio/core';
import type { CorpusCase } from '@aio/embed';

/**
 * 参考实现自己也要过这份语料。
 *
 * 这不是重复测试：语料是**跨语言的契约**，而 `resolveEmbed()` 只是它的
 * 第一个实现。哪天 Java / PHP 的宿主实现跟这份对不上，分歧一定在
 * 语料能表达的层面上——因为两边都只对语料负责。
 */
function viaResolveEmbed(c: CorpusCase): { status: number; reason?: string } {
  const config: SiteConfig = {
    ...DEFAULT_CONFIG,
    plugins: Object.fromEntries(c.disabledPlugins.map((id) => [id, { enabled: false }])),
  };
  const d = resolveEmbed(c.pathname, c.search, {
    config,
    policy: { allowedAncestors: ['https://wiki.example.org'] },
    takedown: { refPrefixes: c.takedownRefPrefixes, pathPrefixes: [] },
    capabilityProviders: c.providers as Readonly<Record<CapabilityId, readonly string[]>>,
  });
  return d.status === 200 ? { status: 200 } : { status: d.status, reason: d.reason };
}

describe('嵌入准入的跨语言一致性语料', () => {
  it('参考实现（resolveEmbed）条条对得上', () => {
    const bad = runCorpus(viaResolveEmbed);
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
  });

  it('语料本身是可序列化的纯数据——别的语言要读得动', () => {
    // 混进函数、类、undefined 的话，emit 出来的 JSON 会静静少掉字段。
    const json = JSON.stringify(EMBED_CORPUS);
    expect(JSON.parse(json)).toEqual(EMBED_CORPUS);
    expect(EMBED_CORPUS.length).toBeGreaterThan(15);
  });

  it('用例名不重复——分歧报出来要能定位到是哪一条', () => {
    const names = EMBED_CORPUS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('导出的 JSON 与语料同步（别的语言读的是这份文件）', () => {
    // 与 providers.generated.json 同一个套路：生成物入库 + 快照测试盯着别漂。
    // 漂了的后果是别的语言按旧语料对账，两边都自以为通过。
    const file = path.join(__dirname, '../corpus.generated.json');
    const want = JSON.stringify(EMBED_CORPUS, null, 2) + '\n';
    if (process.env['UPDATE_CORPUS'] === '1') fs.writeFileSync(file, want, 'utf8');
    expect(fs.existsSync(file), `${file} 不存在，用 UPDATE_CORPUS=1 生成`).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe(want);
  });
});
