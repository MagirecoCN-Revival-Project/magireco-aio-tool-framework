/**
 * WebGL 上下文治理。
 *
 * 浏览器同时保有的 WebGL 上下文有硬上限（常见 8–16）。超过之后**不会报错**，
 * 只是最早那个上下文被丢弃：表现是「刚才还好好的 3D 查看器突然变黑」，
 * 控制台安静得像什么都没发生。
 *
 * 这个问题在原来那种「一个页面一个查看器」的形态下不存在，但本框架要让
 * 剧情、精灵、Live2D、3D 同时活在一个页面上，就必须有人管这件事。
 *
 * 策略：按 LRU 挂起最久没被碰过的实例。挂起 ≠ 关闭——状态还在，
 * 用户再次交互时 resume 回来。
 */
export interface GovernedEntry {
  readonly surfaceId: string;
  readonly usesWebGL: boolean;
  suspended: boolean;
  touchedAt: number;
}

export interface GovernorOptions {
  /** 同时活着的 WebGL 实例上限。 */
  readonly maxLiveWebGL?: number;
  readonly now?: () => number;
}

export class ContextGovernor {
  readonly #entries = new Map<string, GovernedEntry>();
  readonly #max: number;
  readonly #now: () => number;
  #clock = 0;

  constructor(options: GovernorOptions = {}) {
    this.#max = options.maxLiveWebGL ?? 4;
    this.#now = options.now ?? (() => ++this.#clock);
  }

  register(surfaceId: string, usesWebGL: boolean): void {
    this.#entries.set(surfaceId, {
      surfaceId,
      usesWebGL,
      suspended: false,
      touchedAt: this.#now(),
    });
  }

  unregister(surfaceId: string): void {
    this.#entries.delete(surfaceId);
  }

  touch(surfaceId: string): void {
    const e = this.#entries.get(surfaceId);
    if (e === undefined) return;
    e.touchedAt = this.#now();
  }

  markSuspended(surfaceId: string, suspended: boolean): void {
    const e = this.#entries.get(surfaceId);
    if (e === undefined) return;
    e.suspended = suspended;
    if (!suspended) e.touchedAt = this.#now();
  }

  /**
   * 返回**当前应该被挂起**的 surface（最久未使用的那些）。
   * 只在超额时返回内容；不超额返回空数组。
   */
  overBudget(): readonly string[] {
    const live = [...this.#entries.values()].filter((e) => e.usesWebGL && !e.suspended);
    if (live.length <= this.#max) return [];
    live.sort((a, b) => a.touchedAt - b.touchedAt);
    return live.slice(0, live.length - this.#max).map((e) => e.surfaceId);
  }

  /** 当前活跃的 WebGL 实例数，供状态面板显示。 */
  liveWebGLCount(): number {
    return [...this.#entries.values()].filter((e) => e.usesWebGL && !e.suspended).length;
  }
}
