#!/usr/bin/env python3
"""Turn the NeoDB shelf into one tab of grouped entries per category.

Two grouping axes, each doing one job:

* tabs   — the category (book / movie / tv / game / podcast)
* groups — the shelf. Progress and wishlist stay flat; complete is split by
           the year it was marked, because 201 of the 271 watched films were
           marked in 2022 and one flat list would be unreadable.

Order on the page is progress → wishlist → complete, so the two short "active"
shelves sit together and the long year timeline does not split them.

Titles prefer NeoDB's zh-cn localized_title so China-region names show up
instead of the English display_title. Plot blurbs (`brief`) are deliberately
not carried over.

Music is left out so it does not repeat the Last.fm page.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from paths import dump_data, life_data_root, load_archive, note_html, note_text

ROOT = Path(__file__).resolve().parents[1]
LABELS = {
    "book": "书籍",
    "movie": "电影",
    "tv": "剧集",
    "game": "游戏",
    "podcast": "播客",
    "performance": "演出",
}
# NeoDB-style two-character shelf labels, keyed by category.
SHELF_LABELS = {
    "book": {"progress": "在读", "complete": "读过", "wishlist": "想读"},
    "movie": {"progress": "在看", "complete": "看过", "wishlist": "想看"},
    "tv": {"progress": "在看", "complete": "看过", "wishlist": "想看"},
    "game": {"progress": "在玩", "complete": "玩过", "wishlist": "想玩"},
    "podcast": {"progress": "在听", "complete": "听过", "wishlist": "想听"},
    "performance": {"progress": "在看", "complete": "看过", "wishlist": "想看"},
}
SHELVES = ("progress", "complete", "wishlist")
# A year with more entries than this is collapsed by default.
BIG_YEAR = 40
ZH_LANGS = ("zh-cn", "zh-hans", "zh")
# NeoDB TV seasons often list bare "第 N 季" as a zh-cn title ahead of the series name.
_SEASON_NUM = r"[0-9一二三四五六七八九十百零]+"
_SEASON_ONLY = re.compile(rf"^(?:第\s*{_SEASON_NUM}\s*季|Season\s*\d+)$", re.I)
_SEASON_PREFIX = re.compile(rf"^(?:第\s*{_SEASON_NUM}\s*季|Season\s*\d+)\b", re.I)
_HAS_SEASON = re.compile(rf"(?:第\s*{_SEASON_NUM}\s*季|Season\s*\d+)", re.I)


def rating_filled(grade) -> int:
    """10-point grade -> 1–5 dots. Half-up so 5/10 is 3 dots, matching the old template."""
    filled = (int(grade) + 1) // 2
    return max(1, min(5, filled))


def sort_key(entry: dict):
    return (
        entry["created_time"],
        entry["title"],
        entry["rating_grade"] if entry["rating_grade"] is not None else -1,
    )


def _zh_titles(item: dict) -> list[str]:
    titles: list[str] = []
    seen: set[str] = set()
    for loc in item.get("localized_title") or []:
        if not isinstance(loc, dict) or loc.get("lang") not in ZH_LANGS:
            continue
        text = (loc.get("text") or "").strip()
        if text and text not in seen:
            seen.add(text)
            titles.append(text)
    return titles


def title_of(item: dict) -> str:
    """Prefer the China-region title when NeoDB has one.

    TV seasons sometimes expose bare season labels (「第 1 季」) as zh-cn
    entries before the series name. Skip those, prefer a title that already
    embeds the season, or combine series + season when both are present.
    """
    zh = _zh_titles(item)
    fallback = item.get("display_title") or item.get("title") or ""
    if not zh:
        return fallback

    season_only = [t for t in zh if _SEASON_ONLY.match(t)]
    proper = [t for t in zh if not _SEASON_ONLY.match(t)]
    if not proper:
        return fallback or season_only[0]

    # Skip labels that lead with a season marker when a real name exists
    # (e.g. prefer「刺客伍六七」over「第一季 小鸡岛篇」).
    named = [t for t in proper if not _SEASON_PREFIX.match(t)]
    candidates = named or proper

    if season_only or item.get("type") == "TVSeason":
        with_season = [t for t in candidates if _HAS_SEASON.search(t)]
        if with_season:
            return with_season[0]
        if season_only:
            return f"{candidates[0]} {season_only[0]}"

    return candidates[0]


def main() -> None:
    path = life_data_root() / "data" / "neodb" / "shelf.json"
    if not path.exists():
        print("neodb source missing, skip")
        return

    items = load_archive(path).get("items") or []
    grouped = {key: {shelf: [] for shelf in SHELVES} for key in LABELS}
    for row in items:
        category = row.get("category")
        shelf = row.get("shelf_type")
        if category not in grouped or shelf not in SHELVES:
            continue
        item = row.get("item") or {}
        comment = (row.get("comment_text") or "").strip()
        grade = row.get("rating_grade")
        entry = {
            "created_time": (row.get("created_time") or "")[:10],
            "note": note_text(comment),
            "note_html": note_html(comment),
            "rating_grade": grade,
            "title": title_of(item),
            "url": item.get("url") or "",
        }
        if grade:
            entry["rating_filled"] = rating_filled(grade)
        grouped[category][shelf].append(entry)

    tabs = []
    for key, label in LABELS.items():
        shelves = SHELF_LABELS[key]
        progress = sorted(grouped[key]["progress"], key=sort_key, reverse=True)
        complete = sorted(grouped[key]["complete"], key=sort_key, reverse=True)
        wishlist = sorted(grouped[key]["wishlist"], key=sort_key, reverse=True)
        if not (progress or complete or wishlist):
            continue

        # Progress and wishlist first; complete (year timeline) last.
        groups = []
        if progress:
            groups.append(
                {
                    "count": len(progress),
                    "heading": shelves["progress"],
                    "id": "progress",
                    "items": progress,
                    "label": "",
                }
            )
        if wishlist:
            groups.append(
                {
                    "id": "wishlist",
                    "label": shelves["wishlist"],
                    "count": len(wishlist),
                    "items": wishlist,
                }
            )
        if complete:
            by_year: dict[str, list] = {}
            for entry in complete:
                by_year.setdefault(entry["created_time"][:4] or "—", []).append(entry)
            years = [
                {
                    "collapsed": len(entries) > BIG_YEAR,
                    "count": len(entries),
                    "items": entries,
                    "label": year,
                }
                for year, entries in sorted(by_year.items(), reverse=True)
            ]
            groups.append(
                {
                    "id": "complete",
                    "label": shelves["complete"],
                    "count": len(complete),
                    "items": complete,
                    "years": years,
                }
            )

        tabs.append(
            {
                "count": len(progress) + len(complete) + len(wishlist),
                "groups": groups,
                "id": key,
                "label": label,
            }
        )

    dump_data("neodb.json", {"categories": tabs})


if __name__ == "__main__":
    main()
