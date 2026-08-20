import { describe, expect, it, vi } from 'vitest';
import { createEventBus, parseRef } from '@aio/core';

describe('EventBus', () => {
  it('派发与退订', () => {
    const bus = createEventBus();
    const seen: number[] = [];
    const off = bus.on('progress', (p) => seen.push(p.position));
    bus.emit('progress', { surfaceId: 's1', ref: parseRef('a:scenario/1'), position: 3 });
    off();
    bus.emit('progress', { surfaceId: 's1', ref: parseRef('a:scenario/1'), position: 4 });
    expect(seen).toEqual([3]);
  });

  it('一个订阅者抛错不影响其余订阅者', () => {
    const onError = vi.fn();
    const bus = createEventBus(onError);
    const seen: string[] = [];
    bus.on('surface.closed', () => {
      throw new Error('坏插件');
    });
    bus.on('surface.closed', (p) => seen.push(p.pluginId));
    bus.emit('surface.closed', { surfaceId: 's', pluginId: 'good' });
    expect(seen).toEqual(['good']);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('监听器里退订不影响本轮派发', () => {
    const bus = createEventBus();
    const seen: string[] = [];
    const off = bus.on('surface.closed', (p) => {
      seen.push(`a:${p.pluginId}`);
      off();
    });
    bus.on('surface.closed', (p) => seen.push(`b:${p.pluginId}`));
    bus.emit('surface.closed', { surfaceId: 's', pluginId: 'x' });
    expect(seen).toEqual(['a:x', 'b:x']);
  });
});
