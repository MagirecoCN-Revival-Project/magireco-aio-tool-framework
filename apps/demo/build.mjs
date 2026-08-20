// 把真内核 + 演示宿主打成一个自包含的 IIFE，供 docs/demo 页面内联。
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const p = (rel) => fileURLToPath(new URL(rel, import.meta.url));

const result = await build({
  entryPoints: [p('src/main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  minify: process.argv.includes('--minify'),
  write: false,
  legalComments: 'none',
  alias: {
    '@aio/core': p('../../packages/core/src/index.ts'),
    '@aio/registry': p('../../packages/registry/src/index.ts'),
    '@aio/resource': p('../../packages/resource/src/index.ts'),
    '@aio/kernel': p('../../packages/kernel/src/index.ts'),
  },
});

process.stdout.write(result.outputFiles[0].text);
