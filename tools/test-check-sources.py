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
    for item in ("repository-policy.json", "contracts", "tools"):
        src = ROOT / item
        dst = tmp / item
        if src.is_dir():
            shutil.copytree(src, dst)
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
    c = load(work, "wiki-data.source.json")
    c["integration"] = "plugin"
    save(work, "wiki-data.source.json", c)


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
    c = load(work, "wiki-data.source.json")
    c["mount"] = "/codex/"
    save(work, "wiki-data.source.json", c)


@case("契约 publish 与策略不符", "publish 与策略不符")
def _(work):
    c = load(work, "wiki-data.source.json")
    c["publish"] = "allowed"
    save(work, "wiki-data.source.json", c)


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
    c = load(work, "call-search.source.json")
    c["plugin"]["pluginId"] = "model-3d"
    save(work, "call-search.source.json", c)


@case("资源前缀重复", "清单会互相覆盖")
def _(work):
    c = load(work, "kyu-sprite.source.json")
    c["assets"]["prefix"] = "3d/"
    save(work, "kyu-sprite.source.json", c)


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
    c = load(work, "kyu-sprite.source.json")
    del c["plugin"]["isolation_reason"]
    save(work, "kyu-sprite.source.json", c)


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
