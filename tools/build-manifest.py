#!/usr/bin/env python3
"""资源清单生成器（AIO-ROADMAP Phase 2.2）。

扫一个目录，出一份 `@aio/resource` 能吃的清单：

    {version, universe, kind, generated, entries: {ref: {parts: [{path, role, bytes, sha256}]}}}

路线图把 2.1（桶）+ 2.2（本工具）标成关键路径。**2.2 不需要域名、账号或
桶权限**，所以它先做——清单能离线生成、离线校验，等桶开好直接上传。

## 这个工具最重要的一条：它不猜 ref

从文件路径推 ref 是**必须由人给规则**的事，不是工具能自己判断的：

  - 命名空间 a的 `100100` 与 命名空间 b 的 `100101` 同号不同人（铁律 1）；
  - 「charaId + 服装号 = 精灵 unit」这条看着成立的规律，实测不成立（铁律 2）。

所以规则由 `--pattern` 显式给出（带命名组的正则），**匹配不上的文件一律
报出来并让整次生成失败**，而不是悄悄跳过。悄悄跳过的后果是清单看着生成成功，
线上却少了一批资源，而且没人知道少了哪些。

## 用法

    python3 tools/build-manifest.py ASSETS_DIR \\
        --universe a --kind sprite \\
        --pattern '(?P<id>\\d+)/(?P<variant>[a-z_]+)\\.' \\
        --ref '{id}/{variant}' \\
        --out manifest.mr.sprite.json

`--ref` 是模板，用 `--pattern` 抓到的命名组填。ref 最终形如
`a:sprite/100100/d_r`——universe 与 kind 来自参数，不从路径推。

## 不入库的是素材，不是清单

清单只含**路径与校验和**，不含任何素材字节，所以它入库是安全的（铁律 9）。
`tools/check-assets.py` 查的是素材本身。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
from datetime import datetime, timezone

# 扩展名 → role。role 是插件按名索取的键（`fetchPart(ref, 'texture')`）。
# 认不出来的扩展名**不给它编一个 role**——插件按错的 role 取会拿到错的文件。
ROLES: dict[str, str] = {
    ".exportjson": "definition",
    ".plist": "atlas",
    ".png": "texture",
    ".jpg": "texture",
    ".jpeg": "texture",
    ".webp": "texture",
    ".json": "script",
    ".gltf": "model",
    ".glb": "model",
    ".fbx": "model",
    ".moc3": "moc",
    ".model3": "model",
    ".motion3": "motion",
    ".exp3": "expression",
    ".physics3": "physics",
    ".mp3": "audio",
    ".ogg": "audio",
    ".wav": "audio",
    ".hca": "audio",
    ".webm": "movie",
    ".mp4": "movie",
}

CHUNK = 1 << 20


def sha256_of(path: pathlib.Path) -> tuple[str, int]:
    """流式算，不把整个文件读进内存——素材动辄几十 MB。"""
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as fh:
        while True:
            block = fh.read(CHUNK)
            if not block:
                break
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def role_of(rel: str) -> tuple[str | None, str | None]:
    """返回 (role, encoding)。认不出来返回 (None, …)，由调用方报错。"""
    lowered = rel.lower()
    encoding: str | None = None
    if lowered.endswith(".gz"):
        # 预压缩产物：role 按去掉 .gz 之后的真实类型判，
        # 并记下 encoding 让前端知道服务端会带 Content-Encoding。
        encoding = "gzip"
        lowered = lowered[: -len(".gz")]

    # 先试双段扩展名（.model3.json / .motion3.json 这类），再试单段。
    parts = lowered.split(".")
    if len(parts) >= 3:
        two = f".{parts[-2]}"
        if two in ROLES:
            return ROLES[two], encoding
    one = pathlib.PurePosixPath(lowered).suffix
    return ROLES.get(one), encoding


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="生成资源清单")
    ap.add_argument("root", type=pathlib.Path, help="素材目录")
    ap.add_argument("--universe", required=True, choices=["a", "b"])
    ap.add_argument("--kind", required=True)
    ap.add_argument("--pattern", required=True, help="带命名组的正则，用来从相对路径抓 ref 的段")
    ap.add_argument("--ref", required=True, help="ref 模板，如 '{id}/{variant}'")
    ap.add_argument("--out", type=pathlib.Path, help="输出文件，缺省打到标准输出")
    ap.add_argument("--prefix", default="", help="给每条 path 加的前缀，如 'sprite/'")
    ap.add_argument(
        "--allow-unmapped",
        action="store_true",
        help="允许匹配不上的文件（默认失败）。用它之前请先想清楚少的是哪些",
    )
    args = ap.parse_args(argv)

    if not args.root.is_dir():
        print(f"❌ {args.root} 不是目录", file=sys.stderr)
        return 2
    try:
        pattern = re.compile(args.pattern)
    except re.error as err:
        print(f"❌ --pattern 不是合法正则：{err}", file=sys.stderr)
        return 2

    entries: dict[str, dict[str, list[dict[str, object]]]] = {}
    unmapped: list[str] = []
    unknown_role: list[str] = []
    total_bytes = 0

    files = sorted(p for p in args.root.rglob("*") if p.is_file())
    for path in files:
        rel = path.relative_to(args.root).as_posix()

        match = pattern.search(rel)
        if match is None:
            unmapped.append(rel)
            continue

        role, encoding = role_of(rel)
        if role is None:
            # 编一个 role 出来，插件按它取会拿到错的文件——宁可报出来。
            unknown_role.append(rel)
            continue

        try:
            ref_tail = args.ref.format(**match.groupdict())
        except KeyError as err:
            print(f"❌ --ref 用到了 --pattern 里没有的组 {err}", file=sys.stderr)
            return 2

        ref = f"{args.universe}:{args.kind}/{ref_tail}"
        digest, size = sha256_of(path)
        total_bytes += size

        part: dict[str, object] = {
            "path": f"{args.prefix}{rel}",
            "role": role,
            "bytes": size,
            "sha256": digest,
        }
        if encoding is not None:
            part["encoding"] = encoding

        entry = entries.setdefault(ref, {"parts": []})
        # 同一条 ref 下 role 撞了，说明规则把两个不同资源并成了一条——
        # 后写的会盖掉前一个，且**不报错**。这类错在线上表现为「显示了另一个东西」。
        if any(p["role"] == role for p in entry["parts"]):
            print(
                f"❌ {ref} 下出现两个 role={role}：{rel}\n"
                f"   规则把不同资源并到了同一条 ref 上，请收紧 --pattern / --ref",
                file=sys.stderr,
            )
            return 1
        entry["parts"].append(part)

    if unmapped and not args.allow_unmapped:
        print(f"❌ {len(unmapped)} 个文件匹配不上 --pattern：", file=sys.stderr)
        for rel in unmapped[:20]:
            print(f"   {rel}", file=sys.stderr)
        if len(unmapped) > 20:
            print(f"   …还有 {len(unmapped) - 20} 个", file=sys.stderr)
        print(
            "   悄悄跳过的后果是清单看着生成成功，线上却少了一批资源，"
            "而且没人知道少了哪些。\n"
            "   确认这些本来就不该进清单，再用 --allow-unmapped。",
            file=sys.stderr,
        )
        return 1

    if unknown_role and not args.allow_unmapped:
        print(f"❌ {len(unknown_role)} 个文件的扩展名认不出 role：", file=sys.stderr)
        for rel in unknown_role[:20]:
            print(f"   {rel}", file=sys.stderr)
        print("   在 tools/build-manifest.py 的 ROLES 里登记它，或确认它不该进清单。", file=sys.stderr)
        return 1

    # 排序输出：同一批素材两次生成应当逐字节相同，否则没法拿 diff 看变了什么。
    doc = {
        "version": 1,
        "universe": args.universe,
        "kind": args.kind,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "entries": {
            ref: {"parts": sorted(entry["parts"], key=lambda p: (p["role"], p["path"]))}
            for ref, entry in sorted(entries.items())
        },
    }
    text = json.dumps(doc, ensure_ascii=False, indent=2, sort_keys=False) + "\n"

    if args.out is not None:
        args.out.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)

    print(
        f"✅ {len(entries)} 条 ref、{sum(len(e['parts']) for e in entries.values())} 份文件、"
        f"{total_bytes / 1024 / 1024:.1f} MiB"
        + (f"（跳过 {len(unmapped) + len(unknown_role)} 个）" if args.allow_unmapped else ""),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
