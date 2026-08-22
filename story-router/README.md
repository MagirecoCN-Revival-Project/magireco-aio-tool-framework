# Story route data

`story-routes.json` 是 EdgeOne Story Router 的只读交叉表。每条记录把搜索站
`story-v6` 的目录版本 + 分类 slug + 行号映射到：

- Reader route id，以及可证明时与 Reader 现有目录同格式的 section 深链；
- 可选 ADV chapter id（与 Reader id 相同）与已验证 section；
- ADV 所依赖的 MagiReader repository/revision 与启动接收器状态。

`reader-route-rules.json` 保存角色别名、空标题的显式 Reader id，以及主线分篇到
Reader 分组的映射。分篇只有在规则同时给出可证明的 section 策略时才产生 ADV
目标；否则仍可跳转 Reader，`adv` 为 `null`。清单保存 Reader 的完整 section 标签，
实际 ADV URL 则提取其中稳定的 scenario section id（如 `101102-1`）。

`adv-target.json` 登记 L2D/ADV 当前固定读取的 MagiReader revision。生成器会用该
revision 的索引过滤每个 `{readerId, section}`，避免把当前 Reader 新增剧情误报为
L2D 已可播放。`story-routes.report.json` 会把 ADV 缺口拆成固定 revision 缺 id、
精确 section 边界未闭合、以及 section 版本漂移三类。目标站启动接收器验收前，
`handoffReady` 保持 `false`。当前目标站公开 URL 只确认
`advRenderer=pixi-v2`，尚未提供剧情 deep-link。未来接收器应解析 `story + section`
后调用现有 `loadChapterById`；只有存在来源证据时才附加 group key 与 zero-based
turn index，并继续由既有 AdvEngine 持有会话和 turn。

`story-route-overrides.json` 只用于不能从稳定结构唯一闭合的条目。格式：

```json
{
  "version": 1,
  "routes": {
    "story-v6:CATALOG_REVISION:event:ROW": {
      "readerId": "READER_ID",
      "section": "OPTIONAL_CONFIRMED_SECTION"
    }
  }
}
```

省略 `section` 时使用 Reader 索引中的第一个章节。生成器同时把该 section 写入
Reader 与 ADV 目标；Reader 适配器会生成与其首页相同的
`?section=<anchor>#<anchor>`。不存在、重复或章节不属于该 Reader 条目的 override
会令生成失败。
