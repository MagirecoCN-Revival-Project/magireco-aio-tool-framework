import { movementOf, type SpriteDoc, type SpriteMovement } from './armature.js';

/**
 * 渲染无关的精灵播放器。
 *
 * 与 `@aio/plugin-adv` 的引擎同一个切法：这里管**帧推进与回话**，
 * 画面交给注入的 `Stage`。于是整套播放逻辑（选动作、循环、暂停、
 * 释放）都能在 node 上验，不需要 cocos2d，也不需要 GPU。
 *
 * 这也是「不碰上游」的落点：上游那套三百多个文件的 cocos2d 引擎
 * 若要接进来，它是 `Stage` 的一个实现，而不是我们必须去改的东西。
 */

export interface Stage {
  /** 呈现某个动作的第几帧。舞台自己决定怎么画，或者干脆不画。 */
  drawFrame(movement: SpriteMovement, frame: number): void;
  dispose(): void;
}

export interface SpritePlayerOptions {
  readonly doc: SpriteDoc;
  readonly stage?: Stage | null;
  /** 起始动作名。查不到就抛——不退回第一个动作（那是显示了别的东西）。 */
  readonly movement?: string;
  readonly onFrame?: (frame: number, total: number, movement: SpriteMovement) => void;
  /** 帧率，缺省 60（CocosStudio 导出的默认口径）。 */
  readonly fps?: number;
  readonly autoPlay?: boolean;
}

export class SpritePlayerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpritePlayerError';
  }
}

export class SpritePlayer {
  readonly #doc: SpriteDoc;
  readonly #stage: Stage | null;
  readonly #onFrame: SpritePlayerOptions['onFrame'];
  readonly #fps: number;

  #movement: SpriteMovement;
  #frame = 0;
  #paused = true;
  #disposed = false;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SpritePlayerOptions) {
    this.#doc = options.doc;
    this.#stage = options.stage ?? null;
    this.#onFrame = options.onFrame;
    this.#fps = options.fps !== undefined && options.fps > 0 ? options.fps : 60;

    const first = options.doc.movements[0];
    /* c8 ignore next */
    if (first === undefined) throw new SpritePlayerError('这份骨骼里没有任何动作');
    this.#movement = first;

    if (options.movement !== undefined) this.select(options.movement);
    if (options.autoPlay !== false) this.play();
  }

  get movement(): SpriteMovement {
    return this.#movement;
  }

  get frame(): number {
    return this.#frame;
  }

  get paused(): boolean {
    return this.#paused;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** 可选动作名。UI 用它画动作列表——**列表来自数据，不是猜的**。 */
  list(): readonly string[] {
    return this.#doc.movements.map((m) => m.name);
  }

  /**
   * 换动作。查不到就抛。
   *
   * 不退回第一个动作：那样点「action_out」会播出「name_r」，
   * 看起来像是能用，其实显示的是另一段——与铁律 2 同源的判断。
   */
  select(name: string): void {
    if (this.#disposed) return;
    const found = movementOf(this.#doc, name);
    if (found === null) {
      throw new SpritePlayerError(
        `没有动作 ${JSON.stringify(name)}——这份骨骼里有：${this.list().join('、')}`,
      );
    }
    this.#movement = found;
    this.#frame = 0;
    this.#emit();
  }

  seek(frame: number): void {
    if (this.#disposed) return;
    const max = this.#movement.frames - 1;
    const i = Number.isFinite(frame) ? Math.trunc(frame) : 0;
    this.#frame = i < 0 ? 0 : i > max ? max : i;
    this.#emit();
  }

  play(): void {
    if (this.#disposed || !this.#paused) return;
    this.#paused = false;
    this.#emit();
    if (this.#timer === null) {
      const interval = 1000 / (this.#fps * this.#movement.speedScale);
      this.#timer = setInterval(() => this.#tick(), interval);
    }
  }

  pause(): void {
    if (this.#disposed) return;
    this.#paused = true;
    this.#clear();
  }

  /** 幂等——治理器会反复调。 */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#paused = true;
    this.#clear();
    this.#stage?.dispose();
  }

  #tick(): void {
    const last = this.#movement.frames - 1;
    if (this.#frame >= last) {
      // 不循环的动作播完就停住，而不是回到第 0 帧继续——
      // 「播完了」必须是可观察的状态。
      if (!this.#movement.loop) {
        this.pause();
        return;
      }
      this.#frame = 0;
    } else {
      this.#frame += 1;
    }
    this.#emit();
  }

  #clear(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  #emit(): void {
    this.#stage?.drawFrame(this.#movement, this.#frame);
    this.#onFrame?.(this.#frame, this.#movement.frames, this.#movement);
  }
}
