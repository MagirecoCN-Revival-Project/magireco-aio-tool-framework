import { createApp } from 'vue';
import ViewerPage from '../../shared/ViewerPage.vue';

/**
 * 前台入口。
 *
 * 与控制台那份（`ui/src/index.ts`）的差别只有一处：**谁把页面挂起来**。
 * 控制台那边由 Halo 的路由系统挂，这边自己找一个挂载点。
 * `ViewerPage` 本身不知道自己在哪——它只跟内核打交道。
 *
 * 挂载点由模板给（`<div id="aio-viewer-root">`）。找不到就什么都不做，
 * 不去猜一个位置插进去——那会在别人的主题里画出莫名其妙的东西。
 */
const root = document.getElementById('aio-viewer-root');
if (root !== null) {
  createApp(ViewerPage).mount(root);
} else {
  console.warn('[aio-viewer] 找不到 #aio-viewer-root，没有挂载。');
}
