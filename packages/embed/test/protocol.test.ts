import { describe, expect, it } from 'vitest';
import {
  EMBED_PROTOCOL_VERSION,
  MAX_EMBED_HEIGHT,
  eventMessage,
  isEmbedMessage,
  readyMessage,
  resizeMessage,
} from '@aio/embed';

describe('嵌入 postMessage 协议', () => {
  it('自造的消息自己认得', () => {
    expect(isEmbedMessage(resizeMessage(300))).toBe(true);
    expect(isEmbedMessage(readyMessage('sprite.show', 'a:sprite/1', 300))).toBe(true);
    expect(isEmbedMessage(eventMessage('progress', { frame: 12, total: 60 }))).toBe(true);
  });

  it('🔴 不是我们的消息一律不认——页面上还有别的库在发 postMessage', () => {
    for (const junk of [
      null,
      undefined,
      'resize',
      42,
      [],
      {},
      { type: 'resize', height: 10 }, // 没有 channel
      { channel: 'other', v: 1, type: 'resize', height: 10 },
    ]) {
      expect(isEmbedMessage(junk), JSON.stringify(junk) ?? 'undefined').toBe(false);
    }
  });

  it('🔴 版本对不上就不认，而不是按猜测的形状去读', () => {
    expect(isEmbedMessage({ ...resizeMessage(10), v: EMBED_PROTOCOL_VERSION + 1 })).toBe(false);
    expect(isEmbedMessage({ ...resizeMessage(10), v: '1' })).toBe(false);
  });

  it('🔴 高度有上限——一条 resize: 1e9 会把父页撑崩', () => {
    // 这条消息可能来自我们自己的 bug，不一定是攻击。设了上限，
    // 最坏情况是内容被截断，看得见、查得出。
    expect(resizeMessage(1e9).height).toBe(MAX_EMBED_HEIGHT);
    expect(resizeMessage(-5).height).toBe(0);
    expect(resizeMessage(10.2).height).toBe(11);
    // 手工构造的超限值收不进来。
    expect(isEmbedMessage({ ...resizeMessage(10), height: 1e9 })).toBe(false);
    expect(isEmbedMessage({ ...resizeMessage(10), height: Number.NaN })).toBe(false);
    expect(isEmbedMessage({ ...resizeMessage(10), height: '300' })).toBe(false);
  });

  it('事件负载只收扁平的 JSON 值', () => {
    expect(isEmbedMessage({ ...eventMessage('progress', {}), detail: { a: 1, b: 'x', c: true } })).toBe(true);
    // 嵌套对象、函数、undefined 都不收：它们要么传不过去，
    // 要么让接收方拿到一个自己没预期的形状。
    expect(isEmbedMessage({ ...eventMessage('progress', {}), detail: { a: { b: 1 } } })).toBe(false);
    expect(isEmbedMessage({ ...eventMessage('progress', {}), detail: { a: Number.NaN } })).toBe(false);
    expect(isEmbedMessage({ ...eventMessage('progress', {}), detail: null })).toBe(false);
  });

  it('守卫只判形状，判不了来源', () => {
    // 这条是给读代码的人看的：一条完全合法的消息可以来自任何页面。
    // 来源必须由调用方用 isAllowedAncestor(event.origin) 单独判。
    const forged = eventMessage('entity.focused', { ref: 'a:character/9999' });
    expect(isEmbedMessage(forged)).toBe(true);
  });
});
