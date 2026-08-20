import { describe, expect, it } from 'vitest';
import { normalizeBase, OriginNotAllowedError, OriginPool } from '@aio/resource';

describe('normalizeBase', () => {
  it('补尾斜杠', () => {
    expect(normalizeBase('https://a.example/x')).toBe('https://a.example/x/');
    expect(normalizeBase('https://a.example/x/')).toBe('https://a.example/x/');
  });

  it('只收 https —— 一个明文源就是整条资源链的投毒入口', () => {
    expect(() => normalizeBase('http://a.example/')).toThrow(OriginNotAllowedError);
  });

  it('本地开发放行 http://localhost', () => {
    expect(normalizeBase('http://localhost:5173/assets')).toBe('http://localhost:5173/assets/');
    expect(normalizeBase('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080/');
  });

  it('拒绝控制字符、query、fragment 与非 URL', () => {
    // 运行时构造，避免源码里出现裸控制字符。
    const withControl = `https://a.example/${String.fromCharCode(1)}x`;
    expect(() => normalizeBase(withControl)).toThrow(/控制字符/);
    expect(() => normalizeBase('https://a.example/?x=1')).toThrow(/query/);
    expect(() => normalizeBase('https://a.example/#f')).toThrow(/query|fragment/);
    expect(() => normalizeBase('not a url')).toThrow(/合法 URL/);
  });
});

describe('OriginPool', () => {
  const origins = [
    { base: 'https://fast.example/', weight: 80, name: 'edgeone' },
    { base: 'https://slow.example/', weight: 10, name: 'backup' },
  ];

  it('空源列表 fail-closed，不发明默认线路', () => {
    expect(() => new OriginPool([])).toThrow(/至少要配置一个源/);
  });

  it('按权重排序', () => {
    const pool = new OriginPool(origins);
    expect(pool.order()).toEqual(['https://fast.example/', 'https://slow.example/']);
  });

  it('连续失败进冷却后被降到队尾', () => {
    let t = 1000;
    const pool = new OriginPool(origins, {
      failuresBeforeCooldown: 2,
      cooldownMs: 500,
      now: () => t,
    });
    pool.reportFailure('https://fast.example/');
    expect(pool.order()[0]).toBe('https://fast.example/'); // 一次失败还不够
    pool.reportFailure('https://fast.example/');
    expect(pool.isCoolingDown('https://fast.example/')).toBe(true);
    expect(pool.order()).toEqual(['https://slow.example/', 'https://fast.example/']);

    t += 501;
    expect(pool.isCoolingDown('https://fast.example/')).toBe(false);
    expect(pool.order()[0]).toBe('https://fast.example/');
  });

  it('成功清零失败计数', () => {
    const t = 0;
    const pool = new OriginPool(origins, { failuresBeforeCooldown: 2, now: () => t });
    pool.reportFailure('https://fast.example/');
    pool.reportSuccess('https://fast.example/');
    pool.reportFailure('https://fast.example/');
    expect(pool.isCoolingDown('https://fast.example/')).toBe(false);
  });

  it('全线冷却也要给出顺序：取最早恢复的那条', () => {
    let t = 0;
    const pool = new OriginPool(origins, {
      failuresBeforeCooldown: 1,
      cooldownMs: 100,
      now: () => t,
    });
    pool.reportFailure('https://fast.example/'); // 冷却到 100
    t = 50;
    pool.reportFailure('https://slow.example/'); // 冷却到 150
    t = 60;
    expect(pool.order()).toEqual(['https://fast.example/', 'https://slow.example/']);
  });
});
