'use client';

import { createContext, useContext, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Station } from './station';
import type { OpenSurface } from './surface-store';

/**
 * 把工作站运行时接进 React。
 *
 * 只做两件事：给出 `Station` 单例，和把它的两个 store 变成 React 可订阅的量。
 * **没有状态管理库**（ADR 0001：平台或标准库有的不重造）——`useSyncExternalStore`
 * 是 React 自带的外部 store 订阅原语，正是为这种场景设计的。
 */

const StationContext = createContext<Station | null>(null);

export function KernelProvider({ children }: { children: ReactNode }): ReactNode {
  // 惰性初始化：Station 的构造会注册插件，不能每次渲染都跑一遍。
  const [station] = useState(() => new Station());
  return <StationContext.Provider value={station}>{children}</StationContext.Provider>;
}

export function useStation(): Station {
  const station = useContext(StationContext);
  if (station === null) {
    throw new Error('useStation 必须在 <KernelProvider> 内使用');
  }
  return station;
}

/**
 * 订阅插件装卸。返回值本身没用（是个版本号），要的是**它一变就重渲染**——
 * 于是所有读 `kernel.can()` 的组件会重新求值，按钮该消失的消失。
 */
export function usePluginVersion(): number {
  const station = useStation();
  return useSyncExternalStore(station.subscribe, station.getSnapshot, station.getServerSnapshot);
}

export function useOpenSurfaces(): readonly OpenSurface[] {
  const station = useStation();
  return useSyncExternalStore(
    station.surfaces.subscribe,
    station.surfaces.getSnapshot,
    station.surfaces.getServerSnapshot,
  );
}
