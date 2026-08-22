# 守卫与铁律

这个项目的判断方式只有一条：**不报错的错最贵。**

崩溃会被立刻发现；「显示了另一个角色」「少了一批资源」「后台开关关了页面还在」
不会——它们看起来像在正常工作。所以凡是这类，判据一律写成守卫，
而不是写成文档里的一句提醒。

> 文档挡不住不读文档的人，钩子可以。

## 十一条铁律

| # | 铁律 | 谁在拦 |
|---|---|---|
| 1 | 资源引用必须带作品前缀，裸 ID 一律拒绝 | `parseRef` 直接抛 |
| 2 | 交叉表查不到就返回空，绝不按编号规律猜 | `Registry` 的实现 |
| 3 | 插件只能经 `host.resources` 拿资源 | 判据：插件源码里 grep 不到任何 host 名或资源路径 |
| 4 | `isolation: 'iframe'` 必须写 `isolation_reason` | `check-sources.py` |
| 5 | 占 WebGL 必须声明 `usesWebGL` | 没法自动查，只能靠实现者诚实——所以写在这里 |
| 6 | 上游仓库改造后必须仍能独立运行 | 契约文件 |
| 7 | 🔴 两条发布禁令不得解除 | `check-sources.py` + `pre-push` |
| 8 | 不自研运行时（平台原语能做的不重造） | 评审 |
| 9 | 🔴 资源与代码必须分离，版权文件一个都不能进仓库 | `check-assets.py` + `pre-push` |
| 10 | 插件的两半共用一个开关 | `@aio/site` 的设计 + 测试 |
| 11 | 🔴 下架不能只靠重建 | 设计约束，见[边缘半边](/guide/edge#下架-两处都要做) |

铁律 1、2 的证据在[资源面那一页](/guide/resources)；5 在[内核那一页](/guide/kernel)；
10、11 在[边缘半边](/guide/edge)。

## 五个守卫

```bash
python3 tools/check-sources.py         # 契约 + 能力表对账
python3 tools/check-assets.py          # 版权素材不得入库（铁律 9）
python3 tools/check-commit-messages.py # 提交信息（CI 侧，不依赖本地钩子）
python3 tools/build-manifest.py        # 清单生成器（不猜 ref）
```

每个守卫都有**自测**，喂它坏样本确认它真的拦得下来：

```bash
python3 tools/test-check-sources.py    # 27 个坏样本必须全被拦下
python3 tools/test-check-assets.py     # 12 个坏样本 + 4 个好样本
python3 tools/test-build-manifest.py   # 15 条，含三条失败路径
```

::: warning 一个拦不下任何东西的检查比没有检查更糟
因为它会让人以为有人在看着。所以每加一条规则，就在自测里加一个会触发它的
坏样本。反过来也一样：一个会拦下正常代码的检查同样更糟，所以宁可漏报也不误报
——`check-sources.py` 抓不到 `@aio/capability` 的契约清单时是**跳过并警告**，
不是报错。
:::

### `check-sources.py` 查六件事

1. 契约自洽 —— 必填字段、枚举、id 与文件名一致
2. 禁令不被绕过 —— `publish=forbidden` 的源不得接入运行时；`vendor=forbidden`
   的源不得被包装成插件（那要复制其代码）
3. 插件不打架 —— `pluginId` 唯一；能力标识合约定
4. 资源前缀唯一 —— 两个源共用一个前缀会互相覆盖对方的清单
5. 资源必须外置 —— 声明的资产量若逼近 Pages 单项目限额，说明它没有真的外置
6. 能力表对账 —— 横着的 `capabilities.json` 与竖着的 `*.source.json` 双向一致

### `check-assets.py` 的判据

按扩展名黑名单分类（图片、音频、视频、模型、字体、压缩包），加一条
`MAX_FILE_BYTES = 256 KiB` 兜底，`ASSET_DIRS` 目录白名单例外。
用 `git ls-files`，拿不到时**回退到文件系统遍历**——绝不因为拿不到列表就放行。

`pre-push` 里那一份查的是**本次推送新增的提交对象**（`git diff-tree`），
不是工作树：在别处提交再推进来的，工作树扫描看不见。

## git 钩子

```bash
git config --get core.hooksPath      # 应输出 tools/githooks
bash tools/install-hooks.sh          # 空的就跑这个
```

::: danger 不要假设钩子是活的
`core.hooksPath` 是**每份克隆的本地配置**，入库文件没法让它自动生效——这是 git
有意为之的安全设计，否则 clone 一个仓库就等于执行任意代码。

2026-08-20 实测：远程多仓库会话里，会话的项目根是各仓库的**上一级目录**时，
仓库自带的 `.claude/settings.json` 不是「项目设置」，从未被加载。
后果是那一轮 8 个提交没有任何东西在拦，包括一个英文标题、无 `Co-authored-by`
的根提交——`pre-push` 放行它，是因为 `pre-push` 压根没跑。

所以同一套判据另有一份跑在 CI 里，**不依赖任何本地配置**。
:::

| 钩子 | 拦什么 | 逃生口 |
|---|---|---|
| `commit-msg` | 标题非中文 / 缺 `Co-authored-by` / 缺「文档:」交代 | 信息里顶格独占一行写 `[skip-hooks]` |
| `pre-push` | 本次推送**新增**的提交信息不合规 | `SKIP_MSG_HOOK=1` |
| | 新建远端分支违反 `AGENTS.md` §0 | `SKIP_BRANCH_HOOK=1` |
| | 改动删掉了两条发布禁令（铁律 7） | `SKIP_POLICY_HOOK=1` |
| | 红灯期间推非修复类提交到 main | `SKIP_REDLIGHT_HOOK=1` |
| | 本次推送把版权素材加进了历史（铁律 9） | `SKIP_ASSET_HOOK=1` |
| `agent-guard.py` | `--no-verify` 与 `-c core.hooksPath=…`（绕过且不留痕迹） | 无——请改用上面的逃生口 |

钩子分两层：`commit-msg` / `pre-push` 是 POSIX sh 的启动层，只负责找一个能用的
Python 3；实现在 `commit_msg.py` / `pre_push.py`，判据在共用的 `_msgrules.py`。
**找不到解释器时放行并提示，不是拦下**——缺个 Python 不该让整个仓库提交不了。

## CI

`.github/workflows/checks.yml` 五个 job，push 与 PR 都跑：

| job | 跑什么 |
|---|---|
| `framework` | typecheck（strict）+ 全部测试 + **静态导出** |
| `contracts` | 契约守卫自测 + 契约守卫（装了 jsonschema 会多跑完整 schema 校验） |
| `assets` | 资源分离守卫自测 + 清单生成器自测 + 资源分离守卫 |
| `commit-messages` | 提交信息守卫，不依赖任何本地配置 |

静态导出单独跑一步是有原因的：typecheck 与单测都过、导出却坏掉是可能的
——Next 16 换 Turbopack 缺省时一次撞上 51 个 `Can't resolve`，而 tsc 与 vitest
都是绿的。

## 两条发布禁令

`repository-policy.json` 里标 `publish: forbidden` 的源**不进入任何公开面**。
典型来源：上游 CI 强制的部署禁令、含真实用户数据的归档。

这不是本项目的判断，是既有约束；要改必须由维护者拍板，并同步修改上游仓库
自己的策略文件——只改这边不算数。

标 `vendor: forbidden` 的源**不得 vendor**，只能作为独立宿主装插件。

## 提交约定

- **Conventional Commits 前缀 + 中文描述**：`fix(kernel): 修复 surface 泄漏`
- 允许的 type：`feat` `fix` `refactor` `docs` `test` `chore` `ci` `perf` `build`
- 一功能一 commit，直接提交 `main`（无 PR 流程，除非明确要求）
- 信息里要有一行 `文档:` 交代对应文档改动，或明确写不影响
- 实际执笔的 Agent 以 `Co-authored-by` trailer 署名，必须是完整的 `Name <email>`

::: info 作者按实际执笔的人记，没有默认值
不确定就问那个人。默认值在署名这件事上只会造成一种结果：拿它去替一个**没有
参与这次改动的人**署名，而且不报错。署名是归属，猜错了就是把别人的名字签在
他没写过的东西上。**Agent 永远不做作者，只做 co-author。**
:::
