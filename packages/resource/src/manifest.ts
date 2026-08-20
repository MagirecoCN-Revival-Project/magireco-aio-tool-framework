import { formatRef, type RefKind, type ResourceRef, type Universe } from '@aio/core';

/**
 * 资源清单（Manifest）。
 *
 * 这是「把 assets 从网站里分离出去」落到实处的那一层：网站里**不出现任何
 * 资源路径**，只出现 ref。ref → 相对路径的映射住在 manifest 里，manifest
 * 与资源一起放在对象存储上，可以独立于任何一次网站发版而更新。
 *
 * 一条 ref 可能对应多个文件（一组精灵是 ExportJson + plist + png），
 * 所以 entry 的产物是 `parts`，每个 part 有自己的角色名。
 */
export interface ManifestPart {
  /** 相对 base 的路径。 */
  readonly path: string;
  /** 这一份在这条资源里扮演什么，如 `definition` / `atlas` / `texture`。 */
  readonly role: string;
  readonly bytes?: number;
  readonly sha256?: string;
  /** 预压缩产物：`gzip` 表示服务端会带 Content-Encoding。 */
  readonly encoding?: 'gzip';
}

export interface ManifestEntry {
  readonly parts: readonly ManifestPart[];
}

export interface ManifestDoc {
  readonly version: number;
  readonly universe: Universe;
  readonly kind: RefKind;
  readonly generated?: string;
  /** ref 字符串 → 条目。key 必须与 universe/kind 相符。 */
  readonly entries: Readonly<Record<string, ManifestEntry>>;
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

/** 路径不得逃出 base：`..` 与绝对路径都拒收。 */
export function assertSafePath(path: string): void {
  if (path.length === 0) throw new ManifestError('清单里有空路径');
  if (path.startsWith('/') || path.includes('://')) {
    throw new ManifestError(`清单路径 ${JSON.stringify(path)} 必须是相对路径`);
  }
  for (const seg of path.split('/')) {
    if (seg === '..' || seg === '.' || seg === '') {
      throw new ManifestError(`清单路径 ${JSON.stringify(path)} 含非法路径段`);
    }
  }
}

export class Manifest {
  readonly universe: Universe;
  readonly kind: RefKind;
  readonly #entries: ReadonlyMap<string, ManifestEntry>;

  private constructor(doc: ManifestDoc) {
    this.universe = doc.universe;
    this.kind = doc.kind;
    const map = new Map<string, ManifestEntry>();
    for (const [key, entry] of Object.entries(doc.entries)) {
      if (!key.startsWith(`${doc.universe}:${doc.kind}/`)) {
        throw new ManifestError(
          `清单声明为 ${doc.universe}:${doc.kind}，却包含条目 ${key}`,
        );
      }
      if (entry.parts.length === 0) {
        throw new ManifestError(`${key} 没有任何 part`);
      }
      const roles = new Set<string>();
      for (const part of entry.parts) {
        assertSafePath(part.path);
        if (roles.has(part.role)) {
          throw new ManifestError(`${key} 里 role ${JSON.stringify(part.role)} 重复`);
        }
        roles.add(part.role);
      }
      map.set(key, entry);
    }
    this.#entries = map;
  }

  static from(doc: ManifestDoc): Manifest {
    if (doc.version !== 1) throw new ManifestError(`不支持的清单版本 ${doc.version}`);
    return new Manifest(doc);
  }

  get size(): number {
    return this.#entries.size;
  }

  /**
   * 查条目。**variant 先精确匹配，再退回无 variant 的通用条目**——
   * 精灵这类资源与语言无关，剧情则不然，两者用同一套查表逻辑。
   */
  lookup(ref: ResourceRef): ManifestEntry | null {
    const exact = this.#entries.get(formatRef(ref));
    if (exact !== undefined) return exact;
    if (ref.variant === undefined) return null;
    const { universe, kind, segments } = ref;
    return this.#entries.get(formatRef({ universe, kind, segments })) ?? null;
  }

  has(ref: ResourceRef): boolean {
    return this.lookup(ref) !== null;
  }

  keys(): readonly string[] {
    return [...this.#entries.keys()];
  }
}
