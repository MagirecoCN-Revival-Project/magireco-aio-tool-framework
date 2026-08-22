<script setup lang="ts">
import { onUnmounted, shallowRef } from 'vue';
import type { OpenSurface, SurfaceStore } from './station';

/**
 * surface 的出口：把内核造出来的**游离 DOM 容器**接进 Vue 树。
 *
 * `apps/station/README.md` 里写着：
 *
 * > 换 Vue 或 Svelte 时要重写的只有 `SurfaceOutlet`——`surface-store.ts` 与整个
 * > `packages/` 一行都不用动。
 *
 * 这个文件就是那句话的兑现。React 那版是 ref 回调 + `replaceChildren`，
 * 这版一模一样，只是换了个框架的写法。
 *
 * 关键的两条也一样：
 *
 * 1. 容器**已经存在**（内核 `acquire()` 同步造好的），Vue 只负责把它
 *    append 到自己的槽位里；
 * 2. **Vue 永远不去重渲染那个节点的内容。**
 *
 * 第 2 条是必须的：three.js / cocos2d / Cubism 这些库直接持有 DOM 与 WebGL
 * 上下文。框架若把它们当受控内容重建，画面就没了——而且不报错。
 */
const props = defineProps<{ store: SurfaceStore }>();
const emit = defineEmits<{ close: [surfaceId: string] }>();

// shallowRef：容器是 DOM 节点，深响应式化它没有意义还很贵。
const surfaces = shallowRef<readonly OpenSurface[]>(props.store.open);
const unsubscribe = props.store.subscribe(() => {
  surfaces.value = props.store.open;
});
onUnmounted(unsubscribe);

/**
 * ref 回调：槽位一挂上就把游离容器塞进去。
 *
 * 判一下 `parentElement` 是因为这个回调会被重复调用（每次重渲染），
 * 而 `replaceChildren` 会把节点先摘再插——对 canvas 无所谓，
 * 对持有 WebGL 上下文的东西可能就是一次重建。
 */
function attach(surface: OpenSurface) {
  // 参数类型照 Vue 的 `VNodeRef` 来：模板 ref 可能是元素也可能是组件实例，
  // 收窄成 Element 会让 vue-tsc 拒绝。这里只认真正的元素。
  return (el: unknown): void => {
    if (!(el instanceof HTMLElement)) return;
    if (surface.container.parentElement !== el) {
      el.replaceChildren(surface.container);
    }
  };
}
</script>

<template>
  <div class="aio-surfaces">
    <section v-for="s in surfaces" :key="s.surfaceId" class="aio-surface">
      <header class="aio-surface-chrome">
        <span class="aio-pill">{{ s.pluginId }}</span>
        <!-- 关闭走内核，不是直接摘 store：只摘 store 的话内核仍以为它开着，
             插件的 unmount 不会被调，定时器与事件监听全留着。 -->
        <button type="button" @click="emit('close', s.surfaceId)">关闭</button>
      </header>
      <div class="aio-surface-slot" :ref="attach(s)" />
    </section>
  </div>
</template>
