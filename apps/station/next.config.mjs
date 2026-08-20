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
