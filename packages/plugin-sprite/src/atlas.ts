import {
  parsePlist,
  plistBool,
  plistDict,
  plistNumber,
  plistString,
  type PlistValue,
} from './plist.js';

/**
 * CocosStudio / TexturePacker 图集（`*.plist`）的解析。
 *
 * 骨骼文件（`*.ExportJson`）说「第 12 帧，bone_a 用 `part_a.png`」；
 * 图集说「`part_a.png` 在大图的 (128,64) 起、48×72、顺时针转了 90°」。
 * 两份合起来才画得出真图——`armature.ts` 管前一半，这里管后一半。
 *
 * **与渲染无关**：这里不 import 任何 DOM 类型，判据全在 node 上验。
 *
 * ## 四种 format 的键名完全不同，所以不猜
 *
 * | format | 矩形 | 偏移 | 原尺寸 | 旋转 |
 * |---|---|---|---|---|
 * | 0 | `x`/`y`/`width`/`height` | `offsetX`/`offsetY` | `originalWidth`/`originalHeight` | 无 |
 * | 1 | `frame` | `offset` | `sourceSize` | 无 |
 * | 2 | `frame` | `offset` | `sourceSize` | `rotated` |
 * | 3 | `textureRect`+`spriteSize` | `spriteOffset` | `spriteSourceSize` | `textureRotated` |
 *
 * `metadata.format` 缺失或不是这四个之一 → **直接抛**。按「大概是 2」去读一份
 * format 0 的图集，得到的不是报错，是一整套错的矩形——画面上每个部件都取了
 * 大图里的另一块，看起来像素材损坏。
 *
 * ## 旋转的那个坑
 *
 * cocos 的打包器把竖长图**顺时针转 90°**塞进图集省地方。此时 plist 里
 * `frame` 的宽高记的仍是**转回来之后**的显示尺寸，而它在大图里实际占的是
 * 高×宽（两个数调过来）。照着 `frame` 的宽高去 `drawImage` 会裁到隔壁的图，
 * 而且不报错。所以本模块把两个口径分开：`width`/`height` 永远是显示尺寸，
 * 图集里的真实区域一律经 {@link regionInAtlas} 取。
 */

export class AtlasParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AtlasParseError';
  }
}

export interface AtlasFrame {
  /** 帧名，就是骨骼文件里 `display_data[].name` 的那个值。 */
  readonly name: string;
  /** 在大图里的左上角（像素，y 向下——与 canvas `drawImage` 同一个口径）。 */
  readonly x: number;
  readonly y: number;
  /** **未旋转**的显示尺寸。大图里实际占的区域见 {@link regionInAtlas}。 */
  readonly width: number;
  readonly height: number;
  /** 打包时被顺时针转了 90°。 */
  readonly rotated: boolean;
  /** 裁掉透明边后，图块中心相对原图中心的偏移（y 向上，cocos 口径）。 */
  readonly offsetX: number;
  readonly offsetY: number;
  /** 裁剪之前的原图尺寸。摆位要用它，否则裁过的图会往左上角缩。 */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

export interface AtlasSize {
  readonly width: number;
  readonly height: number;
}

export interface SpriteAtlas {
  /** 大图文件名（`realTextureFileName` 优先，退到 `textureFileName`）。 */
  readonly texture: string;
  /** 大图尺寸。format 0 的老图集可能没写，那时是 null。 */
  readonly size: AtlasSize | null;
  readonly format: number;
  /** 按帧名升序，保证两次解析的顺序一致。 */
  readonly frames: readonly AtlasFrame[];
  /**
   * 按名字取帧。**查不到返回 null，绝不模糊匹配**——
   * 不去掉 `.png` 再试，也不忽略大小写。猜中隔壁那张图的代价是画错，
   * 而画错不报错（与铁律 2 同源）。
   */
  frame(name: string): AtlasFrame | null;
}

/** 这一帧在大图里实际占的矩形。旋转过的把宽高调过来——就为了不写错这一处。 */
export function regionInAtlas(frame: AtlasFrame): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  return frame.rotated
    ? { x: frame.x, y: frame.y, width: frame.height, height: frame.width }
    : { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
}

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)/g;

/** 把 `{{0,0},{48,72}}` / `{48,72}` 这类几何串读成定长数组。多一个少一个都抛。 */
function nums(raw: string, count: number, what: string): number[] {
  const found = raw.match(NUMBER) ?? [];
  if (found.length !== count) {
    throw new AtlasParseError(
      `${what} 期望 ${count} 个数字，实际 ${found.length} 个：${JSON.stringify(raw)}`,
    );
  }
  return found.map(Number);
}

function need(dict: Record<string, PlistValue>, key: string, what: string): PlistValue {
  const value = dict[key];
  if (value === undefined) throw new AtlasParseError(`${what} 缺 ${key}`);
  return value;
}

