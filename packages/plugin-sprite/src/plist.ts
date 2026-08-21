/**
 * Apple property list（XML 形式）里 plist **实际用到的那个子集**的读取。
 *
 * ## 为什么不用 DOMParser
 *
 * 铁律 8 说「平台有的不重造」，这里不是例外，是它的边界：`DOMParser` 是**浏览器**
 * 原语，node 上没有。而这个包的判据全在 node 上验（`vitest` 跑的就是 node），
 * 图集解析一旦只能在浏览器里跑，它就退回成「上线才知道对不对」的东西。
 *
 * 另一半理由是安全：通用 XML 解析器要处理 DTD、外部实体、实体展开。本读取器
 * **根本不读 DTD**——`<!DOCTYPE …>` 整段跳过，实体只认 XML 预定义的那五个加
 * 数字引用，其余一律抛。于是 XXE 与实体爆炸在这里不是「防住了」，是不存在。
 *
 * ## 它不是 XML 解析器
 *
 * 只认 `<plist> <dict> <key> <string> <integer> <real> <true/> <false/> <array>`。
 * 见到 `<data>` / `<date>` / 任何别的标签直接抛，**不跳过**——跳过一个不认识的
 * 标签意味着少读一批帧，而少读的帧在画面上表现为「某个部件不见了」，
 * 看起来像素材没加载，能查很久。
 */

export class PlistParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlistParseError';
  }
}

export type PlistValue =
  | string
  | number
  | boolean
  | readonly PlistValue[]
  | { readonly [key: string]: PlistValue };

interface Cursor {
  readonly text: string;
  i: number;
}

interface Tag {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
}

const NAME = /[A-Za-z_][A-Za-z0-9_.:-]*/y;
const WS = new Set([' ', '\t', '\r', '\n']);

/** 报错时带上出错位置附近的原文——只说「解析失败」等于让人从头找。 */
function at(c: Cursor, message: string): string {
  const line = c.text.slice(0, c.i).split('\n').length;
  const near = c.text.slice(c.i, c.i + 40).replace(/\s+/g, ' ');
  return `${message}（第 ${line} 行附近：${JSON.stringify(near)}）`;
}

function skipTrivia(c: Cursor): void {
  for (;;) {
    while (c.i < c.text.length && WS.has(c.text[c.i] as string)) c.i += 1;

    if (c.text.startsWith('<?', c.i)) {
      const end = c.text.indexOf('?>', c.i);
      if (end < 0) throw new PlistParseError(at(c, '<? … ?> 没有闭合'));
      c.i = end + 2;
      continue;
    }
    if (c.text.startsWith('<!--', c.i)) {
      const end = c.text.indexOf('-->', c.i);
      if (end < 0) throw new PlistParseError(at(c, '注释没有闭合'));
      c.i = end + 3;
      continue;
    }
    if (c.text.startsWith('<!', c.i)) {
      // DOCTYPE。**整段丢掉，一个字节都不解释**——内部子集里的 <!ENTITY>
      // 因此永远不会被登记，正文里的自定义实体随后会在 decodeEntities 里抛。
      let j = c.i + 2;
      for (; j < c.text.length; j += 1) {
        const ch = c.text[j];
        if (ch === '[') {
          const close = c.text.indexOf(']', j);
          if (close < 0) throw new PlistParseError(at(c, '<!DOCTYPE 的内部子集没有闭合'));
          j = close;
          continue;
        }
        if (ch === '>') break;
      }
      if (j >= c.text.length) throw new PlistParseError(at(c, '<!DOCTYPE 没有闭合'));
      c.i = j + 1;
      continue;
    }
    return;
  }
}

function readTag(c: Cursor): Tag {
  if (c.text[c.i] !== '<') throw new PlistParseError(at(c, '这里期望一个标签'));
  c.i += 1;

  let closing = false;
  if (c.text[c.i] === '/') {
    closing = true;
    c.i += 1;
  }

  NAME.lastIndex = c.i;
  const m = NAME.exec(c.text);
  if (m === null) throw new PlistParseError(at(c, '标签名不合法'));
  const name = m[0];
  c.i += name.length;

  // 属性只跳过不解释：plist 里唯一的属性是 <plist version="1.0">，与语义无关。
  // 引号内的 > 不能算标签结束，否则一个含 > 的属性值会把结构读错。
  let selfClosing = false;
  for (;;) {
    const ch = c.text[c.i];
    if (ch === undefined) throw new PlistParseError(at(c, `<${name} 没有闭合`));
    if (ch === '"' || ch === "'") {
      const end = c.text.indexOf(ch, c.i + 1);
      if (end < 0) throw new PlistParseError(at(c, '属性值的引号没有闭合'));
      c.i = end + 1;
      continue;
    }
    if (ch === '/' && c.text[c.i + 1] === '>') {
      selfClosing = true;
      c.i += 2;
      break;
    }
    if (ch === '>') {
      c.i += 1;
      break;
    }
    c.i += 1;
  }
  if (closing && selfClosing) throw new PlistParseError(at(c, `</${name}/> 不是合法标签`));
  return { name, closing, selfClosing };
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&(#[Xx]?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
        throw new PlistParseError(`非法的字符引用 ${whole}`);
      }
      return String.fromCodePoint(code);
    }
    const hit = ENTITIES[body];
    if (hit === undefined) {
      throw new PlistParseError(
        `未知实体 ${whole}——本读取器不读 DTD，自定义实体一律拒绝（见文件头）`,
      );
    }
    return hit;
  });
}

