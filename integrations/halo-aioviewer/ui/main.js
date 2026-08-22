import { definePlugin } from '@halo-dev/ui-shared';
import { IconPlug } from '@halo-dev/components';
import { defineComponent, h, markRaw, ref } from 'vue';
import {
  buildStoryRouterUrl,
  findStoryRoute,
  normalizeRouterBaseUrl,
  storyRoutesManifestUrl,
  validateSourceKey,
} from './story-router-contract.js';

const STORAGE_KEY = 'aio-story-router-base-url';

function storedRouterBase() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

const StoryRouterPage = defineComponent({
  name: 'AioStoryRouterBridgePage',
  setup() {
    const routerBase = ref(storedRouterBase());
    const sourceKey = ref('');
    const status = ref('填写 EdgeOne Story Router 根地址，并粘贴搜索结果的 sourceKey。');
    const statusKind = ref('idle');
    const currentRoute = ref(null);
    const advHandoffReady = ref(false);
    const busy = ref(false);

    function setStatus(message, kind = 'idle') {
      status.value = message;
      statusKind.value = kind;
    }

    async function inspectRoute() {
      busy.value = true;
      currentRoute.value = null;
      advHandoffReady.value = false;
      try {
        const base = normalizeRouterBaseUrl(routerBase.value);
        const key = validateSourceKey(sourceKey.value.trim());
        globalThis.localStorage?.setItem(STORAGE_KEY, base);
        const response = await fetch(storyRoutesManifestUrl(base), {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`路由清单返回 HTTP ${response.status}`);
        const manifest = await response.json();
        const route = findStoryRoute(manifest, key);
        if (route === null) {
          setStatus('该搜索结果尚未登记；搜索站应保持无跳转按钮。', 'missing');
          return;
        }
        currentRoute.value = route;
        advHandoffReady.value = manifest.targets.adv.handoffReady;
        const advStatus = route.adv === null
          ? '当前搜索行尚无经过验证的 L2D/ADV 精确章节'
          : manifest.targets.adv.handoffReady
            ? `ADV ${route.adv.chapterId} / ${route.adv.section}`
            : `ADV 数据已兼容，启动接收器等待对接（Reader ${manifest.targets.adv.readerRevision}）`;
        setStatus(
          `已登记：Reader ${route.reader.storyId}；${advStatus}`,
          'success',
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        busy.value = false;
      }
    }

    function openTarget(target) {
      try {
        const url = buildStoryRouterUrl(routerBase.value, sourceKey.value.trim(), target);
        globalThis.open(url, '_blank', 'noopener,noreferrer');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      }
    }

    const field = (label, value, placeholder, onInput) => h('label', { class: 'aio-router-field' }, [
      h('span', label),
      h('input', {
        value: value.value,
        placeholder,
        autocomplete: 'off',
        onInput,
        onKeyup: (event) => {
          if (event.key === 'Enter') inspectRoute();
        },
      }),
    ]);

    return () => h('main', { class: 'aio-router-page' }, [
      h('header', { class: 'aio-router-head' }, [
        h('p', { class: 'aio-router-kicker' }, 'HALO OPTIONAL BRIDGE'),
        h('h1', 'AIO 剧情路由桥'),
        h('p', '这里只检查 EdgeOne 中转接线；剧情搜索、Reader 与 L2D/ADV 仍是彼此独立的网站。'),
      ]),
      h('section', { class: 'aio-router-card' }, [
        field(
          'EdgeOne Story Router 根地址',
          routerBase,
          'https://YOUR_AIO_EDGEONE_HOST',
          (event) => { routerBase.value = event.target.value; currentRoute.value = null; },
        ),
        field(
          '搜索结果 sourceKey',
          sourceKey,
          'story-v6:20260816t013548z:character:0',
          (event) => { sourceKey.value = event.target.value; currentRoute.value = null; },
        ),
        h('div', { class: 'aio-router-actions' }, [
          h('button', { type: 'button', disabled: busy.value, onClick: inspectRoute }, busy.value ? '正在检查…' : '检查交叉表'),
          h('button', {
            type: 'button',
            class: 'secondary',
            disabled: currentRoute.value === null,
            onClick: () => openTarget('reader'),
          }, '打开文字 Reader'),
          h('button', {
            type: 'button',
            class: 'secondary',
            disabled: currentRoute.value === null
              || currentRoute.value.adv === null
              || !advHandoffReady.value,
            onClick: () => openTarget('adv'),
          }, '打开 L2D / ADV'),
        ]),
        h('p', { class: ['aio-router-status', `is-${statusKind.value}`] }, status.value),
      ]),
      h('section', { class: 'aio-router-boundary' }, [
        h('strong', '数据边界'),
        h('span', '插件不托管剧情、不代理资源、不嵌入其他查看器；两个打开按钮始终先进入固定的 AIO /open 路由。'),
      ]),
    ]);
  },
});

export default definePlugin({
  components: {},
  routes: [{
    parentName: 'Root',
    route: {
      path: '/aio-story-router',
      name: 'AioStoryRouterBridge',
      component: StoryRouterPage,
      meta: {
        title: 'AIO 剧情路由桥',
        searchable: true,
        menu: {
          name: 'AIO 剧情路由桥',
          group: '工具',
          icon: markRaw(IconPlug),
          priority: 0,
        },
      },
    },
  }],
  extensionPoints: {},
});
