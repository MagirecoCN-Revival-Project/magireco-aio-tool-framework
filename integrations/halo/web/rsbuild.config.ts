import { defineConfig } from '@rsbuild/core';
import { pluginVue } from '@rsbuild/plugin-vue';
import { fileURLToPath } from 'node:url';

const pkg = (name: string): string =>
  fileURLToPath(new URL(`../../../packages/${name}/src/index.ts`, import.meta.url));

/**
 * 前台 bundle —— 与控制台那份（`ui/`）的关键差别：
 *
 * | | 控制台 `ui/` | 前台 `web/`（这份） |
 * |---|---|---|
 * | 谁加载 | Halo 控制台按 `ui-plugin.json` | 我们自己的模板里一个 `<script>` |
 * | vue | **外部化**（控制台已经有了） | **打进来**（前台不保证有 Vue） |
 * | 产物去哪 | jar 里的 `ui/` | jar 里的 `web/`，由 Java 路由吐出去 |
 *
 * 产物直接写进 `src/main/resources/web/`，这样它跟着 jar 走，
 * 由 `ViewerRouter` 从 classpath 读出来返回。
 *
 * **为什么不放 Halo 的静态资源目录**：那要假设 Halo 对外暴露插件静态文件的
 * 路径约定，而本项目在「假设平台行为」上栽过三次。自己出内容不用猜，
 * 多写十几行 Java 换掉一个假设，划算。
 */
export default defineConfig({
  plugins: [pluginVue()],

  source: {
    entry: { viewer: './src/main.ts' },
  },

  // rsbuild 默认会生成一个 HTML 页面。我们的页面由 Thymeleaf 模板出，
  // 这里只要 js 与 css 两个文件，多出来的 HTML 会跟着进 jar 白占地方。
  html: { template: undefined },
  tools: {
    htmlPlugin: false,
  },

  output: {
    distPath: { root: '../src/main/resources/web', js: '.', css: '.' },
    filename: { js: 'viewer.js', css: 'viewer.css' },
    // 前台是别人的页面，不该被我们的 sourcemap 撑大。
    sourceMap: false,
    // 不做文件名哈希：Java 路由按固定名字取，模板里也写死这两个名字。
    // 缓存由响应头管（见 ViewerRouter），不靠文件名。
    filenameHash: false,
    // 只打一个 chunk，省得再写一套 chunk 加载逻辑。
    injectStyles: false,
    // 产物目录在项目根之外（写进上层的 resources），rsbuild 默认不敢清它。
    // 显式打开：不清的话删掉一个入口后旧产物会留在 jar 里。
    cleanDistPath: true,
  },

  performance: {
    chunkSplit: { strategy: 'all-in-one' },
  },

  resolve: {
    /**
     * 🔴 **必须**：把 vue 钉死成一份。
     *
     * 组件在 `../shared/`，那个目录没有自己的 `node_modules`，于是它里面的
     * `import { ref } from 'vue'` 沿目录树往上找，落到**仓库根**的那份；
     * 而 `web/src/main.ts` 就地找到 `web/node_modules/vue`。两份都是 3.5.41，
     * 也都被打进同一个 bundle。
     *
     * 后果不是报错，是**页面渲染正常但一个按钮都不响应**：
     * `createApp` 来自 A 份，组件里的 `ref`/`computed` 来自 B 份，
     * B 份记录依赖时看的是 B 的 activeSub（永远是空），所以什么都没被追踪。
     * 首屏照常画出来，之后再不更新——控制台一行错误都没有。
     *
     * 实测确认过：`className=aio-surface-body` 与 4 次 profile fetch 都发生了，
     * 内核完全正常，只是 Vue 不知道该重画。**这和之前那个 `fetch` receiver
     * 的坑是同一种形状：测试全绿、浏览器里静静地不工作。**
     *
     * `dedupe` 强制这些包从本项目根（`web/`）解析，两边就是同一份了。
     * 控制台那份（`ui/`）不受影响——它把 vue 外部化，运行时只有 Halo 的那一份。
     */
    dedupe: ['vue'],

    alias: {
      '@aio/core': pkg('core'),
      '@aio/kernel': pkg('kernel'),
      '@aio/registry': pkg('registry'),
      '@aio/resource': pkg('resource'),
      '@aio/plugin-chart': pkg('plugin-chart'),
      '@aio/plugin-search': pkg('plugin-search'),
    },
  },
});
