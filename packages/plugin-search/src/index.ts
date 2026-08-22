import { formatRef, tryParseRef } from '@aio/core';
import type { Plugin, PluginInstance } from '@aio/kernel';
import { buildCorpus, search, type SearchHit, type SearchRecord } from './corpus.js';

export * from './corpus.js';

/**
 * `search.query` 的一个实现——**从零写的，不碰任何上游代码**。
 *
 * 目录经 `host.resources` 拿（铁律 3），匹配逻辑在 `corpus.ts`，
 * 结果怎么画交给注入的 `Stage`。上游那套 GAS + 前端
 * 若要接进来，它是 `Stage` 的又一个实现。
 */

export interface Stage {
  /** 呈现一次查询结果。舞台自己决定怎么画，或者干脆不画。 */
  render(query: string, hits: readonly SearchHit[]): void;
  dispose(): void;
}

export interface SearchDeps {
  createStage(container: unknown): Stage | null;
  /** 结果条数上限，缺省 50。 */
  readonly limit?: number;
}

const decoder = new TextDecoder();

function asRecords(input: unknown): readonly SearchRecord[] {
  if (!Array.isArray(input)) throw new Error('角色目录不是数组');
  return input.filter((x): x is SearchRecord => typeof x === 'object' && x !== null);
}

export function createSearchPlugin(deps: SearchDeps): Plugin {
  return {
    manifest: {
      id: 'search-query',
      version: '0.1.0',
      title: '检索',
      isolation: 'inline',
      // 纯 DOM 与文本匹配，不占 WebGL。
      usesWebGL: false,
      provides: [{ id: 'search.query', accepts: ['character'], title: '检索' }],
      needs: ['character'],
    },

    async mount(target, intent, host): Promise<PluginInstance> {
      const bytes = await host.resources.fetchPart(intent.ref, 'catalog');

      let corpus;
      try {
        corpus = buildCorpus(asRecords(JSON.parse(decoder.decode(bytes))));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        host.log('error', `解析 ${formatRef(intent.ref)} 的目录失败：${reason}`);
        throw new Error(`目录解析失败：${reason}`);
      }

      const stage = deps.createStage(target.container);
      const limit = deps.limit ?? 50;
      let hits: readonly SearchHit[] = [];

      const run = (raw: unknown): void => {
        const q = typeof raw === 'string' ? raw : '';
        hits = search(corpus, q, { limit });
        stage?.render(q, hits);
      };

      /**
       * 选中一条结果 → 发 `entity.focused`，宿主据此打开档案。
       *
       * **没有 ref 的条目不发事件。** 那份目录按显示名索引、根本没有 ID，
       * 而显示名跨数据源对不上（「角色甲（另一种译名）」vs「角色甲」）。按名字凑一个 ref
       * 会把人配错且不报错——宁可点不动（铁律 2）。
       */
      const select = (raw: unknown): void => {
        if (typeof raw !== 'string' || raw === '') return;
        const hit = hits.find(
          (h) => h.record.ref === raw || h.record.zh === raw || h.record.jp === raw,
        );
        const ref = hit?.record.ref === undefined ? null : tryParseRef(hit.record.ref);
        if (ref === null) {
          host.log('info', `${raw} 没有可用的 ref（交叉表未覆盖），不发 entity.focused`);
          return;
        }
        host.events.emit('entity.focused', { surfaceId: host.surfaceId, ref });
      };

      run(intent.params?.['q']);

      return {
        suspend() {},
        resume() {},
        dispose() {
          stage?.dispose();
        },
        update(next) {
          if (next.params?.['q'] !== undefined) run(next.params['q']);
          select(next.params?.['select']);
        },
      };
    },
  };
}
