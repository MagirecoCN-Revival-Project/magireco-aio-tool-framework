import { formatRef, type ResourceRef } from '@aio/core';
import type { Plugin, PluginHost, PluginInstance } from '@aio/kernel';
import { parseArmature, type SpriteDoc } from './armature.js';
import { parseAtlas, type SpriteAtlas } from './atlas.js';
import { SpritePlayer, type Stage } from './player.js';
import type { SpriteStageContext } from './stage-canvas2d.js';

export * from './armature.js';
export * from './atlas.js';
export * from './draw.js';
export * from './player.js';
export * from './plist.js';
export * from './pose.js';
export * from './stage-canvas2d.js';

/**
 * `sprite.show` 的一个实现——**从零写的，不碰任何上游代码**。
 *
 * 它只依赖两样东西：资源提供者（拿导出文件）和一个注入的舞台（画面）。
 * 上游那套 cocos2d 若要接进来，它是 `Stage` 的又一个实现，
 * 而不是我们必须去改的东西——那 367 个引擎文件与 4,025 组素材都留在原地。
 */

export interface SpriteDeps {
  /**
   * 造舞台。拿不到 DOM 时返回 null——播放器照常推帧，只是不画。
   *
   * 第二个参数带着骨架、图集与已解码的贴图：舞台要么画真图，要么退回画骨骼
   * 方块，**由它自己决定**。插件不替它判断，因为「能不能画贴图」是舞台的属性。
   */
  createStage(container: unknown, ctx: SpriteStageContext): Stage | null;
  /**
   * 把贴图字节解成能画的东西。**不给就不取贴图**——解码要浏览器 API
   * （`createImageBitmap`），而这个包必须能在 node 上 import。
   * 浏览器宿主传 `decodeTextureWithImageBitmap` 即可。
   */
  decodeTexture?: (bytes: ArrayBuffer) => Promise<unknown>;
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

/**
 * 取图集与贴图。
 *
 * **取不到不是错误**：资源面还没上线（路线图 Phase 2）时这条 ref 只有骨骼文件，
 * 舞台退回画骨骼方块，插件照常可用。所以这里全程不抛，只 `log('warn')`——
 * 让「精灵打不开」与「精灵没有贴图」是两件不同的事。
 *
 * 骨骼文件里的 `texture_data[].plistFile` 记着图集文件名，但**这里一个路径都不拼**
 * （铁律 3）：图集与贴图各是一个 role，路径在清单里。
 */
async function loadTexture(
  doc: SpriteDoc,
  ref: ResourceRef,
  host: PluginHost,
  deps: SpriteDeps,
): Promise<{ atlas: SpriteAtlas | null; texture: unknown }> {
  if (deps.decodeTexture === undefined) return { atlas: null, texture: null };

  let roles: ReadonlySet<string>;
  try {
    roles = new Set(host.resources.resolve(ref).parts.map((p) => p.role));
  } catch {
    /* c8 ignore next */
    return { atlas: null, texture: null };
  }
  if (!roles.has('atlas') || !roles.has('texture')) {
    if (doc.textures.length > 0) {
      // 骨骼说它有图集分片，清单里却没有——多半是清单少登记了，值得说一声。
      host.log('info', `${formatRef(ref)} 的清单里没有 atlas/texture，只画骨骼`);
    }
    return { atlas: null, texture: null };
  }

  try {
    const atlas = parseAtlas(decoder.decode(await host.resources.fetchPart(ref, 'atlas')));
    const texture = await deps.decodeTexture(await host.resources.fetchPart(ref, 'texture'));
    return texture == null ? { atlas: null, texture: null } : { atlas, texture };
  } catch (err) {
    host.log('warn', `${formatRef(ref)} 的图集用不了，只画骨骼：${String(err)}`);
    return { atlas: null, texture: null };
  }
}

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

      const { atlas, texture } = await loadTexture(doc, intent.ref, host, deps);
      const stage = deps.createStage(target.container, { doc, atlas, texture });

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
