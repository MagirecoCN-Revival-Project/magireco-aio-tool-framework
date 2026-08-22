import { formatRef } from '@aio/core';
import type { Plugin, PluginInstance } from '@aio/kernel';
import { animationNames, animationOf, parseGltf, type GltfAnimation, type GltfDoc } from './gltf.js';

export * from './gltf.js';

/**
 * `model3d.show` 的一个实现——**从零写的，不碰任何上游代码**。
 *
 * 这是五个能力里最后一个补齐自有实现的：此前它只有
 * `@aio/plugin-model-3d`（包装一个既有的上游查看器），而那个上游子包装不上。
 *
 * 与另外三个从零实现同一个切法：解析在 `gltf.ts`，画面交给注入的 `Stage`。
 * three.js / Babylon / 上游那套若要接进来，各自是 `Stage` 的一个实现。
 */

export interface Stage {
  /** 装载模型。`externals` 已经解析成可直接取用的 URL。 */
  load(doc: GltfDoc, externals: ReadonlyMap<string, string>): void;
  /** `null` 表示停在静止姿态。 */
  playAnimation(animation: GltfAnimation | null): void;
  dispose(): void;
}

export interface GltfDeps {
  createStage(container: unknown): Stage | null;
  /**
   * 真跑 WebGL 的舞台**一定要传 true**。
   *
   * 不声明的后果不是报错，是浏览器静默丢弃最早的上下文，别人已打开的
   * 查看器突然变黑（铁律 5）。这个能力的实现几乎必然占 WebGL，
   * 但仍由舞台决定——一个只列动画清单、不渲染的舞台就不占。
   */
  readonly usesWebGL?: boolean;
}

const decoder = new TextDecoder();

export function createGltfPlugin(deps: GltfDeps): Plugin {
  return {
    manifest: {
      id: 'model3d-gltf',
      version: '0.1.0',
      title: '3D 模型查看器（glTF）',
      isolation: 'inline',
      usesWebGL: deps.usesWebGL ?? false,
      provides: [{ id: 'model3d.show', accepts: ['model3d'], title: '查看 3D 模型' }],
      needs: ['model3d'],
    },

    async mount(target, intent, host): Promise<PluginInstance> {
      const bytes = await host.resources.fetchPart(intent.ref, 'model');

      let doc: GltfDoc;
      try {
        doc = parseGltf(JSON.parse(decoder.decode(bytes)));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        host.log('error', `解析 ${formatRef(intent.ref)} 失败：${reason}`);
        // 按 2.0 读一份 1.0 得到的是错的东西而不是报错，所以宁可打不开。
        throw new Error(`glTF 解析失败：${reason}`);
      }

      /**
       * 把外部依赖解析成 URL。
       *
       * 走的是同一条 ref 的清单：glTF 里的 `uri` 是**相对路径**，而资源层按
       * role 索引。约定是清单里给每份外部文件登记一个与 uri 同名的 role。
       * 查不到就跳过并记一笔——**不去猜一个 URL 拼出来**（铁律 3：插件不碰 URL）。
       */
      const externals = new Map<string, string>();
      let resolved;
      try {
        resolved = host.resources.resolve(intent.ref);
      } catch {
        resolved = null;
      }
      for (const ext of doc.externals) {
        const part = resolved?.parts.find((p) => p.role === ext.uri || p.path.endsWith(ext.uri));
        const url = part?.candidates[0]?.url;
        if (url === undefined) {
          host.log('warn', `${formatRef(intent.ref)} 的清单里没有 ${ext.uri}，该部件不会出现`);
          continue;
        }
        externals.set(ext.uri, url);
      }

      const stage = deps.createStage(target.container);
      stage?.load(doc, externals);

      // 未知动画名忽略而不是崩：容忍未知参数是契约的一条。
      const pick = (raw: unknown): GltfAnimation | null =>
        typeof raw === 'string' ? animationOf(doc, raw) : null;

      let current = pick(intent.params?.['animation']);
      if (typeof intent.params?.['animation'] === 'string' && current === null) {
        host.log(
          'warn',
          `没有动画 ${JSON.stringify(intent.params['animation'])}——这份模型有：` +
            `${animationNames(doc).join('、') || '（无）'}`,
        );
      }
      stage?.playAnimation(current);

      return {
        suspend() {
          // 渲染循环归舞台管；这里停在当前姿态即可。
          stage?.playAnimation(null);
        },
        resume() {
          stage?.playAnimation(current);
        },
        dispose() {
          stage?.dispose();
        },
        update(next) {
          const picked = pick(next.params?.['animation']);
          if (picked !== null) {
            current = picked;
            stage?.playAnimation(picked);
          }
        },
      };
    },
  };
}
