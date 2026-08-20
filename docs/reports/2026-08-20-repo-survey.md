# 十仓库架构与近期改动盘点

> 日期：2026-08-20
> 方法：全部 10 个仓库均为 `--depth 50` 浅克隆，**"最新改动"以各仓库最近
> 50 个提交为准**；文件数取 `git ls-files`，体积取 `du -sh` 工作树实测。

---

## 一、整体格局

这 10 个仓库是一条完整的链路，分五层：

| 层 | 仓库 | 角色 |
|---|---|---|
| **客户端** | `example-client` | 唯一的可发布成品，工程成熟度断层领先 |
| **后端规格** | `example-user-archive` | 上游 API 流量归档，自建服务端的唯一规格来源 |
| **语料/数据** | `example-restricted-data`、`example-reader` | 结构化资料库 + 剧情翻译流水线 |
| **查看器** | `example-model-viewer`、`example-adv-live2d`、`example-live2d-viewer`、`example-sprite-mirror` | 3D / Live2D / ADV / CocosStudio 精灵，四条独立技术栈 |
| **工具** | `example-search-site`、`magireco-aio-tool-framework` | 检索站；后者 2026-08-20 刚建 |

---

## 二、逐仓库

### 1. example-client —— 主线客户端

**架构**：以 upstream-baseline `io.kamihama.upstream-baseline` 成品 APK 为基线，叠一层 Java 补丁重建。

- **仓库里没有工程树**（2026-08-14 起）。`baseline/` 用 123 条带 `pre`/`post` hash
  和 `why` 的操作（`patch` 14 / `replace` 85 / `add` 13 / `remove` 6 / `generated` 5）
  从公开 Release 整包重建，`tools/check-baseline.py` 拦住原包派生文件"回流"。
- **补丁层** 46 个 Java 类（`patch/src/main/java/io/kamihama/magianative/`）：下载浮层、
  安装器、分片续传、镜像换线、进程内 aria2（双 TLS 后端 + dead-man's switch）、
  热更事务、WebView 代理、外链白名单、版本检查、调试悬浮窗。
- **native** 3.6k 行 C++（`MagiaLegacy.cpp` + 硬化过的 `cnzip` 解压核心），
  34 个 hook：i18n 文案替换、字体路径、端点重写、序章强制。
- **守卫工程化程度极高**：23 个 `check-*` 脚本 + 28 个 JVM 测试套件，全在 CI 里跑；
  d8 已知坑（`this$0` / `Comparator<T>`）有专门检测器；git 钩子由
  `tools/agent-guard.py` 在 Agent 跑第一条 Bash 命令时自动"接电"。
- **安全模型明确**：信任锚只有三样（`MIRRORS_URL`、外链白名单、APK 签名），
  `config.json` 按半可信输入处理，52 项判据钉在 `ConfigGuardTest`。

**最新改动（8/19–8/20）**：一次密集的**缺陷审计闭环**，46 个提交集中在 8/19，
编号 F-041 → F-075。主题是并发与失败路径的正确性——原子替换收敛成一份实现（F-073）、
安装完成判据从"标记存在"改成"资源装齐了没"（F-074）、`Content-Range` 严格解析（F-068）、
分片 monitor 关门顺序（F-066）、`getCurrentActivity` 按生命周期挑前台（F-053）、
aria2 终态释放与 CA bundle 可解析性校验。另外 aria2 日志改成源码层 Android log sink
（不再重定向进程 fd），libarchive 改 clang++ 静态链 libc++ 并由 CI 重建刷 sha256 pin。

### 2. example-user-archive —— API 流量归档

单次提交（7/31）建成：293,217 条请求、205 个归一化端点、1,383 个文件，
来自 190 台设备的 55 天窗口。每端点至多 5 条样本（**强制不同设备**）+
无条件保留最大一条响应。脱敏做得认真：header 值抹掉但**保留 key**，
UUID/hex 映射成 `sha256[:8]` 稳定占位符（跨样本引用关系仍可读）。
README 里主动记了一次事故——第一版漏了 `path` 字段，12 个文件泄露了真实好友 UUID，
已修复复检。

### 3. example-restricted-data —— 结构化资料库

