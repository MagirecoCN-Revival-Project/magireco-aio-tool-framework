import { describe, expect, it } from 'vitest';
import { RouteError, RouteTable, compilePattern, normalizePath } from '@aio/site';

describe('路由模式', () => {
  it('拒绝不合法的模式', () => {
    for (const bad of ['character', '/character/', '/character/:Id', '/a//b', '/a/:1x']) {
      expect(() => compilePattern(bad)).toThrow(RouteError);
    }
    expect(compilePattern('/')).toEqual([]);
    expect(compilePattern('/character/:id')).toEqual(['character', ':id']);
  });

  it('规范化路径', () => {
    expect(normalizePath('/a/b/')).toBe('/a/b');
    expect(normalizePath('//a//b')).toBe('/a/b');
    expect(normalizePath('/')).toBe('/');
  });
});

describe('RouteTable', () => {
  const table = new RouteTable();
  table.add('codex', { pattern: '/character/:id' });
  table.add('codex', { pattern: '/character/new' });
  table.add('story', { pattern: '/story/:id', enumerate: () => ['/story/310241'] });
  table.add('home', { pattern: '/' });

  it('静态段赢过参数段，与注册顺序无关', () => {
    expect(table.match('/character/new')?.pluginId).toBe('codex');
    expect(table.match('/character/new')?.pattern).toBe('/character/new');
    expect(table.match('/character/1001')?.pattern).toBe('/character/:id');
    expect(table.match('/character/1001')?.params).toEqual({ id: '1001' });
  });

  it('匹配根路径', () => {
    expect(table.match('/')?.pluginId).toBe('home');
  });

  it('段数不同不匹配', () => {
    expect(table.match('/character/1001/extra')).toBeNull();
    expect(table.match('/nope')).toBeNull();
  });

  it('参数会 URL 解码', () => {
    expect(table.match('/character/%E7%8E%AF')?.params['id']).toBe('环');
  });

  it('拒绝重复注册同一路由', () => {
    const t = new RouteTable();
    t.add('a', { pattern: '/x' });
    expect(() => t.add('b', { pattern: '/x' })).toThrow(/同时注册/);
  });

  it('被关掉的插件视同没有这条路由', () => {
    expect(table.match('/story/1', (id) => id !== 'story')).toBeNull();
    expect(table.match('/story/1', () => true)?.pluginId).toBe('story');
  });

  it('报出带参数却无法枚举的路由——它们进不了 sitemap', () => {
    expect(table.unenumerable()).toEqual(['/character/:id']);
  });
});
