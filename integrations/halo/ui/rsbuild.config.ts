import { rsbuildConfig } from '@halo-dev/ui-plugin-bundler-kit/rsbuild';
import { fileURLToPath } from 'node:url';

const pkg = (name: string): string =>
  fileURLToPath(new URL(`../../../packages/${name}/src/index.ts`, import.meta.url));

/**
 * `rsbuildConfig()` 由 Halo 提供：它已经装好了 Vue 插件、把 vue 与
 * `@halo-dev/*` 外部化、并按 `plugin.yaml` 决定产物格式与输出目录。
 * 我们只在 `rsbuild` 字段里加自己需要的那两条解析规则。
 */
export default rsbuildConfig({
  rsbuild: {
    source: {
      entry: { index: './src/index.ts' },
    },

    resolve: {
      /**
       * 直接指向 `packages/*` 的 **TS 源码**。
       *
       * 那些包的 `main` 就是 `src/index.ts`，没有构建产物——这是故意的，
       * 为的是「能被任何宿主直接 import」。代价是宿主的打包器必须自己转译，
       * 而这正是本次要验的三个前提之一。
       *
       * 🚧 这条 alias 让本插件**只能在本仓库里构建**。等 `@aio/*` 真的发布
       * 之后换成普通 dependency，这一段就删掉——那才是「Halo 插件依赖框架」
       * 的最终形态。现在这样是为了先把方案跑通，不被发布流程挡住。
       */
      alias: {
        '@aio/core': pkg('core'),
        '@aio/kernel': pkg('kernel'),
        '@aio/registry': pkg('registry'),
        '@aio/resource': pkg('resource'),
        '@aio/plugin-chart': pkg('plugin-chart'),
        '@aio/plugin-search': pkg('plugin-search'),
      },

    },
  },
});

/**
 * 📌 **rsbuild 不需要 `extensionAlias`，webpack 需要——别照抄 station 的配置。**
 *
 * `packages/` 里的相对 import 带 `.js` 后缀（`./chart.js` → `chart.ts`），
 * 那是 TS 写 ESM 的正确写法。`apps/station` 在 Next/webpack 上必须显式配
 * `resolve.extensionAlias`，否则 51 个 `Can't resolve './xxx.js'`。
 *
 * 我一开始照抄了那一条，`vue-tsc` 报 `extensionAlias` 不在 `ResolveConfig` 里。
 * 于是实测：**加与不加，产物字节数与内容完全一致**（23121 字节，`parseRef`
 * 的错误信息、两个插件的 manifest 都在）。rspack 默认就做这件事。
 *
 * 所以删掉了。留着不但是死配置，还会让类型检查红——而一条「看起来很重要、
 * 其实没用」的配置比没有更糟：下一个人会围着它调。
 */
