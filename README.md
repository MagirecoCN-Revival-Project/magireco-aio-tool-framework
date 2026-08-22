# magireco-aio-tool-framework

## 目标生产形态：Story Router

AIO **不是另一个剧情网站，也不把搜索、Reader、L2D/ADV、3D 或战斗精灵塞进
同一个页面**。当前唯一主链是：

```text
角色剧情搜索结果
      │ sourceKey + target
      ▼
EdgeOne /open（AIO Story Router）
      ├── 302 → 独立 Reader：/reader/{storyId}
      └── 302 → 独立 ADV：?advRenderer=pixi-v2&bridge=1&story={storyId}&section={scenarioSectionId}&readerRevision={revision}
```

AIO 只负责三件事：

1. 给搜索数据中的每一行一个版本绑定来源键，例如
   `story-v6:20260816t013548z:character:0`。
2. 维护来源键到 Reader 剧情编号、ADV 起始章节的**显式交叉表**。
3. 在 EdgeOne 边缘函数上把 `/open` 请求 302 转发到独立站点。

搜索站不 import Reader 或 ADV；Reader 与 ADV 也不需要知道搜索站存在。换域名时只
改 EdgeOne 环境变量，不需要改搜索数据或交叉表。

## 已确认的真实入口

| 系统 | 当前契约 | 状态 |
|---|---|---|
| 搜索站 `story-v6` | 目录版本 + 分类 slug + 原始行号 | 已用于 `sourceKey`；目录更新时旧键失效而不是误跳 |
| MagiReader | `/reader/{id}` | 已存在，可直接跳转 |
| L2D/ADV | 当前公开 URL 只接受 `advRenderer=pixi-v2`；未来接收器解析参数后调用内部 `loadChapterById(id, section)` | AIO 已按固定 Reader revision 过滤兼容条目；稳定剧情 deep-link 尚未公开，接收器完成前保持关闭 |

ADV 不是复用 Reader 页面查询参数，而是直接读取固定 MagiReader revision 的
`story_index.json` 与剧情 JSON。AIO 因此以 Reader 的 `id + section` 为共同契约：
Reader 使用当前索引，ADV 只保留其固定 revision 中仍存在的章节。AIO 从 Reader
section 显示标签中提取稳定 scenario section id（如 `101102-1`），并在 URL 中携带
`readerRevision`。未来如有经过验证的精确落点，可再附加 group key 与 zero-based
turn index；接收器仍应先走现有 picker/AdvEngine 会话，不另建播放路径。AIO 不复制
剧情，也不改动 Reader/ADV 工程。

## 当前映射结果

从搜索站当前 `story-v6` 14,466 行与 Reader 当前 3,012 条索引中，生成器只对
“角色个人剧情、主线、支线”执行可证明的精确匹配：

- 可播放范围：5,337 行，其中 10 行是无演员、简介和来源的空白坏记录。
- 有效路由候选：5,327 行；Reader 已登记 5,327 行。两个同名序章结果已按
  实际台词边界分别落到 `000001` 开场与 `000003` 第 4 节。
- 角色个人剧情有效行：2,799 / 2,799；第二部主线：1,497 / 1,497。
- ADV 固定 Reader revision 数据兼容：5,036 行；启动接收器完成前不向正式搜索站开放 ADV 按钮。
- 其余 291 行保持 Reader-only：218 行是旧主线分篇视频尚缺逐行 section 边界，
  73 行的 Reader id 尚未进入 ADV 当前固定 revision；两类都不会伪造 ADV 跳转。
- 活动、服装、镜层、scene0、动画、记忆结晶等未纳入本轮主链；不会按标题模糊猜测。

完整机器可读结果在：

- `story-router/story-routes.json`
- `story-router/story-routes.report.json`
- `story-router/story-route-overrides.json`

## 本地验证

```bash
npm ci --ignore-scripts
npm run check
npm run -w @aio/story-router-edge preview
```

预览地址默认是 `http://127.0.0.1:4173/`。本地 Reader 夹具验证精确 302；ADV 在
`handoffReady: false` 时验证 `409 target_not_ready` 门控，稳定 scenario section id
与 renderer 参数由适配器测试覆盖。预览不会启动或修改 Reader/ADV。

