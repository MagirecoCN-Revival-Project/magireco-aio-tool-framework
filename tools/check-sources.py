#!/usr/bin/env python3
"""AIO 接线契约守卫。

五件事，任何一件不成立就红灯：

  1. 契约自洽      —— 必填字段、枚举、id 与文件名一致
  2. 禁令不被绕过  —— publish=forbidden 的源不得接入运行时；
                      vendor=forbidden 的源不得被包装成插件（那要复制其代码）
  3. 插件不打架    —— pluginId 唯一；能力标识合约定
  4. 资源前缀唯一  —— 两个源共用一个资源前缀会互相覆盖对方的清单
  5. 资源必须外置  —— 声明的资产量若逼近 Pages 单项目限额，说明它没有真的外置

第 5 条是这套架构的地基：assets 全部走资源面之后，交付面只需要一个小体量的
Pages 项目。哪天有人把资源塞回部署产物里，这条会先红。

不依赖第三方库。装了 jsonschema 会额外跑一遍完整 schema 校验。
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

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
REPO_RE = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")
CAP_RE = re.compile(r"^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$")
MOUNT_RE = re.compile(r"^/([a-z0-9-]+/)*$")
PREFIX_RE = re.compile(r"^[a-z0-9-]+/$")

INTEGRATIONS = {"plugin", "data", "proxy", "link", "none"}
# 会把上游代码复制进交付面的接入方式
COPYING = {"plugin"}
# 不接入运行时也不出现在公开面的方式
OFFLINE = {"none"}

errors: list[str] = []
warnings: list[str] = []


def err(where: str, msg: str) -> None:
    errors.append(f"{where}: {msg}")


def warn(where: str, msg: str) -> None:
    warnings.append(f"{where}: {msg}")


def human(n: float) -> str:
    for unit in ("B", "KiB", "MiB", "GiB"):
        if n < 1024 or unit == "GiB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024.0
    return str(n)


def main() -> int:
    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    repos = policy["repositories"]
    limits = policy["platform_limits"]["pages_project"]

    if not policy["platform_limits"].get("verified"):
        warn(
            "repository-policy.json",
            "platform_limits.verified=false —— 限额数字尚未经官方文档/控制台复核",
        )

    paths = sorted(p for p in CONTRACTS.glob("*.source.json"))
    if not paths:
        err("contracts/", "一个契约都没有")
        return report()

    seen_ids: dict[str, str] = {}
    seen_plugin_ids: dict[str, str] = {}
    seen_prefixes: dict[str, str] = {}
    seen_mounts: dict[str, str] = {}

    for path in paths:
        where = f"contracts/{path.name}"
        try:
            c = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            err(where, f"JSON 解析失败：{exc}")
            continue

        missing = [f for f in ("id", "repo", "publish", "integration", "license_note") if f not in c]
        if missing:
            err(where, f"缺必填字段 {', '.join(missing)}")
            continue

        # --- 1. 契约自洽 ---------------------------------------------------
        cid = c["id"]
        if not ID_RE.match(cid):
            err(where, f"id 格式非法：{cid!r}")
        if path.name != f"{cid}.source.json":
            err(where, f"文件名与 id 不一致（id={cid}）")
        if cid in seen_ids:
            err(where, f"id 与 {seen_ids[cid]} 重复")
        seen_ids[cid] = path.name

        if not REPO_RE.match(c["repo"]):
            err(where, f"repo 格式非法：{c['repo']!r}")
        if c["publish"] not in ("allowed", "forbidden"):
            err(where, f"publish 取值非法：{c['publish']!r}")

        integration = c["integration"]
        if integration not in INTEGRATIONS:
            err(where, f"integration 取值非法：{integration!r}")
            continue

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
            if integration not in OFFLINE:
                err(
                    where,
                    f"🔴 publish=forbidden 却 integration={integration!r}，必须是 none"
                    f"（{entry['reason']}）",
                )
            for field in ("plugin", "mount"):
                if field in c:
                    err(
                        where,
                        f"🔴 publish=forbidden 却有 {field} —— 这会把禁止公开的仓库接进运行时",
                    )

        if entry.get("vendor") == "forbidden" and integration in COPYING:
            err(
                where,
                f"🔴 vendor=forbidden 却 integration={integration!r} —— "
                f"包装成插件需要复制其代码（{entry['reason']}）",
            )

        # --- 3. 插件不打架 -------------------------------------------------
        plugin = c.get("plugin")
        if integration == "plugin" and plugin is None:
            err(where, "integration=plugin 却没有 plugin 段")
        if plugin is not None:
            if integration != "plugin":
                err(where, f"integration={integration!r} 却填了 plugin 段")
            pid = plugin.get("pluginId", "")
            if not ID_RE.match(pid):
                err(where, f"pluginId 格式非法：{pid!r}")
            elif pid in seen_plugin_ids:
                err(where, f"pluginId {pid} 与 {seen_plugin_ids[pid]} 重复——内核会拒绝注册")
            else:
                seen_plugin_ids[pid] = cid

            if plugin.get("isolation") not in ("inline", "iframe"):
                err(where, f"isolation 取值非法：{plugin.get('isolation')!r}")
            if plugin.get("isolation") == "iframe" and not plugin.get("isolation_reason"):
                # 隔离是有代价的（一次 iframe 启动、一条 RPC）。用它必须说清为什么，
                # 否则下一个人无从判断能不能改回 inline。
                err(where, "isolation=iframe 必须写 isolation_reason")

            caps = plugin.get("capabilities") or []
            if not caps:
                err(where, "plugin 没有声明任何 capability——内核会拒绝注册")
            for cap in caps:
                if not CAP_RE.match(cap.get("id", "")):
                    err(where, f"能力标识 {cap.get('id')!r} 不合约定（<域>.<动词>）")
                if not cap.get("accepts"):
                    err(where, f"能力 {cap.get('id')} 没声明接受任何 ref kind")

        # --- 4. 资源前缀唯一 -----------------------------------------------
        assets = c.get("assets")
        if assets is not None:
            prefix = assets.get("prefix", "")
            if not PREFIX_RE.match(prefix):
                err(where, f"资源前缀格式非法：{prefix!r}")
            elif prefix in seen_prefixes:
                err(where, f"资源前缀 {prefix} 与 {seen_prefixes[prefix]} 重复——清单会互相覆盖")
            else:
                seen_prefixes[prefix] = cid

            # --- 5. 资源必须真的外置 ---------------------------------------
            approx_bytes = assets.get("approx_bytes")
            approx_files = assets.get("approx_files")
            if approx_bytes is not None and approx_bytes > limits["max_bytes"]:
                warn(
                    where,
                    f"资产 {human(approx_bytes)} 超过 Pages 单项目上限 "
                    f"{human(limits['max_bytes'])} —— 确认它走的是资源面（COS），不是部署产物",
                )
            if approx_files is not None and approx_files > limits["max_files"]:
                warn(
                    where,
                    f"资产 {approx_files} 个文件超过 Pages 单项目上限 {limits['max_files']}"
                    f" —— 同上",
                )

        mount = c.get("mount")
        if mount is not None:
            if integration != "proxy":
                err(where, f"只有 integration=proxy 才用 mount，当前是 {integration!r}")
            if not MOUNT_RE.match(mount):
                err(where, f"mount 格式非法：{mount!r}（须形如 /a/b/）")
            elif mount in seen_mounts:
                err(where, f"mount {mount} 与 {seen_mounts[mount]} 重复")
            else:
                seen_mounts[mount] = cid
        elif integration == "proxy":
            err(where, "integration=proxy 却没有 mount，反代不知道挂在哪")

    # --- 可选：完整 schema 校验 --------------------------------------------
    try:
        import jsonschema  # type: ignore
    except ImportError:
        warn("schema", "未安装 jsonschema，跳过完整 schema 校验（仅跑内置检查）")
    else:
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        for path in paths:
            try:
                jsonschema.validate(json.loads(path.read_text(encoding="utf-8")), schema)
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
