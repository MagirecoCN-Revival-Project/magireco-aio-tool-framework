import type { CapabilityId, FrameworkEventName } from '@aio/core';

/**
 * 嵌入面与宿主页之间的 postMessage 协议。
 *
 * ## 为什么是 postMessage 而不是别的
 *
 * 跨域 iframe 与父页之间，平台只给了这一条通道（铁律 8：平台有的不重造）。
 * 内核里那套 `MessagePort` 桥是**同源 iframe 插件**用的，走的是
 * `createIframePlugin()`；这里是**跨域、对方不是我们的代码**，
 * 信任模型完全不同，所以协议单独一份，且只传数据、不传能力句柄。
 *
 * ## 这份协议只做三件事
 *
 * 1. `ready`  —— 嵌入面起来了，告诉父页它在放什么；
 * 2. `resize` —— 内容高度变了，父页据此调 iframe 高度（跨域拿不到子页高度，
 *    只能子页自己报）；
 * 3. `event`  —— 把能力契约里 `emits` 的那几个事件透出去。
 *
 * **没有「父页调用子页方法」这一半。** 那需要一套请求/应答与错误模型，
 * 而目前没有任何一个已知用例要它。等真有了再加，别先建一条没人走的通道。
 *
 * ## 收消息的一方必须自己校验来源
 *
 * 这些 `is*` 守卫只判**形状**，判不了**来源**——`event.origin` 不在消息体里，
 * 它由浏览器附在事件上。所以两边都必须：
 *
 * ```ts
 * window.addEventListener('message', (e) => {
 *   if (!isAllowedAncestor(policy, e.origin)) return;   // ← 这一步不能省
 *   if (!isEmbedMessage(e.data)) return;
 * });
 * ```
 *
 * 漏掉来源校验的后果不是报错：任何一个页面都能给你发一条形状合法的
 * `resize`，把 iframe 撑成一万像素高，或者伪造 `entity.focused`
 * 让宿主跳到别的实体上。
 */

/** 协议版本。形状变了就加，老宿主据此拒收而不是按新形状误读。 */
export const EMBED_PROTOCOL_VERSION = 1;

interface Base {
  /** 固定前缀，用来把我们的消息与页面上其它库的 postMessage 区分开。 */
  readonly channel: 'aio-embed';
  readonly v: number;
}

export interface EmbedReadyMessage extends Base {
  readonly type: 'ready';
  readonly capability: CapabilityId;
  /** 正在放的 ref，已格式化。 */
  readonly ref: string;
  readonly height: number;
}

export interface EmbedResizeMessage extends Base {
  readonly type: 'resize';
  readonly height: number;
}

export interface EmbedEventMessage extends Base {
  readonly type: 'event';
  readonly name: FrameworkEventName;
  /** 事件负载。只允许 JSON 可序列化的扁平数据。 */
  readonly detail: Readonly<Record<string, string | number | boolean>>;
}

export type EmbedMessage = EmbedReadyMessage | EmbedResizeMessage | EmbedEventMessage;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 高度的上限。
 *
 * 不设上限的话，一条 `resize: 1e9` 会让父页把 iframe 撑到浏览器崩掉——
 * 而这条消息**可能来自我们自己的 bug**，不一定是攻击。
 * 设了上限，最坏情况是内容被截断，看得见、查得出。
 */
export const MAX_EMBED_HEIGHT = 20000;

function isHeight(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_EMBED_HEIGHT;
}

function isFlatDetail(v: unknown): v is Record<string, string | number | boolean> {
  if (!isRecord(v)) return false;
  return Object.values(v).every(
    (x) => typeof x === 'string' || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x)),
  );
}

/**
 * 形状守卫。**只判形状，不判来源**——来源由调用方用 `isAllowedAncestor` 判。
 *
 * 版本不认识就返回 false：宁可当成不是我们的消息，也不要按猜测的形状去读。
 */
export function isEmbedMessage(data: unknown): data is EmbedMessage {
  if (!isRecord(data)) return false;
  if (data['channel'] !== 'aio-embed') return false;
  if (data['v'] !== EMBED_PROTOCOL_VERSION) return false;
  switch (data['type']) {
    case 'ready':
      return (
        typeof data['capability'] === 'string' &&
        typeof data['ref'] === 'string' &&
        isHeight(data['height'])
      );
    case 'resize':
      return isHeight(data['height']);
    case 'event':
      return typeof data['name'] === 'string' && isFlatDetail(data['detail']);
    default:
      return false;
  }
}

/** 造一条 `resize`。子页用。 */
export function resizeMessage(height: number): EmbedResizeMessage {
  return {
    channel: 'aio-embed',
    v: EMBED_PROTOCOL_VERSION,
    type: 'resize',
    height: Math.max(0, Math.min(MAX_EMBED_HEIGHT, Math.ceil(height))),
  };
}

export function readyMessage(
  capability: CapabilityId,
  ref: string,
  height: number,
): EmbedReadyMessage {
  return {
    channel: 'aio-embed',
    v: EMBED_PROTOCOL_VERSION,
    type: 'ready',
    capability,
    ref,
    height: Math.max(0, Math.min(MAX_EMBED_HEIGHT, Math.ceil(height))),
  };
}

export function eventMessage(
  name: FrameworkEventName,
  detail: Readonly<Record<string, string | number | boolean>>,
): EmbedEventMessage {
  return { channel: 'aio-embed', v: EMBED_PROTOCOL_VERSION, type: 'event', name, detail };
}
