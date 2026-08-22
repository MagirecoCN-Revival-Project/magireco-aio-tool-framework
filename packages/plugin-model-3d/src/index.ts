import { formatRef } from '@aio/core';
import type { Plugin, PluginInstance } from '@aio/kernel';
import { buildFiles } from './files.js';

export * from './files.js';

/**
 * 一个既有 3D 查看器的插件封装（Phase 1.2）——**wrapper 模式的样例实现**。
 *
 * ## 为什么上游那两个类是**注入**进来的，而不是 import 的
 *
 * 三条理由，任何一条单独成立：
 *
 * 1. **本仓库不装上游查看器的源码**（CLAUDE.md 开头）。直接 import 会把
 *    上游那个 three.js 子包连同 three 本身拖进控制面的依赖树。
 * 2. **`three` 是 peerDependency。** 宿主可能已经有一份 three，装两份会得到
 *    两个互不相认的 `THREE` 命名空间——那是这类库最经典的坑。
 * 3. **注入才能在 node 上测。** 下面那些判据（清单路径合规、角色号对得上、
 *    suspend 真的停渲染）全部不需要浏览器，注入假实现就能跑。
 *
 * 宿主侧长这样：
 *
 * ```ts
 * import CharacterThree, { Scene3D } from '<上游的 three.js 子包>';
 * import { setRenderPaused } from '<上游的 three.js 子包>/renderer';
 *
 * kernel.register(createModel3dPlugin({
 *   CharacterManager: CharacterThree,
 *   Scene: Scene3D,
 *   setRenderPaused,
 * }));
 * ```
 *
 * ## 上游仓库要改什么
 *
 * **什么都不用改。** 它的构造函数签名本来就是 `Record<路径, URL>`，
 * 文档里还明写了可以传任意 URL。改的只是「谁来构造这个 Record」——
 * 从 `import.meta.glob` 换成资源清单。铁律 6 因此自动满足：
 * 上游照旧 `npm run dev` 独立可跑。
 */

/** 上游角色管理器里本插件用到的部分。 */
export interface CharacterManagerLike {
  loadCharacterById(id: number | string): Promise<unknown>;
}

/** 上游场景类里本插件用到的部分。 */
export interface SceneLike {
  addCharacter(id: number | string): Promise<SceneCharacterLike>;
  removeCharacter(sceneCharacter: SceneCharacterLike): void;
  /** 挂到宿主给的容器上。上游把 canvas 挂在 document.body，包装层负责改址。 */
  readonly canvas?: HTMLCanvasElement;
}

export type SceneCharacterLike = object;

export interface Model3dDeps {
  readonly CharacterManager: new (files: Record<string, string>) => CharacterManagerLike;
  readonly Scene: new (manager: CharacterManagerLike) => SceneLike;
  /**
   * 上游 `renderer.ts` 的 `setRenderPaused`。
   *
   * **它是模块级单例**——整个 three 渲染循环只有一个。这正是内核上下文治理器
   * 需要的把手：`suspend()` 停掉 RAF 与 WebGL 工作，状态全留着，
   * `resume()` 原地接回来。不给这个函数，插件被挂起时仍会烧 GPU。
   */
  readonly setRenderPaused?: (paused: boolean) => void;
}

export function createModel3dPlugin(deps: Model3dDeps): Plugin {
  return {
    manifest: {
      id: 'model-3d',
      version: '0.1.0',
      title: '3D 模型查看器',
      // three.js 0.182 是 ESM，不挂全局，可与宿主及其它 ESM 查看器同 realm。
      // 与 contracts/example-model-viewer.source.json 一致。
      isolation: 'inline',
      // 不声明的后果不是报错，是浏览器静默丢弃最早的上下文（铁律 5）。
      usesWebGL: true,
      provides: [
        { id: 'model3d.show', accepts: ['model3d', 'character'], title: '查看 3D 模型' },
      ],
      needs: ['model3d'],
    },

    async mount(target, intent, host): Promise<PluginInstance> {
      // 清单 → Record<路径, URL>。整个「接入」的实质就是这一行。
      const { files, characterId } = buildFiles(host.resources, intent.ref);

      const manager = new deps.CharacterManager(files);
      const scene = new deps.Scene(manager);

      const container = target.container;
      if (scene.canvas !== undefined && container !== null && typeof container === 'object') {
        (container as HTMLElement).append(scene.canvas);
      }

      let current: SceneCharacterLike | null = null;
      try {
        current = await scene.addCharacter(characterId);
      } catch (err) {
        host.log('error', `装载 ${formatRef(intent.ref)} 失败：${String(err)}`);
        throw err;
      }

      let disposed = false;
      const pause = (paused: boolean): void => {
        deps.setRenderPaused?.(paused);
      };

      return {
        // 四个方法都必须幂等——治理器会反复调（PluginInstance 的契约）。
        suspend() {
          if (disposed) return;
          pause(true);
        },
        resume() {
          if (disposed) return;
          pause(false);
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          pause(true);
          if (current !== null) {
            scene.removeCharacter(current);
            current = null;
          }
          scene.canvas?.remove();
        },
        async update(next) {
          if (disposed) return;
          const built = buildFiles(host.resources, next.ref);
          const nextManager = new deps.CharacterManager(built.files);
          // 换角色比 dispose+mount 省一次场景与渲染器初始化。
          void nextManager;
          if (current !== null) scene.removeCharacter(current);
          current = await scene.addCharacter(built.characterId);
        },
      };
    },
  };
}
