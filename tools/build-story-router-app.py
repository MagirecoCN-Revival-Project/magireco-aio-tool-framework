#!/usr/bin/env python3
"""Validate the checked-in route manifest and assemble the EdgeOne artifact."""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "story-router" / "story-routes.json"
REPORT = ROOT / "story-router" / "story-routes.report.json"
OUTPUT = ROOT / "apps" / "router" / "dist"
GENERATED_FUNCTION_DATA = ROOT / "edge-functions" / "_generated" / "story-routes.js"
CLIENT_MODULE = ROOT / "packages" / "story-router" / "dist" / "index.js"
CATALOG_REVISION_RE = re.compile(r"^\d{8}t\d{6}z$")
CATALOG_GENERATED_AT_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$"
)
SOURCE_KEY_RE = re.compile(r"^story-v6:\d{8}t\d{6}z:[a-z0-9-]{1,64}:[0-9]{1,8}$")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def revision_from_generated_at(value) -> str:
    if not isinstance(value, str):
        raise RuntimeError("story route catalog generatedAt is invalid")
    match = CATALOG_GENERATED_AT_RE.fullmatch(value)
    if match is None:
        raise RuntimeError("story route catalog generatedAt is invalid")
    compact = "".join(match.groups())
    return compact[:8] + "t" + compact[8:] + "z"


def validate(manifest, report) -> None:
    if not isinstance(manifest, dict) or manifest.get("version") != 1:
        raise RuntimeError("story route manifest version is invalid")
    if manifest.get("bridgeRevision") != 1 or manifest.get("sourceCatalog") != "story-v6":
        raise RuntimeError("story route bridge contract is invalid")
    catalog_revision = manifest.get("catalogRevision")
    if not isinstance(catalog_revision, str) or CATALOG_REVISION_RE.fullmatch(catalog_revision) is None:
        raise RuntimeError("story route catalog revision is invalid")
    if revision_from_generated_at(manifest.get("catalogGeneratedAt")) != catalog_revision:
        raise RuntimeError("story route catalog time and revision diverge")
    routes = manifest.get("routes")
    targets = manifest.get("targets")
    if (
        not isinstance(targets, dict)
        or not isinstance(targets.get("reader"), dict)
        or not isinstance(targets.get("adv"), dict)
        or targets["reader"].get("indexEntries") != manifest.get("readerIndexEntries")
        or not isinstance(targets["adv"].get("handoffReady"), bool)
        or not isinstance(targets["adv"].get("readerRevision"), str)
        or not targets["adv"]["readerRevision"]
    ):
        raise RuntimeError("story route target metadata is invalid")
    if not isinstance(routes, list) or not routes:
        raise RuntimeError("story route manifest has no routes")
    seen: set[str] = set()
    for index, route in enumerate(routes):
        if not isinstance(route, dict):
            raise RuntimeError(f"route {index} is not an object")
        source_key = route.get("sourceKey")
        reader = route.get("reader")
        adv = route.get("adv")
        if not isinstance(source_key, str) or SOURCE_KEY_RE.fullmatch(source_key) is None:
            raise RuntimeError(f"route {index} sourceKey is invalid")
        if source_key.split(":", 3)[1] != catalog_revision:
            raise RuntimeError(f"route {index} sourceKey revision diverges")
        if source_key in seen:
            raise RuntimeError(f"duplicate story route: {source_key}")
        seen.add(source_key)
        if not isinstance(reader, dict) or (adv is not None and not isinstance(adv, dict)):
            raise RuntimeError(f"route {source_key} has invalid targets")
        story_id = reader.get("storyId")
        if not isinstance(story_id, str):
            raise RuntimeError(f"route {source_key} has no Reader id")
        reader_section = reader.get("section")
        if reader_section is not None and (
            not isinstance(reader_section, str) or not reader_section
        ):
            raise RuntimeError(f"route {source_key} has invalid Reader section")
        if adv is not None and adv.get("chapterId") != story_id:
            raise RuntimeError(f"route {source_key} target ids diverge")
        if route.get("canonicalStoryId") != f"magireco:{story_id}":
            raise RuntimeError(f"route {source_key} canonical id diverges")
        if adv is not None and (not isinstance(adv.get("section"), str) or not adv["section"]):
            raise RuntimeError(f"route {source_key} has no ADV section")
        if adv is not None and reader_section is not None and adv["section"] != reader_section:
            raise RuntimeError(f"route {source_key} target sections diverge")
    adv_unavailable = report.get("advUnavailable") if isinstance(report, dict) else None
    if (
        not isinstance(report, dict)
        or report.get("catalogRevision") != catalog_revision
        or report.get("mappedRows") != len(routes)
        or not isinstance(adv_unavailable, dict)
    ):
        raise RuntimeError("story route report does not match the manifest")
    adv_gap_parts = (
        adv_unavailable.get("readerIdAbsentFromPinnedRevision"),
        adv_unavailable.get("exactSectionUnresolved"),
        adv_unavailable.get("sectionAbsentFromPinnedRevision"),
    )
    if (
        any(not isinstance(value, int) or value < 0 for value in adv_gap_parts)
        or adv_unavailable.get("total") != sum(adv_gap_parts)
        or adv_unavailable["total"]
        != report["readerMappedPlayableRows"] - report["advMappedPlayableRows"]
    ):
        raise RuntimeError("story route ADV gap report is inconsistent")