**已于 2026-08-15 退役公开站**，转为私有研究档案：`repository-policy.json` + CI 校验
共同禁止重新接入 Pages / Cloudflare / Vercel 等公开托管，`deploy/` 只留不可索引的
退役提示页，`site/`（Next.js 只读界面）固定绑 `127.0.0.1`。

数据规模：角色 241 / 卡牌 1,404 / 道具 174 / 剧情 725 篇 81,338 行 /
语音字幕 10,511 条 / 媒体清单 30,641 条 / 正文归档 6,813 页。与上游证据层
`another-org/magiWiki` 是"证据 → 派生"两层关系，本仓库与
`another-org/example-restricted-data` 互为镜像，**同步判据是 Git tree 相同而非 SHA 相同**。

### 4. example-reader —— 剧情阅读站 + 翻译流水线

最大的仓库（47,886 文件）。六个 `*-source-master` / `*-translate-data-master` 目录
分别装 命名空间 a / 命名空间 b / 语音三条线的原文与译文；`website/` 是
Next.js 16 + React 19 + OpenNext on Cloudflare Workers。

**社区校对系统**设计得相当谨慎：访客投稿进独立 KV，记录 7 个 SHA-256 基准哈希，
审核通过后服务端**重新从 GitHub 读取当前源文件复验基准**，再建一个只改单个
中文 TXT 的 PR；投稿口令与建 PR 的 GitHub token 是两条不可互换的凭据。

**最新改动（8/16–8/17，110 个提交）**：v25 → v31 的官方繁中文本导入与
"可信人工翻译"整备。核心是 `[v31] trust only closed manual retranslations`——
只信已闭环的人工重译，然后逐条 `merge verified manual translation 310233/310241`，
最后 `[v31-materialized] publish verified catalog and review state`。

### 5. example-model-viewer —— three.js 3D 模型查看器

Vite + TypeScript + three 0.182，workspace 子包 `upstream-three-subpackage`
封装角色加载与着色。README 的**着色器文档质量很高**：`ctrl` 贴图四个通道的语义
（R 预混 color/shadow、G 反转粗糙度、B 金属度、A alpha map）、face 用 UV2 的
眼高光与腮红、身体/武器动画命名约定（`_L` 循环 / `_SE` 过渡）都写清楚了。
已知问题也诚实列出（缺 shape key 导致无表情）。

已有 `edgeone.json`（给 `*.gz` 打 `Content-Encoding: gzip`）与
`scripts/compress_fbx_gzip.bat`，但 `deploy.yml` 目前发的是 GitHub Pages。

**最新改动（8/4、8/7）**：45 个提交全是 CI 驱动的**逆向研究**——从当前日服包里
提取官方 RDToon shader、608 号舞台的粒子模块与材质、SoftMetallic MatCap、
ReDrive GLSL 公式窗口，逐步把官方渲染参数固化进仓库。

### 6. example-adv-live2d —— Live2D + ADV 播放器

Vite + Cubism SDK（`sdk/Core` + `sdk/Framework` 内嵌），13,883 文件。
`src/story/` 是重头：ADV 引擎、脚本解析、Cocos Studio 特效运行时
（`cocosParticle` / `cocosStudioRuntime` / `plist`）、HCA 音频解码、舞台几何守卫。
**91 个 vitest 测试文件**，其中 adv-v2 / adv-v3 系列大量是"与真机 AArch64 原生实现
交叉核对"的固化测试。

研究文档 `ADV_WEB_RESEARCH.md` 给了硬结论：命名空间 b 剧情是带表头的
worksheet JSON，扫描 6,714 个剧情 JSON、814,730 条指令，**指令行覆盖率 99.994%**，
85 个影片引用全部可映射本地 WebM。

**最新改动（8/8–8/12）**：把 Story 字体、StoryMessage 几何、tap 动画常量逐个
"对着 AArch64 原生实现"钉死并加门禁；最后
`fix(adv): pin Pixi runtime and restore native controls` 固定 Pixi 版本。

### 7. example-live2d-viewer —— 网页版 live2d 浏览器

