import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@aio/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
      '@aio/registry': new URL('./packages/registry/src/index.ts', import.meta.url).pathname,
      '@aio/resource': new URL('./packages/resource/src/index.ts', import.meta.url).pathname,
      '@aio/kernel': new URL('./packages/kernel/src/index.ts', import.meta.url).pathname,
      '@aio/plugin-sdk': new URL('./packages/plugin-sdk/src/index.ts', import.meta.url).pathname,
      '@aio/capability': new URL('./packages/capability/src/index.ts', import.meta.url).pathname,
      '@aio/conformance': new URL('./packages/conformance/src/index.ts', import.meta.url).pathname,
      '@aio/plugin-search': new URL('./packages/plugin-search/src/index.ts', import.meta.url).pathname,
      '@aio/plugin-sprite': new URL('./packages/plugin-sprite/src/index.ts', import.meta.url).pathname,
      '@aio/plugin-adv': new URL('./packages/plugin-adv/src/index.ts', import.meta.url).pathname,
      '@aio/plugin-model-3d': new URL('./packages/plugin-model-3d/src/index.ts', import.meta.url).pathname,
    },
  },
});
