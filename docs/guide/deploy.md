# 部署与域名

这个仓库有**两个**可交付的静态产物，它们互不相干：

| 产物 | 是什么 | 构建 | 输出 |
|---|---|---|---|
| **文档站**（就是本站） | VitePress，纯文档 | `npm run docs:build` | `docs/.vitepress/dist/` |
| **工作站** `apps/station` | 带插件的 CMS 宿主 | `npm run -w @aio/station build` | `apps/station/out/` |

文档站的域名是 **`docs.example.com`**。工作站的域名另定（还在
[路线图](/AIO-ROADMAP)的先决条件里）。

## 文档站

### 本地

```bash
npm run docs:dev       # http://localhost:5173
npm run docs:build
npm run docs:preview   # 预览构建产物，**不要**去双击 dist/index.html
```

::: warning 别双击 `dist/index.html`
产物里的资源引用是绝对路径（`/assets/…`），因为站点跑在自定义域名的根上。
用 `file://` 打开时浏览器会把 `/assets/…` 解析到**文件系统根目录**，
于是 CSS 与 JS 全部 404，页面看起来像坏了。要看构建结果就用 `npm run docs:preview`。
:::

### GitHub Pages（当前接线）

`.github/workflows/docs.yml` 在 push 到 `main` 时构建并发布。
`docs/public/CNAME` 里写着 `docs.example.com`，Pages 据此绑定自定义域名。

::: danger 上线前要人工做两件事，都自动不了
**一、开 Pages。** 仓库 Settings → Pages → Source 选 **GitHub Actions**。

workflow 里带了 `enablement: true`，但 2026-08-21 实测在本组织下**不管用**：

```
不带 enablement    → Get Pages site failed … Not Found
带 enablement:true → Create Pages site failed … Resource not accessible by integration
```

`GITHUB_TOKEN` 无权创建 Pages 站点。那一条留着是因为站点开好之后它是空操作，
在权限更宽的 fork 里还能省掉这一步。

**二、配 DNS。**
:::

::: warning DNS 那条记录
在 `example.com` 的 DNS 上加一条：

```
framework   CNAME   magirecocn-revival-project.github.io.
```

然后在仓库 Settings → Pages 里确认自定义域名已识别、并勾上 Enforce HTTPS。
证书签发要等几分钟。
:::

::: info 这是「发布类 workflow 一律手动」的一个有意的例外
本仓库沿用兄弟仓库的分工：检查类 workflow 允许 push 触发，发布类一律手动。
文档站在这里被判为例外，理由有两条：

- **落后的文档比没有文档更糟**——它会让人按一份不成立的描述去改代码；
- 与 APK 发版不同，文档发布是**幂等且可逆**的：没有版本号，没有用户在安装
  什么东西，推错了改回来再推一次即可。

不接受这个判断的话，把 `docs.yml` 的 `on.push` 去掉就变回纯手动。
:::

### EdgeOne Pages

::: danger 不要选任何框架预设
预设会自作主张：**Next 预设在仓库根跑 `next build`**，而这里是 npm workspaces
的 monorepo——根 `package.json` 里压根没有 `build` 脚本，`next` 也不装在根上，
所以它必然失败。构建一失败，EdgeOne 没有产物可发，整站就是 404。

两个产物都选 **无预设 / 静态站点**，把命令和输出目录明确填进去。
:::

项目根目录都填**仓库根**（`/`），因为依赖要靠 npm workspaces 一起装。

**文档站（就是本站，VitePress）**

| 字段 | 值 |
|---|---|
| 框架预设 | 无 / 静态站点 |
| 根目录 | `/` |
| 安装命令 | `npm install` |
| 构建命令 | `npm run docs:build` |
| 输出目录 | `docs/.vitepress/dist` |

**工作站（`apps/station`，Next 静态导出）**

| 字段 | 值 |
|---|---|
| 框架预设 | 无 / 静态站点（**不是 Next**） |
| 根目录 | `/` |
| 安装命令 | `npm install` |
| 构建命令 | `npm run build -w @aio/station` |
| 输出目录 | `apps/station/out` |

它虽然是 Next，但走的是 `output: 'export'`——产物是纯静态的 `out/`，
不是 `.next/`；而且构建必须带 `--webpack`（见上）。Next 预设两条都不满足。

::: warning Node 必须是 22
`package.json` 的 `engines` 写着 `>=22`。仓库里放了 `.node-version`（内容就是 `22`），
EdgeOne 会读它；读不到就在环境变量里加 `NODE_VERSION=22`。
用更低的版本，`npm install` 或构建会在半路上失败，而失败之后整站 404
——跟编码没关系，是压根没有产物。
:::

域名在控制台绑。`docs/public/CNAME` 是给 GitHub Pages 用的，对 EdgeOne 无效
但也无害（产物里多一个纯文本文件而已）。

::: tip 如果页面出来了但中文是乱码
那是**响应头**的问题，不是文档的问题：本站每一页都带 `<meta charset="utf-8">`，
而 **HTTP 头里的 charset 会覆盖文档内的所有声明**。去控制台的规则引擎
（或 `edgeone.json`）把 HTML 的响应头钉成 `Content-Type: text/html; charset=utf-8`。
:::

::: warning 国内加速需要备案
`example.com` 若要走 EdgeOne 的国内节点，域名需完成 ICP 备案。
另外 Cloudflare 托管的**根域名**不支持绑定，用子域——`framework.` 正是子域，
这条不构成阻碍。
:::

## 工作站 `apps/station`

```bash
npm run -w @aio/station build     # → apps/station/out/
```

`output: 'export'` 静态导出，交付到 EdgeOne Pages 单项目。

::: tip 两条命令都带 `--webpack`
Next 16 起 Turbopack 是缺省打包器，而 `packages/` 里的相对 import 带 `.js` 后缀
（TS 写 ESM 的正确写法），Turbopack 目前没有 webpack `extensionAlias` 的对应物
——2026-08-21 实测拿掉之后 51 个 `Can't resolve './xxx.js'` 全部复现。
等 Turbopack 能表达这条解析规则再迁。
:::

### 静态导出与 KV 的矛盾

静态页**读不到 KV**，而站点配置（插件开关、SEO、下架清单）住在 KV 里。
后台改了开关，静态页不会知道。当前建议：

- 内容页保持静态（爬虫要的就是它，而且最快）；
- 动态行为（开关、下架判定、鉴权）走 EdgeOne Functions；
- 下架靠规则引擎 + purge 兜住缓存副本，**不等重建**（铁律 11）。

完整讨论见 [`CMS-ON-EDGEONE.md`](/CMS-ON-EDGEONE)。

## 资源面

素材不在这两个产物里，它们在 COS + EdgeOne CDN 上，前端经清单按 ref 取。

清单可以**离线生成、离线校验**，不需要桶权限：

```bash
python3 tools/build-manifest.py ASSETS_DIR \
  --universe a --kind sprite \
  --pattern '(?P<id>\d+)/(?P<variant>[a-z_]+)\.' \
  --ref '{id}/{variant}' --prefix 'sprite/' \
  --out manifest.mr.sprite.json
```

桶开好之后直接上传即可。详见[资源面](/guide/resources#生成清单)。

## 平台限额（待复核）

EdgeOne Pages 单项目：**5 GiB / 20,000 文件 / 单文件 25 MiB**。

::: warning 这组数字来自第三方文章，官方文档站当时 503
资源外置之后余量很大（部署产物只有几 MB 量级），但仍需复核。
`check-sources.py` 会在契约声明的资产量逼近限额时报 ⚠️——那说明它没有真的外置。
:::
