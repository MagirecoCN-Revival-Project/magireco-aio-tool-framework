# Halo AIO Story Router bridge

这里把用户提供的 `aioviewer0.1.0.jar` Halo 插件壳改造成一个**可选的管理端接线
检查器**。它不是新的剧情站，也不参与 EdgeOne 的生产构建。

## 边界

- 保留原包的 Halo `BasePlugin` 空后端入口；不增加服务端接口。
- 移除原包内合成的 `search.query` / `chart.height` Viewer 页面。
- 新页面只读取 EdgeOne 的 `/story-routes.json`，并通过固定的
  `/open?source=...&target=reader|adv` 打开独立站点。
- 不嵌入 Reader、ADV、3D 或战斗精灵，也不保存剧情数据。
- EdgeOne Story Router 仍是唯一中转路由；Halo 插件只是管理员手工检查接线的入口。

## 构建

构建器从原包复制三项后端壳文件，并用本目录的清单和 UI 替换旧前端：

```powershell
python tools/build-halo-aioviewer.py `
  --base-jar PATH_TO_BASE\aioviewer0.1.0.jar.zip `
  --output PATH_TO_OUTPUT\aioviewer0.2.0-story-router.jar
```

原始包不会被改写。输出包仍使用插件名 `aio-viewer`，版本提升为 `0.2.0`，可作为
0.1.0 的替换安装包。

## Halo 页面

安装后在 Halo 管理端打开 `/aio-story-router`：

1. 填入 EdgeOne Story Router 根地址；
2. 粘贴搜索站产生的版本绑定 `sourceKey`；
3. 检查交叉表是否存在该条记录；
4. 通过 Reader/ADV 按钮验证 302 跳转。

Router 根地址仅存于当前浏览器的 `localStorage`，不会写入 Halo 数据库。
