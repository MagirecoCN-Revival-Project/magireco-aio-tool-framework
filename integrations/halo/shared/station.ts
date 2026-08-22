import { parseRef } from '@aio/core';
import type { ResourceRef, SurfaceHint } from '@aio/core';
import { Kernel } from '@aio/kernel';
import type { Plugin, SurfaceProvider, SurfaceTarget } from '@aio/kernel';
import { Registry } from '@aio/registry';
import type { RegistryData } from '@aio/registry';
import { StaticProvider } from '@aio/resource';
import { createChartPlugin, createDomStage as createChartStage } from '@aio/plugin-chart';
import { createSearchPlugin } from '@aio/plugin-search';
import type { SearchHit, Stage as SearchStage } from '@aio/plugin-search';

/**
 * 内核接线 —— 这一份与 `apps/station` 的等价物几乎一样，**故意的**。
 *
 * 它本身就是本次要验的判据：把同一套 `packages/` 装进一个完全不同的宿主
 * （Next/React → Halo/Vue），接线代码应该长得差不多，而 `packages/` 一行不改。
 *
 * ## 🚧 这一版不接统一资源管线
 *
 * 数据内联在下面，走 `StaticProvider`。**这不是偷懒，是把变量控制住**：
 * 一次只验一件事。资源面（COS + CDN + 清单 + sha256）与「Halo 能不能装下
 * 这套东西」一起验，出了问题分不清是谁的。
 *
 * 换成 `ManifestCdnProvider` 时，**插件与下面的接线一行都不用改**——
 * 那正是 `ResourceProvider` 这个接口存在的理由。
 */

/** 合成数据。**没有一个字节来自真实素材**（铁律 9），角色是编的。 */
export const PROFILES: Readonly<Record<string, unknown>> = {
  'a:character/1001': { name: '角色甲', heightCm: 158, aliases: ['甲'] },
  // heightCm 为 null 是**有意义的一条**：有些实体确实没登记身高。
  // 图上它会进「没有数据」那一行，而不是被画成 0。
  'a:character/1002': { name: '角色丙', heightCm: null },
  'a:character/1003': { name: '角色丁', heightCm: 171, aliases: ['丁'] },
  'b:character/100101': { name: '角色乙', heightCm: 153, aliases: ['乙'] },
};

/** 检索目录。`ref` 是交叉表给的，**没有就是没有，不按名字推**（铁律 2）。 */
export const CATALOG: readonly Record<string, unknown>[] = [
  { ref: 'a:character/1001', zh: '角色甲', jp: '甲キャラ', roman: 'Kou Kyara', kana: 'こう きゃら' },
  { ref: 'a:character/1002', zh: '角色丙', jp: '丙キャラ', kana: 'へい きゃら' },
  { ref: 'a:character/1003', zh: '角色丁', jp: '丁キャラ', aliases: ['小丁'] },
  { ref: 'b:character/100101', zh: '角色乙', jp: '乙キャラ', roman: 'Otsu Kyara' },
  // 故意留一条**没有 ref** 的：交叉表没登记它。检索能搜到，但点不开——
  // 这正是铁律 2 要的表现，比「按名字凑一个 ref」诚实。
  { zh: '未登记的角色', jp: '未登録キャラ' },
];

const REGISTRY: RegistryData = {
  version: 1,
  entities: [
    { ref: 'a:character/1001', nameZh: '角色甲', links: {} },
    { ref: 'a:character/1002', nameZh: '角色丙', links: {} },
    { ref: 'a:character/1003', nameZh: '角色丁', links: {} },
    { ref: 'b:character/100101', nameZh: '角色乙', links: {} },
  ],
};

const dataUrl = (value: unknown): string =>
  `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(value))}`;

function createResources(): StaticProvider {
  const entries: Record<string, { role: string; path: string; url: string }[]> = {};
  for (const [ref, profile] of Object.entries(PROFILES)) {
    entries[ref] = [
      { role: 'profile', path: `profile/${ref.replace(':', '/')}.json`, url: dataUrl(profile) },
      // 检索目录挂在每条 character 上：search.query 的 intent 也是一条 character ref，
      // 它 fetch 的是 role=catalog。同一条 ref 上两个 role，互不相干。
      { role: 'catalog', path: 'catalog/characters.json', url: dataUrl(CATALOG) },
    ];
  }
  return new StaticProvider({ entries });
}

export interface OpenSurface {
  readonly surfaceId: string;
  readonly pluginId: string;
  readonly container: HTMLElement;
}

