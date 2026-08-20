import { describe, expect, it, vi } from 'vitest';
import { createEventBus, parseRef } from '@aio/core';
import {
  createIframePlugin,
  createMemoryTransportPair,
  type BridgeCommand,
  type PluginHost,
  type Transport,
} from '@aio/kernel';
import { Registry } from '@aio/registry';
import { makeResources } from './fixtures.js';

const manifest = {
  id: 'legacy-viewer',
  version: '0.1.0',
  title: '老库查看器',
  isolation: 'iframe' as const,
  usesWebGL: true,
  provides: [{ id: 'sprite.show', accepts: ['sprite'] as const }],
};

function hostStub(events = createEventBus()): PluginHost {
  return {
    resources: makeResources(),
    registry: Registry.empty(),
    events,
    surfaceId: 'sf-1',
    request: async () => null,
    can: () => false,
    log: () => {},
  };
}

const target = { surfaceId: 'sf-1', container: null, hint: 'inline' as const };
const intent = { capability: 'sprite.show', ref: parseRef('a:sprite/100100/d_r') };

/** 一个会自动应答的假子帧。 */
function autoReplyFrame(frameSide: Transport, log: BridgeCommand[]) {
  frameSide.onMessage((raw) => {
    const cmd = raw as BridgeCommand;
    log.push(cmd);
    frameSide.post({ t: 'ok', id: cmd.id });
  });
}

describe('iframe 桥', () => {
  it('生命周期命令全部过桥', async () => {
    const log: BridgeCommand[] = [];
    const plugin = createIframePlugin({
      manifest,
      async connect() {
        const [host, frame] = createMemoryTransportPair();
        autoReplyFrame(frame, log);
        return host;
      },
    });

    const inst = await plugin.mount(target, intent, hostStub());
    await inst.suspend();
    await inst.resume();
    await inst.update!({ capability: 'sprite.show', ref: parseRef('a:sprite/100200/d_r') });
    await inst.dispose();

    expect(log.map((c) => c.t)).toEqual(['mount', 'suspend', 'resume', 'update', 'dispose']);
    expect(log[0]).toMatchObject({ ref: 'a:sprite/100100/d_r' });
    expect(log[3]).toMatchObject({ ref: 'a:sprite/100200/d_r' });
  });

  it('子帧上报的进度转成内核事件——这是反向绑定的通道', async () => {
    let frameSide!: Transport;
    const plugin = createIframePlugin({
      manifest,
      async connect() {
        const [host, frame] = createMemoryTransportPair();
        frameSide = frame;
        autoReplyFrame(frame, []);
        return host;
      },
    });

    const events = createEventBus();
    const seen: number[] = [];
    events.on('progress', (p) => seen.push(p.position));
    const focused: string[] = [];
    events.on('entity.focused', (p) => focused.push(p.ref.segments.join('/')));

    await plugin.mount(target, intent, hostStub(events));
    frameSide.post({ t: 'progress', ref: 'a:sprite/100100/d_r', position: 7, total: 20 });
    frameSide.post({ t: 'focus', ref: 'a:character/1001' });
    await new Promise((r) => setTimeout(r, 0));

    expect(seen).toEqual([7]);
    expect(focused).toEqual(['1001']);
  });

  it('子帧发来的坏 ref 被丢弃，不污染事件总线', async () => {
    let frameSide!: Transport;
    const plugin = createIframePlugin({
      manifest,
      async connect() {
        const [host, frame] = createMemoryTransportPair();
        frameSide = frame;
        autoReplyFrame(frame, []);
        return host;
      },
    });
    const events = createEventBus();
    const seen: unknown[] = [];
    events.on('progress', (p) => seen.push(p));
    await plugin.mount(target, intent, hostStub(events));

    frameSide.post({ t: 'progress', ref: '100101', position: 1 });        // 没有 universe 前缀
    frameSide.post({ t: 'progress', ref: 42, position: 1 });               // 根本不是字符串
    frameSide.post('乱七八糟');
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([]);
  });

  it('子帧不回话时命令超时 reject，而不是永远挂着', async () => {
    vi.useFakeTimers();
    try {
      const plugin = createIframePlugin({
        manifest,
        timeoutMs: 100,
        async connect() {
          const [host] = createMemoryTransportPair(); // 对面没人应答
          return host;
        },
      });
      const p = plugin.mount(target, intent, hostStub());
      const assertion = expect(p).rejects.toThrow(/超时/);
      await vi.advanceTimersByTimeAsync(150);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('子帧已死时 dispose 仍然拆干净，不因对面不回话而失败', async () => {
    vi.useFakeTimers();
    try {
      let frameSide!: Transport;
      let alive = true;
      const plugin = createIframePlugin({
        manifest,
        timeoutMs: 100,
        async connect() {
          const [host, frame] = createMemoryTransportPair();
          frameSide = frame;
          frame.onMessage((raw) => {
            if (!alive) return; // 模拟 iframe 已被移除
            frameSide.post({ t: 'ok', id: (raw as BridgeCommand).id });
          });
          return host;
        },
      });

      const mounted = plugin.mount(target, intent, hostStub());
      await vi.advanceTimersByTimeAsync(1);
      const inst = await mounted;

      alive = false;
      const disposing = inst.dispose();
      await vi.advanceTimersByTimeAsync(150);
      await expect(disposing).resolves.toBeUndefined();

      // 已卸载后再调命令直接无操作，不会再起一个超时定时器
      await expect(inst.suspend()).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
