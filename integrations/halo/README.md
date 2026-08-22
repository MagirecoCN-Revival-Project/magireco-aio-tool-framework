# AIO 查看器 · Halo 插件

**这是一次可行性验证，不是成品。** 目的只有一个：回答「把 `packages/` 那套东西
装进 Halo，成不成立」。

装了两个能力：`chart.height`（身高对比）与 `search.query`（称呼检索）。

## 两个面，一套组件

| | 前台（主） | 控制台 |
|---|---|---|
| 地址 | `/aio` | 后台 → 工具 → AIO 查看器 |
| 谁挂它 | 我们自己的 `ViewerRouter` + Thymeleaf 模板 | Halo 控制台按 `ui-plugin.json` |
| bundle | `web/` → jar 里的 `web/` | `ui/` → jar 里的 `ui/` |
| vue | **打进来**（前台不保证有 Vue） | **外部化**（控制台已经有了） |

页面组件在 `shared/`，两边共用同一份——**页面本身不知道自己在哪**，
它只跟内核打交道。两个 bundle 的差别只在「谁把它挂起来」，各自的入口不到 20 行。

### 前台路由

`ViewerRouter` 出三条：

```
GET /aio                  → 渲染页面
GET /aio/assets/viewer.js → 前台 bundle
GET /aio/assets/viewer.css
```

**静态资源为什么自己吐**：Halo 对外暴露插件静态文件是有一套路径约定的，
但那是**平台行为**——而本项目在「假设平台行为」上连栽三次（EdgeOne 的静态优先、
规则引擎不是快路、配额算不过账）。从 classpath 读出来返回，多写十几行 Java，
换掉一个假设。

**模板怎么找**：`resolveTemplateNameOrDefault` 的语义是「主题里有 `aio-viewer`
就用主题的，没有就用 classpath 里那份」。所以主题愿意接管样式就自己写一个，
什么都不做也照常能开。这比 `plugin-links` 那种「硬要求主题提供模板」宽容。

## 已经验过的事

| | 结论 |
|---|---|
| Halo 的 `ui/` 能不能吃我们指向 TS 源码的包 | ✅ 能。产物 23 KB，`parseRef` 的错误信息、两个插件的 manifest 都在里面 |
| `vue` 与 `@halo-dev/*` 会不会被重复打进来 | ✅ 控制台那份不会，bundler kit 正确外部化。前台那份**会**，见下面「两个 Vue」 |
| Java + UI 能不能一起构建出可安装的 JAR | ✅ 能。`gradle build` 出 71 KB 的 `aio-viewer-0.1.0.jar` |
| 前台页面在浏览器里真的能用 | ✅ 实测：柱状图画出来、检索出结果、拔掉插件后按钮消失 |

最后一条是**在真浏览器里点出来的**，不是看构建成功就算。理由见下。

## 怎么构建

```bash
cd integrations/halo
gradle build -x test          # 产物在 build/libs/aio-viewer-0.1.0.jar
```

需要 Java 21。`ui/` 与 `web/` 由 Gradle 经 `node-gradle` 调 pnpm，不用手动装。

装进 Halo：后台 → 插件 → 安装 → 选那个 jar。装好后开 `/aio`。

## 🚧 这一版**没有**的东西

说清楚边界，免得当成成品：

- **没接统一资源管线。** 数据内联在 `shared/station.ts`，走 `StaticProvider`。
  这是有意的——一次只验一件事。换 `ManifestCdnProvider` 时**插件与接线一行不用改**，
  那正是 `ResourceProvider` 这个接口存在的理由。
- **路径写死 `/aio`，没有设置项。** 能配之前先确认能跑。
- **Java 侧几乎是空的。** 除了 `ViewerRouter`，没有自定义模型、没有 `/embed`
  准入路由、没有下架拦截。**空实现比假实现诚实。**
- **只能在本仓库里构建。** 两份 `rsbuild.config.ts` 的 alias 都指向
  `../../../packages/*/src`，因为那些包还没发布。发布之后换成普通 dependency，
  那一段删掉。

## 数据是合成的

`PROFILES` 与 `CATALOG` 里没有一个字节来自真实素材（铁律 9），角色是编的。
其中特意留了两条「不好看但真实」的样本：

- 一条 `heightCm: null` —— 有些实体确实没登记身高。图上它进「没有数据」那行，
  **不是被画成 0**。
- 一条**没有 `ref`** 的目录项 —— 交叉表没登记它。检索搜得到，但点不开。
  这比「按名字凑一个 ref」诚实（铁律 2）。

## 值得记住的几处

**`SurfaceOutlet.vue` 是「换框架只需重写这一个」那句话的兑现。**
`apps/station/README.md` 早就写着换 Vue 时要重写的只有它——这版是 Vue 的，
React 那版是 ref 回调 + `replaceChildren`，**逻辑一模一样**，
而 `packages/` 一行没动。

**rsbuild 不需要 `extensionAlias`，webpack 需要。**
`apps/station` 在 Next 上必须显式配它，否则 51 个 `Can't resolve './xxx.js'`。
这里照抄过来之后类型检查报错，于是实测：加与不加，产物字节数与内容完全一致。
rspack 默认就做这件事。**别照抄 station 的打包配置。**

### 🔴 两个 Vue：构建全绿，页面一个按钮都不响应

前台 bundle 第一版把 **两份 vue** 打了进来：`shared/` 没有自己的 `node_modules`，
它里面的 `import { ref } from 'vue'` 沿目录树往上找落到**仓库根**那份，
而 `web/src/main.ts` 就地找到 `web/node_modules/vue`。两份都是 3.5.41。

后果不是报错：

- 构建成功，类型检查通过，产物正常；
- 页面**首屏渲染完全正确**；
- 之后**任何交互都没有反应**——按钮点了什么都不发生；
- **控制台一行错误都没有。**

因为 `createApp` 来自 A 份、组件里的 `ref`/`computed` 来自 B 份，B 份记录依赖时
看的是 B 的 activeSub（永远是空），于是什么都没被追踪。查出来靠的是在浏览器里
打点：`className=aio-surface-body` 与四次 profile fetch 都发生了——**内核完全正常，
只是 Vue 不知道该重画**。

修法是 `web/rsbuild.config.ts` 里的 `resolve.dedupe: ['vue']`。
控制台那份不受影响，它把 vue 外部化，运行时只有 Halo 的那一份。

判据是通用的，而且这已经是同一种形状第二次出现（上一次是 `@aio/resource` 里
`this.#fetch(url)` 的 receiver，471 个 node 测试全绿、浏览器里 `Illegal invocation`）：

> **构建成功不等于能用。凡是最终跑在浏览器里的东西，就得在浏览器里点一遍。**