/**
 * surface 的仓库。
 *
 * 与 `apps/station/src/kernel/surface-store.ts` 同一套解法，因为难点是同一个：
 * **内核的 `acquire()` 是同步的**，必须当场返回一个能挂载的容器，
 * 而 Vue 的渲染要等下一个 tick。
 *
 * 解法是平台原语：`acquire()` 当场 `document.createElement` 造一个**游离**容器
 * 交给插件，插件立刻能画；Vue 侧订阅这个仓库，用 ref 回调把游离节点 append 进去。
 * **Vue 永远不去重渲染那个节点的内容**——插件直接持有它，框架碰它画面就没了。
 */
export class SurfaceStore implements SurfaceProvider {
  #open: readonly OpenSurface[] = [];
  readonly #listeners = new Set<() => void>();

  acquire(surfaceId: string, hint: SurfaceHint, pluginId: string): SurfaceTarget | null {
    if (typeof document === 'undefined') return null;
    const container = document.createElement('div');
    container.className = 'aio-surface-body';
    this.#open = [...this.#open, { surfaceId, pluginId, container }];
    this.#emit();
    return { surfaceId, container, hint };
  }

  release(surfaceId: string): void {
    const next = this.#open.filter((s) => s.surfaceId !== surfaceId);
    if (next.length === this.#open.length) return;
    this.#open = next;
    this.#emit();
  }

  get open(): readonly OpenSurface[] {
    return this.#open;
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  #emit(): void {
    for (const fn of this.#listeners) fn();
  }
}

/**
 * 检索结果的舞台。
 *
 * `@aio/plugin-search` 不自带 DOM 舞台（`plugin-chart` 自带），所以写一个。
 * **不引任何第三方组件**——纯 DOM，跟着宿主的字体与配色走。
 */
function createSearchStage(
  container: unknown,
  onPick: (ref: ResourceRef) => void,
): SearchStage | null {
  if (container === null || typeof document === 'undefined') return null;
  const root = container as HTMLElement;
  const list = document.createElement('ul');
  list.className = 'aio-hits';
  root.replaceChildren(list);

  return {
    render(query: string, hits: readonly SearchHit[]): void {
      list.replaceChildren();
      if (hits.length === 0) {
        const li = document.createElement('li');
        li.className = 'aio-hit-empty';
        li.textContent = query === '' ? '输入点什么' : `没有匹配「${query}」的条目`;
        list.append(li);
        return;
      }
      for (const hit of hits) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'aio-hit';
        const zh = document.createElement('span');
        zh.textContent = (hit.record.zh as string | undefined) ?? '(无中文名)';
        btn.append(zh);
        if (typeof hit.record.jp === 'string') {
          const jp = document.createElement('span');
          jp.className = 'aio-hit-jp';
          jp.textContent = hit.record.jp;
          btn.append(jp);
        }

        // ref 可能没有——交叉表没登记就是没登记，**不按名字推一个出来**。
        // 这时按钮画出来但点不动，比「点了打开另一个人」诚实得多。
        const raw = hit.record.ref;
        if (typeof raw === 'string') {
          let ref: ResourceRef | null = null;
          try {
            ref = parseRef(raw);
          } catch {
            // 目录里写坏的 ref 不该让整个列表崩，这一条降级成点不动。
          }
          if (ref === null) {
            btn.disabled = true;
            btn.title = `目录里这条的 ref 解析不了：${raw}`;
          } else {
            const target = ref;
            btn.addEventListener('click', () => onPick(target));
          }
        } else {
          btn.disabled = true;
          btn.title = '交叉表里没有这条的 ref';
        }

        li.append(btn);
        list.append(li);
      }
    },
    dispose(): void {
      list.remove();
    },
  };
}

/** 装哪两个插件。**目录 id 必须等于插件 manifest 的 id**，否则卸载会静静落空。 */
function buildPlugins(onPick: (ref: ResourceRef) => void): readonly Plugin[] {
  return [
    createChartPlugin({
      createStage: (container, pick) => createChartStage(container, { onPick: pick }),
    }),
    createSearchPlugin({
      createStage: (container) => createSearchStage(container, onPick),
    }),
  ];
}

export interface Station {
  readonly kernel: Kernel;
  readonly surfaces: SurfaceStore;
  readonly catalog: readonly { readonly id: string; readonly title: string }[];
}

export function createStation(onPick: (ref: ResourceRef) => void): Station {
  const surfaces = new SurfaceStore();
  const kernel = new Kernel({
    resources: createResources(),
    registry: Registry.from(REGISTRY),
    surfaces,
    logger: (level, pluginId, msg) => {
      if (level === 'error' || level === 'warn') {
        console[level === 'error' ? 'error' : 'warn'](`[${pluginId}] ${msg}`);
      }
    },
  });

  const catalog: { id: string; title: string }[] = [];
  for (const p of buildPlugins(onPick)) {
    kernel.register(p);
    catalog.push({ id: p.manifest.id, title: p.manifest.title });
  }
  return { kernel, surfaces, catalog };
}
