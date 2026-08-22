import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@aio/site';
import type { SiteConfig } from '@aio/site';
import { resolveEmbed } from '@aio/embed';
import type { EmbedOptions } from '@aio/embed';

const providers = {
  'sprite.show': ['sprite-play'],
  'adv.play': ['adv-play'],
} as EmbedOptions['capabilityProviders'];

const base: EmbedOptions = {
  config: DEFAULT_CONFIG,
  policy: { allowedAncestors: ['https://wiki.example.org'] },
  capabilityProviders: providers,
};

const cfg = (plugins: SiteConfig['plugins']): SiteConfig => ({ ...DEFAULT_CONFIG, plugins });

const go = (o: Partial<EmbedOptions> = {}, q = 'ref=a:sprite/100100/d_r') =>
  resolveEmbed('/embed/sprite.show', q, { ...base, ...o });

describe('嵌入准入判定', () => {
  it('一切正常时放行，并说明由哪个插件服务', () => {
    const d = go();
    expect(d.status).toBe(200);
    if (d.status !== 200) return;
    expect(d.pluginId).toBe('sprite-play');
    expect(d.request.capability).toBe('sprite.show');
  });

  it('🔴 与浏览器侧共用同一个开关（铁律 10）', () => {
    // 后台关掉 sprite-play，嵌在别人页面上的那些必须当场 404，
    // 而不是「后台显示关着、别人页面上还在放」。
    const d = go({ config: cfg({ 'sprite-play': { enabled: false } }) });
    expect(d.status).toBe(404);
    if (d.status === 200) return;
    expect(d.reason).toBe('plugin-disabled');
  });

  it('🔴 下架在请求期再判一次（铁律 11）', () => {
    // 嵌入 URL 散在别人的页面里，重建我们的站碰不到它们一根汗毛。
    const d = go({ takedown: { refPrefixes: ['a:sprite/100100'], pathPrefixes: [] } });
    expect(d.status).toBe(404);
    if (d.status === 200) return;
    expect(d.reason).toBe('taken-down');
  });

  it('🔴 下架的判定排在能力判定之前', () => {
    // 否则被下架的东西会因为「恰好没插件提供这个能力」报成 no-provider，
    // 排查时分不清是真下架了还是配置错了。
    const d = resolveEmbed('/embed/sprite.show', 'ref=a:sprite/100100', {
      ...base,
      capabilityProviders: {} as EmbedOptions['capabilityProviders'],
      takedown: { refPrefixes: ['a:sprite/'], pathPrefixes: [] },
    });
    expect(d.status).toBe(404);
    if (d.status === 200) return;
    expect(d.reason).toBe('taken-down');
  });

  it('下架前缀是前缀匹配，不是整串相等', () => {
    const d = go({ takedown: { refPrefixes: ['a:sprite/'], pathPrefixes: [] } });
    expect(d.status).toBe(404);
  });

  it('这个部署没装对应插件时报 no-provider，与「被关掉」分开', () => {
    const d = go({ capabilityProviders: {} as EmbedOptions['capabilityProviders'] });
    expect(d.status).toBe(404);
    if (d.status === 200) return;
    expect(d.reason).toBe('no-provider');
  });

  it('多个提供者时，只要还有一个开着就放行', () => {
    const d = go({
      capabilityProviders: { 'sprite.show': ['off-one', 'sprite-play'] } as EmbedOptions['capabilityProviders'],
      config: cfg({ 'off-one': { enabled: false } }),
    });
    expect(d.status).toBe(200);
    if (d.status !== 200) return;
    expect(d.pluginId).toBe('sprite-play');
  });

  it('写坏的请求是 400，不认识的能力是 404', () => {
    const bad = resolveEmbed('/embed/sprite.show', 'ref=100101', base);
    expect(bad.status).toBe(400);
    const unknown = resolveEmbed('/embed/nope.thing', 'ref=a:character/1', base);
    expect(unknown.status).toBe(404);
    if (unknown.status === 200) return;
    expect(unknown.reason).toBe('unknown-capability');
  });

  it('🔴 放行时必带 noindex——嵌入面是别人页面里的一块 UI，不是一个页面', () => {
    const d = go();
    if (d.status !== 200) throw new Error('应当放行');
    expect(d.headers['X-Robots-Tag']).toContain('noindex');
    expect(d.headers['Content-Security-Policy']).toContain('frame-ancestors https://wiki.example.org');
    // 配置改了要能让边缘缓存失效。
    expect(d.headers['Cache-Tag']).toContain(`rev:${DEFAULT_CONFIG.revision}`);
  });
});
