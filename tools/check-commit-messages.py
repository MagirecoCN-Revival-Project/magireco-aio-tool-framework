#!/usr/bin/env python3
"""提交信息守卫（CI 版）。

`commit-msg` / `pre-push` 两个 git 钩子只有在 `core.hooksPath` 被指向
`tools/githooks/` 之后才生效，而那是**每份克隆的本地配置**，没法从入库文件里设。
仓库原本靠 `.claude/settings.json` 的 `PreToolUse(Bash)` 钩子来「接电」——
2026-08-20 实测发现这条路在**多仓库远程会话**里不成立：

  会话的项目根是各仓库的**上一级目录**，仓库自带的 `.claude/settings.json`
  因此不是「项目设置」，从未被加载；而设置又只在会话启动时读一次，
  中途补写也不生效。

结果是那一整轮里 8 个提交没有任何东西在拦——包括一个英文标题、无
`Co-authored-by` 的根提交，它被 `pre-push` 放行了，因为 `pre-push` 压根没跑。

所以判据挪到这里：**CI 不依赖任何本地配置**。钩子仍然保留（它更快、更早），
但不再是唯一的一道。

用法：

    python3 tools/check-commit-messages.py <base> <head>
    python3 tools/check-commit-messages.py <head>          # 只查这一个

`base` 为空或全零（新分支）时只查 `head` 那一个提交。
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "githooks"))

try:
    import _msgrules  # type: ignore
except ImportError:
    print("⚠️  找不到 tools/githooks/_msgrules.py，跳过检查", file=sys.stderr)
    raise SystemExit(0)

# 与 pre_push.py 同一个上线时刻：历史不翻旧账。
CUTOFF_EPOCH = 1787184000
MAX_COMMITS = 200


def sh(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(ROOT), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="surrogateescape",
        timeout=120,
    )


def commits(base: str | None, head: str) -> list[str]:
    if base and set(base) != {"0"}:
        r = sh("rev-list", "--no-merges", f"--max-count={MAX_COMMITS}", f"{base}..{head}")
        if r.returncode == 0:
            return [x for x in r.stdout.split() if x]
    r = sh("rev-list", "--no-merges", "--max-count=1", head)
    return [x for x in r.stdout.split() if x]


def main(argv: list[str]) -> int:
    if len(argv) == 1:
        base, head = None, argv[0]
    elif len(argv) == 2:
        base, head = argv[0], argv[1]
    else:
        print(__doc__, file=sys.stderr)
        return 2

    bad: list[tuple[str, str, list[str]]] = []
    checked = 0

    for sha in commits(base, head):
        r = sh("log", "-1", "--format=%ct%x1f%B", sha)
        if r.returncode != 0:
            continue
        stamp, _, body = r.stdout.partition("\x1f")
        try:
            when = int(stamp.strip())
        except ValueError:
            continue
        if when < CUTOFF_EPOCH:
            continue                      # 上线时刻之前的历史，不翻
        subject = body.strip().split("\n", 1)[0]
        if subject.startswith(_msgrules.AUTO_PREFIXES):
            continue                      # Merge / Revert / fixup! 等自动信息
        checked += 1
        problems = _msgrules.problems(body)
        if problems:
            bad.append((sha[:8], subject, problems))

    print(f"检查了 {checked} 个提交的信息")

    if bad:
        print(f"\n❌ {len(bad)} 个提交的信息不合规：\n", file=sys.stderr)
        for sha, subject, problems in bad:
            print(f"  {sha}  {subject}", file=sys.stderr)
            for p in problems:
                print(f"      · {p}", file=sys.stderr)
        print(
            "\n规则出处：CLAUDE.md「提交约定」/ AGENTS.md §1。\n"
            "本地想提前拦下来：bash tools/install-hooks.sh\n"
            "（远程多仓库会话里 .claude/settings.json 那条自动路径不生效，"
            "见本文件顶部说明）",
            file=sys.stderr,
        )
        return 1

    print("✅ 提交信息全部合规。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
