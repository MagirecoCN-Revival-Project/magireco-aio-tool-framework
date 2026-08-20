# 演示宿主

一页能点的东西，用来回答「这个框架到底能干嘛」。

```bash
node apps/demo/build.mjs > /tmp/bundle.js     # 打真内核
node -e "…"                                    # 见下方一行式构建
```

构建（把 bundle 内联进模板，产出单文件）：

```bash
python3 - <<'PY'
import pathlib, subprocess
tpl = pathlib.Path("apps/demo/index.template.html").read_text(encoding="utf-8")
js = subprocess.run(["node","apps/demo/build.mjs"],capture_output=True,text=True,check=True).stdout
pathlib.Path("apps/demo/dist/index.html").write_text(tpl.replace("/*BUNDLE*/", js), encoding="utf-8")
PY
```

`dist/` 不入库（见根 `.gitignore`）。

## 哪些是真的，哪些是占位的

**真的**：`Kernel`、`Registry`、`ResourceClient`、`OriginPool`、`createIframePlugin`
全部从 `packages/` 原样 import，esbuild 直接打进页面。插件的 manifest、能力声明、
生命周期、事件总线、iframe 的 `MessageChannel` RPC——都是生产路径。

**占位的**：三个插件的**内部渲染**。它们不真的跑 Live2D 或 three.js，
画的是占位方块。把 `mount()` 里的内容换成真正的查看器，这三个插件就是成品
（怎么换见 `docs/VIEWER-REFACTOR.md`）。

剧本文本是占位的，不是游戏原文。角色与 ID 是真的，取自上游仓库实测。

## 演示了什么

| 操作 | 说明的事 |
|---|---|
| 取消勾选 `adv-player` | 播放按钮整排消失，剧本照常可读——宿主依然自洽 |
| 点某一行「从这行播」 | 阅读器发意图 → 内核派发 → ADV 挂载；进度回流让该行高亮 |
| 角色卡「显示精灵」 | 交叉表查关联 → 内核派发 → 精灵在**独立 iframe realm** 里挂载 |
| 开到第三个 WebGL surface | 治理器按 LRU 挂起最久未用的，而不是让浏览器静默丢弃上下文 |
| 「解析裸 ID」 | `parseRef('100101')` 抛错——mr 与 ex 的编号会撞 |
| 「让主源连续失败」 | 选路顺序改变，冷却跨资源共享 |

子帧里故意挂了一个 `window.cc`（模拟 cocos2d-html5），页面上会显示
「父页面里没有它」——这就是 iframe 隔离要解决的问题。
