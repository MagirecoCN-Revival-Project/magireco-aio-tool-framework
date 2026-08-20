'use client';

import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { useOpenSurfaces, useStation } from './KernelProvider';
import type { OpenSurface } from './surface-store';

/**
 * surface 的出口：把内核造出来的**游离 DOM 容器**接进 React 树。
 *
 * 关键就是那个 ref 回调。React 负责画外框（标题、关闭按钮），插件的容器作为
 * 一个已经存在的节点 `append` 进去——React 不管它里面画了什么，也永远不会去
 * 重渲染它的内容。这一点是必须的：three.js / cocos2d 那些库直接持有 DOM 与
 * WebGL 上下文，React 若把它们的节点当受控内容重建，画面就没了。
 */

function SurfaceFrame({ surface }: { surface: OpenSurface }): ReactNode {
  const station = useStation();

  const attach = useCallback(
    (slot: HTMLDivElement | null) => {
      if (slot === null) return;
      if (surface.container.parentElement !== slot) {
        slot.replaceChildren(surface.container);
      }
    },
    [surface.container],
  );

  return (
    <section className="surface" data-hint={surface.hint}>
      <header className="surface-chrome">
        <span className="pill">{surface.pluginId}</span>
        <button
          type="button"
          onClick={() => {
            void station.kernel.close(surface.surfaceId);
          }}
        >
          关闭
        </button>
      </header>
      <div className="surface-slot" ref={attach} />
    </section>
  );
}

export function SurfaceOutlet(): ReactNode {
  const surfaces = useOpenSurfaces();

  if (surfaces.length === 0) {
    return (
      <p className="empty">
        还没有打开任何 surface。点上面的入口试试——
        <strong>没装对应插件的入口根本不会画出来</strong>，那不是禁用，是不存在。
      </p>
    );
  }

  return (
    <div className="surfaces">
      {surfaces.map((s) => (
        <SurfaceFrame key={s.surfaceId} surface={s} />
      ))}
    </div>
  );
}
