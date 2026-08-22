/**
 * EdgeOne Pages 是静态托管，所以先走 `output: 'export'`。
 *
 * CMS 的写入面（内容页、权限）需要服务端，那是架构文档的 Phase 5：
 * EdgeOne 边缘函数 + KV。届时把这里改成边缘运行时即可——上层不用动，
 * 因为写入全部经 `src/cms/store.ts` 的 `CmsStore` 接口。
 *
 * `transpilePackages`：workspace 里那五个包的 `main` 直接指向 TS 源码
 * （没有构建产物，故意的——它们要能被任何宿主直接 import），所以 Next 必须
 * 自己转译它们。
 */
/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  transpilePackages: [
    '@aio/core',
    '@aio/kernel',
    '@aio/registry',
    '@aio/resource',
    '@aio/plugin-sprite',
    '@aio/plugin-adv',
    '@aio/plugin-chart',
    '@aio/plugin-gltf',
    '@aio/capability',
    '@aio/site',
    '@aio/embed',
  ],
  // 资源全部外置到资源面（铁律 9），所以这里没有图片需要优化。
  images: { unoptimized: true },

  /**
   * `packages/` 里的相对 import 带 `.js` 后缀（`./governor.js` → `governor.ts`），
   * 那是 TS 写 ESM 的**正确**写法：产物里就是 `.js`，说明符必须提前写对。
   * 但 webpack 默认不会把 `.js` 回落到 `.ts`，于是解析不到。
   *
   * 修 webpack，不修那些包——它们的写法没错，而且 demo 宿主（esbuild）与
   * 任何走标准 ESM 解析的宿主都吃这一套。为了迁就一个打包器去改五个包的
   * 导入风格，等于让「能被任何宿主直接 import」这条设计前提作废。
   *
   * > **Next 16 起 Turbopack 是缺省打包器**，所以 `package.json` 的 dev/build
   * > 都显式加了 `--webpack`。这不是「懒得迁」：Turbopack 目前没有
   * > `extensionAlias` 的对应物（`resolveExtensions` 是整份扩展名清单，
   * > `resolveAlias` 针对模块名），2026-08-21 实测拿掉 webpack 后 51 个
   * > `Can't resolve './xxx.js'` 全部复现。等 Turbopack 能表达这条解析规则
   * > 再迁；在那之前显式声明用哪个打包器，比让构建在某次升级后突然红掉好。
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default config;
