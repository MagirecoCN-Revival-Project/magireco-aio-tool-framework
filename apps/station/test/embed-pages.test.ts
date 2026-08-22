import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONTRACTS } from '@aio/capability';

/**
 * 🔴 `/embed/*` 这条路径下**不能有静态产物**。
 *
 * EdgeOne Pages 在路由冲突时静态优先：只要 `out/embed/sprite.show.html` 存在，
 * `/embed/sprite.show` 就永远命中它，`functions/embed/[capability].js`
 * 一次都不会被触发。而那个函数是整套准入的唯一落点。
 *
 * 静静失效的后果：被下架的 ref 照常放出去、后台关掉的插件还在别人页面上放、
 * **谁都能把这个页面套进 iframe**（`frame-ancestors` 只能由响应头下发，
 * CSP 规范规定它在 `<meta>` 里被忽略）。三条都不报错。
 *
 * 所以构建后由 `tools/pack-embed-pages.mjs` 把嵌入页搬进函数的包里并删掉
 * 原目录。这两条测试盯着那个搬运的结果——**没构建过就跳过**，
 * 因为它们验的是构建产物，不是源码。
 */

const OUT_EMBED = path.join(__dirname, '../out/embed');
const PAGES = path.join(__dirname, '../../../functions/embed/pages.generated.js');

const built = fs.existsSync(path.join(__dirname, '../out'));

describe.skipIf(!built)('嵌入页的构建产物', () => {
  it('🔴 out/embed/ 必须已被搬走——留着它，边缘函数永远不触发', () => {
    expect(
      fs.existsSync(OUT_EMBED),
      'out/embed/ 还在。EdgeOne 路由冲突时静态优先，这会让整套准入判定失效',
    ).toBe(false);
  });
});

describe('打包进边缘函数的嵌入页', () => {
  it('每个有契约的能力都有一份页面', () => {
    // 少一个的话，那个能力的嵌入 URL 会 404 在一条本该存在的路径上；
    // 判定会放行（它只看 providers），然后函数找不到 HTML。
    if (!fs.existsSync(PAGES)) {
      expect(built, 'pages.generated.js 不存在——先跑一次 station 构建').toBe(false);
      return;
    }
    const src = fs.readFileSync(PAGES, 'utf8');
    for (const c of CONTRACTS) {
      expect(src, `${c.id} 没有被打包进去`).toContain(`"${c.id}"`);
    }
  });

  it('页面里带着 noindex，不依赖响应头', () => {
    if (!fs.existsSync(PAGES)) return;
    const src = fs.readFileSync(PAGES, 'utf8');
    // 能由静态携带的约束就别只靠响应头——谁把这份 HTML 拿去怎么托管，它都在。
    expect(src).toContain('noindex');
  });
});
