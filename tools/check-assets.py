#!/usr/bin/env python3
"""资源/代码分离守卫（铁律 9）。

本仓库以 GPLv3 公开分发。GPLv3 要求分发者对**整份分发物**授予再分发与修改的
权利——而素材（图像、语音、音乐、模型、文本）的版权在各自的版权方手里，
我们没有任何权利去授予。

一个版权文件进了这棵树，后果不是"多了个大文件"：

  * 它让整份 GPLv3 分发变成一个我们**无权做出的授权声明**；
  * git 历史不可逆——删掉它只是让当前 HEAD 干净，历史里那份仍在被分发，
    要真正抹掉得改写历史并强推，而所有下游克隆都不会自动跟着改；
  * 下架请求来的时候，我们能下架的只有资源面，下不了别人手上的克隆。

所以判据是**一个都不能进**，而不是"少放一点"。

三件事，任何一件不成立就红灯：

  1. 扩展名  —— 版权素材格式（图片/音频/视频/3D/Live2D/Cocos/字体）不得入库
  2. 体积    —— 超过阈值的入库文件（素材换个扩展名照样是素材）
  3. 目录名  —— assets/ image/ voice/ 这类资源目录不得出现在入库路径里

素材的正确去处是资源面（COS + EdgeOne CDN），经 `@aio/resource` 的清单
按 ref 取用。见 docs/AIO-ARCHITECTURE.md §五。

不依赖第三方库。
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# 单个入库文件的体积上限。素材可以换扩展名，换不掉体积。
# 取 256 KiB：本仓库现存最大的入库文件是 package-lock.json（约 48 KiB），
# 余量充足；而任何一张有意义的游戏立绘都远超这个数。
MAX_FILE_BYTES = 256 * 1024

# 版权素材格式。分类只为报错时说人话，判定上一视同仁。
ASSET_EXTS: dict[str, tuple[str, ...]] = {
    "图片": (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tga", ".dds", ".ico"),
    "音频": (".mp3", ".ogg", ".wav", ".m4a", ".flac", ".hca", ".acb", ".awb", ".aac"),
    "视频": (".mp4", ".webm", ".mkv", ".usm", ".mov", ".avi"),
    "3D/模型": (".fbx", ".glb", ".gltf", ".obj", ".dae", ".blend", ".anim"),
    "Live2D": (".moc", ".moc3", ".cdi3", ".can3", ".motion3", ".physics3"),
    "Cocos": (".plist", ".exportjson", ".csb", ".ccbi"),
    "字体": (".ttf", ".otf", ".woff", ".woff2", ".ttc"),
    "打包产物": (".zip", ".apk", ".7z", ".rar", ".tar", ".gz", ".xz", ".so", ".dex", ".dll"),
}

# 资源目录名。出现在入库路径的任何一段上都算。
ASSET_DIRS = {
    "assets", "asset", "image", "images", "img", "sprites", "sprite",
    "voice", "voices", "audio", "sound", "sounds", "bgm", "se",
    "movie", "movies", "video", "videos", "models", "model",
    "live2d", "live2d_resources", "scenario", "scenarios", "fonts", "font",
}

# 例外。每条必须写清理由，且**只对具体路径生效**，不接受目录通配。
# 加一条就是在铁律 9 上开一个口子，请当成改铁律来审。
ALLOW: dict[str, str] = {
    # 锁文件天生会长，且是纯文本依赖图，不含任何版权素材。
    "package-lock.json": "npm 锁文件：纯文本依赖图，体积随依赖数增长",
    # 该文件是 sourceKey 到 Reader/ADV 标识的压缩 JSON 交叉表，不含剧情或媒体内容；
    # EdgeOne 与搜索站需要读取完整表，体积随可路由搜索行数量增长。
    "story-router/story-routes.json": "Story Router 纯文本路由交叉表：只含来源键、目标标识和版本元数据",
    # GPLv3 全文约 35 KiB，本来就该原样入库。
    "LICENSE": "GPLv3 许可证全文，必须逐字保留",
}

errors: list[str] = []


def err(path: str, msg: str) -> None:
    errors.append(f"{path}: {msg}")


def human(n: float) -> str:
    for unit in ("B", "KiB", "MiB", "GiB"):
        if n < 1024 or unit == "GiB":
            return f"{int(n)} B" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0
    return str(n)


def tracked_files() -> tuple[list[str], bool]:
    """入库文件清单。「进仓库」说的是被 git 跟踪，不是躺在工作区里。

    拿不到 git 时退回文件系统遍历——**宁可多查也不放行**：这条铁律的代价
    是不可逆的，不适用「找不到解释器就放行」那套。
    """
    try:
        proc = subprocess.run(
            ["git", "-C", str(ROOT), "ls-files", "-z"],
            capture_output=True,
            text=True,
            check=True,
        )
        return [p for p in proc.stdout.split("\0") if p], True
    except (OSError, subprocess.CalledProcessError):
        skip = {".git", "node_modules", "dist", "build", ".venv"}
        out: list[str] = []
        for p in ROOT.rglob("*"):
            if not p.is_file():
                continue
            rel = p.relative_to(ROOT)
            if any(part in skip for part in rel.parts):
                continue
            out.append(rel.as_posix())
        return out, False


def kind_of(name: str) -> str | None:
    lowered = name.lower()
    for kind, exts in ASSET_EXTS.items():
        for ext in exts:
            if lowered.endswith(ext):
                return kind
    return None


def main() -> int:
    files, from_git = tracked_files()

    for rel in files:
        if rel in ALLOW:
            continue

        name = pathlib.PurePosixPath(rel).name

        kind = kind_of(name)
        if kind is not None:
            err(rel, f"{kind}素材不得入库——素材走资源面（见 docs/AIO-ARCHITECTURE.md §五）")

        parts = pathlib.PurePosixPath(rel).parts[:-1]
        hit = next((seg for seg in parts if seg.lower() in ASSET_DIRS), None)
        if hit is not None:
            err(rel, f"路径里有资源目录 {hit!r}／——资源目录不得出现在代码树里")

        full = ROOT / rel
        try:
            size = full.stat().st_size
        except OSError:
            continue
        if size > MAX_FILE_BYTES:
            err(rel, f"体积 {human(size)} 超过上限 {human(MAX_FILE_BYTES)}——素材换个扩展名还是素材")

    print(f"扫描 {len(files)} 个入库文件" + ("" if from_git else "（未经 git，已退回文件系统遍历）"))

    if errors:
        print(f"\n❌ 铁律 9（资源与代码分离）被破坏，{len(errors)} 处：\n", file=sys.stderr)
        for e in errors:
            print(f"  {e}", file=sys.stderr)
        print(
            "\n素材的去处是资源面（COS + EdgeOne CDN），由 @aio/resource 的清单按 ref 取用。\n"
            "确有非素材文件被误伤，在 tools/check-assets.py 的 ALLOW 里按路径登记并写明理由——\n"
            "那等同于改铁律，请当成改铁律来审。",
            file=sys.stderr,
        )
        return 1

    print("✅ 资源与代码分离：未发现版权素材入库。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
