# -*- coding: utf-8 -*-
"""pre-push 钩子：把 AGENTS.md §0 的分支纪律与 §1 的提交规范变成硬拦截。

装法见 tools/install-hooks.sh。

## 拦什么

四件事，互相独立，各有各的逃生口。

### 一、本次推送新增的提交，信息不合规（§1）

判据与 commit-msg 完全一致（共用 _msgrules.py）。之所以在推送时再查一遍：
commit-msg 只管得住「提交这个动作发生在这份克隆里」，在别处提交再推进来的
它看不见——而那正是兄弟仓库当初出事的形状。

只查**本次推送新增的**提交（`remote..local`，新建分支则是
`local --not --remotes=<远端>`），另加时间闸 CUTOFF_EPOCH，早于它的不查。
既不翻旧账，也不会因为历史里有老提交就把第一次推送卡死。
合并提交（多个父）跳过——那是 git 自己生成的信息。

逃生口：`SKIP_MSG_HOOK=1 git push ...`

### 二、新建远端分支（§0）

只有**新建**这一个动作。已存在的分支继续推、推 main、删分支，都放行。
本仓库直接提 main，白名单只有 main / hotfix/* / surgery/*。
名字像 CI 触发器的（ci/*、build/*、*-driver-*、*-success、9 位以上数字的
run-id）一律拦——见 AGENTS.md §2。日期后缀 -YYYYMMDD 是 8 位，不会误伤。

逃生口：`SKIP_BRANCH_HOOK=1 git push ...`

### 三、发布禁令被单方面解除（§4，本仓库版的「禁止更改」）

`repository-policy.json` 里标 `publish: forbidden` 的源**不得进入任何公开面**。
这类约束通常**不是本项目做出的判断**（典型来源：上游 CI 强制的部署禁令、
含真实用户数据的归档），本项目只是执行方。把某一条改成 allowed，
`tools/check-sources.py` 的守卫对它就整个失效了，而且**不会报错**——
契约会变得「自洽」，只是自洽在错误的前提上。

判据不写死是哪几个源：**逐提交比对前后两版**，凡是先前为 forbidden 的条目
被删掉或被改成 allowed，就拦。这样新加的禁令自动受保护，
而不必记得回来改这个钩子。

所以：凡本次推送新增的提交动了 repository-policy.json 或 docs/CONSTRAINTS.md，
改动后两条禁令必须仍在，否则拦。判据是「禁令还在」而不是「文件不许动」——
措辞修正、补细节、加新仓库都放行。

逃生口：`SKIP_POLICY_HOOK=1 git push ...`（改了禁令还硬要推，向维护者交代）

### 四、红灯期间推 main

只在往 main 推时查。联网问 GitHub API：main 上最近一次跑完的 `checks`
workflow 是什么结论。是 failure（红灯）时，本次推送新增的提交必须全是
修复类（标题以 `fix(` / `fix:` / `revert` 开头）。查不到一律放行并提示——
护栏坏了让路，不锁仓库。

逃生口：`SKIP_REDLIGHT_HOOK=1 git push ...`
"""

import json
import os
import re
import subprocess
import sys
import time

HOOK_NAME = "pre-push"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import _msgrules                                          # noqa: E402
except ImportError:
    sys.stderr.write(
        "\n⚠ %s: 找不到同目录下的 _msgrules.py（提交信息判据），本次跳过检查。\n"
        "  它是两个钩子共用的判据模块，必须和它们放在一起。\n"
        "  正确装法是让 core.hooksPath 指向整个目录：bash tools/install-hooks.sh\n"
        "  ——而不是把单个钩子文件拷进 .git/hooks/。\n\n" % HOOK_NAME)
    sys.exit(0)

# 提交信息检查只查这个时刻之后的提交（2026-08-20 00:00 UTC，本检查上线时）。
CUTOFF_EPOCH = 1787184000
MAX_COMMITS = 200                 # 单次推送最多查这么多（护栏不是审计）

ALLOW = (re.compile(r"^main$"), re.compile(r"^hotfix/"), re.compile(r"^surgery/"))
CI_SHAPED = (
    re.compile(r"^ci/"), re.compile(r"^build/"),
    re.compile(r"-driver-"), re.compile(r"-success$"),
    # 分支名里带 run-id 这种长数字。**9 位起**，不是 8 位：仓库命名习惯带
    # -YYYYMMDD 日期后缀，8 位会把每一条按规矩起名的分支都误判成 CI 触发器。
    # GitHub 的 run-id 是 11 位，两者不会撞。
    re.compile(r"\d{9,}"),
)
RECENT_HOURS = 2.0

