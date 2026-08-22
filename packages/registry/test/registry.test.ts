import { describe, expect, it } from 'vitest';
import { formatRef, parseRef } from '@aio/core';
import { Registry, RegistryError } from '@aio/registry';

const data = {
  version: 1 as const,
  entities: [
    {
      ref: 'a:character/1001',
      nameZh: '角色甲',
      nameJa: '角色甲',
      links: {
        sprite: ['a:sprite/100100/d_r', 'a:sprite/100101/d_r'],
        voice: ['a:voice/vo_char_1001_00_01'],
      },
    },
    {
      ref: 'a:character/1002',
      nameZh: '角色丙',
      links: { sprite: ['a:sprite/100200/d_r'] },
    },
    {
      ref: 'b:character/100101',
      nameJa: '角色乙',
      links: { model3d: ['b:model3d/100101'] },
    },
  ],
};

describe('Registry', () => {
  const reg = Registry.from(data);

  it('查角色的关联资源', () => {
    const links = reg.linksOf(parseRef('a:character/1001'), 'sprite');
    expect(links.map(formatRef)).toEqual(['a:sprite/100100/d_r', 'a:sprite/100101/d_r']);
    expect(formatRef(reg.primaryLink(parseRef('a:character/1001'), 'sprite')!)).toBe(
      'a:sprite/100100/d_r',
    );
  });

  it('has() 用于决定按钮画不画', () => {
    expect(reg.has(parseRef('a:character/1001'), 'sprite')).toBe(true);
    expect(reg.has(parseRef('a:character/1001'), 'model3d')).toBe(false);
    expect(reg.has(parseRef('a:character/1002'), 'voice')).toBe(false);
  });

  it('🔴 查不到就是查不到，绝不按编号规律猜', () => {
    // 1002 登记了精灵却没登记语音。按「charaId + 服装号」的规律，
    // 猜一个 a:voice/vo_char_1002_00_01 出来看似合理——但 wiki 给 1001 登记的
    // costumeIds 是 03/04/50/53，而实际存在的精灵是 00/01/09，规律本身就不成立。
    expect(reg.linksOf(parseRef('a:character/1002'), 'voice')).toEqual([]);
    // 完全不存在的实体同理。
    expect(reg.linksOf(parseRef('a:character/9999'), 'sprite')).toEqual([]);
  });

  it('🔴 两个作品的同号实体互不串台', () => {
    const mrSide = reg.linksOf(parseRef('a:character/100101'), 'model3d');
    const exSide = reg.linksOf(parseRef('b:character/100101'), 'model3d');
    expect(mrSide).toEqual([]);
    expect(exSide.map(formatRef)).toEqual(['b:model3d/100101']);
  });

  it('🔴 拒绝跨作品关联——那正是撞号事故的形状', () => {
    expect(() =>
      Registry.from({
        version: 1,
        entities: [{ ref: 'a:character/1001', links: { model3d: ['b:model3d/100101'] } }],
      }),
    ).toThrow(RegistryError);
  });

  it('拒绝分组与 kind 不符的条目', () => {
    expect(() =>
      Registry.from({
        version: 1,
        entities: [{ ref: 'a:character/1001', links: { sprite: ['a:voice/x'] } }],
      }),
    ).toThrow(/混进/);
  });

  it('拒绝重复登记', () => {
    expect(() =>
      Registry.from({
        version: 1,
        entities: [
          { ref: 'a:character/1001', links: {} },
          { ref: 'a:character/1001', links: {} },
        ],
      }),
    ).toThrow(/重复/);
  });

  it('反查：这份资源属于谁——ADV 里点立绘要用', () => {
    expect(formatRef(reg.ownerOf(parseRef('a:sprite/100200/d_r'))!)).toBe('a:character/1002');
    expect(reg.ownerOf(parseRef('a:sprite/999999/x'))).toBeNull();
  });

  it('显示名按语言优先级回退', () => {
    expect(reg.displayName(parseRef('a:character/1001'))).toBe('角色甲');
    expect(reg.displayName(parseRef('a:character/1001'), 'ja')).toBe('角色甲');
    // 只有日文名时，中文优先也得给出日文，而不是给个空串。
    expect(reg.displayName(parseRef('b:character/100101'))).toBe('角色乙');
    // 完全没登记就退回 ref 本身，便于排查。
    expect(reg.displayName(parseRef('a:character/9999'))).toBe('a:character/9999');
  });

  it('按作品域列目录', () => {
    expect(reg.list('a', 'character').map(formatRef)).toEqual([
      'a:character/1001',
      'a:character/1002',
    ]);
    expect(reg.list('b', 'character').map(formatRef)).toEqual(['b:character/100101']);
  });
});
