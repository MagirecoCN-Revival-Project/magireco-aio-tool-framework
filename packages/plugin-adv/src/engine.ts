import type { ScenarioCommand, ScenarioDoc } from './scenario.js';

/**
 * 渲染无关的 ADV 播放引擎。
 *
 * 它管时间轴与回话，**不管画面**。画面是注入的 `Stage`：
 * 浏览器里可以是 DOM/Pixi/Cubism，node 里可以是 null（什么都不画）。
 *
 * 这个切法有两个直接后果：
 *
 *   1. **整套播放逻辑能在 node 上测**——seek、播放暂停、进度回流、
 *      资源释放，全部不需要 GPU 与浏览器；
 *   2. **不碰任何上游代码**。上游若愿意接，它是 `Stage` 的一个实现，
 *      而不是我们必须去改的东西。
 */

export interface Stage {
  /** 呈现一条指令。引擎不关心它怎么画，也不关心它画不画。 */
  show(command: ScenarioCommand): void;
  dispose(): void;
}

export interface AdvEngineOptions {
  readonly doc: ScenarioDoc;
  /** 没有舞台就只跑时间轴——测试与 SSR 预检用。 */
  readonly stage?: Stage | null;
  readonly onProgress?: (position: number, total: number) => void;
  /** 指令带 assetId 时回报，供「ADV 里点立绘打开档案」那条链路。 */
  readonly onAsset?: (assetId: string, command: ScenarioCommand) => void;
  /** 自动推进间隔；<= 0 表示只手动推进。 */
  readonly autoAdvanceMs?: number;
  readonly startLine?: number;
}

export class AdvEngine {
  readonly #doc: ScenarioDoc;
  readonly #stage: Stage | null;
  readonly #onProgress: ((position: number, total: number) => void) | undefined;
  readonly #onAsset: ((assetId: string, command: ScenarioCommand) => void) | undefined;
  readonly #autoMs: number;

  #position = 0;
  #paused = true;
  #disposed = false;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AdvEngineOptions) {
    this.#doc = options.doc;
    this.#stage = options.stage ?? null;
    this.#onProgress = options.onProgress;
    this.#onAsset = options.onAsset;
    this.#autoMs = options.autoAdvanceMs ?? 0;
    this.#position = clamp(options.startLine ?? 0, this.total);
  }

  get total(): number {
    return this.#doc.commands.length;
  }

  get position(): number {
    return this.#position;
  }

  get paused(): boolean {
    return this.#paused;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** 定位并呈现。越界一律夹到范围内——不抛，播放器不该因为一个坏行号整个挂掉。 */
  seek(line: number): void {
    if (this.#disposed) return;
    this.#position = clamp(line, this.total);
    this.#emit();
  }

  next(): void {
    if (this.#disposed) return;
    // 播到底就停在最后一行，不循环：循环会让「播完了」这件事无法观察。
    if (this.#position >= this.total - 1) {
      this.pause();
      return;
    }
    this.#position += 1;
    this.#emit();
  }

  play(): void {
    if (this.#disposed || !this.#paused) return;
    this.#paused = false;
    this.#emit();
    if (this.#autoMs > 0 && this.#timer === null) {
      this.#timer = setInterval(() => this.next(), this.#autoMs);
    }
  }

  pause(): void {
    if (this.#disposed) return;
    this.#paused = true;
    this.#clearTimer();
  }

  /** 幂等——治理器会反复调（`PluginInstance` 的契约）。 */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#paused = true;
    // 漏掉这一步，一致性套件的「关闭之后不再发事件」当场变红。
    this.#clearTimer();
    this.#stage?.dispose();
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  #emit(): void {
    const command = this.#doc.commands[this.#position];
    /* c8 ignore next */
    if (command === undefined) return;
    this.#stage?.show(command);
    this.#onProgress?.(this.#position, this.total);
    if (command.assetId !== undefined) {
      this.#onAsset?.(command.assetId, command);
    }
  }
}

function clamp(n: number, total: number): number {
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  if (i < 0) return 0;
  const max = Math.max(0, total - 1);
  return i > max ? max : i;
}
