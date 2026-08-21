'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { formatRef, parseRef } from '@aio/core';
import type { CapabilityId, ResourceRef } from '@aio/core';
import { usePluginVersion, useStation } from '../kernel/KernelProvider';
import { SurfaceOutlet } from '../kernel/SurfaceOutlet';

/**
 * 角色资料页——用来演示「能力决定 UI」。
 *
 * 每个入口按钮画不画，由 `kernel.can(capability, ref)` 决定，而它同时看两件事：
 * 有没有插件声明了这个能力，以及资源清单里有没有这条 ref。所以
 * **拔掉插件按钮就消失**，**素材没上线按钮也不会出现**——用户点了才发现 404
 * 的情况在这里就被挡掉了。
 */

interface Entry {
  readonly ref: string;
  readonly label: string;
  readonly actions: readonly {
    readonly capability: CapabilityId;
    readonly target: string;
    readonly label: string;
    /** 传给插件的意图参数。契约要求实现容忍未知参数，所以这里多传不会崩。 */
    readonly params?: Record<string, unknown>;
  }[];
}

const CODEX: readonly Entry[] = [
  {
    ref: 'a:character/1001',
    label: '角色甲（命名空间 a）',
    actions: [
      { capability: 'sprite.show', target: 'a:sprite/100100/d_r', label: '显示战斗精灵' },
      { capability: 'adv.play', target: 'a:scenario/310241@zh', label: '实机播放剧情' },
      // 目标就是这个角色自己——身高对比图以他为主体，compare 由插件参数给。
      {
        capability: 'chart.height',
        target: 'a:character/1001',
        label: '身高对比',
        // 名单里故意带一个没登记身高的（1002）与一个跨作品的：前者验「不画柱子
        // 但说出来」，后者验 universe 前缀真的把两个作品分开（铁律 1）。
        params: { compare: 'b:character/100101,a:character/1002' },
      },
    ],
  },
  {
    ref: 'b:character/100101',
    label: '角色乙（示例作品 B）',
    actions: [
      { capability: 'model3d.show', target: 'b:model3d/100101', label: '查看 3D 模型' },
      {
        capability: 'chart.height',
        target: 'b:character/100101',
        label: '身高对比',
        params: { compare: 'a:character/1001' },
      },
    ],
  },
];

export default function CodexPage(): ReactNode {
  const station = useStation();
  // 订阅插件装卸——一变就重渲染，下面的 can() 才会重新求值。
  usePluginVersion();

  const [progress, setProgress] = useState<{ ref: string; position: number; total: number } | null>(null);

  useEffect(() => {
    // 进度回流：ADV 播到第几行，这个页面据此高亮——而它从未 import 过 ADV 插件。
    return station.kernel.events.on('progress', (p) => {
      setProgress({ ref: formatRef(p.ref), position: p.position, total: p.total ?? 0 });
    });
  }, [station]);

  const open = (
    capability: CapabilityId,
    target: string,
    params?: Record<string, unknown>,
  ): void => {
    let ref: ResourceRef;
    try {
      ref = parseRef(target);
    } catch {
      return; // 裸 ID / 格式错一律不派发（铁律 1）
    }
    void station.kernel.request({
      capability,
      ref,
      surface: 'inline',
      ...(params === undefined ? {} : { params }),
    });
  };

  return (
    <>
      <h1>角色资料</h1>
      <p className="lead">
        下面每个按钮都问过 <code>kernel.can()</code>。
        到<a href="/admin">后台</a>把某个插件关掉，对应按钮会当场消失——
        那不是置灰，是不渲染。
      </p>

      {CODEX.map((entry) => (
        <article key={entry.ref} className="card">
          <h2>{entry.label}</h2>
          <code className="ref">{entry.ref}</code>
          <div className="actions">
            {entry.actions.map((a) => {
              let ok = false;
              try {
                ok = station.kernel.can(a.capability, parseRef(a.target));
              } catch {
                ok = false;
              }
              if (!ok) return null;
              return (
                <button
                    key={a.capability}
                    type="button"
                    onClick={() => open(a.capability, a.target, a.params)}
                  >
                  {a.label}
                </button>
              );
            })}
            {entry.actions.every((a) => {
              try {
                return !station.kernel.can(a.capability, parseRef(a.target));
              } catch {
                return true;
              }
            }) && <span className="muted">（没有可用能力——相关插件未装或资源未上线）</span>}
          </div>
        </article>
      ))}

      {progress !== null && (
        <p className="progress">
          进度回流：<code>{progress.ref}</code> 第 {progress.position} / {progress.total} 行
        </p>
      )}

      <h2>已打开的 surface</h2>
      <SurfaceOutlet />
    </>
  );
}
