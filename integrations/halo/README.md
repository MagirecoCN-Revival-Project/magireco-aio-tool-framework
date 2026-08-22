# AIO 查看器 · Halo 插件

**这是一次可行性验证，不是成品。** 目的只有一个：回答「把 `packages/` 那套东西
装进 Halo，成不成立」。

装了两个能力：`chart.height`（身高对比）与 `search.query`（称呼检索）。

## 已经验过的三件事

| | 结论 |
|---|---|
| Halo 的 `ui/` 能不能吃我们指向 TS 源码的包 | ✅ 能。产物 23 KB，`parseRef` 的错误信息、两个插件的 manifest 都在里面 |
| `vue` 与 `@halo-dev/*` 会不会被重复打进来 | ✅ 不会，bundler kit 正确外部化 |
| Java + UI 能不能一起构建出可安装的 JAR | ✅ 能。`gradle build` 出 24 KB 的 `aio-viewer-0.1.0.jar` |

## 怎么构建

```bash
cd integrations/halo
gradle build -x test          # 产物在 build/libs/aio-viewer-0.1.0.jar
```

需要 Java 21。`ui/` 由 Gradle 经 `node-gradle` 调 pnpm，不用手动装。

装进 Halo：后台 → 插件 → 安装 → 选那个 jar。装好后左侧菜单「工具 → AIO 查看器」。

## 🚧 这一版**没有**的东西

说清楚边界，免得当成成品：

- **没接统一资源管线。** 数据内联在 `ui/src/station.ts`，走 `StaticProvider`。
  这是有意的——一次只验一件事。换 `ManifestCdnProvider` 时**插件与接线一行不用改**，
  那正是 `ResourceProvider` 这个接口存在的理由。
- **没有前台。** 只有控制台页面。前台要么做成编辑器区块（像 `plugin-thyuu-embed`），
  要么往主题注入，两条路都得先确认这一版能跑。
- **Java 侧是空的。** `AioViewerPlugin` 只有生命周期，没有自定义模型、
  没有 `/embed` 准入路由、没有下架拦截。**空实现比假实现诚实。**
- **只能在本仓库里构建。** `rsbuild.config.ts` 的 alias 指向 `../../../packages/*/src`，
  因为那些包还没发布。发布之后换成普通 dependency，那一段删掉。

## 数据是合成的

`PROFILES` 与 `CATALOG` 里没有一个字节来自真实素材（铁律 9），角色是编的。
其中特意留了两条「不好看但真实」的样本：

- 一条 `heightCm: null` —— 有些实体确实没登记身高。图上它进「没有数据」那行，
  **不是被画成 0**。
- 一条**没有 `ref`** 的目录项 —— 交叉表没登记它。检索搜得到，但点不开。
  这比「按名字凑一个 ref」诚实（铁律 2）。

## 值得记住的两处

**`SurfaceOutlet.vue` 是「换框架只需重写这一个」那句话的兑现。**
`apps/station/README.md` 早就写着换 Vue 时要重写的只有它——这版是 Vue 的，
React 那版是 ref 回调 + `replaceChildren`，**逻辑一模一样**，
而 `packages/` 一行没动。

**rsbuild 不需要 `extensionAlias`，webpack 需要。**
`apps/station` 在 Next 上必须显式配它，否则 51 个 `Can't resolve './xxx.js'`。
这里照抄过来之后类型检查报错，于是实测：加与不加，产物字节数与内容完全一致。
rspack 默认就做这件事。**别照抄 station 的打包配置。**