/** 读到下一个 `<` 为止的原文。标签内容里不会有裸的 `<`（那得写成 `&lt;`）。 */
function readText(c: Cursor): string {
  const start = c.i;
  const end = c.text.indexOf('<', c.i);
  if (end < 0) throw new PlistParseError(at(c, '文本之后没有结束标签'));
  c.i = end;
  return decodeEntities(c.text.slice(start, end));
}

function expectClose(c: Cursor, name: string): void {
  const tag = readTag(c);
  if (!tag.closing || tag.name !== name) {
    throw new PlistParseError(`期望 </${name}>，读到的是 <${tag.closing ? '/' : ''}${tag.name}>`);
  }
}

function parseValue(c: Cursor): PlistValue {
  skipTrivia(c);
  const tag = readTag(c);
  if (tag.closing) throw new PlistParseError(`这里期望一个值，读到的是 </${tag.name}>`);

  switch (tag.name) {
    case 'true':
    case 'false': {
      const value = tag.name === 'true';
      if (!tag.selfClosing) expectClose(c, tag.name);
      return value;
    }

    case 'string': {
      if (tag.selfClosing) return '';
      const raw = readText(c);
      expectClose(c, 'string');
      return raw;
    }

    case 'integer':
    case 'real': {
      if (tag.selfClosing) throw new PlistParseError(`<${tag.name}/> 里没有数字`);
      const raw = readText(c).trim();
      expectClose(c, tag.name);
      const value = Number(raw);
      // 空串 Number('') 是 0——那会把「缺一个数」变成「这里是 0」，不报错。
      if (raw === '' || !Number.isFinite(value)) {
        throw new PlistParseError(`<${tag.name}> 的内容不是数字：${JSON.stringify(raw)}`);
      }
      return value;
    }

    case 'array': {
      if (tag.selfClosing) return [];
      const out: PlistValue[] = [];
      for (;;) {
        skipTrivia(c);
        if (c.text.startsWith('</', c.i)) {
          expectClose(c, 'array');
          return out;
        }
        out.push(parseValue(c));
      }
    }

    case 'dict': {
      if (tag.selfClosing) return Object.create(null) as Record<string, PlistValue>;
      // 原型为 null：字典的 key 来自素材文件，里面出现 `__proto__` 时，
      // 普通对象上的赋值会**改原型而不是加字段**，于是那一帧凭空消失且不报错。
      const out = Object.create(null) as Record<string, PlistValue>;
      for (;;) {
        skipTrivia(c);
        if (c.text.startsWith('</', c.i)) {
          expectClose(c, 'dict');
          return out;
        }
        const keyTag = readTag(c);
        if (keyTag.closing || keyTag.name !== 'key') {
          throw new PlistParseError(`<dict> 里期望 <key>，读到的是 <${keyTag.name}>`);
        }
        let key = '';
        if (!keyTag.selfClosing) {
          key = readText(c);
          expectClose(c, 'key');
        }
        if (Object.hasOwn(out, key)) {
          // 重名 key 会让「按名字取帧」变成看运气取到哪一个。
          throw new PlistParseError(`<dict> 里 key 重复：${JSON.stringify(key)}`);
        }
        out[key] = parseValue(c);
      }
    }

    default:
      throw new PlistParseError(
        `不支持的 plist 标签 <${tag.name}>——本读取器只认 dict/key/string/integer/real/true/false/array`,
      );
  }
}

/** 解析一份 XML plist。结构不对一律抛，**没有宽松模式**。 */
export function parsePlist(text: string): PlistValue {
  const c: Cursor = { text, i: 0 };
  skipTrivia(c);

  const root = readTag(c);
  if (root.closing || root.name !== 'plist') {
    throw new PlistParseError(`根标签是 <${root.name}>，不是 <plist>`);
  }
  if (root.selfClosing) throw new PlistParseError('<plist/> 里没有内容');

  const value = parseValue(c);

  skipTrivia(c);
  expectClose(c, 'plist');
  return value;
}

/* ── 取值助手。类型不对就抛，不做「大概是这个意思」的转换。 ───────────── */

export function plistDict(value: PlistValue | undefined, what: string): Record<string, PlistValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PlistParseError(`${what} 不是 <dict>`);
  }
  return value as Record<string, PlistValue>;
}

export function plistString(value: PlistValue | undefined, what: string): string {
  if (typeof value !== 'string') throw new PlistParseError(`${what} 不是 <string>`);
  return value;
}

export function plistNumber(value: PlistValue | undefined, what: string): number {
  if (typeof value !== 'number') throw new PlistParseError(`${what} 不是数字`);
  return value;
}

/**
 * 布尔值。**缺省是 false，但类型不对要抛**——把 `<string>true</string>`
 * 当成 true 的宽容会让一份写坏的图集正好在「旋转」这件事上静默出错。
 */
export function plistBool(value: PlistValue | undefined, what: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new PlistParseError(`${what} 不是 <true/> 或 <false/>`);
  return value;
}
