import type { CapabilityId, FrameworkEventName, RefKind } from '@aio/core';

/**
 * 能力契约（ADR 0002 第二层）。
 *
 * 契约**不描述「怎么画」，只描述「能被怎么用」**。所以它落在意图与事件上，
 * 而不是在 `PluginInstance` 上加方法——加方法等于在既有的
 * 「发意图 / 订事件」之外再开一条更紧的耦合通道，而那条通道会把
 * 「插件之间互不知道对方存在」这条判据蛀空。
 *
 * ## 为什么这一层现在值得做
 *
 * 维护者的判断：这是开源仓库，**直接去改上游第一不合适、第二容易牵出许可证
 * 问题**。那么「把既有查看器改一改接进来」就不能是主路径——
 * `example-reader` 未授予任何开源许可，`example-live2d-viewer` 是他人仓库，
 * 改动别人的项目既是越界也是风险。
 *
 * 于是契约不再只是「将来好替换」的锦上添花，而是**这套系统能独立成立的前提**：
 * 先有与实现无关的契约，我们自己的实现才可能不依赖任何一个上游而存在；
 * 上游若愿意接，它是契约的又一个实现，不接也不影响这套系统可用。
 */

export interface CapabilityParamSpec {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean';
  readonly required: boolean;
  readonly note: string;
}

export interface CapabilityContract {
  readonly id: CapabilityId;
  readonly title: string;
  /**
   * **至少**要接受这些 kind。实现可以多接（如 3D 查看器同时接 character），
   * 不能少接——少接意味着宿主按契约画出来的入口点下去没人处理。
   */
  readonly accepts: readonly RefKind[];
  /**
   * 认得的参数。实现**必须容忍未知参数**（忽略，不得抛）：
   * 契约会长出新参数，老实现不能因此在新宿主里崩掉。
   */
  readonly params: readonly CapabilityParamSpec[];
  /**
   * 实现在被驱动时**应当**发出的事件。
   *
   * 这是「回话」那一半：只能打开、不能回话的东西是跳转链接，不是插件。
   */
  readonly emits: readonly FrameworkEventName[];
  /**
   * 会不会占 WebGL 上下文。
   *
   * 契约里钉死是因为它不是实现细节：浏览器同时活着的上下文有硬上限，
   * 超了**不报错**，只是最早那个被静默丢弃（铁律 5）。
   * 一个占了 WebGL 却不声明的实现，会让别人已经打开的查看器突然变黑。
   */
  readonly usesWebGL: boolean;
}

const contract = (c: CapabilityContract): CapabilityContract => c;

export const MODEL3D_SHOW = contract({
  id: 'model3d.show',
  title: '查看 3D 模型',
  accepts: ['model3d'],
  params: [
    { name: 'animation', type: 'string', required: false, note: '起始动画名，缺省为静止姿态' },
  ],
  emits: [],
  usesWebGL: true,
});

export const SPRITE_SHOW = contract({
  id: 'sprite.show',
  title: '显示战斗精灵',
  accepts: ['sprite'],
  params: [
    { name: 'variant', type: 'string', required: false, note: '变体（如 d_r），缺省用清单里第一个' },
    { name: 'paused', type: 'boolean', required: false, note: '是否挂起后再起播' },
  ],
  emits: [],
  usesWebGL: true,
});

export const LIVE2D_SHOW = contract({
  id: 'live2d.show',
  title: '查看 Live2D',
  accepts: ['live2d'],
  params: [
    { name: 'costume', type: 'string', required: false, note: '服装 ID' },
    { name: 'motion', type: 'string', required: false, note: '起始动作' },
  ],
  emits: ['entity.focused'],
  usesWebGL: true,
});

export const ADV_PLAY = contract({
  id: 'adv.play',
  title: '实机播放剧情',
  accepts: ['scenario'],
  params: [
    { name: 'line', type: 'number', required: false, note: '起播行号，缺省从头' },
    { name: 'auto', type: 'boolean', required: false, note: '自动播放' },
  ],
  // 进度回流是这个能力存在的意义之一：阅读器据此高亮当前行，
  // 而它从未 import 过播放器。不发 progress 的实现只是个播放窗口。
  emits: ['progress', 'entity.focused'],
  usesWebGL: true,
});

export const SEARCH_QUERY = contract({
  id: 'search.query',
  title: '检索',
  accepts: ['character'],
  params: [{ name: 'q', type: 'string', required: false, note: '查询串' }],
  emits: ['entity.focused'],
  usesWebGL: false,
});

export const CONTRACTS: readonly CapabilityContract[] = [
  MODEL3D_SHOW,
  SPRITE_SHOW,
  LIVE2D_SHOW,
  ADV_PLAY,
  SEARCH_QUERY,
];

export function contractOf(id: CapabilityId): CapabilityContract | null {
  return CONTRACTS.find((c) => c.id === id) ?? null;
}
