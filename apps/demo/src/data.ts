/**
 * 演示用的数据。
 *
 * 角色与 ID 是**真实的**（从上游仓库对账得来，见 docs/reports/）：
 *   a:character/1001  角色甲   → 精灵 unit 100100
 *   b:character/100101 角色乙 → 命名空间 b 3D，与上面同号但不同人
 * 剧本文本是**占位的**，不是游戏原文——这里要演示的是机制，不是内容。
 */
import type { RegistryData } from '@aio/registry';
import type { ManifestDoc } from '@aio/resource';

export const registryData: RegistryData = {
  version: 1,
  entities: [
    {
      ref: 'a:character/1001',
      nameZh: '角色甲',
      nameJa: '角色甲',
      links: { sprite: ['a:sprite/100100/d_r'], voice: ['a:voice/vo_char_1001_00_01'] },
    },
    {
      ref: 'a:character/1002',
      nameZh: '角色丙',
      nameJa: '丙キャラ',
      links: { sprite: ['a:sprite/100200/d_r'] },
    },
    {
      ref: 'b:character/100101',
      nameZh: '角色乙',
      nameJa: '角色乙',
      links: { model3d: ['b:model3d/100101'] },
    },
  ],
};

export const manifests: ManifestDoc[] = [
  {
    version: 1, universe: 'a', kind: 'scenario',
    entries: { 'a:scenario/310241@zh': { parts: [{ path: '310241/zh.json', role: 'script', bytes: 18422 }] } },
  },
  {
    version: 1, universe: 'a', kind: 'sprite',
    entries: {
      'a:sprite/100100/d_r': { parts: [
        { path: '100100/mini_100100_d_r.ExportJson', role: 'definition', bytes: 12038 },
        { path: '100100/mini_100100_d_r0.plist', role: 'atlas', bytes: 4211 },
        { path: '100100/mini_100100_d_r0.png', role: 'texture', bytes: 40213 },
      ] },
      'a:sprite/100200/d_r': { parts: [
        { path: '100200/mini_100200_d_r.ExportJson', role: 'definition' },
        { path: '100200/mini_100200_d_r0.png', role: 'texture', bytes: 38907 },
      ] },
    },
  },
  {
    version: 1, universe: 'b', kind: 'model3d',
    entries: { 'b:model3d/100101': { parts: [
      { path: 'chara_100107_battle_unit/VisualRoot.fbx.gz', role: 'mesh', bytes: 2_140_331, encoding: 'gzip' },
      { path: 'chara_100107_battle_unit/acc_color.png', role: 'texture', bytes: 262_144 },
    ] } },
  },
  {
    version: 1, universe: 'a', kind: 'character',
    entries: {
      'a:character/1001': { parts: [{ path: 'c/1001.json', role: 'profile' }] },
      'a:character/1002': { parts: [{ path: 'c/1002.json', role: 'profile' }] },
    },
  },
];

/** 占位剧本。不是游戏原文。 */
export const script: readonly { speaker: string; text: string }[] = [
  { speaker: '角色甲', text: '这里是第一行台词。剧本内容是占位的。' },
  { speaker: '旁白', text: '阅读器只知道自己在显示一篇剧情。' },
  { speaker: '角色丙', text: '它不知道有没有播放器，也不知道播放器叫什么。' },
  { speaker: '角色甲', text: '它只会问内核：有人能播 a:scenario/310241@zh 吗？' },
  { speaker: '旁白', text: '有人能播，才画出这一行的播放按钮。' },
  { speaker: '角色丙', text: '播放开始后，进度会顺着事件总线回到这里。' },
  { speaker: '角色甲', text: '于是当前行会高亮——两个模块从未互相引用。' },
  { speaker: '旁白', text: '这就是「插件化」与「放个跳转链接」的区别。' },
];
