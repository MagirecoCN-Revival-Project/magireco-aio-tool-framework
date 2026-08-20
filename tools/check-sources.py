#!/usr/bin/env python3
"""AIO 接线契约守卫。

四件事，任何一件不成立就红灯：

  1. 契约自洽      —— 必填字段、枚举、路径格式、id 与文件名一致
  2. 禁令不被绕过  —— publish=forbidden 的源不得有 mount / pages_project；
                      vendor=forbidden 的源不得被 build/static 方式复制进交付面
  3. 挂载不打架    —— 挂载路径不重复、不互为前缀；Pages 项目名不重复
  4. 预算不超限    —— 每个 Pages 项目的预算必须小于平台限额

第 4 条是这个脚本存在的主要理由：撞 EdgeOne Pages 限额时不会报错，
只会部署失败或者文件静默缺失，等发现时已经在线上了。

不依赖第三方库。装了 jsonschema 的话会额外跑一遍完整 schema 校验。
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
POLICY = ROOT / "repository-policy.json"
CONTRACTS = ROOT / "contracts"
SCHEMA = CONTRACTS / "aio-source.schema.json"

MOUNT_RE = re.compile(r"^/([a-z0-9-]+/)*$")
PROJECT_RE = re.compile(r"^aio-[a-z0-9-]+$")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
REPO_RE = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")

INTEGRATIONS = {"build", "static", "proxy", "link", "none"}
# 会把上游内容复制进我们的交付面的接入方式——vendor=forbidden 的源不许用
COPYING = {"build", "static"}

errors: list[str] = []
warnings: list[str] = []


def err(where: str, msg: str) -> None:
    errors.append(f"{where}: {msg}")


def warn(where: str, msg: str) -> None:
    warnings.append(f"{where}: {msg}")


def human(n: int) -> str:
    for unit in ("B", "KiB", "MiB", "GiB"):
        if n < 1024 or unit == "GiB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024.0
    return str(n)


def main() -> int:
    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    repos = policy["repositories"]
    limits = policy["platform_limits"]["pages_project"]

    if not policy["platform_limits"].get("verified"):
        warn(
            "repository-policy.json",
            "platform_limits.verified=false —— 限额数字尚未经官方文档/控制台复核，"
            "预算检查的结论只在这些数字正确时成立",
        )

    paths = sorted(p for p in CONTRACTS.glob("*.source.json"))
    if not paths:
        err("contracts/", "一个契约都没有")
        return report()

    seen_ids: dict[str, pathlib.Path] = {}
    seen_mounts: dict[str, str] = {}
    seen_projects: dict[str, str] = {}

    for path in paths:
        where = f"contracts/{path.name}"
        try:
            c = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            err(where, f"JSON 解析失败：{exc}")
            continue

        # --- 1. 契约自洽 ---------------------------------------------------
        for field in ("id", "repo", "publish", "license_note"):
            if field not in c:
                err(where, f"缺必填字段 {field}")
        if errors and where in errors[-1]:
            continue

        cid = c["id"]
        if not ID_RE.match(cid):
            err(where, f"id 格式非法：{cid!r}")
        if path.name != f"{cid}.source.json":
            err(where, f"文件名与 id 不一致（id={cid}）")
        if cid in seen_ids:
            err(where, f"id 与 {seen_ids[cid].name} 重复")
        seen_ids[cid] = path

        if not REPO_RE.match(c["repo"]):
            err(where, f"repo 格式非法：{c['repo']!r}")
        if c["publish"] not in ("allowed", "forbidden"):
            err(where, f"publish 取值非法：{c['publish']!r}")

        integration = c.get("integration", "none")
        if integration not in INTEGRATIONS:
            err(where, f"integration 取值非法：{integration!r}")

        # --- 2. 禁令不被绕过 -----------------------------------------------
        entry = repos.get(c["repo"])
        if entry is None:
            err(where, f"{c['repo']} 未在 repository-policy.json 登记")
            continue

        if entry["publish"] != c["publish"]:
            err(
                where,
                f"publish 与策略不符：契约写 {c['publish']}，"
                f"repository-policy.json 写 {entry['publish']}",
            )

        if c["publish"] == "forbidden":
            for field in ("mount", "pages_project"):
                if field in c:
                    err(
                        where,
                        f"🔴 publish=forbidden 却有 {field}={c[field]!r} —— "
                        f"这会把禁止公开的仓库挂上公开面（{entry['reason']}）",
                    )
            if integration != "none":
                err(
                    where,
                    f"🔴 publish=forbidden 却 integration={integration!r}，必须是 none",
                )

        if entry.get("vendor") == "forbidden" and integration in COPYING:
            err(
                where,
                f"🔴 vendor=forbidden 却 integration={integration!r} —— "
                f"该方式会把上游内容复制进交付面（{entry['reason']}）",
            )

        # --- 3. 挂载不打架 -------------------------------------------------
        mount = c.get("mount")
        if mount is not None:
            if not MOUNT_RE.match(mount):
                err(where, f"mount 格式非法：{mount!r}（须形如 /a/b/）")
            elif mount in seen_mounts:
                err(where, f"mount {mount} 与 {seen_mounts[mount]} 重复")
            else:
                for other, owner in seen_mounts.items():
                    if mount.startswith(other) or other.startswith(mount):
                        err(
                            where,
                            f"mount {mount} 与 {owner} 的 {other} 互为前缀，路由会打架",
                        )
                seen_mounts[mount] = cid

        project = c.get("pages_project")
        if project is not None:
            if not PROJECT_RE.match(project):
                err(where, f"pages_project 格式非法：{project!r}（须以 aio- 开头）")
            elif project in seen_projects:
                err(where, f"pages_project {project} 与 {seen_projects[project]} 重复")
            else:
                seen_projects[project] = cid

        if integration in COPYING and project is None:
            err(where, f"integration={integration} 却没有 pages_project")
        if integration == "proxy":
            # 反代是一条 EdgeOne 路由规则，不部署产物，因此不占 Pages 项目、
            # 也没有预算可言。给它配一个项目名说明有人搞混了这两件事。
            if project is not None:
                err(where, f"integration=proxy 却占了 pages_project={project!r}")
            if mount is None:
                err(where, "integration=proxy 却没有 mount，反代不知道挂在哪")

        # --- 4. 预算不超限 -------------------------------------------------
        budget = c.get("budget")
        if project is not None and budget is None:
            err(where, f"{project} 没有 budget —— 预算无人看管就会撞限额")
        if project is None and budget is not None:
            err(where, "没有 pages_project 却填了 budget —— 这份预算不对应任何部署")
        if budget is not None:
            if budget["files"] > limits["max_files"]:
                err(
                    where,
                    f"预算文件数 {budget['files']} 超过单项目上限 {limits['max_files']}",
                )
            if budget["bytes"] > limits["max_bytes"]:
                err(
                    where,
                    f"预算体积 {human(budget['bytes'])} 超过单项目上限 "
                    f"{human(limits['max_bytes'])}",
                )
            if not budget.get("measured", False):
                warn(where, f"budget 仍是估算值（measured=false），上线前必须实测回填")

    # --- 可选：完整 schema 校验 --------------------------------------------
    try:
        import jsonschema  # type: ignore
    except ImportError:
        warn("schema", "未安装 jsonschema，跳过完整 schema 校验（仅跑内置检查）")
    else:
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        for path in paths:
            try:
                jsonschema.validate(
                    json.loads(path.read_text(encoding="utf-8")), schema
                )
            except jsonschema.ValidationError as exc:
                err(f"contracts/{path.name}", f"schema 校验失败：{exc.message}")

    return report()


def report() -> int:
    for w in warnings:
        print(f"⚠️  {w}")
    if errors:
        print()
        for e in errors:
            print(f"❌ {e}")
        print(f"\n{len(errors)} 项不合规。")
        return 1
    print(f"\n✅ 契约检查通过（{len(list(CONTRACTS.glob('*.source.json')))} 个源）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
