/**
 * 多源选路。
 *
 * 语义照抄 `example-client` 的 `CNMirrors`——那套在国内网络环境下
 * 被真实玩家验证过：按权重选线、失败打冷却、冷却期内跳过、全线冷却时取最早
 * 恢复的一条而不是「没线路可用」。
 *
 * 一条**没有照抄**：客户端的 `switch_after_failures: 1`（一次失败就换线）。
 * 那是为大文件长连接定的；浏览器端多为小文件短请求，一次超时就永久降权
 * 会在弱网下把所有线路轮空。这里默认 2 次，且可配。
 */
export interface OriginConfig {
  readonly base: string;
  /** 越大越优先。 */
  readonly weight?: number;
  readonly name?: string;
}

export interface OriginPolicy {
  /** 连续失败多少次进入冷却。 */
  readonly failuresBeforeCooldown?: number;
  /** 冷却时长（毫秒）。 */
  readonly cooldownMs?: number;
  readonly now?: () => number;
}

export class OriginNotAllowedError extends Error {
  constructor(base: string, reason: string) {
    super(`源 ${JSON.stringify(base)} 不可用：${reason}`);
    this.name = 'OriginNotAllowedError';
  }
}

interface OriginState {
  readonly base: string;
  readonly weight: number;
  readonly name: string;
  failures: number;
  cooldownUntil: number;
}

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * 只收 https（`localhost` / `127.0.0.1` 例外，供本地开发）。
 *
 * 理由与客户端同源：manifest 条目缺少独立校验和时，完整性全押在 TLS 上。
 * 允许一个 http 源，等于给整条资源链留一个明文投毒入口。
 */
export function normalizeBase(base: string): string {
  if (CONTROL_CHARS.test(base)) {
    throw new OriginNotAllowedError(base, '含控制字符');
  }
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new OriginNotAllowedError(base, '不是合法 URL');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new OriginNotAllowedError(base, '只接受 https（本地开发可用 http://localhost）');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new OriginNotAllowedError(base, '源地址不得带 query 或 fragment');
  }
  return url.href.endsWith('/') ? url.href : `${url.href}/`;
}

export class OriginPool {
  readonly #origins: OriginState[];
  readonly #failuresBeforeCooldown: number;
  readonly #cooldownMs: number;
  readonly #now: () => number;

  constructor(origins: readonly OriginConfig[], policy: OriginPolicy = {}) {
    if (origins.length === 0) {
      // fail-closed：没有源就是没有源，不发明一个默认值。客户端曾因为
      // 「无可用线路时发明一个空 base」而把失败变成静默的 404 风暴。
      throw new OriginNotAllowedError('(空)', '至少要配置一个源');
    }
    this.#origins = origins.map((o) => ({
      base: normalizeBase(o.base),
      weight: o.weight ?? 0,
      name: o.name ?? o.base,
      failures: 0,
      cooldownUntil: 0,
    }));
    this.#failuresBeforeCooldown = policy.failuresBeforeCooldown ?? 2;
    this.#cooldownMs = policy.cooldownMs ?? 60_000;
    this.#now = policy.now ?? (() => Date.now());
  }

  /** 按优先级返回当前该尝试的源顺序。 */
  order(): readonly string[] {
    const t = this.#now();
    const live = this.#origins.filter((o) => o.cooldownUntil <= t);
    const cooled = this.#origins.filter((o) => o.cooldownUntil > t);

    live.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
    // 全线冷却也要给出顺序：取最早恢复的。让用户对着「暂无可用线路」干等，
    // 比让他重试一条刚冷却完的线路更糟。
    cooled.sort((a, b) => a.cooldownUntil - b.cooldownUntil);

    return [...live, ...cooled].map((o) => o.base);
  }

  reportSuccess(base: string): void {
    const o = this.#find(base);
    if (o === undefined) return;
    o.failures = 0;
    o.cooldownUntil = 0;
  }

  reportFailure(base: string): void {
    const o = this.#find(base);
    if (o === undefined) return;
    o.failures += 1;
    if (o.failures >= this.#failuresBeforeCooldown) {
      o.cooldownUntil = this.#now() + this.#cooldownMs;
      o.failures = 0;
    }
  }

  isCoolingDown(base: string): boolean {
    const o = this.#find(base);
    return o !== undefined && o.cooldownUntil > this.#now();
  }

  #find(base: string): OriginState | undefined {
    const normalized = base.endsWith('/') ? base : `${base}/`;
    return this.#origins.find((o) => o.base === normalized);
  }
}
