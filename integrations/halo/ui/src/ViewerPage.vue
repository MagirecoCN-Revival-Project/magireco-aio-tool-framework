<script setup lang="ts">
import { onUnmounted, ref, shallowRef } from 'vue';
import { formatRef, parseRef } from '@aio/core';
import type { ResourceRef } from '@aio/core';
import SurfaceOutlet from './SurfaceOutlet.vue';
import { createStation, PROFILES } from './station';
import './viewer.css';

/**
 * 试咸淡用的页面。
 *
 * 它刻意长得像 `apps/station` 的资料页——**因为要验的就是「同一套东西换个
 * 宿主还成不成立」**。按钮画不画由 `kernel.can()` 决定，不是由这个页面判断。
 */

const station = createStation(onPick);
const refs = Object.keys(PROFILES);

const query = ref('');
const note = ref('');
const enabled = shallowRef<Record<string, boolean>>(
  Object.fromEntries(station.catalog.map((e) => [e.id, true])),
);

onUnmounted(() => {
  // 页面走了要把 surface 关干净，否则插件的定时器与监听留在那里。
  for (const s of [...station.surfaces.open]) void station.kernel.close(s.surfaceId);
});

function onPick(ref_: ResourceRef): void {
  note.value = `检索里点了 ${formatRef(ref_)}，于是去开身高对比。`;
  void showChart(ref_);
}

/** 能力在不在。**这一问就是框架成不成立的判据**：没装插件就不画按钮。 */
function can(capability: string, refText: string): boolean {
  try {
    return station.kernel.can(capability as never, parseRef(refText));
  } catch {
    return false;
  }
}

async function showChart(ref_: ResourceRef): Promise<void> {
  const others = refs.filter((r) => r !== formatRef(ref_)).join(',');
  const handle = await station.kernel.request({
    capability: 'chart.height',
    ref: ref_,
    params: { compare: others },
    surface: 'inline',
    source: 'halo-console',
  });
  if (handle === null) note.value = '内核没给出 surface——多半是插件被卸掉了。';
}

async function runSearch(): Promise<void> {
  // 检索的 intent 也是一条 character ref：目录挂在它的 catalog role 上。
  const handle = await station.kernel.request({
    capability: 'search.query',
    ref: parseRef(refs[0] as string),
    params: { q: query.value },
    surface: 'inline',
    source: 'halo-console',
  });
  if (handle === null) note.value = '检索能力没装上。';
}

/**
 * 装卸插件。
 *
 * 这是**整页最要紧的一个按钮**：拔掉之后 `can()` 变假、按钮消失、
 * 已开的 surface 被内核收走，而页面其余部分照常。
 * 「少装一个模块，宿主依然自洽」那条判据，验的就是这里。
 */
async function toggle(id: string): Promise<void> {
  if (enabled.value[id] === true) {
    await station.kernel.unregister(id);
    enabled.value = { ...enabled.value, [id]: false };
    note.value = `拔掉了 ${id}。对应的按钮应该消失了，其余功能不受影响。`;
  } else {
    note.value = `${id} 需要重新装载页面才能装回来——这一版没做重装。`;
  }
}
</script>

<template>
  <div class="aio-page">
    <header class="aio-head">
      <h1>AIO 查看器</h1>
      <p class="aio-lead">
        身高对比与称呼检索跑在 Halo 里。数据是合成的，资源管线还没接——
        这一版只验「同一套 <code>packages/</code> 换个宿主还成不成立」。
      </p>
    </header>

    <section class="aio-card">
      <h2>称呼检索（search.query）</h2>
      <div class="aio-row">
        <input
          v-model="query"
          class="aio-input"
          type="search"
          placeholder="试试 甲 / こう / Otsu / 小丁"
          @keyup.enter="runSearch"
        />
        <button v-if="can('search.query', refs[0]!)" type="button" @click="runSearch">检索</button>
        <span v-else class="aio-muted">检索能力没装</span>
      </div>
      <p class="aio-muted">
        目录里有一条<strong>没有 ref</strong> 的——搜得到但点不开。交叉表没登记就是没登记，
        不按名字凑一个出来。
      </p>
    </section>

    <section class="aio-card">
      <h2>身高对比（chart.height）</h2>
      <div class="aio-row">
        <template v-for="r in refs" :key="r">
          <button v-if="can('chart.height', r)" type="button" @click="showChart(parseRef(r))">
            {{ r }}
          </button>
        </template>
      </div>
      <p class="aio-muted">
        其中一条<strong>没有登记身高</strong>——它会出现在图下方的「没有数据」里，
        而不是被画成 0。
      </p>
    </section>

    <section class="aio-card">
      <h2>插件装卸</h2>
      <ul class="aio-plugins">
        <li v-for="e in station.catalog" :key="e.id">
          <span>{{ e.title }} <code>{{ e.id }}</code></span>
          <button type="button" :disabled="enabled[e.id] !== true" @click="toggle(e.id)">
            {{ enabled[e.id] === true ? '拔掉' : '已拔掉' }}
          </button>
        </li>
      </ul>
      <p class="aio-muted">拔掉之后上面对应的按钮应当消失，其余部分照常——这是框架成立的判据。</p>
    </section>

    <p v-if="note !== ''" class="aio-note">{{ note }}</p>

    <SurfaceOutlet :store="station.surfaces" @close="station.kernel.close($event)" />
  </div>
</template>
