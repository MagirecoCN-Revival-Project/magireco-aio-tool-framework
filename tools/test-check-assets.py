#!/usr/bin/env python3
"""check-assets.py 的自测：喂它坏样本，确认它真的拦得下来。

与 test-check-sources.py 同一套路数。铁律 9 的代价是不可逆的（git 历史里的
版权文件删不干净），所以这里的坏样本要覆盖"素材伪装"的几种常见形状，而不只是
一个明摆着的 .png。
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

failures: list[str] = []


def sandbox() -> pathlib.Path:
    """搭一个最小的假仓库：只要有 tools/check-assets.py，脚本就把它当 ROOT。"""
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="aio-assets-"))
    (tmp / "tools").mkdir()
    shutil.copy2(ROOT / "tools" / "check-assets.py", tmp / "tools" / "check-assets.py")
    # 一份正常的源码文件，确保守卫不是"见谁咬谁"
    (tmp / "packages").mkdir()
    (tmp / "packages" / "index.ts").write_text("export const ok = 1;\n", encoding="utf-8")
    return tmp


def run(work: pathlib.Path) -> tuple[int, str]:
    proc = subprocess.run(
        [sys.executable, str(work / "tools" / "check-assets.py")],
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def expect_blocked(label: str, build) -> None:
    work = sandbox()
    try:
        build(work)
        code, out = run(work)
        if code == 0:
            failures.append(f"{label}：应该被拦下，但守卫放行了\n{out}")
        else:
            print(f"  ✓ 拦下：{label}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def expect_pass(label: str, build) -> None:
    work = sandbox()
    try:
        build(work)
        code, out = run(work)
        if code != 0:
            failures.append(f"{label}：不该被拦，但守卫红灯了\n{out}")
        else:
            print(f"  ✓ 放行：{label}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def write(work: pathlib.Path, rel: str, data: bytes | str = b"x") -> None:
    p = work / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        p.write_text(data, encoding="utf-8")
    else:
        p.write_bytes(data)


def main() -> int:
    print("坏样本（必须全部被拦下）：")

    expect_blocked("立绘 png 直接入库", lambda w: write(w, "ui/chara_1001.png"))
    expect_blocked("语音 hca 入库", lambda w: write(w, "packages/vo_1001.hca"))
    expect_blocked("Live2D moc3 入库", lambda w: write(w, "packages/model.moc3"))
    expect_blocked("Cocos plist 入库", lambda w: write(w, "packages/mini_100100.plist"))
    expect_blocked("字体入库", lambda w: write(w, "apps/demo/MTF4a5kp.ttf"))
    expect_blocked("影片 webm 入库", lambda w: write(w, "packages/movie_01.webm"))
    expect_blocked("3D 模型 fbx 入库", lambda w: write(w, "packages/chara.fbx"))
    expect_blocked("打包产物 apk 入库", lambda w: write(w, "dist-release.apk"))

    # 伪装：换扩展名躲开黑名单，但体积躲不掉
    expect_blocked(
        "素材改名成 .txt（体积超限）",
        lambda w: write(w, "packages/blob.txt", b"A" * (300 * 1024)),
    )
    # 伪装：目录名暴露意图，哪怕文件本身是文本
    expect_blocked("资源目录 assets/ 出现在代码树", lambda w: write(w, "assets/list.json", "{}"))
    expect_blocked("资源目录 image/ 出现在代码树", lambda w: write(w, "apps/image/manifest.json", "{}"))
    expect_blocked("资源目录 voice/ 出现在代码树", lambda w: write(w, "packages/voice/index.ts", "//"))

    print("\n好样本（必须放行）：")

    expect_pass("纯源码树", lambda w: write(w, "packages/kernel/src/kernel.ts", "//"))
    expect_pass(
        "ALLOW 登记的锁文件即使很大",
        lambda w: write(w, "package-lock.json", "{}" + " " * (300 * 1024)),
    )
    expect_pass("契约 JSON", lambda w: write(w, "contracts/foo.source.json", "{}"))
    expect_pass("文档与 Markdown", lambda w: write(w, "docs/AIO-ARCHITECTURE.md", "# 架构"))

    if failures:
        print(f"\n❌ 自测失败 {len(failures)} 项：\n", file=sys.stderr)
        for f in failures:
            print(f"  {f}\n", file=sys.stderr)
        return 1

    print("\n✅ 守卫自测通过：坏样本全部拦下，好样本全部放行。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
