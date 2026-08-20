import { formatRef } from '@aio/core';
import type { Plugin, PluginInstance } from '@aio/kernel';
import { parseArmature } from './armature.js';
import { SpritePlayer, type Stage } from './player.js';

export * from './armature.js';
export * from './player.js';
export * from './pose.js';
export * from './stage-canvas2d.js';

/**
 * `sprite.show` 的一个实现——**从零写的，不碰任何上游代码**。
 *
 * 它只依赖两样东西：资源提供者（拿导出文件）和一个注入的舞台（画面）。
 * `example-sprite-mirror` 那套 cocos2d 若要接进来，它是 `Stage` 的又一个实现，
 * 而不是我们必须去改的东西——那 367 个引擎文件与 4,025 组素材都留在原地。
 */

export interface SpriteDeps {
  /** 造舞台。拿不到 DOM 时返回 null——播放器照常推帧，只是不画。 */
  createStage(container: unknown): Stage | null;
  /**
   * 这个舞台占不占 WebGL 上下文。
   *
   * 由**舞台**决定而不是由能力决定：canvas2d 舞台不占，WebGL 舞台占。
   * 声明错的后果不是报错，是浏览器静默丢弃最早的上下文（铁律 5）。
   */
  readonly usesWebGL?: boolean;
  /** 帧率，缺省 60。 */
  readonly fps?: number;
}

const decoder = new TextDecoder();

export function createSpritePlugin(deps: SpriteDeps): Plugin {
  return {
    manifest: {
      id: 'sprite-play',
      version: '0.1.0',
      title: '战斗精灵',
      isolation: 'inline',
      usesWebGL: deps.usesWebGL ?? false,
      provides: [{ id: 'sprite.show', accepts: ['sprite'], title: '显示战斗精灵' }],
      needs: ['sprite'],
    },

    async mount(target, intent, host): Promise<PluginInstance> {
      // 导出文件只经 host.resources 拿（铁律 3）：插件不知道它来自 CDN、
      // 本地目录还是离线包。
      const bytes = await host.resources.fetchPart(intent.ref, 'definition');

      let doc;
      try {
        doc = parseArmature(JSON.parse(decoder.decode(bytes)));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        host.log('error', `解析 ${formatRef(intent.ref)} 失败：${reason}`);
        // 解析错的骨骼不会白屏，它会播成另一个样子——所以宁可打不开。
        throw new Error(`骨骼解析失败：${reason}`);
      }

      const stage = deps.createStage(target.container);

      const wanted = intent.params?.['movement'];
      const player = new SpritePlayer({
        doc,
        stage,
        ...(deps.fps === undefined ? {} : { fps: deps.fps }),
        // 未知动作名不该让挂载失败：容忍未知参数是契约的一条。
        ...(typeof wanted === 'string' && doc.movements.some((m) => m.name === wanted)
          ? { movement: wanted }
          : {}),
        autoPlay: intent.params?.['paused'] !== true,
        onFrame: (frame, total) => {
          host.events.emit('progress', {
            surfaceId: host.surfaceId,
            ref: intent.ref,
            position: frame,
            total,
          });
        },
      });

      if (typeof wanted === 'string' && !doc.movements.some((m) => m.name === wanted)) {
        host.log('warn', `没有动作 ${JSON.stringify(wanted)}，用默认动作 ${player.movement.name}`);
      }

      return {
        suspend() {
          player.pause();
        },
        resume() {
          player.play();
        },
        dispose() {
          player.dispose();
        },
        update(next) {
          const m = next.params?.['movement'];
          if (typeof m === 'string' && doc.movements.some((x) => x.name === m)) {
            player.select(m);
          }
        },
      };
    },
  };
}
