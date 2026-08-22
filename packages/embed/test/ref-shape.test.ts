import { describe, expect, it } from 'vitest';
import { parseRef } from '@aio/core';

/**
 * 🔴 这份语料在**两个语言里各有一份实现**：
 *
 * - TS：`packages/core` 的 `parseRef`（唯一的安全边界）
 * - PHP：`integrations/mediawiki/src/Hooks.php` 的 `refValid()`（编辑期预检）
 *
 * PHP 那份不是安全边界，但它必须与这份**给出同样的答案**：
 *
 * - PHP 更松 → wiki 上看着合法、嵌进去 400，编辑者只看到一块空白，
 *   会去反复改标签，而问题不在标签上；
 * - PHP 更严 → 合法的 ref 在 wiki 上被拒，而服务端明明认。
 *
 * 实测出过一次前者：PHP 的 kind 段写成 `[a-z0-9]+`，`a:nope/1` 与
 * `a:character/../etc` 都被放过。所以这份语料钉在这里——
 * **改了 parseRef 的判据，就得回去改 PHP 那份，并重跑对照。**
 */
const CORPUS: readonly (readonly [string, boolean])[] = [
  ['a:sprite/100100/d_r', true],
  ['a:character/1001', true],
  ['b:model3d/100101', true],
  ['a:scenario/310241@zh', true],
  ['zz:character/1', true],
  ['anything9:character/1', true],
  ['a:card/1001', true],
  ['a:item/9', true],
  ['a:image/x.png', true],
  // 段里带点是合法的（文件名），但 `..` 单独成段不是。
  ['a:sprite/a../b', true],

  ['100101', false],
  ['character/1001', false],
  ['A:character/1', false],
  ['1x:character/1', false],
  ['my-ns:character/1', false],
  ['a:character/', false],
  ['a:character/../etc', false],
  ['a:character/1@ZH', false],
  ['a:nope/1', false],
  ['a:sprite/./x', false],
  ['a:sprite//x', false],
];

describe('ref 形状：与 MediaWiki 侧预检共用的语料', () => {
  for (const [ref, ok] of CORPUS) {
    it(`${ok ? '收' : '拒'} ${ref}`, () => {
      let accepted = true;
      try {
        parseRef(ref);
      } catch {
        accepted = false;
      }
      expect(accepted).toBe(ok);
    });
  }
});
