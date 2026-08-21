import { formatRef, parseRef, type ResourceRef } from '@aio/core';
import type { Plugin, PluginHost, PluginInstance } from '@aio/kernel';
import { layoutChart, type ChartEntry, type ChartOptions } from './chart.js';
import { parseProfile } from './profile.js';
import type { Stage } from './stage-dom.js';

export * from './chart.js';
export * from './profile.js';
export * from './stage-dom.js';

/**
 * `chart.height` 的一个实现——**从零写的，不碰任何上游代码**。
 *
 * 这一项能力是 `contracts/capabilities.json` 那张表第一次跑就查出来的缺口：
 * 上游 `call-search` 提供它，本仓库既没有实现也没有契约，于是它落在
 * 「离不开上游」那一档里，而维护者的约束是不改上游。现在两边都补上了。
 */

export interface ChartDeps {
  /** 造舞台。拿不到 DOM 时返回 null——插件照常读档案、照常回话，只是不画。 */
  createStage(container: unknown, onPick: (ref: ResourceRef) => void): Stage | null;
  readonly chart?: ChartOptions;
}

const decoder = new TextDecoder();

/**
 * 把 `compare` 参数拆成 ref。
 *
 * **拆不出来的一律丢掉，不抛**：对比名单来自调用方（可能是别的插件、可能是
 * URL 里的查询串），它不该知道清单里有谁。一个写错的 ref 让整张图打不开，
 * 代价远大于少画一根柱子——而少画的那一根会出现在图下方的「没有数据」里。
 *
 * 但**裸 ID 依然拒绝**（铁律 1）：`parseRef('100101')` 抛，这里接住后丢掉它，
 * 不会退化成「按当前作品补一个前缀」。补前缀就是把一个角色的身高配到另一个
 * 角色头上，而且不报错。
 */
export function parseCompare(raw: unknown): readonly ResourceRef[] {
  if (typeof raw !== 'string') return [];
  const out: ResourceRef[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(',')) {
    const text = piece.trim();
    if (text === '') continue;
    let ref: ResourceRef;
    try {
      ref = parseRef(text);
    } catch {
      continue;
    }
    const key = formatRef(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

async function readProfile(
  ref: ResourceRef,
  host: PluginHost,
  focus: boolean,
): Promise<ChartEntry | null> {
  // 档案只经 host.resources 拿（铁律 3）。清单里没有这条 ref 就没有这条，
  // 不去别处找、不按编号猜一个。
  if (!host.resources.has(ref)) return null;
  try {
    const bytes = await host.resources.fetchPart(ref, 'profile');
    return { ref, profile: parseProfile(JSON.parse(decoder.decode(bytes)), formatRef(ref)), focus };
  } catch (err) {
    host.log('warn', `${formatRef(ref)} 的档案读不出来，这一条不画：${String(err)}`);
    return null;
  }
}

export function createChartPlugin(deps: ChartDeps): Plugin {
  return {
    manifest: {
      id: 'chart-height',
      version: '0.1.0',
      title: '身高对比',
      isolation: 'inline',
      // DOM 舞台不占 WebGL 上下文。多声明一个不存在的占用会让治理器
      // 白白挂起别的查看器（铁律 5 的反面）。
      usesWebGL: false,
      provides: [{ id: 'chart.height', accepts: ['character'], title: '身高对比' }],
      needs: ['character'],
    },

    async mount(target, intent, host): Promise<PluginInstance> {
      const focused = await readProfile(intent.ref, host, true);
      if (focused === null) {
        // 点名的那个角色都没有档案，图就没有主体——宁可打不开。
        throw new Error(`${formatRef(intent.ref)} 没有可用的档案`);
      }

      const stage = deps.createStage(target.container, (ref) => {
        host.events.emit('entity.focused', { surfaceId: host.surfaceId, ref });
      });

      let alive = true;
      const render = async (params: Record<string, unknown> | undefined): Promise<void> => {
        const others = await Promise.all(
          parseCompare(params?.['compare'])
            .filter((r) => formatRef(r) !== formatRef(intent.ref))
            .map((r) => readProfile(r, host, false)),
        );
        if (!alive) return;
        const entries = [focused, ...others].filter((e): e is ChartEntry => e !== null);
        stage?.draw(layoutChart(entries, deps.chart ?? {}));
      };

      void render(intent.params);

      return {
        suspend() {
          /* 这张图是静态的：没有计时器、没有音频、没有 GPU 上下文可让。 */
        },
        resume() {
          /* 同上。 */
        },
        dispose() {
          alive = false;
          stage?.dispose();
        },
        update(next) {
          // 支持就地更新：不实现的话，改一次对比名单就多开一个 surface。
          void render(next.params);
        },
      };
    },
  };
}
