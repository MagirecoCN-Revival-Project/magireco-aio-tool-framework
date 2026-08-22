/**
 * 谁可以把这个嵌入面套进 iframe。
 *
 * ## 为什么必须是白名单，且不给通配全放
 *
 * 嵌入面是**唯一一处我们主动允许别人把我们的 UI 套进他们页面**的地方。
 * 放开成 `frame-ancestors *` 的后果不是「更方便」，是点击劫持：任何人都能
 * 把这个 iframe 铺成透明层盖在自己的按钮上，用户以为点的是他的页面，
 * 实际点的是我们的。所以 `'*'` 在这里**直接拒绝**，没有「省事模式」。
 *
 * 空名单 = 谁都不许嵌（`frame-ancestors 'none'`），而不是「谁都行」。
 * 默认值站在拒绝那一侧：忘了配置的后果应该是「嵌不上，来问」，
 * 而不是「谁都能嵌，没人发现」。
 */

export interface EmbedPolicy {
  /**
   * 允许把我们嵌进去的来源。两种写法：
   *
   * - 精确来源：`https://wiki.example.org`
   * - 一级通配子域：`https://*.example.org`
   *
   * 通配的语义与 CSP 一致：`https://*.example.org` 匹配任意子域，
   * **但不匹配 `https://example.org` 本身**。要连主域一起放，两条都写。
   */
  readonly allowedAncestors: readonly string[];
}

export class EmbedPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbedPolicyError';
  }
}

export const DENY_ALL: EmbedPolicy = { allowedAncestors: [] };

interface ParsedAncestor {
  readonly scheme: string;
  readonly host: string;
  readonly port: string;
  readonly wildcard: boolean;
}

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

const DEFAULT_PORT: Readonly<Record<string, string>> = { 'http:': '80', 'https:': '443' };

/** 去掉默认端口，让 `https://a.org` 与 `https://a.org:443` 判为同一个来源。 */
function canonicalPort(scheme: string, port: string): string {
  if (port === '') return '';
  return DEFAULT_PORT[scheme] === port ? '' : port;
}

function parseAncestor(entry: string): ParsedAncestor {
  const raw = entry.trim();
  if (raw === '') throw new EmbedPolicyError('来源不能是空串');
  if (raw === '*' || raw === "'*'") {
    throw new EmbedPolicyError("不接受 '*'——嵌入面必须列出具体来源，否则等于开放点击劫持");
  }

  const wildcard = raw.includes('*');
  // 通配只允许出现在 `scheme://*.` 这一个位置，且只有一个。
  // 允许 `*.a.*.org` 这类会让匹配语义变得没人说得准。
  const probe = wildcard ? raw.replace('://*.', '://') : raw;
  if (wildcard && (raw.indexOf('*') !== raw.lastIndexOf('*') || !raw.includes('://*.'))) {
    throw new EmbedPolicyError(`通配只支持 scheme://*.host 这一种写法：${entry}`);
  }

  let u: URL;
  try {
    u = new URL(probe);
  } catch {
    throw new EmbedPolicyError(`来源不是合法 URL：${entry}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new EmbedPolicyError(`来源只支持 http/https：${entry}`);
  }
  if (u.username !== '' || u.password !== '') {
    throw new EmbedPolicyError(`来源不得带凭据：${entry}`);
  }
  // URL 会把 `https://a.org` 的 pathname 补成 `/`，那是合法的「无路径」。
  // 真带了路径（`https://a.org/wiki`）要拒绝：frame-ancestors 只比来源，
  // 写了路径的人会以为「只有这个路径下能嵌」，而实际上整个站都能。
  if (u.pathname !== '/' || u.search !== '' || u.hash !== '') {
    throw new EmbedPolicyError(`来源只能是 scheme://host[:port]，不带路径：${entry}`);
  }
  if (!HOST_RE.test(u.hostname)) {
    throw new EmbedPolicyError(`主机名非法：${entry}`);
  }
  if (wildcard && !u.hostname.includes('.')) {
    throw new EmbedPolicyError(`通配子域至少要有一级父域：${entry}`);
  }
  return {
    scheme: u.protocol,
    host: u.hostname,
    port: canonicalPort(u.protocol, u.port),
    wildcard,
  };
}

/** 校验整份名单。有一条坏的就整份拒绝——半份生效的白名单比没有更危险。 */
export function parsePolicy(policy: EmbedPolicy): readonly ParsedAncestor[] {
  return policy.allowedAncestors.map(parseAncestor);
}

/**
 * 这个来源能不能嵌我们。
 *
 * **必须与浏览器对 `frame-ancestors` 的判定一致。** 两边不一致的后果是
 * 最难查的一类：浏览器放行而我们的 postMessage 校验拒收（功能静默失效），
 * 或者反过来（我们以为拦住了，其实没有）。
 */
export function isAllowedAncestor(policy: EmbedPolicy, origin: string): boolean {
  // `null` 来源（sandbox 的 iframe、file://、重定向后的不透明来源）永远不放行。
  // 单独挡一道而不是靠 `new URL('null')` 抛错——那是**碰巧**成立的：
  // 若哪天注册了 `null:` 这个 scheme，靠抛错的写法会静默放行。
  if (origin === 'null') return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  const port = canonicalPort(u.protocol, u.port);
  for (const a of parsePolicy(policy)) {
    if (a.scheme !== u.protocol || a.port !== port) continue;
    if (a.wildcard) {
      // CSP 语义：`*.example.org` 匹配子域，不匹配 example.org 本身。
      if (u.hostname.endsWith(`.${a.host}`) && u.hostname !== a.host) return true;
    } else if (u.hostname === a.host) {
      return true;
    }
  }
  return false;
}

/** `frame-ancestors` 指令的值。空名单给 `'none'`。 */
export function frameAncestors(policy: EmbedPolicy): string {
  const parsed = parsePolicy(policy);
  if (parsed.length === 0) return "'none'";
  return parsed
    .map((a) => `${a.scheme}//${a.wildcard ? '*.' : ''}${a.host}${a.port === '' ? '' : `:${a.port}`}`)
    .join(' ');
}

/**
 * 嵌入页要发的 CSP。
 *
 * 除了 `frame-ancestors`，这里还钉死了两件事：
 *
 * - `default-src 'self'`：嵌入页不该去第三方拉任何东西。素材走资源面，
 *   资源面的来源由调用方按需加进 `connect-src` / `img-src`。
 * - `form-action 'none'`：嵌入页没有表单。留着它等于给 XSS 留一条外传通道。
 */
export function embedCsp(policy: EmbedPolicy, extra?: Readonly<Record<string, string>>): string {
  const directives: Record<string, string> = {
    'default-src': "'self'",
    'frame-ancestors': frameAncestors(policy),
    'form-action': "'none'",
    'base-uri': "'none'",
    ...extra,
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v}`)
    .join('; ');
}