49,358 文件里 48,964 是 `image/`，纯静态站（无构建）。功能是角色换装 /
战斗动画 / 语音 / 第一章剧情播放。**最新改动（7/28–7/29）**：同源 Live2D 与
HCA 代理的 CORS 验证、从 Release APK 精确提取核心字体、经典 ADV 页面浏览器测试；
最后一条是 `移除越权的跨项目部署与验证工作流`——自我纠正了跨仓库越权。

### 8. example-sprite-mirror —— CocosStudio 精灵档案镜像

7/30 单次分 32 块导入，8,164 文件。cocos2d-html5 引擎 + 4,025 个
`mini_*.ExportJson/plist/png` 战斗精灵资源，`main.js` 是个自写的目录/舞台查看器
（搜索、分类、变体切换、播放控制）。纯归档性质，之后没动过。

### 9. example-search-site —— 角色称呼检索站

fork 自 third-party-author 的 GAS 项目，做了完整中文化 + 身高图表系统 + 图片导出。
部署在 Cloudflare Pages，数据只人工静态更新（上游已停维护）。

**最新改动（8/20，50 个提交一天内）**：V22 缺陷审计闭环 → V23 权威标题终结器，
加上汉堡菜单改成紧凑非阻塞式。

### 10. magireco-aio-tool-framework

2026-08-20 刚建，初始提交只有一个 GPLv3 LICENSE。现已作为 AIO 工作站的控制面，
见 `docs/AIO-ARCHITECTURE.md`。

---

## 三、跨仓库观察

**1. 工程纪律断层明显。** `example-client` 有 CLAUDE.md / AGENTS.md /
CONTRIBUTING.md 三层规范、git 钩子硬拦、23 个 CI 守卫；其余仓库基本没有。
最直观的对比是提交信息——主仓库强制"Conventional 前缀 + 中文描述 +
`Co-authored-by`"，而 `example-reader` 里就有 `github-actions[bot]` 作者的英文标题提交，
正是当初催生那套钩子的那类提交。

**2. 一次性 workflow 大量堆积。** `example-search-site` 有 **85 个** workflow、
`example-model-viewer` 有 **46 个**，绝大多数是 `apply-*` / `repair-*` / `diagnose-*` /
`dispatch-*` 这类跑完就该删的一次性作业；call-search 根目录还躺着 9 个
`.deploy-v22-*-trigger` 空触发文件。这与主仓库 CONTRIBUTING §八「禁止一次性 Workflow」
和 AGENTS §4「不要在仓库里留一次性脚手架」是同一个问题的两种处理方式。

**3. `node_modules` 进了版本库。** `example-search-site` 提交了 3,988 个
`node_modules` 文件。

**4. 两条"缺陷审计闭环"同时收尾。** 8/19–8/20 客户端跑 F-041→F-075，
8/20 call-search 跑 V22→V23，8/17 example-reader 收 v31。三个仓库在同一周
各自进入"审计—修复—固化"阶段，节奏是一致的。

**5. 数据不可逆性被反复强调，且都吃过亏。** 客户端的「CSS 进过热更包就再也拿不出来」
（历史篇入口塌陷事故）、example-user-archive 的 path 脱敏遗漏、example-reader 的
`INCIDENT_2026-07-29_PROBE_STORM.md`——三个仓库都把事故原样写进文档
而不是抹掉，这是这套项目里最好的一个习惯。

---

## 四、实测占用（AIO 架构的输入）

| 仓库 | 入库文件数 | 磁盘占用 |
|---|---:|---:|
| `example-adv-live2d` | 13,883 | 7.0 G |
| `example-live2d-viewer` | 49,358 | 5.8 G |
| `example-sprite-mirror` | 8,164 | 3.1 G |
| `example-reader` | 47,886 | 2.2 G |
| `example-model-viewer` | 1,780 | 734 M |
| `example-user-archive` | 1,385 | 123 M |
| `example-search-site` | 4,517 | 92 M |
| `example-restricted-data` | 83 | 86 M |
| `example-client` | 216 | 77 M |
| `magireco-aio-tool-framework` | 1 | 288 K |

这张表是 `AIO-ARCHITECTURE.md` §二.3 那条"没有任何一个重仓库能整体塞进一个
EdgeOne Pages 项目"结论的直接依据。