function frameOf(name: string, dict: Record<string, PlistValue>, format: number): AtlasFrame {
  const what = `帧 ${JSON.stringify(name)}`;

  if (format === 0) {
    // 最老的一档：每个数字一个 key，且从不旋转。
    return {
      name,
      x: plistNumber(need(dict, 'x', what), `${what}.x`),
      y: plistNumber(need(dict, 'y', what), `${what}.y`),
      width: plistNumber(need(dict, 'width', what), `${what}.width`),
      height: plistNumber(need(dict, 'height', what), `${what}.height`),
      rotated: false,
      offsetX: plistNumber(need(dict, 'offsetX', what), `${what}.offsetX`),
      offsetY: plistNumber(need(dict, 'offsetY', what), `${what}.offsetY`),
      // 原尺寸这里可能是负数（老打包器用负号标记「有旋转信息」），取绝对值。
      sourceWidth: Math.abs(plistNumber(need(dict, 'originalWidth', what), `${what}.originalWidth`)),
      sourceHeight: Math.abs(
        plistNumber(need(dict, 'originalHeight', what), `${what}.originalHeight`),
      ),
    };
  }

  if (format === 1 || format === 2) {
    const [x, y, width, height] = nums(
      plistString(need(dict, 'frame', what), `${what}.frame`),
      4,
      `${what}.frame`,
    ) as [number, number, number, number];
    const [offsetX, offsetY] = nums(
      plistString(need(dict, 'offset', what), `${what}.offset`),
      2,
      `${what}.offset`,
    ) as [number, number];
    const [sourceWidth, sourceHeight] = nums(
      plistString(need(dict, 'sourceSize', what), `${what}.sourceSize`),
      2,
      `${what}.sourceSize`,
    ) as [number, number];
    return {
      name,
      x,
      y,
      width,
      height,
      // format 1 没有旋转这回事；format 2 才有 rotated。
      rotated: format === 2 ? plistBool(dict['rotated'], `${what}.rotated`) : false,
      offsetX,
      offsetY,
      sourceWidth,
      sourceHeight,
    };
  }

  if (format === 3) {
    // 这一档的 textureRect 宽高是**大图里的占位**（旋转过就是转后的），
    // 显示尺寸单独放在 spriteSize 里。所以矩形取 textureRect 的原点 +
    // spriteSize 的宽高，与 1/2 档对齐，regionInAtlas 再统一还原。
    const [x, y] = nums(
      plistString(need(dict, 'textureRect', what), `${what}.textureRect`),
      4,
      `${what}.textureRect`,
    ) as [number, number, number, number];
    const [width, height] = nums(
      plistString(need(dict, 'spriteSize', what), `${what}.spriteSize`),
      2,
      `${what}.spriteSize`,
    ) as [number, number];
    const [offsetX, offsetY] = nums(
      plistString(need(dict, 'spriteOffset', what), `${what}.spriteOffset`),
      2,
      `${what}.spriteOffset`,
    ) as [number, number];
    const [sourceWidth, sourceHeight] = nums(
      plistString(need(dict, 'spriteSourceSize', what), `${what}.spriteSourceSize`),
      2,
      `${what}.spriteSourceSize`,
    ) as [number, number];
    return {
      name,
      x,
      y,
      width,
      height,
      rotated: plistBool(dict['textureRotated'], `${what}.textureRotated`),
      offsetX,
      offsetY,
      sourceWidth,
      sourceHeight,
    };
  }

  /* c8 ignore next */
  throw new AtlasParseError(`未知的图集 format=${format}`);
}

/** 解析一份 plist 图集。 */
export function parseAtlas(text: string): SpriteAtlas {
  const root = plistDict(parsePlist(text), 'plist 根');

  const metadata = plistDict(root['metadata'], 'metadata');
  const formatRaw = metadata['format'];
  if (typeof formatRaw !== 'number' || ![0, 1, 2, 3].includes(formatRaw)) {
    // 不默认成 2：按错的 format 读出来的是一整套错矩形，而不是一个错误。
    throw new AtlasParseError(
      `metadata.format 必须是 0/1/2/3 之一，实际是 ${JSON.stringify(formatRaw)}`,
    );
  }
  const format = formatRaw;

  const textureRaw = metadata['realTextureFileName'] ?? metadata['textureFileName'];
  if (textureRaw === undefined) {
    throw new AtlasParseError('metadata 里既没有 realTextureFileName 也没有 textureFileName');
  }
  const texture = plistString(textureRaw, 'metadata 的大图文件名');

  let size: AtlasSize | null = null;
  const sizeRaw = metadata['size'];
  if (sizeRaw !== undefined) {
    const [width, height] = nums(
      plistString(sizeRaw, 'metadata.size'),
      2,
      'metadata.size',
    ) as [number, number];
    size = { width, height };
  }

  const framesDict = plistDict(root['frames'], 'frames');
  const frames: AtlasFrame[] = [];
  for (const name of Object.keys(framesDict).sort()) {
    frames.push(frameOf(name, plistDict(framesDict[name], `帧 ${JSON.stringify(name)}`), format));
  }
  if (frames.length === 0) {
    // 空图集不会白屏，它会让每个部件都「查不到帧」而静静不画。
    throw new AtlasParseError('这份图集里一帧都没有');
  }

  const byName = new Map(frames.map((f) => [f.name, f]));
  return {
    texture,
    size,
    format,
    frames,
    frame: (name: string) => byName.get(name) ?? null,
  };
}
