# Story Router Edge profile

这个应用不是搜索站、Reader 或 ADV 播放器。它只生成 EdgeOne 静态健康页与
`/open` 边缘函数所需的路由清单。搜索站链接到 `/open`，函数再以 302 跳到
独立部署的 Reader 或 ADV。

静态输出还包含 `story-router-client.js`。它与 `story-routes.json` 一起允许
搜索站按“目录版本 + 分类 + 原始行号”判断一条结果是否有精确路由；不会下载或
渲染剧情内容。

EdgeOne 环境变量：

- `AIO_READER_BASE_URL`：Reader 站点根地址。
- `AIO_ADV_BASE_URL`：ADV 站点入口地址。

本地运行 `npm run -w @aio/story-router-edge preview` 会使用两个本地接收页验证
跳转参数，不会启动或修改 Reader/ADV 项目。
