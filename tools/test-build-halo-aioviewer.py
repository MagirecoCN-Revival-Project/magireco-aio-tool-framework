#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

MODULE_PATH = Path(__file__).with_name("build-halo-aioviewer.py")
SPEC = importlib.util.spec_from_file_location("build_halo_aioviewer", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class HaloBridgeBuildTests(unittest.TestCase):
    def test_replaces_legacy_ui_and_preserves_only_backend_shell(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base = root / "base.jar"
            output = root / "bridge.jar"
            with ZipFile(base, "w") as archive:
                archive.writestr("run/halo/aio/viewer/AioViewerPlugin.class", b"fixture-class")
                archive.writestr("META-INF/plugin-components.idx", b"fixture-index")
                archive.writestr("ui/main.old.js", b"chart.height search.query /aio-viewer")
            MODULE.build(base, output)
            with ZipFile(output) as archive:
                names = set(archive.namelist())
                main = archive.read("ui/main.js").decode("utf-8")
                manifest = archive.read("META-INF/MANIFEST.MF").decode("utf-8")
        self.assertNotIn("ui/main.old.js", names)
        self.assertIn("ui/story-router-contract.js", names)
        self.assertIn("/aio-story-router", main)
        self.assertIn("Implementation-Version: 0.2.0", manifest)


if __name__ == "__main__":
    unittest.main()
