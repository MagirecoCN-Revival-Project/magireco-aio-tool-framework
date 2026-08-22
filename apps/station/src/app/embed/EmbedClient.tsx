'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { formatRef } from '@aio/core';
import {
  EMBED_PREFIX,
  EmbedError,
  eventMessage,
  parseEmbedRequest,
  readyMessage,
  resizeMessage,
} from '@aio/embed';
import type { EmbedRequest } from '@aio/embed';
import { useOpenSurfaces, useStation } from '../../kernel/KernelProvider';

/**
 * 嵌入面的浏览器半边。
 *
 * ## 往父页发消息为什么用 targetOrigin `'*'`
 *
 * 我们**不知道**父页的来源：MediaWiki 那个扩展给 iframe 设了
 * `referrerpolicy="no-referrer"`（不该把读者在看哪个 wiki 页面顺手告诉我们），
 * 于是 `document.referrer` 是空的。
 *
 * 在这里 `'*'` 是安全的，判据是**负载里没有一样东西是父页不知道的**：
 * 高度是它自己那个 iframe 的高度，capability 与 ref 是它自己写进 URL 的，
 * 进度是从它给的 ref 算出来的。谁能收到这些消息，谁本来就已经有这些信息。
 *
 * **这条判据随协议变化。** 哪天 `event` 里要带上「当前用户是谁」「清单里
 * 还有哪些 ref」这类父页不该知道的东西，`'*'` 立刻就不成立了——
 * 那时要么让父页把自己的来源传进来，要么放弃 no-referrer。
 *
 * 反方向（收消息）没有这个余地：那一侧必须校验 `event.origin`，
 * 见 `integrations/mediawiki/resources/ext.aioEmbed.js`。
 */

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; request: EmbedRequest }
  | { kind: 'error'; title: string; detail: string };

function post(msg: unknown): void {
  if (window.parent === window) return; // 没被嵌，不用发
  window.parent.postMessage(msg, '*');
}

export function EmbedClient({ capability }: { capability: string }): ReactNode {
  const station = useStation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    let request: EmbedRequest;
    try {
      request = parseEmbedRequest(`${EMBED_PREFIX}${capability}`, window.location.search);
    } catch (e) {
      const err = e as EmbedError;
      setState({
        kind: 'error',
        title: '这条嵌入链接有问题',
        // 把原因原样说出来。嵌入链接是别人手写的，含糊的提示会让他们
        // 反复改标签，而问题可能在 ref 的写法上。
        detail: err instanceof EmbedError ? err.message : String(e),
      });
      return;
    }

    const { kernel } = station;
    if (!kernel.can(request.capability, request.ref)) {
      setState({
        kind: 'error',
        title: '这个部署放不了它',
        detail:
          `没有装能处理 ${request.capability} 的插件，` +
          `或者 ${formatRef(request.ref)} 不在资源清单里。`,
      });
      return;
    }

    let disposed = false;
    let surfaceId: string | null = null;

    void (async () => {
      const handle = await kernel.request({
        capability: request.capability,
        ref: request.ref,
        params: request.params,
        surface: 'inline',
        source: 'embed',
      });
      if (disposed) {
        await handle?.close();
        return;
      }
      if (handle === null) {
        setState({ kind: 'error', title: '打不开', detail: '内核没有分配到 surface。' });
        return;
      }
      surfaceId = handle.surfaceId;
      setState({ kind: 'ready', request });
      post(readyMessage(request.capability, formatRef(request.ref), root.scrollHeight));
    })();

    // 能力契约 emits 的事件透给父页。只透契约登记过的那几个——
    // 内部事件（surface.opened / resource.failed）是我们的实现细节，
    // 透出去等于把内部结构写进对外协议。
    const offProgress = kernel.events.on('progress', (p) => {
      post(eventMessage('progress', {
        ref: formatRef(p.ref),
        position: p.position,
        ...(p.total === undefined ? {} : { total: p.total }),
      }));
    });
    const offFocus = kernel.events.on('entity.focused', (p) => {
      post(eventMessage('entity.focused', { ref: formatRef(p.ref) }));
    });

    // 跨域拿不到子页高度，只能子页自己报。ResizeObserver 而不是轮询：
    // 内容高度只在真的变了时才需要通知一次。
    const ro = new ResizeObserver(() => {
      post(resizeMessage(root.scrollHeight));
    });
    ro.observe(root);

    return () => {
      disposed = true;
      ro.disconnect();
      offProgress();
      offFocus();
      if (surfaceId !== null) void kernel.close(surfaceId);
    };
  }, [capability, station]);

  return (
    <div className="embed-root" ref={rootRef}>
      {state.kind === 'error' ? (
        <div className="embed-error">
          <strong>{state.title}</strong>
          <p>{state.detail}</p>
        </div>
      ) : null}
      <EmbedSurfaces />
    </div>
  );
}

/**
 * 嵌入面的 surface 出口。
 *
 * 与站点的 `SurfaceOutlet` 是两个组件，因为**外框不一样**：站点那个有标题栏
 * 和关闭按钮，嵌入面一个都不要——它整个就是那块内容，关掉它是父页的事。
 * 共用一个组件再加个 `bare` 开关的话，两种用法会互相牵制。
 */
function EmbedSurfaces(): ReactNode {
  const surfaces = useOpenSurfaces();

  return (
    <>
      {surfaces.map((s) => (
        <div
          key={s.surfaceId}
          className="embed-slot"
          ref={(slot) => {
            if (slot !== null && s.container.parentElement !== slot) {
              slot.replaceChildren(s.container);
            }
          }}
        />
      ))}
    </>
  );
}
