#!/bin/sh
# 把本克隆的 core.hooksPath 指向受版本控制的 tools/githooks/。
#
# 正常情况下**不需要手动跑**：.claude/settings.json 与 .codex/config.toml 各注册了
# 一个 PreToolUse(Bash) 钩子指向 tools/agent-guard.py，Claude 或 Codex 跑过任意
# 一条 Bash 命令就会自动接上电。只有「两个 Agent 都没碰过这份克隆」时才要跑这个。
#
# 为什么不能从入库文件里自动生效：core.hooksPath 是每份克隆的本地配置，
# 这是 git 有意为之的安全设计——否则 clone 一个仓库就等于执行任意代码。

set -e
root=$(git rev-parse --show-toplevel 2>/dev/null) || {
    printf '✘ 不在 git 仓库里。\n' >&2
    exit 1
}
cd "$root"
[ -d tools/githooks ] || {
    printf '✘ 找不到 tools/githooks/，这不像是本仓库。\n' >&2
    exit 1
}

cur=$(git config --get core.hooksPath || true)
if [ -n "$cur" ] && [ "$cur" != "tools/githooks" ]; then
    printf '⚠ core.hooksPath 当前是 %s，不是 tools/githooks。\n' "$cur" >&2
    printf '  继续会覆盖它。确认无误请重跑：git config core.hooksPath tools/githooks\n' >&2
    exit 1
fi

chmod +x tools/githooks/commit-msg tools/githooks/pre-push 2>/dev/null || true
git config core.hooksPath tools/githooks

printf '✔ 已装上 git 钩子（core.hooksPath → tools/githooks）。\n'
printf '  commit-msg  标题非中文 / 缺 Co-authored-by / 缺「文档:」交代 → 拦\n'
printf '  pre-push    新增提交信息不合规、新建非白名单分支、删掉发布禁令 → 拦\n'
printf '  规则见 CLAUDE.md 与 AGENTS.md。\n'
