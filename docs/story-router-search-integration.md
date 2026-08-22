# 搜索站接入 Story Router

搜索站不需要引入 Reader 或 ADV 代码。EdgeOne 构建会公开两个可跨域读取的文件：

- `/story-routes.json`：当前精确交叉表；
- `/story-router-client.js`：与边缘函数相同的来源键和 URL 契约。

## 必须保留原始行号

`story-v6` 的来源键绑定“目录版本 + 分类 slug + **分类文件中的原始行号**”。搜索结果
经过筛选后不能使用显示序号。读取分类时先标记原始行号：

```js
const taggedRows = data.rows.map((row, rowIndex) => ({ row, rowIndex }));
const matches = taggedRows.filter(({ row }) =>
  rowMatches(row, families, logic, includeVariants, keywordTerms)
);
```

渲染时继续使用 `row` 显示原内容，使用 `rowIndex` 构造来源键。

## 初始化

```js
import {
  buildRouterUrl,
  buildStorySourceKey,
  createStoryRouteIndex,
  parseStoryRouteManifest,
  resolveStoryRoute,
} from 'https://AIO_HOST/story-router-client.js';

const AIO_BASE = 'https://AIO_HOST';
const routeManifest = parseStoryRouteManifest(
  await fetch(`${AIO_BASE}/story-routes.json`, { cache: 'no-cache' }).then((response) => {
    if (!response.ok) throw new Error(`Story Router HTTP ${response.status}`);
    return response.json();
  }),
);

// 搜索目录和交叉表必须来自同一次生成；不一致时整批隐藏按钮。
if (routeManifest.catalogGeneratedAt !== manifest.generatedAt) {
  throw new Error('搜索目录与 Story Router 目录版本不一致');
}
const storyRouteIndex = createStoryRouteIndex(routeManifest);
```

## 为一条搜索结果生成按钮

```js
function storyRouteLinks(categorySlug, rowIndex) {
  const sourceKey = buildStorySourceKey(
    routeManifest.catalogRevision,
    categorySlug,
    rowIndex,
  );
  const route = resolveStoryRoute(storyRouteIndex, sourceKey);
  if (route === null) return null;
  return {
    reader: buildRouterUrl(`${AIO_BASE}/open`, sourceKey, 'reader'),
    adv: route.adv !== null && routeManifest.targets.adv.handoffReady
      ? buildRouterUrl(`${AIO_BASE}/open`, sourceKey, 'adv')
      : null,
  };
}
```

函数整体返回 `null` 表示该行没有唯一 Reader 映射。链接结果中的 `adv: null`
表示目标 L2D 固定 revision 尚未收录该 Reader id、视频结果到 section 的边界仍待
闭合，或启动接收器仍在等待对接。界面始终保留 Reader 按钮，只隐藏 ADV 按钮。
不得用标题、简介、出场角色或筛选后的序号临时猜测 Reader id。

ADV URL 契约会携带 `story`、从 Reader section 标签提取的稳定 scenario section id，
以及 `readerRevision`；当前目标站公开 URL 只确认 `advRenderer=pixi-v2`，所以保持
关闭。目标 ADV 工程完成参数/消息接收器并调用现有
`loadChapterById(story, section)` 后，再只读定位可选 group key 与 zero-based turn
index，且不绕过既有 AdvEngine 会话/turn owner。随后把 `adv-target.json` 的
`handoffReady` 切为 `true`，EdgeOne 同时设置 `AIO_ADV_HANDOFF_ENABLED=1`，重建并
执行真实端到端验收。
