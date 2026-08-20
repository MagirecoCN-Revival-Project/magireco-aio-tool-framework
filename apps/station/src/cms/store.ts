import type { RegistryData } from '@aio/registry';

/**
 * CMS 的数据面抽象。
 *
 * 现有架构全是**只读查看器**，而 CMS 要写。EdgeOne Pages 是静态托管，写不了——
 * 真正的持久化要靠边缘函数 + KV，那是架构文档里的 Phase 5。
 *
 * 所以这里先把**接口**钉死、把实现留成可替换的：现在是内存实现（刷新即失忆，
 * 够骨架用），Phase 5 换成边缘函数实现时，上层一行都不用改。
 * 这与铁律 3 是同一个手法——调用方只说要什么，不知道东西从哪来。
 *
 * 四类内容对应你定的 CMS 范围：
 *
 *   1. 交叉表与资源清单   `registry` / `manifestStatus`
 *   2. 站点内容页         `pages`
 *   3. 插件与能力开关     不在这里——那是运行时状态，归 `Station`
 *   4. 用户与权限         `roles`
 */

export interface ContentPage {
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  readonly updated: string;
  /** 草稿不出现在公开面。 */
  readonly draft: boolean;
}

export type Role = 'maintainer' | 'editor' | 'viewer';

export interface Member {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
}

export interface ManifestStatus {
  readonly universe: string;
  readonly kind: string;
  readonly entries: number;
  /** 下架 = 从清单里去掉条目。这里记的是「本地已标记待下架」。 */
  readonly pendingTakedown: readonly string[];
}

export interface CmsStore {
  listPages(): Promise<readonly ContentPage[]>;
  savePage(page: ContentPage): Promise<void>;
  listMembers(): Promise<readonly Member[]>;
  setRole(id: string, role: Role): Promise<void>;
  /** 交叉表当前快照。Phase 4 会换成人工核对过的全量数据。 */
  registry(): Promise<RegistryData>;
  manifestStatus(): Promise<readonly ManifestStatus[]>;
}

/**
 * 内存实现。**刷新即失忆**——这不是缺陷，是骨架期的诚实状态：
 * 没有后端就不该假装有持久化，否则维护者会以为改动保存住了。
 */
export class LocalCmsStore implements CmsStore {
  #pages: readonly ContentPage[];
  #members: readonly Member[];
  readonly #registry: RegistryData;
  readonly #manifests: readonly ManifestStatus[];

  constructor(seed: {
    pages: readonly ContentPage[];
    members: readonly Member[];
    registry: RegistryData;
    manifests: readonly ManifestStatus[];
  }) {
    this.#pages = seed.pages;
    this.#members = seed.members;
    this.#registry = seed.registry;
    this.#manifests = seed.manifests;
  }

  async listPages(): Promise<readonly ContentPage[]> {
    return this.#pages;
  }

  async savePage(page: ContentPage): Promise<void> {
    const rest = this.#pages.filter((p) => p.slug !== page.slug);
    this.#pages = [...rest, page];
  }

  async listMembers(): Promise<readonly Member[]> {
    return this.#members;
  }

  async setRole(id: string, role: Role): Promise<void> {
    this.#members = this.#members.map((m) => (m.id === id ? { ...m, role } : m));
  }

  async registry(): Promise<RegistryData> {
    return this.#registry;
  }

  async manifestStatus(): Promise<readonly ManifestStatus[]> {
    return this.#manifests;
  }
}
