#!/usr/bin/env python3
"""AIO 接线契约守卫。

六件事，任何一件不成立就红灯：

  1. 契约自洽      —— 必填字段、枚举、id 与文件名一致
  2. 禁令不被绕过  —— publish=forbidden 的源不得接入运行时；
                      vendor=forbidden 的源不得被包装成插件（那要复制其代码）
  3. 插件不打架    —— pluginId 唯一；能力标识合约定
  4. 资源前缀唯一  —— 两个源共用一个资源前缀会互相覆盖对方的清单
  5. 资源必须外置  —— 声明的资产量若逼近 Pages 单项目限额，说明它没有真的外置
  6. 能力表对账    —— 横着的 capabilities.json 与竖着的 *.source.json 必须一致

第 5 条是这套架构的地基：assets 全部走资源面之后，交付面只需要一个小体量的
Pages 项目。哪天有人把资源塞回部署产物里，这条会先红。

第 6 条补的是一个视角缺口：契约按上游仓库分（一个仓库一份），而「某能力有几个
实现、当前用哪个」是横着切的，两份文件里谁也看不出全貌。看不出全貌，那条判据
（少装一个模块宿主依然自洽）就没法查。

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
CAPABILITIES = CONTRACTS / "capabilities.json"
CAP_SCHEMA = CONTRACTS / "capabilities.schema.json"
PACKAGES = ROOT / "packages"
# 能力契约的唯一出处。这里只按行抓 id，抓不到就跳过而不是报错——
# 一个会误报的检查比没有检查更糟。
CONTRACT_TS = PACKAGES / "capability" / "src" / "index.ts"

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
    by_id: dict[str, dict] = {}

    for path in paths:
        where = f"contracts/{path.name}"
        try:
            c = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            err(where, f"JSON 解析失败：{exc}")
            continue
        if isinstance(c.get("id"), str):
            by_id[c["id"]] = c

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

    # --- 6. 能力表对账 ------------------------------------------------------
    check_capabilities(by_id)

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
        if CAPABILITIES.is_file() and CAP_SCHEMA.is_file():
            try:
                jsonschema.validate(
                    json.loads(CAPABILITIES.read_text(encoding="utf-8")),
                    json.loads(CAP_SCHEMA.read_text(encoding="utf-8")),
                )
            except jsonschema.ValidationError as exc:
                err("contracts/capabilities.json", f"schema 校验失败：{exc.message}")

    return report()


def declared_contracts() -> set[str] | None:
    """`@aio/capability` 里登记了哪些能力契约。抓不到返回 None。"""
    if not CONTRACT_TS.is_file():
        return None
    found = set(
        re.findall(
            r"^\s*id:\s*'([a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+)'",
            CONTRACT_TS.read_text(encoding="utf-8"),
            re.M,
        )
    )
    # 一个都没抓到多半是文件写法变了，而不是真的一个契约都没有。
    # 这时候报错等于误报，宁可跳过（与兄弟仓库那条 d8 检查同一条判断）。
    return found or None


def check_capabilities(by_id: dict[str, dict]) -> None:
    """横着的能力表与竖着的契约对账。"""
    where = "contracts/capabilities.json"
    if not CAPABILITIES.is_file():
        err(where, "能力登记表不存在——「某能力有几个实现」就没有出处了")
        return
    try:
        table = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        err(where, f"JSON 解析失败：{exc}")
        return

    caps = table.get("capabilities")
    if not isinstance(caps, dict) or not caps:
        err(where, "capabilities 段是空的")
        return

    # 同一个实现可以提供多个能力（上游 adv-player 就同时提供 adv.play 与
    # live2d.show）。允许它出现多次，但各处属性必须一致——不一致意味着
    # 有人只改了一处，而两处说的是同一个 PluginManifest。
    seen_impl: dict[str, tuple[str, dict]] = {}
    # 能力表声称的「某上游提供某能力」，用来与竖着的契约双向对账。
    claimed: set[tuple[str, str]] = set()

    for cap_id, cap in sorted(caps.items()):
        at = f"{where} [{cap_id}]"
        if not CAP_RE.match(cap_id):
            err(at, f"能力标识 {cap_id!r} 不合约定（<域>.<动词>）")

        impls = cap.get("implementations") or []
        if not impls:
            err(at, "一个实现都没有——那它不是能力，是个名字")
            continue

        ready: list[str] = []
        has_own = False
        for impl in impls:
            iid = impl.get("id", "")
            origin = impl.get("origin")
            if origin not in ("own", "wrapper", "upstream"):
                err(at, f"实现 {iid!r} 的 origin 取值非法：{origin!r}")
                continue
            if origin == "own":
                has_own = True
            if origin in ("own", "wrapper"):
                ready.append(iid)

            # note 是「这个实现在这项能力下的说明」，两处不同很正常；
            # 其余字段说的是同一个 PluginManifest，必须一致。
            shape = {k: v for k, v in impl.items() if k != "note"}
            prev = seen_impl.get(iid)
            if prev is not None and prev[1] != shape:
                err(
                    at,
                    f"实现 {iid} 在 {prev[0]} 与这里的属性不一致（{prev[1]} ≠ {shape}）——"
                    f"两处说的是同一个 PluginManifest，只改一处就是让表自相矛盾",
                )
            seen_impl.setdefault(iid, (cap_id, shape))

            # own/wrapper 必须真有那个包，否则「缺省装它」到启动时才发现装不上。
            if origin in ("own", "wrapper"):
                pkg = impl.get("package")
                if not pkg:
                    err(at, f"实现 {iid} 是 {origin}，必须写 package")
                else:
                    check_package(at, iid, pkg)
            elif impl.get("package"):
                err(at, f"实现 {iid} 是 upstream，不该有 package（代码不在本仓库）")

            # wrapper/upstream 必须指向一份存在的契约，且那份契约得认这件事。
            if origin in ("wrapper", "upstream"):
                src = impl.get("source")
                if not src:
                    err(at, f"实现 {iid} 是 {origin}，必须写 source 指向对应契约")
                else:
                    claimed.add((src, cap_id))
                    check_source(at, cap_id, iid, src, impl, by_id)
            elif impl.get("source"):
                err(at, f"实现 {iid} 是 own（从零写的），不该指向任何上游契约")

        default = cap.get("default")
        if default is None:
            if ready:
                err(
                    at,
                    f"default 是 null，但本仓库里已有可装的实现（{'、'.join(ready)}）——"
                    f"宿主不知道该装哪个",
                )
        elif default not in ready:
            # 指向一个装不上的实现，宿主启动时才发现少一项能力。
            err(
                at,
                f"default={default!r} 不在本仓库可装的实现里"
                f"（{'、'.join(ready) or '一个都没有'}）",
            )

        if not has_own:
            # 不是错，是风险：这一项能力目前只能靠上游提供，而维护者的约束是
            # 「不改上游」。留成 ⚠️ 让它一直可见，别等到要用时才发现。
            warn(at, "没有 origin=own 的实现——这一项能力目前离不开上游")

    # 竖着的契约声明了某能力，横着的表里却没登记它 → 表立刻失真。
    for cid, c in sorted(by_id.items()):
        for cap in (c.get("plugin") or {}).get("capabilities") or []:
            cap_id = cap.get("id")
            if cap_id and (cid, cap_id) not in claimed:
                err(
                    f"contracts/{cid}.source.json",
                    f"声明了能力 {cap_id}，但 capabilities.json 里没把它登记成 {cid} 的实现",
                )

    declared = declared_contracts()
    if declared is None:
        warn(where, "抓不到 @aio/capability 里的契约清单，跳过这一项对账")
        return
    for cap_id in sorted(set(caps) - declared):
        # 没有契约的能力没法做一致性测试，宿主也无从知道它能被怎么用。
        warn(where, f"{cap_id} 没有对应的能力契约（packages/capability），一致性套件覆盖不到它")
    for cap_id in sorted(declared - set(caps)):
        # ADR 0002：没有一个能跑的实现，契约一定设计错。所以这条是硬的。
        err(where, f"@aio/capability 有 {cap_id} 的契约，却没有任何实现登记在册")


MANIFEST_ID_RE = re.compile(r"^\s*id: '([a-z0-9][a-z0-9-]*)',", re.M)


def check_package(at: str, iid: str, pkg: str) -> None:
    if not PACKAGES.is_dir():
        return
    name = pkg.split("/")[-1]
    manifest = PACKAGES / name / "package.json"
    if not manifest.is_file():
        err(at, f"实现 {iid} 指向 {pkg}，但 packages/{name}/package.json 不存在")
        return
    try:
        actual = json.loads(manifest.read_text(encoding="utf-8")).get("name")
    except json.JSONDecodeError as exc:
        err(at, f"packages/{name}/package.json 解析失败：{exc}")
        return
    if actual != pkg:
        err(at, f"实现 {iid} 写的是 {pkg}，packages/{name}/package.json 里是 {actual!r}")
        return

    # 实现 id 就是 PluginManifest.id，内核按它注册、宿主按 default 找它。
    # 两边对不上的后果不是报错，是「缺省的那个实现装上了却没人认得」。
    entry = PACKAGES / name / "src" / "index.ts"
    if not entry.is_file():
        return
    found = MANIFEST_ID_RE.findall(entry.read_text(encoding="utf-8"))
    # 不止一个就说明这个正则认错了形状——宁可跳过也不误报。
    if len(found) != 1:
        return
    if found[0] != iid:
        err(at, f"实现 id 是 {iid!r}，但 {pkg} 的 manifest 里写的是 {found[0]!r}")


def check_source(
    at: str, cap_id: str, iid: str, src: str, impl: dict, by_id: dict[str, dict]
) -> None:
    c = by_id.get(src)
    if c is None:
        err(at, f"实现 {iid} 的 source={src!r} 没有对应的 contracts/{src}.source.json")
        return
    if c.get("publish") == "forbidden":
        # 铁律 7：两条发布禁令不得解除。能力表是公开面的装配单。
        err(at, f"🔴 实现 {iid} 指向 publish=forbidden 的 {src}——那不进任何公开面")
    if c.get("integration") != "plugin":
        err(at, f"实现 {iid} 指向 {src}，但那份契约的 integration 是 {c.get('integration')!r}")
        return

    plugin = c.get("plugin") or {}
    if plugin.get("pluginId") != iid:
        err(
            at,
            f"实现 id {iid!r} 与 contracts/{src}.source.json 的 "
            f"pluginId {plugin.get('pluginId')!r} 不一致——内核按这个 id 注册",
        )
    if cap_id not in [x.get("id") for x in plugin.get("capabilities") or []]:
        err(at, f"contracts/{src}.source.json 没声明能力 {cap_id}，能力表却把它记在这儿")
    for field in ("isolation", "usesWebGL"):
        if field in impl and field in plugin and impl[field] != plugin[field]:
            err(
                at,
                f"实现 {iid} 的 {field}={impl[field]!r} 与 "
                f"contracts/{src}.source.json 的 {plugin[field]!r} 不一致",
            )


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
