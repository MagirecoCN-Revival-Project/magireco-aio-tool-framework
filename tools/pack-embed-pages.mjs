/**
 * 把嵌入页从静态产物里搬进边缘函数的包里。
 *
 * ## 为什么必须搬走，而不是留在那儿
 *
 * **EdgeOne Pages 在路由冲突时静态优先**（2026-08-22 由维护者查证官方文档
 * 确认：Edge Functions 与 Node.js Functions 都是「路由与静态资源冲突时，
 * 请求优先被路由到静态资源」）。
 *
 * 也就是说：只要 `out/embed/sprite.show.html` 还在，`/embed/sprite.show`
 * 就永远命中它，`functions/embed/[capability].js` **一次都不会被触发**。
 * 而那个函数是整套准入的唯一落点——下架判定、插件开关、
 * 以及只能由响应头下发的 `frame-ancestors`。
 *
 * 后果不是「函数没生效」这么轻。是：
 *
 * - 被下架的 ref 照常放出去（铁律 11 的请求期那一道整个失效）；
 * - 后台关掉的插件，嵌在别人页面上的还在放（铁律 10 失效）；
 * - **谁都能把这个页面套进 iframe**——`frame-ancestors` 发不出去，
 *   等于开放点击劫持。而这件事不报错、页面照常显示，没有任何迹象。
 *
 * ## 解法：让那条路径下没有静态产物
 *
 * 冲突的根源是「同一路径下同时存在静态文件与函数」。既然静态必赢，
 * 那就别让它存在——构建后把 `out/embed/` 整个搬进函数的包里，
 * 由函数自己吐 HTML。URL 一个字都不用改，MediaWiki 那侧也不用动。
 *
 * （另一条备选是把嵌入面挪到 `/e/<cap>` 这种静态产物不存在的路径。
 * 那样要改 URL、改 wiki 扩展、改所有已经贴出去的嵌入链接——
 * 而搬产物只动构建流程，代价小得多。）
 *
 * ## 这个脚本失败时必须**响亮地**失败
 *
 * 它要是静静地什么都没搬，构建照常成功，产物里带着一份可被直接访问的
 * 嵌入页——正是上面那三条后果。所以每一步都检查，缺什么就非零退出。
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT_EMBED = join(root, 'apps/station/out/embed');
const TARGET = join(root, 'functions/embed/pages.generated.js');

function die(msg) {
  console.error(`✘ pack-embed-pages: ${msg}`);
  process.exit(1);
}

let names;
try {
  names = readdirSync(OUT_EMBED).filter((f) => f.endsWith('.html'));
} catch {
  die(
    `找不到 ${OUT_EMBED}。\n` +
    '  嵌入页没被构建出来，或者构建产物的布局变了。\n' +
    '  这不能当成「没有嵌入页要搬」放过去——那样产物里可能留着一份能被直接\n' +
    '  访问的嵌入页，而边缘函数永远不会触发（EdgeOne 路由冲突时静态优先）。',
  );
}

if (names.length === 0) {
  die(`${OUT_EMBED} 里一个 .html 都没有——构建大概失败了`);
}

const pages = {};
for (const file of names) {
  const capability = file.replace(/\.html$/, '');
  pages[capability] = readFileSync(join(OUT_EMBED, file), 'utf8');
}

const body = `// 由 tools/pack-embed-pages.mjs 生成，**不要手改**。
//
// 嵌入页的 HTML 内联在这里，因为 EdgeOne 路由冲突时静态优先：
// 只要 out/embed/ 下还有文件，边缘函数就永远不会被触发，
// 而那个函数是下架判定、插件开关与 frame-ancestors 的唯一落点。
export const EMBED_PAGES = ${JSON.stringify(pages, null, 2)};
`;

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, body, 'utf8');

// 搬完就删。**删这一步才是重点**——不删的话前面全白做。
rmSync(OUT_EMBED, { recursive: true, force: true });

let leftover = [];
try {
  leftover = readdirSync(OUT_EMBED);
} catch {
  /* 不存在正是我们要的 */
}
if (leftover.length > 0) {
  die(`${OUT_EMBED} 没删干净，还剩 ${leftover.length} 项`);
}

const kb = (body.length / 1024).toFixed(1);
console.log(`✔ 嵌入页已搬进边缘函数：${names.length} 个能力，${kb} KiB`);
console.log(`  ${Object.keys(pages).join(', ')}`);
console.log('✔ apps/station/out/embed/ 已删除——那条路径下不再有静态产物，函数才会被触发');