def health_page(manifest, report) -> str:
    reader_mapped = int(report["readerMappedPlayableRows"])
    adv_mapped = int(report["advMappedPlayableRows"])
    playable = int(report["playableRows"])
    candidates = int(report["routingCandidateRows"])
    invalid = int(report["invalidPlayableRows"])
    unresolved = int(report["unmappedCandidateRows"])
    adv_unavailable = report["advUnavailable"]
    handoff_label = "已启用" if report["advHandoffReady"] else "等待目标站启动接收器"
    adv_action_label = "测试 ADV 路由" if report["advHandoffReady"] else "检查 ADV 对接门控"
    mapping_label = (
        f"另有 {unresolved:,} 条有效行仍待精确映射"
        if unresolved
        else "有效搜索行已全部登记"
    )
    adv_gap_labels = []
    if adv_unavailable["exactSectionUnresolved"]:
        adv_gap_labels.append(
            f"{adv_unavailable['exactSectionUnresolved']:,} 行仍缺视频结果到 Reader section 的逐行边界"
        )
    if adv_unavailable["readerIdAbsentFromPinnedRevision"]:
        adv_gap_labels.append(
            f"{adv_unavailable['readerIdAbsentFromPinnedRevision']:,} 行尚未进入目标站固定的 Reader revision"
        )
    if adv_unavailable["sectionAbsentFromPinnedRevision"]:
        adv_gap_labels.append(
            f"{adv_unavailable['sectionAbsentFromPinnedRevision']:,} 行存在章节版本漂移"
        )
    adv_gap_label = "；".join(adv_gap_labels) if adv_gap_labels else "无"
    revision = manifest["catalogRevision"]
    example_key = f"story-v6:{revision}:character:0"
    escaped_key = example_key.replace(":", "%3A")
    return f"""<!doctype html>
<html lang=\"zh-CN\">
<head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
  <title>AIO Story Router 预发布诊断</title>
  <style>
    :root{{color-scheme:light;font-family:system-ui,-apple-system,\"Segoe UI\",sans-serif;background:#fff8fc;color:#40142d}}
    body{{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}}
    main{{max-width:760px;width:100%;border:1px solid #edcade;border-radius:20px;padding:28px;background:#fff;box-shadow:0 16px 46px #7d18451a}}
    h1{{margin:0 0 12px;font-size:clamp(26px,6vw,42px)}}
    p{{line-height:1.7}} .count{{font-size:1.1rem;font-weight:700;color:#a31e61}}
    nav{{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}}
    a{{display:inline-block;border-radius:999px;padding:10px 16px;background:#b62068;color:white;text-decoration:none;font-weight:700}}
    a.secondary{{background:#f8e8f1;color:#721342}}
    code{{overflow-wrap:anywhere}}
  </style>
</head>
<body><main>
  <h1>Story Router 预发布诊断</h1>
  <p>这里是路由运维页，不是剧情网站。正式用户界面仍在独立搜索站、Reader 和 ADV/L2D 站点。</p>
  <p class=\"count\">Reader：{reader_mapped:,} / {candidates:,} 条有效搜索行</p>
  <p class=\"count\">ADV 数据兼容：{adv_mapped:,} / {candidates:,} 条；启动对接：{handoff_label}</p>
  <p>ADV 精确缺口：{adv_gap_label}。</p>
  <p>源目录共 {playable:,} 条候选范围，其中 {invalid:,} 条为空白坏记录；{mapping_label}。行数不等于独立剧情数。</p>
  <p>接口：<code>/open?source=story-v6:目录版本:分类:行号&amp;target=reader|adv</code></p>
  <nav>
    <a href=\"/open?source={escaped_key}&amp;target=reader\">测试 Reader 路由</a>
    <a href=\"/open?source={escaped_key}&amp;target=adv\">{adv_action_label}</a>
    <a class=\"secondary\" href=\"/story-routes.json\">查看路由清单</a>
    <a class=\"secondary\" href=\"/story-routes.report.json\">查看覆盖报告</a>
  </nav>
</main></body></html>"""


def main() -> int:
    manifest = read_json(MANIFEST)
    report = read_json(REPORT)
    validate(manifest, report)

    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "index.html").write_text(health_page(manifest, report), encoding="utf-8", newline="\n")
    shutil.copyfile(MANIFEST, OUTPUT / "story-routes.json")
    shutil.copyfile(REPORT, OUTPUT / "story-routes.report.json")
    if not CLIENT_MODULE.is_file():
        raise RuntimeError("compiled Story Router browser client is missing")
    shutil.copyfile(CLIENT_MODULE, OUTPUT / "story-router-client.js")

    GENERATED_FUNCTION_DATA.parent.mkdir(parents=True, exist_ok=True)
    index = {
        route["sourceKey"]: {
            "reader": route["reader"],
            "adv": route["adv"],
        }
        for route in manifest["routes"]
    }
    module = "export const STORY_ROUTE_INDEX = Object.freeze(" + json.dumps(
        index, ensure_ascii=False, separators=(",", ":")
    ) + ");\nexport const STORY_ROUTER_TARGETS = Object.freeze(" + json.dumps(
        manifest["targets"], ensure_ascii=False, separators=(",", ":")
    ) + ");\n"
    GENERATED_FUNCTION_DATA.write_text(module, encoding="utf-8", newline="\n")
    if GENERATED_FUNCTION_DATA.stat().st_size >= 5 * 1024 * 1024:
        raise RuntimeError("generated Edge Function route table exceeds 5 MB")
    print(
        f"EdgeOne Story Router: {len(index)} Reader routes, "
        f"{report['advMappedPlayableRows']} ADV-compatible rows, "
        f"{GENERATED_FUNCTION_DATA.stat().st_size} byte function table"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
