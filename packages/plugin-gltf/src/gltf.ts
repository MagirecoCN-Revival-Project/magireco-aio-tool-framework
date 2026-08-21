/**
 * glTF 2.0 的解析。
 *
 * **与渲染无关，也与上游无关**：这里只把 glTF JSON 变成一份归一化清单
 * （有哪些动画、场景里有哪些节点、还要去取哪些外部文件）。真正把它画出来
 * 是舞台的事（`session.ts` 的 `Stage`）。
 *
 * ## 为什么是 glTF 而不是 FBX
 *
 * `model3d.show` 此前唯一的真实现是 `@aio/plugin-model-3d`——它包的是上游
 * `example-model-viewer`，而那个子包目前装不上（见 ACTIVE.md 阻塞项），于是这个能力
 * 一直是五个里唯一没有自有实现的。
 *
 * 选 glTF 的理由是它是**公开标准**：规范可读、结构是 JSON、外部依赖在
 * `buffers[].uri` 与 `images[].uri` 里明写。FBX 是私有二进制格式，
 * 从零写解析器既昂贵又要靠逆向——那正是这条路线要避免的。
 */

export class GltfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GltfParseError';
  }
}

export interface GltfAnimation {
  /** 规范里 `name` 是**可选**的，所以可能为 null——那时只能按下标指。 */
  readonly name: string | null;
  readonly index: number;
  readonly channels: number;
}

/** 一份要另外去取的外部文件。 */
export interface GltfExternal {
  readonly kind: 'buffer' | 'image';
  readonly index: number;
  /** 相对 glTF 文件的 URI。**内嵌的 `data:` 不出现在这里**。 */
  readonly uri: string;
}

export interface GltfDoc {
  readonly version: string;
  /** 默认场景下标；文件没指定时为 null——**不替它挑一个**。 */
  readonly scene: number | null;
  readonly nodeCount: number;
  readonly meshCount: number;
  readonly animations: readonly GltfAnimation[];
  /**
   * 需要另外去取的文件。内嵌 `data:` URI 已被排除——把它当外部资源送进
   * 资源层，会得到一次必然失败的取用，而失败原因看起来像「资源缺失」。
   */
  readonly externals: readonly GltfExternal[];
  /** 有多少份资源是内嵌的。用来解释「为什么 externals 比 buffers 少」。 */
  readonly embedded: number;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GltfParseError(`${what} 不是对象`);
  }
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown, what: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new GltfParseError(`${what} 不是数组`);
  return value;
}

const isDataUri = (uri: string): boolean => uri.trimStart().toLowerCase().startsWith('data:');

/**
 * 解析 glTF JSON。
 *
 * **只吃 JSON 形态（`.gltf`），不吃 GLB。** GLB 是二进制容器，前 12 字节是
 * `glTF` 魔数 + 版本 + 长度；把它当 JSON 喂进来会在 `JSON.parse` 处抛一个
 * 看不出所以然的语法错。这里提前认出来并说清楚。
 */
export function parseGltf(input: unknown): GltfDoc {
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    throw new GltfParseError('看起来是 GLB（二进制容器）——本实现只解析 .gltf 的 JSON 形态');
  }

  const root = asRecord(input, 'glTF');
  const asset = asRecord(root['asset'], 'asset');
  const version = asset['version'];
  if (typeof version !== 'string') {
    throw new GltfParseError('asset.version 缺失——这不是一份合法的 glTF');
  }
  if (!version.startsWith('2.')) {
    // glTF 1.0 与 2.0 结构不兼容（材质、着色器、动画采样全变了）。
    // 按 2.0 去读一份 1.0，读出来的是错的东西而不是报错。
    throw new GltfParseError(`只支持 glTF 2.x，这份是 ${version}`);
  }

  const nodes = arrayOf(root['nodes'], 'nodes');
  const meshes = arrayOf(root['meshes'], 'meshes');

  const sceneRaw = root['scene'];
  const scene =
    typeof sceneRaw === 'number' && Number.isInteger(sceneRaw) && sceneRaw >= 0
      ? sceneRaw
      : null;

  const animations: GltfAnimation[] = [];
  for (const [index, a] of arrayOf(root['animations'], 'animations').entries()) {
    const anim = asRecord(a, `animations[${index}]`);
    const nameRaw = anim['name'];
    const channels = arrayOf(anim['channels'], `animations[${index}].channels`);
    if (channels.length === 0) {
      // 没有通道的动画播了等于没播——留着它只会让 UI 里多一个点不动的条目。
      throw new GltfParseError(`animations[${index}] 没有 channels`);
    }
    animations.push({
      name: typeof nameRaw === 'string' && nameRaw.trim() !== '' ? nameRaw : null,
      index,
      channels: channels.length,
    });
  }

  const externals: GltfExternal[] = [];
  let embedded = 0;
  const collect = (kind: 'buffer' | 'image', list: unknown[], what: string): void => {
    for (const [index, item] of list.entries()) {
      const uriRaw = asRecord(item, `${what}[${index}]`)['uri'];
      if (typeof uriRaw !== 'string' || uriRaw.trim() === '') continue; // GLB 内嵌或无 uri
      if (isDataUri(uriRaw)) {
        embedded += 1;
        continue;
      }
      externals.push({ kind, index, uri: uriRaw });
    }
  };
  collect('buffer', arrayOf(root['buffers'], 'buffers'), 'buffers');
  collect('image', arrayOf(root['images'], 'images'), 'images');

  return {
    version,
    scene,
    nodeCount: nodes.length,
    meshCount: meshes.length,
    animations,
    externals,
    embedded,
  };
}

/**
 * 按名字取动画。**查不到返回 null，绝不退回第一条**——退回的话，
 * 点「走路」会播「待机」，看着能用其实是别的动作。
 *
 * 规范允许动画没有 `name`，所以这里也接受 `#0` 这种按下标指的写法：
 * 无名动画总得有个指得着的办法，但那是**显式**的下标，不是猜的名字。
 */
export function animationOf(doc: GltfDoc, name: string): GltfAnimation | null {
  const byName = doc.animations.find((a) => a.name === name);
  if (byName !== undefined) return byName;

  if (name.startsWith('#')) {
    const i = Number(name.slice(1));
    if (Number.isInteger(i)) return doc.animations.find((a) => a.index === i) ?? null;
  }
  return null;
}

/** 可选动画的显示名清单。无名的给出 `#下标`。 */
export function animationNames(doc: GltfDoc): readonly string[] {
  return doc.animations.map((a) => a.name ?? `#${a.index}`);
}
