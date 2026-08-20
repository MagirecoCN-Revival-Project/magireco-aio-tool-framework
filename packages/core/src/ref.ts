/**
 * 资源引用（ResourceRef）—— 整个框架的通用货币。
 *
 * 语法：`<universe>:<kind>/<segment>[/<segment>…][@<variant>]`
 *
 *   a:character/1001            命名空间 a · 角色甲
 *   a:sprite/100100/d_r         命名空间 a · 精灵（unit / 变体）
 *   a:voice/vo_char_1001_00_01  命名空间 a · 语音
 *   a:scenario/310241@zh        命名空间 a · 剧情（中文）
 *   b:character/100101          示例作品 B · 角色乙
 *   b:model3d/100101            示例作品 B · 3D 模型
 *
 * ## 为什么 universe 前缀不能省
 *
 * 两个游戏的 ID 空间**长得一模一样但含义完全不同**：
 *
 *   b:model3d/100101  →  角色乙/角色（命名空间 b `style3dCharacterMstId`）
 *   a:sprite/100100   →  角色甲（命名空间 a charaId 1001 + 服装 00）
 *
 * 一旦允许裸数字在系统里流动，"点角色简介看精灵"这类跨模块调用迟早会把
 * 角色甲的档案配上角色乙的模型，而且不报错——只是显示了错的人。
 * 所以 ref 在**语法层面**就强制携带 universe，解析器拒绝没有前缀的字符串。
 */

/** 已知的作品域。新增作品要同时在这里和 registry 的 schema 里登记。 */
export const UNIVERSES = ['a', 'b'] as const;
export type Universe = (typeof UNIVERSES)[number];

/** 已知的资源种类。插件按 kind 声明自己能处理什么。 */
export const REF_KINDS = [
  'character',
  'sprite',
  'live2d',
  'model3d',
  'voice',
  'scenario',
  'card',
  'item',
  'bgm',
  'image',
] as const;
export type RefKind = (typeof REF_KINDS)[number];

export interface ResourceRef {
  readonly universe: Universe;
  readonly kind: RefKind;
  /** 至少一段。第一段是主标识，其余是变体路径（如精灵的 `d_r`）。 */
  readonly segments: readonly string[];
  /** 可选修饰，用于语言等正交维度：`@zh`、`@ja`。 */
  readonly variant?: string;
}

export class RefParseError extends Error {
  constructor(
    readonly input: string,
    reason: string,
  ) {
    super(`无法解析资源引用 ${JSON.stringify(input)}：${reason}`);
    this.name = 'RefParseError';
  }
}

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const VARIANT_RE = /^[a-z0-9][a-z0-9-]*$/;

const UNIVERSE_SET: ReadonlySet<string> = new Set(UNIVERSES);
const KIND_SET: ReadonlySet<string> = new Set(REF_KINDS);

export function isUniverse(value: string): value is Universe {
  return UNIVERSE_SET.has(value);
}

export function isRefKind(value: string): value is RefKind {
  return KIND_SET.has(value);
}

/** 解析 ref 字符串。格式不对一律抛错——**不做猜测性修复**。 */
export function parseRef(input: string): ResourceRef {
  if (typeof input !== 'string' || input.length === 0) {
    throw new RefParseError(String(input), '空字符串');
  }

  const colon = input.indexOf(':');
  if (colon <= 0) {
    throw new RefParseError(
      input,
      '缺少 universe 前缀。裸 ID 在本框架里没有意义——mr 与 ex 的编号会撞',
    );
  }

  const universe = input.slice(0, colon);
  if (!isUniverse(universe)) {
    throw new RefParseError(input, `未知 universe ${JSON.stringify(universe)}`);
  }

  let rest = input.slice(colon + 1);

  let variant: string | undefined;
  const at = rest.lastIndexOf('@');
  if (at >= 0) {
    variant = rest.slice(at + 1);
    rest = rest.slice(0, at);
    if (!VARIANT_RE.test(variant)) {
      throw new RefParseError(input, `variant ${JSON.stringify(variant)} 格式非法`);
    }
  }

  const parts = rest.split('/');
  const kind = parts[0];
  if (kind === undefined || !isRefKind(kind)) {
    throw new RefParseError(input, `未知 kind ${JSON.stringify(kind ?? '')}`);
  }

  const segments = parts.slice(1);
  if (segments.length === 0) {
    throw new RefParseError(input, '缺少标识段');
  }
  for (const seg of segments) {
    if (!SEGMENT_RE.test(seg)) {
      throw new RefParseError(input, `标识段 ${JSON.stringify(seg)} 格式非法`);
    }
  }

  return variant === undefined
    ? { universe, kind, segments }
    : { universe, kind, segments, variant };
}

/** 宽松版：解析失败返回 null，用于处理不可信输入。 */
export function tryParseRef(input: string): ResourceRef | null {
  try {
    return parseRef(input);
  } catch {
    return null;
  }
}

export function formatRef(ref: ResourceRef): string {
  const base = `${ref.universe}:${ref.kind}/${ref.segments.join('/')}`;
  return ref.variant === undefined ? base : `${base}@${ref.variant}`;
}

/** 主标识（第一段）。 */
export function refId(ref: ResourceRef): string {
  const first = ref.segments[0];
  /* c8 ignore next */
  if (first === undefined) throw new Error('ResourceRef 没有标识段');
  return first;
}

/** 同一资源？variant 参与比较——中文剧情与日文剧情不是同一个资源。 */
export function refEquals(a: ResourceRef, b: ResourceRef): boolean {
  return formatRef(a) === formatRef(b);
}

/** 换 variant，其余不变。用于「同一篇剧情切语言」。 */
export function withVariant(ref: ResourceRef, variant: string | undefined): ResourceRef {
  if (variant !== undefined && !VARIANT_RE.test(variant)) {
    throw new RefParseError(formatRef(ref), `variant ${JSON.stringify(variant)} 格式非法`);
  }
  const { universe, kind, segments } = ref;
  return variant === undefined ? { universe, kind, segments } : { universe, kind, segments, variant };
}
