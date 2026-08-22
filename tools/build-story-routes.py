#!/usr/bin/env python3
"""Build the metadata-only search -> Reader/ADV route manifest.

The generator deliberately maps only identities that close uniquely against the
Reader index. It never matches a story from summaries, cast lists, or fuzzy title
similarity. Remaining rows stay unlinked until an explicit override is supplied.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

SOURCE_KEY_RE = re.compile(r"^story-v6:\d{8}t\d{6}z:[a-z0-9-]{1,64}:[0-9]{1,8}$")
CATEGORY_SLUG_RE = re.compile(r"^[a-z0-9-]{1,64}$")
STORY_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,256}$")
PLAYABLE_SLUGS = {"character", "main-1", "main-2", "another-1", "another-2"}
MAIN_CATEGORY = {
    "main-1": (False, 1),
    "main-2": (False, 2),
    "another-1": (True, 1),
    "another-2": (True, 2),
}
GROUPED_MAIN_RE = re.compile(r"(\d+)章(\d+)話\s*\((.+?)(\d+)話\)")
SPECIAL_MAIN_RE = re.compile(r"(\d+)章(\d+)話\s*\((.+)\)")


class RouteBuildError(RuntimeError):
    pass


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RouteBuildError(f"cannot read JSON {path}: {error}") from error


def write_json(path: Path, value: Any, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=False,
        separators=(",", ":") if compact else None,
        indent=None if compact else 2,
    )
    path.write_text(text + "\n", encoding="utf-8", newline="\n")


def normalized_identity(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return "".join(character for character in normalized if character.isalnum())


def catalog_revision(value: Any) -> str:
    if not isinstance(value, str):
        raise RouteBuildError("story-v6 generatedAt is missing")
    match = re.fullmatch(
        r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z",
        value,
    )
    if match is None:
        raise RouteBuildError("story-v6 generatedAt must be a UTC instant")
    compact = "".join(match.groups()).lower()
    return compact[:8] + "t" + compact[8:] + "z"


def plain_title(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return html.unescape(re.sub(r"<[^>]*>", "", value)).strip()


def final_fullwidth_group(value: str) -> tuple[str, int] | None:
    if not value.endswith("）"):
        return None
    depth = 0
    for index in range(len(value) - 1, -1, -1):
        character = value[index]
        if character == "）":
            depth += 1
        elif character == "（":
            depth -= 1
            if depth == 0:
                return value[index + 1 : -1], index
    return None


def reader_character_names(folder: str) -> tuple[str, str]:
    display = re.sub(r"^\s*\d+\s*-\s*", "", folder).strip()
    group = final_fullwidth_group(display)
    if group is None:
        return "", display
    japanese, start = group
    return japanese.strip(), display[:start].strip()


def one(candidates: Iterable[dict[str, Any]]) -> dict[str, Any] | None:
    values = list(candidates)
    return values[0] if len(values) == 1 else None


def valid_reader_entry(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("id"), str)
        and STORY_ID_RE.fullmatch(value["id"]) is not None
        and isinstance(value.get("category"), str)
        and isinstance(value.get("folder"), str)
        and isinstance(value.get("sections"), list)
        and value["sections"]
        and all(isinstance(section, str) and section for section in value["sections"])
    )


def build_reader_indexes(reader_entries: list[dict[str, Any]]) -> dict[str, Any]:
    characters_jp: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    characters_zh: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    main: dict[tuple[bool, int, int, int], list[dict[str, Any]]] = defaultdict(list)
    prologue: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    by_id: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for entry in reader_entries:
        by_id[entry["id"]].append(entry)
        title = str(entry.get("title") or "")
        episode_match = re.match(r"^\s*第(\d+)话", title)
        if entry["category"] == "character_story" and episode_match:
            japanese, chinese = reader_character_names(entry["folder"])
            episode = int(episode_match.group(1))
            if japanese:
                characters_jp[(normalized_identity(japanese), episode)].append(entry)
            if chinese:
                characters_zh[(normalized_identity(chinese), episode)].append(entry)

        if entry["category"] != "main_story" or not episode_match:
            continue
        folder = entry["folder"]
        part = 2 if "第II部" in folder else 1 if "第I部" in folder else 0
        episode = int(episode_match.group(1))
        if part and "序章" in folder:
            prologue[(part, episode)].append(entry)
        chapter_match = re.search(r"第(\d+)章", folder)
        if part and chapter_match:
            main[("支线剧情(AS)" in folder, part, int(chapter_match.group(1)), episode)].append(entry)

    return {
        "characters_jp": characters_jp,
        "characters_zh": characters_zh,
        "main": main,
        "prologue": prologue,
        "by_id": by_id,
    }


def build_character_aliases(localization: Any) -> dict[str, str]:
    aliases: dict[str, set[str]] = defaultdict(set)
    if not isinstance(localization, dict):
        return {}
    for bucket_name in ("characters", "charactersNormalized"):
        bucket = localization.get(bucket_name)
        if not isinstance(bucket, dict):
            continue
        for key, value in bucket.items():
            if not isinstance(key, str) or not isinstance(value, dict):
                continue
            chinese = value.get("zh")
            japanese = value.get("jp")
            if not isinstance(chinese, str) or not chinese.strip():
                continue
            aliases[normalized_identity(key)].add(chinese.strip())
            if isinstance(japanese, str) and japanese.strip():
                aliases[normalized_identity(japanese)].add(chinese.strip())
    return {key: next(iter(values)) for key, values in aliases.items() if len(values) == 1}


def parse_route_rules(path: Path | None) -> dict[str, Any]:
    empty = {
        "character_aliases": {},
        "exact_routes": {},
        "grouped_main": [],
        "special_main": [],
    }
    if path is None:
        return empty
    value = read_json(path)
    if not isinstance(value, dict) or value.get("version") != 1:
        raise RouteBuildError("Reader route rules must contain version=1")

    character_aliases: dict[str, str] = {}
    raw_aliases = value.get("characterAliases", {})
    if not isinstance(raw_aliases, dict):
        raise RouteBuildError("characterAliases must be an object")
    for source, target in raw_aliases.items():
        if not isinstance(source, str) or not source.strip() or not isinstance(target, str) or not target.strip():
            raise RouteBuildError("characterAliases contains an invalid name")
        key = normalized_identity(source)
        if key in character_aliases:
            raise RouteBuildError(f"duplicate character alias: {source}")
        character_aliases[key] = target.strip()

    exact_routes: dict[tuple[str, str], dict[str, Any]] = {}
    raw_exact = value.get("exactRoutes", [])
    if not isinstance(raw_exact, list):
        raise RouteBuildError("exactRoutes must be an array")
    for rule in raw_exact:
        if not isinstance(rule, dict):
            raise RouteBuildError("exactRoutes contains a non-object")
        slug = rule.get("slug")
        title = rule.get("title")
        reader_id = rule.get("readerId")
        strategy = rule.get("advSection")
        if (
            not isinstance(slug, str)
            or slug not in PLAYABLE_SLUGS
            or not isinstance(title, str)
            or not title.strip()
            or not isinstance(reader_id, str)
            or STORY_ID_RE.fullmatch(reader_id) is None
            or strategy not in (None, "first", "zero", "episode")
        ):
            raise RouteBuildError("exactRoutes contains an invalid rule")
        key = (slug, unicodedata.normalize("NFKC", title).strip())
        if key in exact_routes:
            raise RouteBuildError(f"duplicate exact route rule: {slug}/{title}")
        exact_routes[key] = {
            "readerId": reader_id,
            "advSection": strategy,
        }

    def parse_main_rules(name: str, *, special: bool) -> list[dict[str, Any]]:
        raw = value.get(name, [])
        if not isinstance(raw, list):
            raise RouteBuildError(f"{name} must be an array")
        result: list[dict[str, Any]] = []
        for rule in raw:
            if not isinstance(rule, dict):
                raise RouteBuildError(f"{name} contains a non-object")
            slug = rule.get("slug")
            chapter = rule.get("chapter")
            label_key = "label" if special else "arc"
            label = rule.get(label_key)
            reader_id = rule.get("readerId")
            strategy = rule.get("advSection")
            episode_min = rule.get("episodeMin", 1)
            episode_max = rule.get("episodeMax", 9999)
            if (
                slug not in MAIN_CATEGORY
                or not isinstance(chapter, int)
                or chapter < 0
                or not isinstance(label, str)
                or not label.strip()
                or not isinstance(reader_id, str)
                or STORY_ID_RE.fullmatch(reader_id) is None
                or strategy not in (None, "first", "zero", "episode")
                or not isinstance(episode_min, int)
                or not isinstance(episode_max, int)
                or episode_min < 0
                or episode_max < episode_min
            ):
                raise RouteBuildError(f"{name} contains an invalid rule")
            result.append({
                "slug": slug,
                "chapter": chapter,
                "label": unicodedata.normalize("NFKC", label).strip(),
                "readerId": reader_id,
                "advSection": strategy,
                "episodeMin": episode_min,
                "episodeMax": episode_max,
            })
        return result

    return {
        "character_aliases": character_aliases,
        "exact_routes": exact_routes,
        "grouped_main": parse_main_rules("groupedMain", special=False),
        "special_main": parse_main_rules("specialMain", special=True),
    }


def parse_adv_target(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {
            "target": "same-as-reader-input",
            "readerRepository": "same-as-reader-input",
            "readerRevision": "same-as-reader-input",
            "readerIndexPath": "story_index.json",
            "handoffReady": True,
        }
    value = read_json(path)
    if not isinstance(value, dict) or value.get("version") != 1:
        raise RouteBuildError("ADV target must contain version=1")
    required = ("target", "readerRepository", "readerRevision", "readerIndexPath")
    if any(not isinstance(value.get(key), str) or not value[key].strip() for key in required):
        raise RouteBuildError("ADV target metadata is incomplete")
    if not isinstance(value.get("handoffReady"), bool):
        raise RouteBuildError("ADV target handoffReady must be boolean")
    return {key: value[key].strip() for key in required} | {
        "handoffReady": value["handoffReady"],
    }


def character_match(
    title: str,
    indexes: dict[str, Any],
    aliases: dict[str, str],
    reader_aliases: dict[str, str],
) -> dict[str, Any] | None:
    normalized_title = unicodedata.normalize("NFKC", title)
    match = re.fullmatch(r"(.+?)\s*(\d+)話(?:\s*\(英語版\))?", normalized_title)
    if match is None:
        return None
    name = match.group(1).strip()
    episode = int(match.group(2))
    route = one(indexes["characters_jp"].get((normalized_identity(name), episode), ()))
    if route is not None:
        return route
    reader_name = reader_aliases.get(normalized_identity(name))
    if reader_name is not None:
        route = one(indexes["characters_jp"].get((normalized_identity(reader_name), episode), ()))
        if route is not None:
            return route
    chinese = aliases.get(normalized_identity(name))
    if chinese is None:
        return None
    return one(indexes["characters_zh"].get((normalized_identity(chinese), episode), ()))


def main_match(slug: str, title: str, indexes: dict[str, Any]) -> dict[str, Any] | None:
    another, part = MAIN_CATEGORY[slug]
    normalized_title = unicodedata.normalize("NFKC", title)
    match = re.fullmatch(r"(\d+)章(\d+)話", normalized_title)
    if match is not None:
        return one(indexes["main"].get((another, part, int(match.group(1)), int(match.group(2))), ()))
    prologue_match = re.fullmatch(r"序章(\d+)話", normalized_title)
    if not another and prologue_match is not None:
        return one(indexes["prologue"].get((part, int(prologue_match.group(1))), ()))
    return None


def section_for_strategy(
    entry: dict[str, Any],
    strategy: str | None,
    episode: int | None = None,
) -> str | None:
    sections = entry["sections"]
    if strategy is None:
        return None
    if strategy == "first":
        return sections[0]
    section_number = 0 if strategy == "zero" else episode
    if not isinstance(section_number, int):
        raise RouteBuildError(f"ADV episode section is missing for Reader {entry['id']}")
    candidates = [
        section
        for section in sections
        if re.search(rf"\sSection\s+{section_number}$", section, re.IGNORECASE)
    ]
    result = one({"section": section} for section in candidates)
    if result is None:
        raise RouteBuildError(
            f"Reader {entry['id']} has no unique Section {section_number}"
        )
    return result["section"]


def rule_match(
    slug: str,
    title: str,
    indexes: dict[str, Any],
    rules: dict[str, Any],
) -> tuple[dict[str, Any], str | None, str] | None:
    normalized_title = unicodedata.normalize("NFKC", title).strip()
    exact = rules["exact_routes"].get((slug, normalized_title))
    if exact is not None:
        entry = one(indexes["by_id"].get(exact["readerId"], ()))
        if entry is None:
            raise RouteBuildError(f"exact route Reader id is missing or ambiguous: {exact['readerId']}")
        return entry, section_for_strategy(entry, exact["advSection"]), "explicit-title"

    grouped = GROUPED_MAIN_RE.fullmatch(normalized_title)
    if grouped is not None:
        chapter = int(grouped.group(1))
        arc = grouped.group(3).strip()
        episode = int(grouped.group(4))
        candidates = [
            rule
            for rule in rules["grouped_main"]
            if rule["slug"] == slug
            and rule["chapter"] == chapter
            and rule["label"] == arc
            and rule["episodeMin"] <= episode <= rule["episodeMax"]
        ]
        rule = one(candidates)
        if rule is None:
            return None
        entry = one(indexes["by_id"].get(rule["readerId"], ()))
        if entry is None:
            raise RouteBuildError(f"grouped route Reader id is missing or ambiguous: {rule['readerId']}")
        return (
            entry,
            section_for_strategy(entry, rule["advSection"], episode),
            "exact-reader-group",
        )

    special = SPECIAL_MAIN_RE.fullmatch(normalized_title)
    if special is None:
        return None
    chapter = int(special.group(1))
    label = special.group(3).strip()
    candidates = [
        rule
        for rule in rules["special_main"]
        if rule["slug"] == slug
        and rule["chapter"] == chapter
        and rule["label"] == label
    ]
    rule = one(candidates)
    if rule is None:
        return None
    entry = one(indexes["by_id"].get(rule["readerId"], ()))
    if entry is None:
        raise RouteBuildError(f"special route Reader id is missing or ambiguous: {rule['readerId']}")
    return entry, section_for_strategy(entry, rule["advSection"]), "exact-reader-group"


def route_record(
    source_key: str,
    entry: dict[str, Any],
    match: str,
    adv_section: str | None,
    adv_indexes: dict[str, Any],
) -> dict[str, Any]:
    story_id = entry["id"]
    reader = {"storyId": story_id}
    if adv_section is not None:
        # Reader's existing catalogue links use the same section descriptor to
        # build their ?section=<anchor>#<anchor> deep link. Keep that precision
        # even when the pinned ADV revision does not yet contain the section.
        reader["section"] = adv_section
    adv = None
    if adv_section is not None:
        adv_entry = one(adv_indexes["by_id"].get(story_id, ()))
        if adv_entry is not None and adv_section in adv_entry["sections"]:
            adv = {"chapterId": story_id, "section": adv_section}
    return {
        "sourceKey": source_key,
        "canonicalStoryId": f"magireco:{story_id}",
        "match": match,
        "reader": reader,
        "adv": adv,
    }


def invalid_playable_row(row: Any, title: str) -> bool:
    return (
        isinstance(row, list)
        and re.fullmatch(r"未命名记录\s+\d+", title) is not None
        and all(value in (None, "", []) for value in row[1:])
    )


def parse_overrides(path: Path | None) -> dict[str, dict[str, str]]:
    if path is None:
        return {}
    value = read_json(path)
    if not isinstance(value, dict) or value.get("version") != 1 or not isinstance(value.get("routes"), dict):
        raise RouteBuildError("override file must contain version=1 and a routes object")
    result: dict[str, dict[str, str]] = {}
    for source_key, override in value["routes"].items():
        if not isinstance(source_key, str) or SOURCE_KEY_RE.fullmatch(source_key) is None:
            raise RouteBuildError(f"invalid override source key: {source_key!r}")
        if not isinstance(override, dict) or not isinstance(override.get("readerId"), str):
            raise RouteBuildError(f"invalid override for {source_key}")
        item = {"readerId": override["readerId"]}
        if "section" in override:
            if not isinstance(override["section"], str) or not override["section"]:
                raise RouteBuildError(f"invalid override section for {source_key}")
            item["section"] = override["section"]
        result[source_key] = item
    return result


def build(
    search_root: Path,
    localization_path: Path,
    reader_index_path: Path,
    overrides_path: Path | None,
    rules_path: Path | None = None,
    adv_reader_index_path: Path | None = None,
    adv_target_path: Path | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    catalog = read_json(search_root / "manifest.json")
    if not isinstance(catalog, dict) or not isinstance(catalog.get("categories"), list):
        raise RouteBuildError("story-v6 manifest is invalid")
    revision = catalog_revision(catalog.get("generatedAt"))
    reader_raw = read_json(reader_index_path)
    if not isinstance(reader_raw, list):
        raise RouteBuildError("Reader story index must be an array")
    if any(not isinstance(entry, dict) for entry in reader_raw):
        raise RouteBuildError("Reader story index contains a non-object entry")
    # The public index also contains a small number of catalogue information
    # records without sections. Count them as part of the source index, but do
    # not expose them as playable route targets.
    reader_entries = [entry for entry in reader_raw if valid_reader_entry(entry)]
    indexes = build_reader_indexes(reader_entries)
    adv_reader_raw = read_json(adv_reader_index_path) if adv_reader_index_path is not None else reader_raw
    if not isinstance(adv_reader_raw, list) or any(not isinstance(entry, dict) for entry in adv_reader_raw):
        raise RouteBuildError("ADV Reader story index must be an array of objects")
    adv_reader_entries = [entry for entry in adv_reader_raw if valid_reader_entry(entry)]
    adv_indexes = build_reader_indexes(adv_reader_entries)
    adv_target = parse_adv_target(adv_target_path)
    aliases = build_character_aliases(read_json(localization_path))
    rules = parse_route_rules(rules_path)
    overrides = parse_overrides(overrides_path)

    auto_routes: dict[str, dict[str, Any]] = {}
    known_keys: set[str] = set()
    category_stats: list[dict[str, Any]] = []
    seen_slugs: set[str] = set()
    total_rows = 0
    playable_rows = 0
    invalid_playable_rows = 0

    for category in catalog["categories"]:
        if not isinstance(category, dict):
            raise RouteBuildError("story-v6 category metadata is invalid")
        slug = category.get("slug")
        filename = category.get("file")
        if not isinstance(slug, str) or not isinstance(filename, str):
            raise RouteBuildError("story-v6 category lacks slug/file")
        if CATEGORY_SLUG_RE.fullmatch(slug) is None or slug in seen_slugs:
            raise RouteBuildError(f"story-v6 category slug is invalid or duplicated: {slug!r}")
        seen_slugs.add(slug)
        search_base = search_root.resolve()
        category_path = (search_base / filename).resolve()
        if not category_path.is_relative_to(search_base):
            raise RouteBuildError(f"story-v6 category path escapes the catalog: {filename!r}")
        document = read_json(category_path)
        if not isinstance(document, dict) or not isinstance(document.get("rows"), list):
            raise RouteBuildError(f"story-v6 category {slug} is invalid")
        rows = document["rows"]
        mapped = 0
        invalid = 0
        for row_index, row in enumerate(rows):
            source_key = f"story-v6:{revision}:{slug}:{row_index}"
            known_keys.add(source_key)
            if slug not in PLAYABLE_SLUGS:
                continue
            if not isinstance(row, list) or not row:
                raise RouteBuildError(f"{source_key} has an invalid row")
            title = plain_title(row[0])
            if invalid_playable_row(row, title):
                invalid += 1
                continue
            ruled = rule_match(slug, title, indexes, rules)
            if ruled is not None:
                entry, adv_section, match = ruled
            elif slug == "character":
                entry = character_match(title, indexes, aliases, rules["character_aliases"])
                adv_section = entry["sections"][0] if entry is not None else None
                match = "exact-character-episode"
            else:
                entry = main_match(slug, title, indexes)
                adv_section = entry["sections"][0] if entry is not None else None
                match = "exact-main-episode"
            if entry is None:
                continue
            auto_routes[source_key] = route_record(
                source_key,
                entry,
                match,
                adv_section,
                adv_indexes,
            )
            mapped += 1
        row_count = len(rows)
        total_rows += row_count
        if slug in PLAYABLE_SLUGS:
            playable_rows += row_count
            invalid_playable_rows += invalid
        category_stats.append(
            {
                "slug": slug,
                "rows": row_count,
                "candidateRows": row_count - invalid if slug in PLAYABLE_SLUGS else 0,
                "mapped": mapped,
                "unmapped": row_count - mapped if slug in PLAYABLE_SLUGS else 0,
                "invalid": invalid if slug in PLAYABLE_SLUGS else 0,
                "advMapped": 0,
                "routingScope": "playable" if slug in PLAYABLE_SLUGS else "not-targeted",
            }
        )

    for source_key, override in overrides.items():
        if source_key not in known_keys:
            raise RouteBuildError(f"override key is not in story-v6: {source_key}")
        reader_id = override["readerId"]
        entry = one(indexes["by_id"].get(reader_id, ()))
        if entry is None:
            raise RouteBuildError(f"override Reader id is missing or ambiguous: {reader_id}")
        section = override.get("section", entry["sections"][0])
        if section not in entry["sections"]:
            raise RouteBuildError(f"override section is absent from Reader index: {source_key}")
        record = route_record(source_key, entry, "manual", section, adv_indexes)
        auto_routes[source_key] = record

    routes = list(auto_routes.values())
    manifest = {
        "version": 1,
        "bridgeRevision": 1,
        "sourceCatalog": "story-v6",
        "catalogRevision": revision,
        "catalogGeneratedAt": catalog.get("generatedAt"),
        "readerIndexEntries": len(reader_raw),
        "targets": {
            "reader": {
                "indexEntries": len(reader_raw),
            },
            "adv": {
                "target": adv_target["target"],
                "handoffReady": adv_target["handoffReady"],
                "readerRepository": adv_target["readerRepository"],
                "readerRevision": adv_target["readerRevision"],
                "readerIndexPath": adv_target["readerIndexPath"],
                "readerIndexEntries": len(adv_reader_raw),
            },
        },
        "routes": routes,
    }
    mapped_by_category = defaultdict(int)
    adv_mapped_by_category = defaultdict(int)
    for source_key in auto_routes:
        slug = source_key.split(":", 3)[2]
        mapped_by_category[slug] += 1
        if auto_routes[source_key]["adv"] is not None:
            adv_mapped_by_category[slug] += 1
    for stat in category_stats:
        stat["mapped"] = mapped_by_category[stat["slug"]]
        stat["advMapped"] = adv_mapped_by_category[stat["slug"]]
        if stat["routingScope"] == "playable":
            stat["unmapped"] = stat["rows"] - stat["mapped"]
    mapped_playable_rows = sum(mapped_by_category[slug] for slug in PLAYABLE_SLUGS)
    adv_mapped_playable_rows = sum(adv_mapped_by_category[slug] for slug in PLAYABLE_SLUGS)
    routing_candidate_rows = playable_rows - invalid_playable_rows
    adv_unavailable = {
        "readerIdAbsentFromPinnedRevision": 0,
        "exactSectionUnresolved": 0,
        "sectionAbsentFromPinnedRevision": 0,
    }
    for route in routes:
        if route["adv"] is not None:
            continue
        story_id = route["reader"]["storyId"]
        if one(adv_indexes["by_id"].get(story_id, ())) is None:
            adv_unavailable["readerIdAbsentFromPinnedRevision"] += 1
        elif route["reader"].get("section") is None:
            adv_unavailable["exactSectionUnresolved"] += 1
        else:
            adv_unavailable["sectionAbsentFromPinnedRevision"] += 1
    adv_unavailable["total"] = sum(adv_unavailable.values())
    report = {
        "version": 1,
        "sourceCatalog": "story-v6",
        "catalogRevision": revision,
        "catalogGeneratedAt": catalog.get("generatedAt"),
        "totalRows": total_rows,
        "playableRows": playable_rows,
        "routingCandidateRows": routing_candidate_rows,
        "invalidPlayableRows": invalid_playable_rows,
        "mappedRows": len(routes),
        "readerMappedPlayableRows": mapped_playable_rows,
        "advMappedPlayableRows": adv_mapped_playable_rows,
        "advUnavailable": adv_unavailable,
        "advReaderRevision": adv_target["readerRevision"],
        "advHandoffReady": adv_target["handoffReady"],
        "unmappedPlayableRows": playable_rows - mapped_playable_rows,
        "unmappedCandidateRows": routing_candidate_rows - mapped_playable_rows,
        "notTargetedRows": total_rows - playable_rows,
        "readerIndexEntries": len(reader_raw),
        "playableReaderEntries": len(reader_entries),
        "manualRoutes": sum(1 for route in routes if route["match"] == "manual"),
        "categories": category_stats,
    }
    return manifest, report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--search-root", type=Path, required=True)
    parser.add_argument("--localization", type=Path, required=True)
    parser.add_argument("--reader-index", type=Path, required=True)
    parser.add_argument("--overrides", type=Path)
    parser.add_argument("--rules", type=Path)
    parser.add_argument("--adv-reader-index", type=Path)
    parser.add_argument("--adv-target", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    manifest, report = build(
        args.search_root,
        args.localization,
        args.reader_index,
        args.overrides,
        args.rules,
        args.adv_reader_index,
        args.adv_target,
    )
    write_json(args.output, manifest, compact=True)
    write_json(args.report, report)
    print(
        f"story routes: Reader {report['readerMappedPlayableRows']}/"
        f"{report['routingCandidateRows']} valid rows; "
        f"ADV-compatible {report['advMappedPlayableRows']}; "
        f"invalid source rows {report['invalidPlayableRows']} "
        f"({report['totalRows']} total rows)"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RouteBuildError as error:
        print(f"story route build failed: {error}")
        raise SystemExit(1)