FIXISH = re.compile(r"^\s*(fix[(：:]|revert)", re.IGNORECASE)
REDLIGHT_API = ("https://api.github.com/repos/{slug}/actions/workflows/"
                "checks.yml/runs?branch=main&status=completed&per_page=1")
REDLIGHT_TIMEOUT = 15

POLICY_JSON = "repository-policy.json"
POLICY_DOC = "docs/CONSTRAINTS.md"
# 文档侧的双条件标记：防只留标题、正文被掏空。
DOC_MARKERS = ("## 一、公开面许可", "❌ **禁止**")


def sh(*a):
    return subprocess.run(a, capture_output=True, text=True, timeout=120)


def allowed(name):
    return any(p.search(name) for p in ALLOW)


def parse_stdin():
    """stdin: <local ref> <local sha> <remote ref> <remote sha>，逐行。

    全零 OID = 「不存在」；长度随哈希算法变（SHA-1 40 / SHA-256 64），
    所以按「全是 0」判，别写死 40。
    """
    out = []
    for line in sys.stdin.read().split("\n"):
        parts = line.split()
        if len(parts) != 4:
            continue
        _, local_sha, remote_ref, remote_sha = parts
        if not remote_ref.startswith("refs/heads/"):
            continue
        if set(local_sha) == {"0"}:                  # 删除分支，放行
            continue
        out.append((local_sha, remote_ref[len("refs/heads/"):], remote_sha))
    return out


def remote_name():
    """git 把远端名作为第一个参数传给 pre-push。取不到就退回 origin。"""
    return sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else "origin"


def new_commits(local_sha, remote_sha):
    """本次推送**新增**的提交 SHA 列表（不含合并提交）。"""
    if set(remote_sha) != {"0"}:
        rng = ["%s..%s" % (remote_sha, local_sha)]
    else:
        # 远端名取自 git 传进来的参数，不写死 origin——推到 fork 之类的第二个
        # 远端时，写死会拿错排除集，把对方早就有的提交当成新增的重查一遍。
        rng = [local_sha, "--not", "--remotes=%s" % remote_name()]
    r = sh("git", "rev-list", "--no-merges",
           "--max-count=%d" % MAX_COMMITS, *rng)
    if r.returncode != 0:
        return []                                    # 算不出来就不查（fail-open）
    return [x for x in r.stdout.split() if x]


def iter_new(refs):
    """遍历本次推送新增的提交，去重。"""
    seen = set()
    for local_sha, branch, remote_sha in refs:
        for sha in new_commits(local_sha, remote_sha):
            if sha in seen:
                continue
            seen.add(sha)
            yield sha, branch


# ── 一、提交信息 ──────────────────────────────────────────────

def check_messages(refs):
    bad = []
    for sha, branch in iter_new(refs):
        r = sh("git", "log", "-1", "--format=%ct%x1f%B", sha)
        if r.returncode != 0:
            continue
        ts, _, raw = r.stdout.partition("\x1f")
        try:
            if int(ts.strip()) < CUTOFF_EPOCH:       # 历史提交不翻旧账
                continue
        except ValueError:
            continue
        probs = _msgrules.problems(raw)
        if probs:
            subj = (raw.strip().split("\n") or [""])[0][:60]
            bad.append((sha[:8], branch, subj, probs))
    return bad


def report_messages(bad):
    sys.stderr.write("\n✘ push 被 pre-push 钩子拦下：%d 个提交的信息不合规\n\n"
                     % len(bad))
    for sha, branch, subj, probs in bad:
        sys.stderr.write("  %s (%s)  %s\n" % (sha, branch, subj))
        for p in probs:
            sys.stderr.write("      · %s\n" % p.replace("\n      ", "\n        "))
        sys.stderr.write("\n")
    sys.stderr.write("  这一道查的是**本次推送新增的**提交——commit-msg 只管得住在\n"
                     "  这份克隆里做的提交，在别处提交再推进来的它看不见。\n\n")
    sys.stderr.write("  改法: 重写这几条的信息（git rebase -i / git commit --amend）\n")
    sys.stderr.write("  规则出处: CLAUDE.md「提交约定」/ AGENTS.md §1\n")
    sys.stderr.write("  确需跳过: SKIP_MSG_HOOK=1 git push ...\n\n")


