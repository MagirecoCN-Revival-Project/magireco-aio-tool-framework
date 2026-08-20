import { motionGroups, motionOf, type Live2dDoc, type Live2dMotion } from './model3.js';

/**
 * 渲染无关的 Live2D 会话。
 *
 * 与另外三个插件同一个切法：这里管**选什么、能不能选**，画面交给注入的
 * `Stage`。于是动作列表、表情切换、口型同步开关这些判据全部能在 node 上验，
 * 不需要 Cubism Core，也不需要 WebGL。
 *
 * 这同样是「不改上游」的落点：命名空间 b 那套 Cubism 集成若要接进来，
 * 它是 `Stage` 的一个实现。
 */

export interface Stage {
  playMotion(motion: Live2dMotion): void;
  /** `null` 表示清掉表情。 */
  setExpression(file: string | null): void;
  setLipSync(enabled: boolean): void;
  dispose(): void;
}

export interface Live2dSessionOptions {
  readonly doc: Live2dDoc;
  readonly stage?: Stage | null;
  readonly motion?: string;
  readonly expression?: string;
}

export class Live2dSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Live2dSessionError';
  }
}

export class Live2dSession {
  readonly #doc: Live2dDoc;
  readonly #stage: Stage | null;

  #motion: Live2dMotion | null = null;
  #expression: string | null = null;
  #lipSync = false;
  #disposed = false;

  constructor(options: Live2dSessionOptions) {
    this.#doc = options.doc;
    this.#stage = options.stage ?? null;
    if (options.motion !== undefined) this.setMotion(options.motion);
    if (options.expression !== undefined) this.setExpression(options.expression);
  }

  get motion(): Live2dMotion | null {
    return this.#motion;
  }

  get expression(): string | null {
    return this.#expression;
  }

  get lipSyncEnabled(): boolean {
    return this.#lipSync;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** 可选动作组。**来自数据**，不按 `motion_\d+` 这类命名规律推断。 */
  groups(): readonly string[] {
    return motionGroups(this.#doc);
  }

  expressions(): readonly string[] {
    return this.#doc.expressions.map((e) => e.name);
  }

  /** 这个模型支不支持口型同步。UI 据此决定画不画那个开关。 */
  get supportsLipSync(): boolean {
    return this.#doc.lipSync.length > 0;
  }

  setMotion(group: string, index = 0): void {
    if (this.#disposed) return;
    const found = motionOf(this.#doc, group, index);
    if (found === null) {
      // 退回第一条的话，点 motion_300 会播 motion_000，看着能用其实是别的动作。
      throw new Live2dSessionError(
        `没有动作 ${JSON.stringify(group)}[${index}]——这个模型有：${this.groups().join('、')}`,
      );
    }
    this.#motion = found;
    this.#stage?.playMotion(found);
  }

  setExpression(name: string | null): void {
    if (this.#disposed) return;
    if (name === null) {
      this.#expression = null;
      this.#stage?.setExpression(null);
      return;
    }
    const found = this.#doc.expressions.find((e) => e.name === name);
    if (found === undefined) {
      throw new Live2dSessionError(
        `没有表情 ${JSON.stringify(name)}——这个模型有：${this.expressions().join('、') || '（无）'}`,
      );
    }
    this.#expression = found.name;
    this.#stage?.setExpression(found.file);
  }

  /**
   * 开关口型同步。
   *
   * 模型没登记 `LipSync` 参数时**开不起来**——不是静默忽略，是明确返回 false，
   * 让调用方知道这个模型没这个能力，而不是以为开了却没动静。
   */
  setLipSync(enabled: boolean): boolean {
    if (this.#disposed) return false;
    if (enabled && !this.supportsLipSync) return false;
    this.#lipSync = enabled;
    this.#stage?.setLipSync(enabled);
    return true;
  }

  /** 幂等——治理器会反复调。 */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stage?.dispose();
  }
}
