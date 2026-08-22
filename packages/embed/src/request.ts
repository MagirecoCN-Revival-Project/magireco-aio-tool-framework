import { capabilityAccepts, parseRef, formatRef, isValidCapabilityId } from '@aio/core';
import type { CapabilityId, ResourceRef } from '@aio/core';
import { contractOf } from '@aio/capability';
import type { CapabilityParamSpec } from '@aio/capability';

/**
 * 嵌入请求：一次「按 URL 寻址的能力调用」。
 *
 * 它**不是路由**。路由是「URL → 插件页面」，由 `@aio/site` 的路由表管；
 * 嵌入是「URL → 一次能力调用」，寻址的是 `(能力, ref, 参数)` 三元组。
 * 两者混在一张表里迟早出现「路由表能枚举出 sitemap，但嵌入 URL 有无穷多个」
 * 这种自相矛盾——嵌入面**不进 sitemap**，理由见 `docs/guide/embed.md`。
 */
export interface EmbedRequest {
  readonly capability: CapabilityId;
  readonly ref: ResourceRef;
  /** 已按契约校验并转型的参数。契约没登记的键不会出现在这里。 */
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

export class EmbedError extends Error {
  readonly code:
    | 'bad-path'
    | 'bad-capability'
    | 'unknown-capability'
    | 'bad-ref'
    | 'kind-mismatch'
    | 'bad-param';

  constructor(code: EmbedError['code'], message: string) {
    super(message);
    this.name = 'EmbedError';
    this.code = code;
  }
}

/** 嵌入面的路径前缀。 */
export const EMBED_PREFIX = '/embed/';

function coerce(spec: CapabilityParamSpec, raw: string): string | number | boolean {
  switch (spec.type) {
    case 'string':
      return raw;
    case 'number': {
      // Number('') === 0，而空串显然不是「零」——它是「这个参数写了但没写值」。
      // 不挡住的话 `?line=` 会被当成从第 0 行起播，而调用方以为自己没传。
      if (raw.trim() === '') {
        throw new EmbedError('bad-param', `参数 ${spec.name} 是空的——空串不是数字`);
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new EmbedError('bad-param', `参数 ${spec.name} 不是有限数字：${raw}`);
      }
      return n;
    }
    case 'boolean': {
      if (raw === '1' || raw === 'true') return true;
      if (raw === '0' || raw === 'false') return false;
      // 不把「其它一切」当成 true。`?auto=no` 按 JS 真值判定会变成「开」，
      // 那是最难查的一类 bug：调用方明确写了「否」，系统理解成「是」。
      throw new EmbedError(
        'bad-param',
        `参数 ${spec.name} 只认 1/0/true/false，收到 ${raw}`,
      );
    }
  }
}

/**
 * 解析嵌入请求。
 *
 * 形如 `/embed/sprite.show?ref=a:sprite/100100/d_r&movement=idle`。
 *
 * - **裸 ID 一律拒绝**（铁律 1）：ref 走 `parseRef`，没有宽松模式。
 * - **契约没登记的参数直接丢掉，不报错**：契约会长出新参数，
 *   老宿主发来的新参数不该让整个嵌入 400。这与 `CapabilityContract.params`
 *   那条「实现必须容忍未知参数」是同一条判据的两端。
 * - **登记了但值不合法的参数报错**：那不是「新参数」，是写错了。
 */
export function parseEmbedRequest(pathname: string, search: string | URLSearchParams): EmbedRequest {
  if (!pathname.startsWith(EMBED_PREFIX)) {
    throw new EmbedError('bad-path', `嵌入路径必须以 ${EMBED_PREFIX} 开头：${pathname}`);
  }
  const rest = pathname.slice(EMBED_PREFIX.length);
  if (rest === '' || rest.includes('/')) {
    throw new EmbedError('bad-path', `嵌入路径应为 ${EMBED_PREFIX}<能力 id>，收到 ${pathname}`);
  }
  if (!isValidCapabilityId(rest)) {
    throw new EmbedError('bad-capability', `能力 id 非法：${rest}`);
  }
  const capability = rest as CapabilityId;
  const contract = contractOf(capability);
  if (contract === null) {
    throw new EmbedError('unknown-capability', `没有登记的能力：${capability}`);
  }

  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const rawRef = q.get('ref');
  if (rawRef === null || rawRef === '') {
    throw new EmbedError('bad-ref', '缺少 ref 参数');
  }
  let ref: ResourceRef;
  try {
    ref = parseRef(rawRef);
  } catch (e) {
    throw new EmbedError('bad-ref', `ref 解析失败：${(e as Error).message}`);
  }
  if (!capabilityAccepts(contract, ref.kind)) {
    throw new EmbedError(
      'kind-mismatch',
      `${capability} 不接受 ${ref.kind}（只接受 ${contract.accepts.join('/')}）`,
    );
  }

  const params: Record<string, string | number | boolean> = {};
  for (const spec of contract.params) {
    const raw = q.get(spec.name);
    if (raw === null) {
      if (spec.required) {
        throw new EmbedError('bad-param', `缺少必需参数 ${spec.name}`);
      }
      continue;
    }
    params[spec.name] = coerce(spec, raw);
  }

  return { capability, ref, params };
}

/**
 * 拼一条嵌入 URL。
 *
 * `origin` 必须由调用方传进来——**这里不认识任何域名**（铁律 3 的同一条判据：
 * 拼死 host 会让换域名、多站点、私有部署全部失效）。
 */
export function buildEmbedUrl(origin: string, req: EmbedRequest): string {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  const q = new URLSearchParams();
  q.set('ref', formatRef(req.ref));
  for (const [k, v] of Object.entries(req.params)) q.set(k, String(v));
  return `${base}${EMBED_PREFIX}${req.capability}?${q.toString()}`;
}
