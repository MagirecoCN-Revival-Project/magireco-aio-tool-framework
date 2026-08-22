#!/usr/bin/env python3
"""Repackage the Halo aioviewer shell as an optional Story Router bridge."""

from __future__ import annotations

import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = ROOT / "integrations" / "halo-aioviewer"
BACKEND_ENTRIES = (
    "run/halo/aio/viewer/AioViewerPlugin.class",
    "META-INF/plugin-components.idx",
)
TEXT_ENTRIES = {
    "META-INF/MANIFEST.MF": (
        "Manifest-Version: 1.0\n"
        "Plugin-Main-Class: run.halo.app.plugin.BasePlugin\n"
        "Build-Jdk-Spec: 21\n"
        "Implementation-Title: aio-story-router-bridge\n"
        "Implementation-Version: 0.2.0\n\n"
    ),
    "plugin.yaml": (INTEGRATION / "plugin.yaml"),
    "ui/ui-plugin.json": (INTEGRATION / "ui" / "ui-plugin.json"),
    "ui/main.js": (INTEGRATION / "ui" / "main.js"),
    "ui/story-router-contract.js": (INTEGRATION / "ui" / "story-router-contract.js"),
    "ui/style.css": (INTEGRATION / "ui" / "style.css"),
}


def archive_info(name: str) -> ZipInfo:
    info = ZipInfo(name, date_time=(2026, 8, 22, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    return info


def text_bytes(value: str | Path) -> bytes:
    text = value if isinstance(value, str) else value.read_text(encoding="utf-8")
    return text.replace("\r\n", "\n").encode("utf-8")


def build(base_jar: Path, output: Path) -> None:
    if not base_jar.is_file():
        raise RuntimeError(f"base JAR does not exist: {base_jar}")
    with ZipFile(base_jar) as source:
        names = set(source.namelist())
        missing = [name for name in BACKEND_ENTRIES if name not in names]
        if missing:
            raise RuntimeError(f"base JAR lacks Halo backend entries: {', '.join(missing)}")
        backend = {name: source.read(name) for name in BACKEND_ENTRIES}

    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w") as target:
        for name, data in backend.items():
            target.writestr(archive_info(name), data)
        for name, value in TEXT_ENTRIES.items():
            target.writestr(archive_info(name), text_bytes(value))

    with ZipFile(output) as built:
        built_names = set(built.namelist())
        expected = set(BACKEND_ENTRIES) | set(TEXT_ENTRIES)
        if built_names != expected:
            raise RuntimeError("built JAR entry set diverged")
        main = built.read("ui/main.js").decode("utf-8")
        forbidden = ("chart.height", "search.query", "/aio-viewer")
        if any(token in main for token in forbidden):
            raise RuntimeError("legacy standalone Viewer code remains in the bridge")
        if "/aio-story-router" not in main or "buildStoryRouterUrl" not in main:
            raise RuntimeError("Story Router Halo route is missing")
    print(f"Halo Story Router bridge: {output} ({output.stat().st_size} bytes)")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-jar", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.base_jar, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
