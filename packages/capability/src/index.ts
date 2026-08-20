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
   * 这个能力的实现**通常**是否需要 WebGL 上下文。**参考值，不是判据。**
   *
   * > 这里原本叫 `usesWebGL`，而且一致性套件断言「实现必须与契约相等」。
   * > 写第二个 `adv.play` 实现时发现那是错的：同一个能力，DOM 舞台不占
   * > WebGL，Pixi/Cubism 舞台占。**它是实现属性，不是能力属性**，
   * > 断言相等会把合法实现判成不合规。
   * >
   * > 这正是 ADR 0002 那句「没有一个能跑的实现，契约一定设计错」当场应验。
   *
   * 真正该声明它的地方是 `PluginManifest.usesWebGL`——内核的上下文治理器读那里。
   * 声明不足的后果不是报错，是浏览器静默丢弃最早的上下文（铁律 5）；
   * 但那件事没法由测试自动查出来，只能靠实现者诚实，所以这里不假装能验。
   */
  readonly webglTypical: boolean;
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
  webglTypical: true,
});

export const SPRITE_SHOW = contract({
  id: 'sprite.show',
  title: '显示战斗精灵',
  accepts: ['sprite'],
  params: [
    { name: 'variant', type: 'string', required: false, note: '变体（如 d_r），缺省用清单里第一个' },
    { name: 'movement', type: 'string', required: false, note: '动作名，必须来自骨骼数据；未知值忽略而不是崩' },
    { name: 'paused', type: 'boolean', required: false, note: '是否挂起后再起播' },
  ],
  // 帧进度回流：UI 据此画帧进度条，而它不知道是谁在推帧。
  // 精灵是**动画**播放器（骨骼里就带着一串动作），所以「第几帧」是有意义的量。
  emits: ['progress'],
  webglTypical: true,
});

export const LIVE2D_SHOW = contract({
  id: 'live2d.show',
  title: '查看 Live2D',
  accepts: ['live2d'],
  params: [
    { name: 'motion', type: 'string', required: false, note: '动作组名，必须来自模型数据；未知值忽略而不是崩' },
    { name: 'expression', type: 'string', required: false, note: '表情名，同上' },
    { name: 'lipSync', type: 'boolean', required: false, note: '口型同步；模型没登记 LipSync 参数时开不起来' },
  ],
  // > 这里原本有一个 `costume` 参数。写实现时发现它是错的：一个
  // > `model3.json` 描述的就是**一套**服装（Moc、贴图、动作、表情全绑在一起），
  // > 换服装等于换一个模型文件——那是**另一条 ref**，不是同一模型的参数。
  // > 留着它会诱使实现假装能就地换装，而它实际上必须重新加载。
  // > 服装属于 ref 的段（如 `a:live2d/1001/costume03`），由清单与交叉表决定。
  emits: ['entity.focused'],
  webglTypical: true,
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
  webglTypical: true,
});

export const SEARCH_QUERY = contract({
  id: 'search.query',
  title: '检索',
  accepts: ['character'],
  params: [{ name: 'q', type: 'string', required: false, note: '查询串' }],
  emits: ['entity.focused'],
  webglTypical: false,
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
