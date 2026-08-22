#!/usr/bin/env python3
"""build-manifest.py 的自测。

素材全部是**当场造的空文件**，不是游戏资源（铁律 9）。这里验的是规则与失败
路径——尤其是那几条「不报错就会错得很难查」的：匹配不上要失败、role 认不出
要失败、同一 ref 下 role 撞了要失败。
"""

from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "build-manifest.py"

failures: list[str] = []


def make(files: dict[str, bytes]) -> pathlib.Path:
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="aio-manifest-"))
    for rel, data in files.items():
        p = tmp / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    return tmp


def run(root: pathlib.Path, *extra: str) -> tuple[int, str, str]:
    proc = subprocess.run(
        [sys.executable, "-X", "utf8", str(TOOL), str(root),
         "--universe", "a", "--kind", "sprite",
         "--pattern", r"(?P<id>\d+)/(?P<variant>[a-z_]+)\.",
         "--ref", "{id}/{variant}", *extra],
        capture_output=True, text=True, encoding="utf-8",
    )
    return proc.returncode, proc.stdout, proc.stderr


def check(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  ✓ {label}")
    else:
        failures.append(f"{label}{chr(10) + detail if detail else ''}")


def main() -> int:
    print("正常路径：")
    root = make({
        "100100/d_r.ExportJson": b"{}",
        "100100/d_r.plist": b"<plist/>",
        "100100/d_r.png": b"\x89PNG",
        "100101/m_l.ExportJson": b"{}",
    })
    try:
        code, out, err = run(root, "--prefix", "sprite/")
        doc = json.loads(out) if code == 0 else {}
        check("生成成功", code == 0, err)
        check("ref 由 universe/kind/模板拼出，不从路径推",
              set(doc.get("entries", {})) == {"a:sprite/100100/d_r", "a:sprite/100101/m_l"},
              str(list(doc.get("entries", {}))))
        parts = doc.get("entries", {}).get("a:sprite/100100/d_r", {}).get("parts", [])
        check("role 按扩展名判", sorted(p["role"] for p in parts) == ["atlas", "definition", "texture"])
        check("带上 prefix", all(p["path"].startswith("sprite/") for p in parts))
        check("每份都有 sha256 与 bytes",
              all(len(p["sha256"]) == 64 and isinstance(p["bytes"], int) for p in parts))

        # 两次生成必须逐字节相同，否则没法拿 diff 看变了什么。
        code2, out2, _ = run(root, "--prefix", "sprite/")
        check("输出确定：同一批素材两次生成逐字节相同", code2 == 0 and out == out2)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print("\n.gz 预压缩：")
    root = make({"100100/d_r.png.gz": b"\x1f\x8b"})
    try:
        code, out, err = run(root)
        doc = json.loads(out) if code == 0 else {}
        part = doc.get("entries", {}).get("a:sprite/100100/d_r", {}).get("parts", [{}])[0]
        check("role 按去掉 .gz 后的真实类型判", part.get("role") == "texture", str(part))
        check("记下 encoding=gzip", part.get("encoding") == "gzip", str(part))
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print("\n--role 强制指定：")
    root = make({"100100/d_r.json": b"{}", "100101/m_l.json": b"{}"})
    try:
        code, out, err = run(root, "--role", "profile")
        doc = json.loads(out) if code == 0 else {}
        parts = doc.get("entries", {}).get("a:sprite/100100/d_r", {}).get("parts", [{}])
        # 按扩展名 .json 会被判成 script，插件按 profile 取就取不到。
        check("role 用指定的那个，不按扩展名判", parts[0].get("role") == "profile", err or str(parts))
    finally:
        shutil.rmtree(root, ignore_errors=True)

    root = make({"100100/d_r.xyz": b"x"})
    try:
        code, _, err = run(root, "--role", "profile")
        check("--role 也能救认不出扩展名的文件", code == 0, err)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print("\n失败路径（都必须非零退出）：")
    root = make({"100100/d_r.png": b"x", "杂项/readme.txt": b"x"})
    try:
        code, _, err = run(root)
        check("匹配不上 --pattern 时整次失败，而不是悄悄跳过",
              code != 0 and "匹配不上" in err, err)
        code, _, _ = run(root, "--allow-unmapped")
        check("--allow-unmapped 时才放行", code == 0)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    root = make({"100100/d_r.xyz": b"x"})
    try:
        code, _, err = run(root)
        check("认不出 role 时失败，不给它编一个", code != 0 and "认不出 role" in err, err)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    # 两个不同文件被规则并到同一条 ref 且 role 相同——后写的会盖掉前一个。
    root = make({"100100/d_r.png": b"a", "100100/d_r.jpg": b"b"})
    try:
        code, _, err = run(root)
        check("同一 ref 下 role 撞了要失败——否则线上表现为「显示了另一个东西」",
              code != 0 and "两个 role" in err, err)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    if failures:
        print(f"\n❌ 自测失败 {len(failures)} 项：", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        return 1
    print("\n✅ 清单生成器自测通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