# ── 三、发布禁令保全 ──────────────────────────────────────────

def file_at(sha, path):
    r = sh("git", "show", "%s:%s" % (sha, path))
    return None if r.returncode != 0 else r.stdout


def forbidden_set(content):
    """这一版策略文件里，哪些源标着 publish=forbidden。

    解析 JSON 而不是搜字符串：重排字段、改缩进、加键都不该误报，
    而把 forbidden 改成 allowed 必须报。解析不了返回 None（交给 CI，不在这拦）。
    """
    if content is None:
        return None
    try:
        data = json.loads(content)
    except Exception:
        return None
    repos = data.get("repositories") or {}
    return {name for name, e in repos.items()
            if isinstance(e, dict) and e.get("publish") == "forbidden"}


def bans_weakened(sha, path):
    """与父提交比，有没有哪条 forbidden 被删掉或改成了 allowed。

    **不写死是哪几个源**——写死的话，以后新加的禁令不会被保护，
    而加禁令的人不会想到回来改这个钩子。返回被削弱的源名，没有就是空集。
    """
    before = forbidden_set(file_at("%s^" % sha, path))
    after = forbidden_set(file_at(sha, path))
    if before is None or after is None:
        return set()                                 # 任一版解析不了就不拦
    return before - after


def check_policy(refs):
    bad = []
    for sha, branch in iter_new(refs):
        r = sh("git", "diff-tree", "--no-commit-id", "--name-only", "-r", sha,
               "--", POLICY_JSON, POLICY_DOC)
        if r.returncode != 0:
            continue
        for path in r.stdout.split():
            after = file_at(sha, path)
            if after is None:                        # 文件被整个删掉，拦
                bad.append((sha[:8], branch, path, "文件被删除"))
                continue
            if path == POLICY_JSON:
                lost = bans_weakened(sha, path)
                if lost:
                    bad.append((sha[:8], branch, path,
                                "publish=forbidden 被解除：" + "、".join(sorted(lost))))
            else:
                if not all(m in after for m in DOC_MARKERS):
                    bad.append((sha[:8], branch, path, "公开面禁令段落标记不在了"))
    return bad


def report_policy(bad):
    sys.stderr.write("\n✘ push 被 pre-push 钩子拦下：%d 处改动删除了发布禁令\n\n"
                     % len(bad))
    for sha, branch, path, why in bad:
        sys.stderr.write("  %s (%s)  %s：%s\n" % (sha, branch, path, why))
    sys.stderr.write("\n  被保护的是 repository-policy.json 里所有 publish=forbidden 的条目。\n"
                     "  这类约束通常不是本项目的判断，是既有约束（上游 CI 强制的部署禁令、\n"
                     "  含真实用户数据的归档等），本项目只是执行方。把某条改成 allowed，\n"
                     "  tools/check-sources.py 对它的守卫就整个失效——而且不报错，\n"
                     "  契约只是变得「自洽」在错误的前提上。\n\n")
    sys.stderr.write("  规则出处: AGENTS.md §4 / docs/CONSTRAINTS.md 一\n"
                     "  确需跳过: SKIP_POLICY_HOOK=1 git push ...\n\n")


# ── 四、红灯闸门 ──────────────────────────────────────────────

def repo_slug():
    r = sh("git", "remote", "get-url", remote_name())
    if r.returncode != 0:
        return None
    m = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?$", r.stdout.strip())
    return m.group(1) if m else None