## EdgeOne 部署

根目录 `edgeone.json` 已把生产输出切到 `apps/router/dist`，构建命令是
`npm run edgeone:build`。`edge-functions/open.js` 自动成为 `/open`。

在 EdgeOne 项目中设置：

| 环境变量 | 含义 |
|---|---|
| `AIO_READER_BASE_URL` | 独立 Reader 根地址 |
| `AIO_ADV_BASE_URL` | 独立 ADV 入口地址（不含查询参数） |
| `AIO_ADV_RENDERER` | ADV renderer；当前默认并已确认的是 `pixi-v2` |
| `AIO_ADV_HANDOFF_ENABLED` | 目标站接收器验收后设为 `1`；它还必须与清单中的 `handoffReady: true` 同时成立 |

`/story-routes.json` 带跨域读取响应头。搜索站对所有已登记结果显示 Reader 按钮；
只有 `route.adv` 存在且 `targets.adv.handoffReady` 为真时才显示 ADV 按钮。按钮链接到：

```text
https://AIO_HOST/open?source=story-v6:20260816t013548z:character:0&target=reader
https://AIO_HOST/open?source=story-v6:20260816t013548z:character:0&target=adv
```

EdgeOne 同时发布 `/story-router-client.js`；搜索站保留原始行号并接入两个按钮的
完整代码见 `docs/story-router-search-integration.md`。

## 更新交叉表

生成器需要搜索数据目录、搜索本地化表与 Reader 索引；它们只是输入，不会被修改：

```bash
python3 tools/build-story-routes.py \
  --search-root PATH_TO_SEARCH/public/data/story-v6 \
  --localization PATH_TO_SEARCH/public/data/story-v7/localization.json \
  --reader-index PATH_TO_READER/website/public/story_index.json \
  --overrides story-router/story-route-overrides.json \
  --rules story-router/reader-route-rules.json \
  --adv-reader-index PATH_TO_ADV_PINNED_READER/story_index.json \
  --adv-target story-router/adv-target.json \
  --output story-router/story-routes.json \
  --report story-router/story-routes.report.json
```

自动匹配只接受两类证据：

- 角色：权威角色名/显式别名 + 话数，在 Reader 中唯一命中。
- 主线/支线：部、章、话，在 Reader 中唯一命中；分篇主线使用已登记的 Reader 分组规则。
- Reader 深链：有精确 section 时沿用 Reader 首页既有的
  `?section=<anchor>#<anchor>` 参数；只有分组证据时仍跳到剧情首页。
- ADV：Reader id 与 section 还必须同时存在于目标站固定的 Reader revision。

活动名、剧情概要、出场角色和相似标题都不参与猜测。复杂条目通过 overrides 指向
真实 Reader id，可选指定真实 section；生成器会确认两者确实存在。

## 排除项

- `Magius3Dviewer-JP`：属于独立 3D 工作目录，不在剧情搜索跳转主链。
- `kyu.gay-mirror`：是独立战斗精灵/Cocos2d 查看器来源，不在剧情搜索跳转主链。
- `apps/station` 与原有 capability/plugin 包：保留为框架实验与兼容代码，EdgeOne
  默认部署不再构建 Station，也不把这些 surface 接入 Story Router。

## 可选 Halo 管理端桥

`integrations/halo-aioviewer` 可以把旧版 `aioviewer0.1.0` Halo 插件壳重新封装为
`0.2.0` 接线检查器。旧包中的合成称呼搜索、身高对比和 `/aio-viewer` 页面不会
进入新包；新页面 `/aio-story-router` 只读取 EdgeOne 路由清单并打开固定的
`/open` Reader/ADV 链接。

它是可选的 Halo 管理工具，不参与 `edgeone:build`，也不改变搜索站 → EdgeOne →
Reader/ADV 这条生产主链。构建与安装边界见
`integrations/halo-aioviewer/README.md`。

## 许可与数据边界

本仓库为 GPLv3。路由清单只包含来源键、剧情编号和章节标签，不包含剧情文本、
语音、模型、贴图或其他游戏资源。
