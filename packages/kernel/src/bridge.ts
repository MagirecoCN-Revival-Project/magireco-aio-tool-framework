import { formatRef, parseRef, type Intent } from '@aio/core';
import type { Plugin, PluginHost, PluginInstance, PluginManifest, SurfaceTarget } from './types.js';

/**
 * iframe 隔离桥。
 *
 * ## 为什么需要它
 *
 * 四个查看器的运行时里有两个**靠全局变量活着**：
 *
 *   - example-sprite-mirror 的 cocos2d-html5 挂 `window.cc`
 *   - Live2D Cubism Core 挂 `window.Live2DCubismCore`
 *
 * 同一个 realm 里装两份就会互相覆盖。传统解法是「一个页面只放一个查看器」，
 * 但那样就回到了跳转链接。这里的解法是：**把 realm 隔离藏进内核**。
 *
 * 老库跑在自己的 iframe 里，通过 postMessage 收发命令；对发意图的那一方
 * （剧情阅读器）来说，`host.request({capability:'sprite.show', ...})`
 * 的写法与调用一个 inline 插件**一模一样**。它不知道对面是 iframe。
 *
 * ## 传输层是注入的
 *
 * `Transport` 是个两方法接口，浏览器里由 `MessagePort` / `postMessage` 实现，
 * 测试里由一对内存队列实现。桥的协议逻辑因此可以在 node 上直接测，
 * 不用起浏览器。
 */

export interface Transport {
  post(message: unknown): void;
  onMessage(handler: (message: unknown) => void): () => void;
}

export type BridgeCommand =
  | { readonly t: 'mount'; readonly id: number; readonly ref: string; readonly capability: string; readonly params?: Record<string, unknown> }
  | { readonly t: 'update'; readonly id: number; readonly ref: string; readonly capability: string; readonly params?: Record<string, unknown> }
  | { readonly t: 'suspend'; readonly id: number }
  | { readonly t: 'resume'; readonly id: number }
  | { readonly t: 'dispose'; readonly id: number };

export type BridgeReply =
  | { readonly t: 'ok'; readonly id: number }
  | { readonly t: 'err'; readonly id: number; readonly message: string }
  /** 子帧主动上报：进度、焦点变化等，转成内核事件。 */
  | { readonly t: 'progress'; readonly ref: string; readonly position: number; readonly total?: number }
  | { readonly t: 'focus'; readonly ref: string };

export interface IframePluginOptions {
  readonly manifest: PluginManifest;
  /** 为一个 surface 建立传输通道。浏览器实现里这里创建 iframe 并等它就绪。 */
  readonly connect: (target: SurfaceTarget) => Promise<Transport>;
  /** 单条命令的超时（毫秒）。 */
  readonly timeoutMs?: number;
}

/**
 * 把一个「跑在 iframe 里的查看器」包装成一个普通插件。
 *
 * 内核和其它插件看到的就是一个 `Plugin`，与 inline 插件毫无区别。
 */
export function createIframePlugin(options: IframePluginOptions): Plugin {
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    manifest: { ...options.manifest, isolation: 'iframe' },

    async mount(target, intent, host) {
      const transport = await options.connect(target);
      const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
      let seq = 0;
      let disposed = false;

      const off = transport.onMessage((raw) => {
        const msg = raw as BridgeReply;
        if (msg === null || typeof msg !== 'object') return;

        if (msg.t === 'ok' || msg.t === 'err') {
          const entry = pending.get(msg.id);
          if (entry === undefined) return;
          pending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.t === 'ok') entry.resolve();
          else entry.reject(new Error(msg.message));
          return;
        }

        // 子帧上报 → 内核事件。这是「反向绑定」的通道：ADV 在 iframe 里播到
        // 第 42 行，剧情阅读器（另一个 realm 里的 inline 插件）据此高亮第 42 行。
        if (msg.t === 'progress') {
          const ref = safeRef(msg.ref);
          if (ref === null) return;
          host.events.emit('progress', {
            surfaceId: host.surfaceId,
            ref,
            position: msg.position,
            ...(msg.total === undefined ? {} : { total: msg.total }),
          });
          return;
        }
        if (msg.t === 'focus') {
          const ref = safeRef(msg.ref);
          if (ref === null) return;
          host.events.emit('entity.focused', { surfaceId: host.surfaceId, ref });
        }
      });

      function send(build: (id: number) => BridgeCommand): Promise<void> {
        if (disposed) return Promise.resolve();
        const id = ++seq;
        return new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            // 超时必须 reject，不能挂着。一个不回话的 iframe 会让 dispose
            // 永远 await 下去，surface 就永远还不回宿主。
            reject(new Error(`iframe 插件 ${options.manifest.id} 命令 ${id} 超时`));
          }, timeoutMs);
          pending.set(id, { resolve, reject, timer });
          transport.post(build(id));
        });
      }

      await send((id) => ({
        t: 'mount',
        id,
        ref: formatRef(intent.ref),
        capability: intent.capability,
        ...(intent.params === undefined ? {} : { params: { ...intent.params } }),
      }));

      const instance: PluginInstance = {
        suspend: () => send((id) => ({ t: 'suspend', id })),
        resume: () => send((id) => ({ t: 'resume', id })),
        update: (next: Intent) =>
          send((id) => ({
            t: 'update',
            id,
            ref: formatRef(next.ref),
            capability: next.capability,
            ...(next.params === undefined ? {} : { params: { ...next.params } }),
          })),
        dispose: async () => {
          if (disposed) return;
          try {
            await send((id) => ({ t: 'dispose', id }));
          } catch {
            // 子帧已经死了也要继续拆干净——dispose 不允许因为对面不回话而失败。
          } finally {
            disposed = true;
            for (const entry of pending.values()) {
              clearTimeout(entry.timer);
              entry.reject(new Error('插件已卸载'));
            }
            pending.clear();
            off();
          }
        },
      };
      return instance;
    },
  };
}

function safeRef(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    return parseRef(value);
  } catch {
    return null;
  }
}

/** 供测试与本地开发用的一对内存传输通道。 */
export function createMemoryTransportPair(): readonly [Transport, Transport] {
  const handlersA = new Set<(m: unknown) => void>();
  const handlersB = new Set<(m: unknown) => void>();

  const make = (mine: Set<(m: unknown) => void>, theirs: Set<(m: unknown) => void>): Transport => ({
    post(message) {
      // 异步派发，模拟 postMessage 的宏任务语义——同步派发会掩盖
      // 「命令还没回就调了下一个」这类时序 bug。
      queueMicrotask(() => {
        for (const h of [...theirs]) h(message);
      });
    },
    onMessage(handler) {
      mine.add(handler);
      return () => mine.delete(handler);
    },
  });

  return [make(handlersA, handlersB), make(handlersB, handlersA)] as const;
}

export type { PluginHost };
