import { definePlugin } from '@halo-dev/ui-shared';
import { markRaw } from 'vue';
import { IconPlug } from '@halo-dev/components';
import ViewerPage from '../../shared/ViewerPage.vue';

/**
 * Halo 控制台入口。
 *
 * 注意这个 `definePlugin` 是 **Halo 的**，不是 `@aio/plugin-sdk` 的同名函数。
 * 两者描述的东西完全不同：这边是控制台路由与扩展点，那边是能力与生命周期。
 *
 * 🚧 这一版只挂控制台页面，**没有接前台**。前台要么做成编辑器区块
 * （像 plugin-thyuu-embed 那样），要么往主题注入——两条路都要先确认这一版
 * 能跑起来再说。先验最短的那条。
 */
export default definePlugin({
  components: {},
  routes: [
    {
      parentName: 'Root',
      route: {
        path: '/aio-viewer',
        name: 'AioViewer',
        component: ViewerPage,
        meta: {
          title: 'AIO 查看器',
          searchable: true,
          menu: { name: 'AIO 查看器', group: '工具', icon: markRaw(IconPlug), priority: 0 },
        },
      },
    },
  ],
  extensionPoints: {},
});