def remote_main_is_red():
    slug = repo_slug()
    if not slug:
        return None
    import urllib.request
    req = urllib.request.Request(
        REDLIGHT_API.format(slug=slug),
        headers={"Accept": "application/vnd.github+json",
                 "User-Agent": "aio-pre-push-hook"})
    try:
        with urllib.request.urlopen(req, timeout=REDLIGHT_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        runs = data.get("workflow_runs") or []
        if not runs:
            return None
        return runs[0].get("conclusion") == "failure"
    except Exception:
        return None


def check_redlight(refs):
    main_refs = [(l, b, r) for l, b, r in refs if b == "main"]
    if not main_refs:
        return []
    red = remote_main_is_red()
    if red is None:
        sys.stderr.write("pre-push: 红灯状态查询失败（网络/API），本次跳过红灯闸门\n")
        return []
    if not red:
        return []
    bad = []
    for sha, _ in iter_new(main_refs):
        r = sh("git", "log", "-1", "--format=%s", sha)
        if r.returncode == 0 and not FIXISH.search(r.stdout.strip()):
            bad.append((sha[:8], r.stdout.strip()))
    return bad


def report_redlight(bad):
    sys.stderr.write("\n✘ push 被 pre-push 钩子拦下：main 现在是 🔴 红灯\n\n"
                     "  最近一次 checks 失败。红灯期间只许修复主线的提交\n"
                     "  （标题以 fix( / fix: / revert 开头），本次推送里有\n"
                     "  %d 个提交不属于修复类：\n\n" % len(bad))
    for sha, subj in bad:
        sys.stderr.write("      %s  %s\n" % (sha, subj[:60]))
    sys.stderr.write("\n  规则出处: CONTRIBUTING.md「红灯协议」\n"
                     "  确需跳过: SKIP_REDLIGHT_HOOK=1 git push ...\n\n")


# ── 二、分支纪律 ──────────────────────────────────────────────

def check_branches(refs):
    new_branches = [b for _, b, remote_sha in refs if set(remote_sha) == {"0"}]
    problems = []
    for name in new_branches:
        if allowed(name):
            continue
        if any(p.search(name) for p in CI_SHAPED):
            problems.append(
                "`%s` 的名字像 CI 触发器。\n"
                "      AGENTS.md §2：**永远不要用分支触发 CI**。" % name)
            continue
        problems.append("`%s` 是一条新的非白名单分支。" % name)
    return problems


# ── 五、资源与代码分离（铁律 9）────────────────────────────────

_ASSET_RULES = []


def asset_rules():
    """借 tools/check-assets.py 的规则表，而不是在这里再抄一份。

    两处各写一份，迟早只改一处——而这条铁律漏一次的代价是 git 历史里
    永久留着一个我们无权以 GPLv3 分发的文件。
    """
    if _ASSET_RULES:
        return _ASSET_RULES[0]
    import importlib.util
    r = sh("git", "rev-parse", "--show-toplevel")
    if r.returncode != 0:
        return None
    path = os.path.join(r.stdout.strip(), "tools", "check-assets.py")
    if not os.path.exists(path):
        return None
    spec = importlib.util.spec_from_file_location("aio_check_assets", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    _ASSET_RULES.append(mod)
    return mod


def check_assets(refs):
    """本次推送新增的提交里，有没有版权素材被加进来。

    查的是提交对象而不是工作区：素材可以在提交之后从工作区删掉，
    但它已经在历史里了，而推上去就再也收不回来。
    """
    mod = asset_rules()
    if mod is None:
        return []                                    # 拿不到规则表就不查（fail-open）
    bad = []
    for sha, _branch in iter_new(refs):
        r = sh("git", "diff-tree", "--no-commit-id", "--name-only", "-r",
               "--diff-filter=AM", sha)
        if r.returncode != 0:
            continue
        for rel in r.stdout.split("\n"):
            rel = rel.strip()
            if not rel or rel in mod.ALLOW:
                continue
            kind = mod.kind_of(rel.rsplit("/", 1)[-1])
            if kind:
                bad.append((sha[:8], rel, kind + "素材"))
                continue
            hit = next((s for s in rel.split("/")[:-1]
                        if s.lower() in mod.ASSET_DIRS), None)
            if hit:
                bad.append((sha[:8], rel, "资源目录 %s/" % hit))
                continue
            sz = sh("git", "cat-file", "-s", "%s:%s" % (sha, rel))
            if sz.returncode != 0:
                continue
            try:
                n = int(sz.stdout.strip())
            except ValueError:
                continue
            if n > mod.MAX_FILE_BYTES:
                bad.append((sha[:8], rel, "体积 %s" % mod.human(n)))
    return bad


def report_assets(bad):
    sys.stderr.write("\n✗ 铁律 9：资源与代码必须分离，版权文件一个都不能进仓库\n\n")
    for sha, rel, why in bad:
        sys.stderr.write("  %s  %s\n      %s\n" % (sha, rel, why))
    sys.stderr.write(
        "\n  本仓库以 GPLv3 公开分发。游戏素材的版权不在我们手里，"
        "把它放进这棵树\n"
        "  等于替版权方做出一个我们无权做出的授权声明。\n"
        "  而且 git 历史不可逆——推上去之后，删掉只让 HEAD 干净，"
        "历史里那份仍在被分发。\n\n"
        "  素材的去处是资源面（COS + EdgeOne CDN），"
        "由 @aio/resource 按 ref 取用。\n"
        "  确认是误伤: 在 tools/check-assets.py 的 ALLOW 里按路径登记并写明理由\n"
        "  确需跳过: SKIP_ASSET_HOOK=1 git push ...  "
        "（等于明知故推，请先想清楚上一段）\n\n")


def report_branches(problems):
    sys.stderr.write("\n✘ push 被 pre-push 钩子拦下：正在新建分支\n\n")
    for i, p in enumerate(problems, 1):
        sys.stderr.write("  %d. %s\n\n" % (i, p))

    r = sh("git", "ls-remote", "--heads", remote_name())
    existing = []
    if r.returncode == 0:
        for line in r.stdout.splitlines():
            p = line.split()
            if len(p) == 2:
                n = p[1].replace("refs/heads/", "")
                if not allowed(n):
                    existing.append((p[0], n))

    fresh = []
    for sha, n in existing:
        t = sh("git", "log", "-1", "--format=%ct", sha)
        if t.returncode != 0:
            # 本地没有这个对象，取回来再问一次。**只写 FETCH_HEAD，不建 ref**——
            # 建 ref 没人清理，越攒越多，还会让被删分支的对象一直可达。
            if sh("git", "fetch", "--quiet", remote_name(), n).returncode != 0:
                continue
            t = sh("git", "log", "-1", "--format=%ct", "FETCH_HEAD")
        if t.returncode == 0 and t.stdout.strip():
            try:
                h = (time.time() - int(t.stdout.strip())) / 3600.0
                if h < RECENT_HOURS:
                    fresh.append((n, h))
            except ValueError:
                pass

    if fresh:
        sys.stderr.write("  远端有 %.0f 小时内刚动过的分支——"
                         "AGENTS.md §0 规则三：接着用它，不许再开：\n" % RECENT_HOURS)
        for n, h in fresh:
            sys.stderr.write("      %s（%.1f 小时前）\n" % (n, h))
        sys.stderr.write("\n")
    elif existing:
        sys.stderr.write("  远端已有非白名单分支——AGENTS.md §0 规则二："
                         "全会话只许一条：\n")
        for _, n in existing:
            sys.stderr.write("      %s\n" % n)
        sys.stderr.write("\n")
    else:
        sys.stderr.write("  本仓库**直接提 main，没有 PR 流程**"
                         "（AGENTS.md §0 规则一）。\n"
                         "  多数情况根本不需要分支：\n"
                         "      git push -u origin main\n\n")

    sys.stderr.write("  确需跳过: SKIP_BRANCH_HOOK=1 git push ...\n\n")


def main():
    refs = parse_stdin()
    if not refs:
        return 0

    rc = 0
    for env, name, check, report in (
        ("SKIP_MSG_HOOK", "提交信息检查", check_messages, report_messages),
        ("SKIP_POLICY_HOOK", "发布禁令检查", check_policy, report_policy),
        ("SKIP_REDLIGHT_HOOK", "红灯闸门", check_redlight, report_redlight),
        ("SKIP_BRANCH_HOOK", "分支纪律检查", check_branches, report_branches),
        ("SKIP_ASSET_HOOK", "资源分离检查", check_assets, report_assets),
    ):
        if os.environ.get(env):
            sys.stderr.write("pre-push: %s=1，跳过%s\n" % (env, name))
            continue
        try:
            bad = check(refs)
        except Exception:
            bad = []                                 # fail-open，单项出错不牵连其余
        if bad:
            report(bad)
            rc = 1
    return rc


if __name__ == "__main__":
    # 顶层 fail-open：检查自身出了任何意外，都**放行**并把 traceback 打出来。
    try:
        sys.exit(main())
    except Exception:
        import traceback
        sys.stderr.write(
            "\n⚠ " + HOOK_NAME + ": 检查自身出错，本次放行。"
            "请把下面这段贴给维护者：\n")
        traceback.print_exc()
        sys.exit(0)
