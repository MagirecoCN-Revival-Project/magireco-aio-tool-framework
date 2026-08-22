#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("build-story-routes.py")
SPEC = importlib.util.spec_from_file_location("build_story_routes", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def write(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


class StoryRouteBuildTests(unittest.TestCase):
    def fixture(self, root: Path) -> tuple[Path, Path, Path, Path]:
        search = root / "story-v6"
        write(search / "manifest.json", {
            "generatedAt": "2026-08-16T01:35:48Z",
            "categories": [
                {"slug": "character", "file": "character.json"},
                {"slug": "main-1", "file": "main-1.json"},
                {"slug": "event", "file": "event.json"},
            ],
        })
        write(search / "character.json", {
            "rows": [["環いろは 1話", ["環いろは"], "summary", ""]],
        })
        write(search / "main-1.json", {
            "rows": [["1章1話", [], "summary", ""]],
        })
        write(search / "event.json", {
            "rows": [["イベント 1話", [], "summary", ""]],
        })
        localization = root / "localization.json"
        write(localization, {"characters": {}, "charactersNormalized": {}})
        reader = root / "story_index.json"
        write(reader, [
            {
                "id": "310011",
                "category": "character_story",
                "folder": "1001 - 环彩羽（環 いろは）",
                "title": "第1话 充满回忆的菜肴 思い出の料理",
                "sections": ["310011-1 Section 1"],
            },
            {
                "id": "101101",
                "category": "main_story",
                "folder": "1011-01 - 第I部 第1章",
                "title": "第1话 小丘比 小さいキュゥべえ",
                "sections": ["101101-1 Section 1"],
            },
            {
                "id": "special-info",
                "category": "Unclassified",
                "folder": "special",
                "title": "",
                "sections": [],
            },
        ])
        overrides = root / "overrides.json"
        write(overrides, {"version": 1, "routes": {}})
        return search, localization, reader, overrides

    def test_builds_only_unique_playable_routes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            search, localization, reader, overrides = self.fixture(Path(directory))
            manifest, report = MODULE.build(search, localization, reader, overrides)
        self.assertEqual(2, len(manifest["routes"]))
        self.assertEqual("20260816t013548z", manifest["catalogRevision"])
        self.assertEqual(manifest["catalogRevision"], report["catalogRevision"])
        self.assertEqual(3, manifest["readerIndexEntries"])
        self.assertEqual(
            [
                "story-v6:20260816t013548z:character:0",
                "story-v6:20260816t013548z:main-1:0",
            ],
            sorted(route["sourceKey"] for route in manifest["routes"]),
        )
        self.assertEqual(2, report["mappedRows"])
        self.assertEqual(1, report["notTargetedRows"])
        self.assertEqual(0, report["advUnavailable"]["total"])

    def test_manual_override_must_resolve_to_reader_and_section(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            search, localization, reader, overrides = self.fixture(root)
            write(overrides, {
                "version": 1,
                "routes": {
                    "story-v6:20260816t013548z:event:0": {
                        "readerId": "310011",
                        "section": "310011-1 Section 1",
                    },
                },
            })
            manifest, report = MODULE.build(search, localization, reader, overrides)
        manual = next(
            route
            for route in manifest["routes"]
            if route["sourceKey"] == "story-v6:20260816t013548z:event:0"
        )
        self.assertEqual("manual", manual["match"])
        self.assertEqual("310011", manual["reader"]["storyId"])
        self.assertEqual("310011-1 Section 1", manual["reader"]["section"])
        self.assertEqual(1, report["manualRoutes"])

    def test_ambiguous_reader_identity_is_left_unmapped(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            search, localization, reader, overrides = self.fixture(root)
            entries = json.loads(reader.read_text(encoding="utf-8"))
            duplicate = dict(entries[0])
            duplicate["id"] = "duplicate-route"
            duplicate["sections"] = ["duplicate-route-1 Section 1"]
            entries.append(duplicate)
            write(reader, entries)
            manifest, _ = MODULE.build(search, localization, reader, overrides)
        self.assertNotIn(
            "story-v6:20260816t013548z:character:0",
            {route["sourceKey"] for route in manifest["routes"]},
        )

    def test_reader_rules_and_adv_revision_are_independent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            search, localization, reader, overrides = self.fixture(root)
            catalog = json.loads((search / "manifest.json").read_text(encoding="utf-8"))
            catalog["categories"].append({"slug": "main-2", "file": "main-2.json"})
            write(search / "manifest.json", catalog)
            character = json.loads((search / "character.json").read_text(encoding="utf-8"))
            character["rows"].extend([
                ["Ashley Taylor 1話(英語版)", ["アシュリー・テイラー"], "summary", ""],
                ["未命名记录 2", [], "", ""],
            ])
            write(search / "character.json", character)
            write(search / "main-2.json", {
                "rows": [["8章2話 (ユニオン編1話)", [], "summary", ""]],
            })

            entries = json.loads(reader.read_text(encoding="utf-8"))
            entries.extend([
                {
                    "id": "330521",
                    "category": "character_story",
                    "folder": "3052 - 阿什莉·泰勒（アシュリー・テイラー）",
                    "title": "第1话 前往向往的地方，日本",
                    "sections": ["330521-1 Section 1"],
                },
                {
                    "id": "102902",
                    "category": "main_story",
                    "folder": "1029-19 - 第II部 第8章",
                    "title": "联盟篇",
                    "sections": ["102902-1 Section 1"],
                },
            ])
            write(reader, entries)
            rules = root / "rules.json"
            write(rules, {
                "version": 1,
                "characterAliases": {"Ashley Taylor": "アシュリー・テイラー"},
                "exactRoutes": [],
                "groupedMain": [{
                    "slug": "main-2",
                    "chapter": 8,
                    "arc": "ユニオン編",
                    "readerId": "102902",
                    "advSection": "episode",
                }],
                "specialMain": [],
            })
            adv_reader = root / "adv-story-index.json"
            write(adv_reader, [entries[0], entries[1], entries[-1]])
            adv_target = root / "adv-target.json"
            write(adv_target, {
                "version": 1,
                "target": "fixture-adv",
                "readerRepository": "fixture/reader",
                "readerRevision": "fixture-revision",
                "readerIndexPath": "story_index.json",
                "handoffReady": False,
            })
            manifest, report = MODULE.build(
                search,
                localization,
                reader,
                overrides,
                rules,
                adv_reader,
                adv_target,
            )

        routes = {route["sourceKey"]: route for route in manifest["routes"]}
        ashley = routes["story-v6:20260816t013548z:character:1"]
        self.assertEqual("330521", ashley["reader"]["storyId"])
        self.assertEqual("330521-1 Section 1", ashley["reader"]["section"])
        self.assertIsNone(ashley["adv"])
        grouped = routes["story-v6:20260816t013548z:main-2:0"]
        self.assertEqual("102902", grouped["reader"]["storyId"])
        self.assertEqual("102902-1 Section 1", grouped["reader"]["section"])
        self.assertEqual("102902-1 Section 1", grouped["adv"]["section"])
        self.assertEqual(1, report["invalidPlayableRows"])
        self.assertEqual(1, report["unmappedPlayableRows"])
        self.assertEqual(1, report["advUnavailable"]["readerIdAbsentFromPinnedRevision"])
        self.assertEqual(0, report["advUnavailable"]["exactSectionUnresolved"])
        self.assertFalse(manifest["targets"]["adv"]["handoffReady"])


if __name__ == "__main__":
    unittest.main()
