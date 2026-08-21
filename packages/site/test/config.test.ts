import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, pluginEnabled } from '@aio/site';

describe('loadConfig', () => {
  it('坏输入一律回退默认值并报告，绝不抛错', () => {
    for (const bad of [null, 42, 'x', [], { version: 2 }]) {
      const { config, problems } = loadConfig(bad);
      expect(config).toEqual(DEFAULT_CONFIG);
      expect(problems.length).toBeGreaterThan(0);
    }
  });

  it('默认 indexing 是 selective——新路由不该自动进索引', () => {
    expect(DEFAULT_CONFIG.seo.indexing).toBe('selective');
  });

  it('插件设置格式不对时按「关闭」处理，而不是当成开着', () => {
    const { config, problems } = loadConfig({
      version: 1, plugins: { 'adv-player': { enabled: 'yes' } },
    });
    expect(config.plugins['adv-player']).toEqual({ enabled: false });
    expect(problems.join()).toMatch(/adv-player/);
  });

  it('titleTemplate 少了 %s 会丢掉页面标题，回退默认模板', () => {
    const { config, problems } = loadConfig({
      version: 1, seo: { titleTemplate: '固定标题' },
    });
    expect(config.seo.titleTemplate).toBe('%s');
    expect(problems.join()).toMatch(/%s/);
  });

  it('非法 indexing 取值回退并报告', () => {
    const { config, problems } = loadConfig({ version: 1, seo: { indexing: 'sometimes' } });
    expect(config.seo.indexing).toBe('selective');
    expect(problems.join()).toMatch(/indexing/);
  });

  it('canonicalOrigin 去掉尾斜杠', () => {
    const { config } = loadConfig({ version: 1, seo: { canonicalOrigin: 'https://a.example//' } });
    expect(config.seo.canonicalOrigin).toBe('https://a.example');
  });

  it('没登记的插件视为开着——新装的插件不该默认隐身', () => {
    const { config } = loadConfig({ version: 1, plugins: { a: { enabled: false } } });
    expect(pluginEnabled(config, 'a')).toBe(false);
    expect(pluginEnabled(config, '从没登记过的')).toBe(true);
  });

  it('覆盖项里非法的 robots 被丢掉，其余字段保留', () => {
    const { config } = loadConfig({
      version: 1, overrides: { '/x': { title: 'T', robots: 'maybe' }, '/y': 'nope' },
    });
    expect(config.overrides['/x']).toEqual({ title: 'T' });
    expect(config.overrides['/y']).toBeUndefined();
  });
});
