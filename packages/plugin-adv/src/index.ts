import { formatRef, type ResourceRef } from '@aio/core';
import type { Plugin, PluginInstance } from '@aio/kernel';
import { AdvEngine, type Stage } from './engine.js';
import { parseWorksheet, type ScenarioCommand } from './scenario.js';

export * from './scenario.js';
export * from './engine.js';

/**
 * `adv.play` 的一个实现——**从零写的，不碰任何上游代码**。
 *
 * 它只依赖两样东西：资源提供者（拿剧本字节）和一个注入的舞台（画面）。
 * 上游的 ADV 播放器若愿意接进来，它是 `Stage` 的又一个实现，而不是我们
 * 必须去修改的东西。这正是「不改上游」那条约束要的形状。
 */

export interface AdvDeps {
  /**
   * 造舞台。拿不到 DOM（node、SSR 预检）时返回 null——引擎照常跑时间轴，
   * 只是不画。**渲染是可选的，契约行为不是。**
   */
  createStage(container: unknown): Stage | null;
  /**
   * 这个舞台占不占 WebGL 上下文。
   *
   * 由**舞台**决定而不是由能力决定：同一个 `adv.play`，DOM 舞台不占，
   * Pixi/Cubism 舞台占。manifest 里声明错的后果不是报错，是浏览器静默丢弃
   * 最早的上下文，某个已打开的查看器突然变黑（铁律 5）。
   */
  readonly usesWebGL?: boolean;
  /** 自动推进间隔，缺省 2 秒。<= 0 表示只手动推进。 */
  readonly autoAdvanceMs?: number;
  /**
   * 把表内 assetId 映射成 ref，供「ADV 里点立绘打开档案」。
   *
   * **不提供就不发 `entity.focused`。** 绝不按编号规律猜一个 ref 出来——
   * 猜错的代价是把一个角色的立绘链到另一个角色的档案，而且不报错（铁律 2）。
   * 正确的来源是交叉表，那是 Phase 4 的人工核对工作。
   */
  resolveEntity?: (assetId: string, command: ScenarioCommand) => ResourceRef | null;
}

const decoder = new TextDecoder();

export function createAdvPlugin(deps: AdvDeps): Plugin {
  return {
    manifest: {
      id: 'adv-play',
      version: '0.1.0',
      title: 'ADV 播放器',
      isolation: 'inline',
      usesWebGL: deps.usesWebGL ?? false,
      provides: [{ id: 'adv.play', accepts: ['scenario'], title: '实机播放剧情' }],
      needs: ['scenario'],
    },

    async mount(target, intent, host): Promise<PluginInstance> {
      // 剧本字节只经 host.resources 拿（铁律 3）：插件不知道它来自 CDN、
      // 本地目录还是离线包。
      const bytes = await host.resources.fetchPart(intent.ref, 'script');

      let doc;
      try {
        doc = parseWorksheet(JSON.parse(decoder.decode(bytes)));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        host.log('error', `解析 ${formatRef(intent.ref)} 失败：${reason}`);
        // 解析错的剧本会静默播成另一个样子，所以宁可打不开。
        throw new Error(`剧本解析失败：${reason}`);
      }

      const stage = deps.createStage(target.container);

      const engine = new AdvEngine({
        doc,
        stage,
        autoAdvanceMs: deps.autoAdvanceMs ?? 2000,
        startLine: typeof intent.params?.['line'] === 'number' ? intent.params['line'] : 0,
        onProgress: (position, total) => {
          host.events.emit('progress', { surfaceId: host.surfaceId, ref: intent.ref, position, total });
        },
        onAsset: (assetId, command) => {
          const ref = deps.resolveEntity?.(assetId, command) ?? null;
          if (ref === null) return; // 查不到就不发——不猜
          host.events.emit('entity.focused', { surfaceId: host.surfaceId, ref });
        },
      });

      if (intent.params?.['auto'] === false) engine.seek(engine.position);
      else engine.play();

      return {
        suspend() {
          engine.pause();
        },
        resume() {
          engine.play();
        },
        dispose() {
          engine.dispose();
        },
        update(next) {
          const line = next.params?.['line'];
          if (typeof line === 'number') engine.seek(line);
        },
      };
    },
  };
}
