import { formatRef } from '@aio/core';
import type { Plugin, PluginInstance } from '@aio/kernel';
import { parseModel3 } from './model3.js';
import { Live2dSession, type Stage } from './session.js';

export * from './model3.js';
export * from './session.js';

/**
 * `live2d.show` 的一个实现——**从零写的，不碰任何上游代码**。
 *
 * 模型描述文件经 `host.resources` 拿（铁律 3），选择逻辑在 `session.ts`，
 * 画面交给注入的舞台。命名空间 b 那套 Cubism 集成若要接进来，它是 `Stage`
 * 的又一个实现——`sdk/Core` 与 `sdk/Framework` 都留在原地。
 */

export interface Live2dDeps {
  createStage(container: unknown): Stage | null;
  /**
   * 这个舞台占不占 WebGL 上下文。
   *
   * 真跑 Cubism 的舞台**一定占**，务必传 true：不声明的后果不是报错，
   * 是浏览器静默丢弃最早的上下文，别人已打开的查看器突然变黑（铁律 5）。
   */
  readonly usesWebGL?: boolean;
}

const decoder = new TextDecoder();

export function createLive2dPlugin(deps: Live2dDeps): Plugin {
  return {
    manifest: {
      id: 'live2d-show',
      version: '0.1.0',
      title: 'Live2D 查看器',
      isolation: 'inline',
      usesWebGL: deps.usesWebGL ?? false,
      provides: [{ id: 'live2d.show', accepts: ['live2d'], title: '查看 Live2D' }],
      needs: ['live2d'],
    },

    async mount(target, intent, host): Promise<PluginInstance> {
      const bytes = await host.resources.fetchPart(intent.ref, 'model');

      let doc;
      try {
        doc = parseModel3(JSON.parse(decoder.decode(bytes)));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        host.log('error', `解析 ${formatRef(intent.ref)} 失败：${reason}`);
        // 缺贴图的模型不会白屏，会画成一团纯色——比报错更难查，所以宁可打不开。
        throw new Error(`模型描述解析失败：${reason}`);
      }

      const stage = deps.createStage(target.container);

      // 未知动作/表情名忽略而不是崩：容忍未知参数是契约的一条。
      const wantMotion = intent.params?.['motion'];
      const wantExpr = intent.params?.['expression'];
      const session = new Live2dSession({
        doc,
        stage,
        ...(typeof wantMotion === 'string' && doc.motions.some((m) => m.group === wantMotion)
          ? { motion: wantMotion }
          : {}),
        ...(typeof wantExpr === 'string' && doc.expressions.some((e) => e.name === wantExpr)
          ? { expression: wantExpr }
          : {}),
      });

      if (typeof wantMotion === 'string' && session.motion === null) {
        host.log('warn', `没有动作 ${JSON.stringify(wantMotion)}，保持未选中`);
      }

      return {
        suspend() {
          // Cubism 的渲染循环归舞台管；没有舞台时无事可做。
          session.setLipSync(false);
        },
        resume() {},
        dispose() {
          session.dispose();
        },
        update(next) {
          const m = next.params?.['motion'];
          if (typeof m === 'string' && doc.motions.some((x) => x.group === m)) {
            session.setMotion(m);
          }
          const e = next.params?.['expression'];
          if (typeof e === 'string' && doc.expressions.some((x) => x.name === e)) {
            session.setExpression(e);
          }
          const lip = next.params?.['lipSync'];
          if (typeof lip === 'boolean') session.setLipSync(lip);
        },
      };
    },
  };
}
