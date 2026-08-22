#!/usr/bin/env python3
"""check-sources.py 的自测：喂它坏样本，确认它真的拦得下来。

一个拦不下任何东西的检查等于没有检查，而它比没有检查更糟——因为它会让人
以为有人在看着。所以每加一条规则，就在这里加一个会触发它的坏样本。
"""

from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent


def run(work: pathlib.Path) -> tuple[int, str]:
    proc = subprocess.run(
        [sys.executable, str(work / "tools" / "check-sources.py")],
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def sandbox() -> pathlib.Path:
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="aio-guard-"))
    # packages 也要复制：能力表的对账要查包是否真存在、能力契约里登记了哪些 id。
    # 少复制它，那几条检查在沙箱里会静静跳过，于是坏样本「拦下来了」是假的。
    for item in ("repository-policy.json", "contracts", "tools", "packages"):
        src = ROOT / item
        dst = tmp / item
        if src.is_dir():
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns("node_modules", "dist"))
        else:
            shutil.copy2(src, dst)
    return tmp


def load(work: pathlib.Path, name: str) -> dict:
    return json.loads((work / "contracts" / name).read_text(encoding="utf-8"))


def save(work: pathlib.Path, name: str, data: dict) -> None:
    (work / "contracts" / name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


# 每个坏样本：(名字, 改动函数, 输出里必须出现的片段)
CASES = []


def case(name: str, needle: str):
    def deco(fn):
        CASES.append((name, fn, needle))
        return fn

    return deco


@case("禁发仓库被接进运行时", "必须是 none")
def _(work):
    c = load(work, "example-restricted-data.source.json")
    c["integration"] = "plugin"
    save(work, "example-restricted-data.source.json", c)


@case("禁发仓库被配了插件段", "却有 plugin")
def _(work):
    c = load(work, "example-user-archive.source.json")
    c["plugin"] = {
        "pluginId": "lab",
        "isolation": "inline",
        "capabilities": [{"id": "lab.open", "accepts": ["character"]}],
    }
    save(work, "example-user-archive.source.json", c)


@case("禁发仓库被挂上反代路由", "却有 mount")
def _(work):
    c = load(work, "example-restricted-data.source.json")
    c["mount"] = "/codex/"
    save(work, "example-restricted-data.source.json", c)


@case("契约 publish 与策略不符", "publish 与策略不符")
def _(work):
    c = load(work, "example-restricted-data.source.json")
    c["publish"] = "allowed"
    save(work, "example-restricted-data.source.json", c)


@case("无许可仓库被包装成插件", "vendor=forbidden")
def _(work):
    c = load(work, "example-reader.source.json")
    c["integration"] = "plugin"
    c.pop("mount", None)
    c["plugin"] = {
        "pluginId": "story-reader",
        "isolation": "inline",
        "capabilities": [{"id": "story.read", "accepts": ["scenario"]}],
    }
    save(work, "example-reader.source.json", c)


@case("pluginId 重复", "内核会拒绝注册")
def _(work):
    c = load(work, "example-search-site.source.json")
    c["plugin"]["pluginId"] = "model-3d"
    save(work, "example-search-site.source.json", c)


@case("资源前缀重复", "清单会互相覆盖")
def _(work):
    c = load(work, "example-sprite-mirror.source.json")
    c["assets"]["prefix"] = "3d/"
    save(work, "example-sprite-mirror.source.json", c)


@case("能力标识不合约定", "不合约定")
def _(work):
    c = load(work, "example-model-viewer.source.json")
    c["plugin"]["capabilities"][0]["id"] = "ShowModel"
    save(work, "example-model-viewer.source.json", c)


@case("能力没声明接受任何 kind", "没声明接受")
def _(work):
    c = load(work, "example-model-viewer.source.json")
    c["plugin"]["capabilities"][0]["accepts"] = []
    save(work, "example-model-viewer.source.json", c)


@case("插件没有任何能力", "没有声明任何 capability")
def _(work):
    c = load(work, "example-model-viewer.source.json")
    c["plugin"]["capabilities"] = []
    save(work, "example-model-viewer.source.json", c)


@case("iframe 隔离没写理由", "必须写 isolation_reason")
def _(work):
    c = load(work, "example-sprite-mirror.source.json")
    del c["plugin"]["isolation_reason"]
    save(work, "example-sprite-mirror.source.json", c)


@case("integration=plugin 却没有 plugin 段", "却没有 plugin 段")
def _(work):
    c = load(work, "example-model-viewer.source.json")
    del c["plugin"]
    save(work, "example-model-viewer.source.json", c)


@case("反代却没有挂载路径", "却没有 mount")
def _(work):
    c = load(work, "example-reader.source.json")
    del c["mount"]
    save(work, "example-reader.source.json", c)


@case("非反代却填了挂载路径", "只有 integration=proxy 才用 mount")
def _(work):
    c = load(work, "example-model-viewer.source.json")
    c["mount"] = "/3d/"
    save(work, "example-model-viewer.source.json", c)


@case("仓库未在策略里登记", "未在 repository-policy.json 登记")
def _(work):
    c = load(work, "example-model-viewer.source.json")
    c["repo"] = "someone/unregistered"
    save(work, "example-model-viewer.source.json", c)


@case("文件名与 id 不一致", "文件名与 id 不一致")
def _(work):
    c = load(work, "example-model-viewer.source.json")
    c["id"] = "some-other-id"
    save(work, "example-model-viewer.source.json", c)


# ── 能力登记表（横着的那张）与契约（竖着的那些）对账 ─────────────────────


def impl(work: pathlib.Path, cap: str, iid: str) -> tuple[dict, dict]:
    """取出能力表与其中某个实现，供改坏后 save 回去。"""
    table = load(work, "capabilities.json")
    entry = table["capabilities"][cap]
    for i in entry["implementations"]:
        if i["id"] == iid:
            return table, i
    raise AssertionError(f"{cap} 里没有实现 {iid}")


@case("default 指向一个装不上的实现", "不在本仓库可装的实现里")
def _(work):
    table = load(work, "capabilities.json")
    # sprite-viewer 是上游候选，本仓库没有它的代码——写成缺省，宿主启动时才发现。
    table["capabilities"]["sprite.show"]["default"] = "sprite-viewer"
    save(work, "capabilities.json", table)


@case("有可装的实现却把 default 写成 null", "宿主不知道该装哪个")
def _(work):
    table = load(work, "capabilities.json")
    table["capabilities"]["adv.play"]["default"] = None
    save(work, "capabilities.json", table)


@case("上游契约声明的能力没登记进表", "没把它登记成")
def _(work):
    table = load(work, "capabilities.json")
    caps = table["capabilities"]["sprite.show"]["implementations"]
    table["capabilities"]["sprite.show"]["implementations"] = [
        i for i in caps if i["id"] != "sprite-viewer"
    ]
    save(work, "capabilities.json", table)


@case("有契约的能力一个实现都没有", "却没有任何实现登记在册")
def _(work):
    table = load(work, "capabilities.json")
    del table["capabilities"]["model3d.show"]
    save(work, "capabilities.json", table)


@case("实现 id 与上游契约的 pluginId 对不上", "内核按这个 id 注册")
def _(work):
    table, i = impl(work, "sprite.show", "sprite-viewer")
    i["id"] = "sprite-cocos"
    save(work, "capabilities.json", table)


@case("own 实现指向一个不存在的包", "package.json 不存在")
def _(work):
    table, i = impl(work, "sprite.show", "sprite-play")
    i["package"] = "@aio/plugin-nope"
    save(work, "capabilities.json", table)


@case("实现 id 与包里 manifest 写的对不上", "manifest 里写的是")
def _(work):
    # 缺省的那个实现装上了却没人认得——宿主按 default 去找它，找不到。
    table, i = impl(work, "sprite.show", "sprite-play")
    i["id"] = "sprite-player"
    table["capabilities"]["sprite.show"]["default"] = "sprite-player"
    save(work, "capabilities.json", table)


@case("能力实现指向禁发仓库", "publish=forbidden")
def _(work):
    table, i = impl(work, "sprite.show", "sprite-viewer")
    i["source"] = "example-restricted-data"
    save(work, "capabilities.json", table)


@case("同一实现在两处属性不一致", "自相矛盾")
def _(work):
    table, i = impl(work, "live2d.show", "adv-player")
    i["isolation"] = "inline"
    save(work, "capabilities.json", table)


@case("own 实现却指向上游契约", "不该指向任何上游契约")
def _(work):
    table, i = impl(work, "adv.play", "adv-play")
    i["source"] = "example-adv-live2d"
    save(work, "capabilities.json", table)


@case("能力表整个没了", "「某能力有几个实现」就没有出处了")
def _(work):
    (work / "contracts" / "capabilities.json").unlink()


def main() -> int:
    # 先确认干净的仓库是绿的——会拦下正常配置的检查比没有检查更糟
    work = sandbox()
    code, out = run(work)
    shutil.rmtree(work, ignore_errors=True)
    if code != 0:
        print("❌ 基线：未改动的契约就红灯了\n" + out)
        return 1
    print("✅ 基线：未改动的契约通过")

    failed = 0
    for name, mutate, needle in CASES:
        work = sandbox()
        try:
            mutate(work)
            code, out = run(work)
            if code == 0:
                print(f"❌ {name}：没被拦下")
                failed += 1
            elif needle not in out:
                print(f"❌ {name}：拦下了，但提示里没有 {needle!r}\n{out}")
                failed += 1
            else:
                print(f"✅ {name}")
        finally:
            shutil.rmtree(work, ignore_errors=True)

    print()
    if failed:
        print(f"{failed} / {len(CASES)} 个坏样本没被正确拦下。")
        return 1
    print(f"{len(CASES)} 个坏样本全部被拦下。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
