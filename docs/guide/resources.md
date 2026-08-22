# 资源面：ref 与 provider

判据：**网站源码里 grep 不到任何资源路径。**

插件只说「给我这条 ref 的 `texture`」，剩下的（清单查表、按权重选路、失败冷却、
sha256 校验、下架降级）全在 `@aio/resource` 里。换 CDN、加备份源、
下架某批素材，都不需要动插件。

## ref 语法

```
a:sprite/100100/d_r@zh
│  │      │        │  └ variant（可选，语言等正交维度）
│  │      │        └ 变体段
│  │      └ 主标识
│  └ kind
└ universe
```

| 位 | 取值 |
|---|---|
| universe | `a`（命名空间 a）、`b`（示例作品 B） |
| kind | `character` `sprite` `live2d` `model3d` `voice` `scenario` `card` `item` `bgm` `image` |

```ts
import { parseRef, formatRef, tryParseRef, refEquals, withVariant } from '@aio/core';

parseRef('a:sprite/100100/d_r');    // { universe: 'a', kind: 'sprite', segments: ['100100','d_r'] }
parseRef('100101');                  // ❌ 抛 RefParseError
tryParseRef('100101');               // null（不想接 try 的时候用这个）
```

::: danger 裸 ID 一律拒绝，没有宽松模式
实测：命名空间 b 的 `100101` 是角色乙，命名空间 a的 `100100` 是角色甲
——**同号不同人**。裸数字在系统里流动，迟早把一个角色的档案配上另一个角色的
模型，而且**不报错**，只是显示了错的人。
:::

## `ResourceProvider`

只有三个方法，插件与内核都只认这个接口：

```ts
interface ResourceProvider {
  /** 有没有这条资源。**必须同步**——UI 在渲染路径上用它决定按钮画不画 */
  has(ref: ResourceRef): boolean;
  /** 解析成若干 part，每个 part 带按选路顺序排好的候选。查不到抛 ResourceUnavailableError */
  resolve(ref: ResourceRef): ResolvedResource;
  /** 取一份 part 的字节，逐候选回退。校验不过的字节一律不接受 */
  fetchPart(ref: ResourceRef, role: string): Promise<ArrayBuffer>;
}
```

`resolve()` 查不到时**抛**而不是返回空——下架走的就是这条路，
调用方应当降级提示而不是白屏。

### 两个实现

::: code-group

```ts [ManifestCdnProvider]
import { ManifestCdnProvider, Manifest, OriginPool } from '@aio/resource';

const provider = new ManifestCdnProvider({
  manifests: [Manifest.from(spriteManifestJson)],
  origins: new OriginPool({
    origins: [
      { base: 'https://assets.example.com/', weight: 10, name: '主源' },
      { base: 'https://backup.example.com/', weight: 1, name: '备源' },
    ],
  }),
});
```

```ts [StaticProvider]
import { StaticProvider } from '@aio/resource';

// 离线包、本地目录、测试造数据都走这个
const provider = new StaticProvider({
  entries: {
    'a:sprite/100100/d_r': [
      { role: 'definition', path: '100100/d_r.ExportJson', url: 'https://…/d_r.ExportJson' },
    ],
  },
});
```

:::

**换 provider，插件与宿主零改动**——这不是口号：`packages/resource/test/` 里那套
一致性套件不 import 任何实现，两个实现装进去都必须全绿（9 条判据 × 2）。

选路语义照抄兄弟仓库客户端里的多镜像实现——那套被真实网络环境验证过：
按权重挑，失败进冷却，冷却期内不再选它。

## 清单长什么样

```json
{
  "version": 1,
  "universe": "a",
  "kind": "sprite",
  "generated": "2026-08-21",
  "entries": {
    "a:sprite/100100/d_r": {
      "parts": [
        { "path": "sprite/100100/d_r.ExportJson", "role": "definition",
          "bytes": 48213, "sha256": "…" },
        { "path": "sprite/100100/d_r.plist", "role": "atlas", "bytes": 9120, "sha256": "…" },
        { "path": "sprite/100100/d_r.png", "role": "texture", "bytes": 512044, "sha256": "…" }
      ]
    }
  }
}
```

一条 ref 可能对应多个文件，所以产物是 `parts`，每份有自己的 **role**——
插件按 role 索取（`fetchPart(ref, 'texture')`），不按下标也不按路径。

路径必须是相对的：`..`、绝对路径、`://` 一律拒收，路径不得逃出 base。

### 生成清单

```bash
python3 tools/build-manifest.py ASSETS_DIR \
  --universe a --kind sprite \
  --pattern '(?P<id>\d+)/(?P<variant>[a-z_]+)\.' \
  --ref '{id}/{variant}' \
  --prefix 'sprite/' \
  --out manifest.mr.sprite.json
```

::: warning 这个工具不猜 ref
从路径推 ref 是**必须由人给规则**的事：`--pattern` 是带命名组的正则，
`--ref` 是模板。**匹配不上的文件一律报出来并让整次生成失败**，
不悄悄跳过——悄悄跳过的后果是清单看着生成成功，线上却少了一批资源，
而且没人知道少了哪些。

同理，认不出扩展名不给它编一个 role；同一条 ref 下 role 撞了直接失败
（后写的会盖掉前一个且不报错，线上表现为「显示了另一个东西」）。
一个目录就是一种 role 时用 `--role profile` 强制指定。
:::

清单只含**路径与校验和**，不含任何素材字节，所以它入库是安全的。

## 交叉表（`@aio/registry`）

角色 ↔ 精灵 / Live2D / 3D / 语音的关联关系。它是**数据，不是公式**：

```ts
import { Registry } from '@aio/registry';

const registry = Registry.from(data);
registry.linksOf(charaRef, 'sprite');    // 这个角色有哪些精灵
registry.ownerOf(spriteRef);             // 反查主人
registry.primaryLink(charaRef, 'live2d');// 第一条，查不到返回 null
registry.displayName(charaRef, 'zh');
```

::: danger 查不到就返回空，绝不按编号规律猜
看着有规律（charaId + 服装号 = 精灵 unit），但 wiki 给 `1001` 登记的服装是
`03/04/50/53`，镜像里实际存在的是 `00/01/09`——规律不成立。
加一个「猜一个」的回退，等于把 ref 前缀那道防线也拆掉。
:::

跨作品关联（`a:` 的角色链到 `b:` 的模型）在装载时就被拒绝。

## 🔴 素材不进这棵树

本仓库以 GPLv3 公开分发，而立绘、语音、BGM、模型、剧情文本的版权在
各自的版权方手里。一个版权文件进了这棵树，后果不是「多了个大文件」：

- 它让整份 GPLv3 分发变成一个**我们无权做出的授权声明**；
- **git 历史不可逆**——删掉它只让当前 HEAD 干净，历史里那份仍在被分发；
- 下架请求来时，我们能下架的只有资源面，下不了别人手上的克隆。

所以判据是**一个都不能进**，由 `tools/check-assets.py` 与 `pre-push` 钩子保护。
详见[守卫与铁律](/guide/guards)。
