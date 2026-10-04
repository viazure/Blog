#!/usr/bin/env python3
"""Turn life-data Last.fm archives into the small JSON the music page reads.

Display data stays on Last.fm (scrobbles, top charts, loved). Artwork:

1. Last.fm `image` on the scrobble / album row (Fastly, primary)
2. else Cover Art Archive via ListenBrainz `caa_release_mbid`
3. else the shared Last.fm placeholder

CAA is only used when Last.fm has no art. The page lazy-loads covers and
falls back on error, so a failed CAA request does not block the document.
Nothing is downloaded into the site; every URL is a hotlink.
"""

from __future__ import annotations

import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from paths import dump_data, field_text, life_data_root, load_archive

# Periods Last.fm can report, most recent first. Only the ones with data are
# emitted, so a page never offers a tab that leads to an empty chart.
PERIODS = (
    ("7day", "近一周"),
    ("1month", "近一个月"),
    ("3month", "近三个月"),
    ("6month", "近半年"),
    ("12month", "近一年"),
    ("overall", "全部时间"),
)
CHARTS = (
    ("albums", "专辑"),
    ("tracks", "歌曲"),
)
# Page timestamps are China Standard Time, not the build machine's zone.
DISPLAY_TZ = timezone(timedelta(hours=8))
PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f"
# Last.fm's own "no artwork" image for music, hotlinked from their CDN.
NO_MUSIC_ART = "https://lastfm-img.freetls.fastly.net/i/u/64s/4128a6eb29f94943c9d206c08e625904.jpg"
CAA_FRONT = "https://coverartarchive.org/release/{mbid}/front-250"
RECENT_LIMIT = 10
# Cap the artwork lookup so an unexpected archive cannot blow up the run.
ART_SCAN_LIMIT = 20000


def local_stamp(uts: int) -> tuple[str, str]:
    moment = datetime.fromtimestamp(int(uts), timezone.utc).astimezone(DISPLAY_TZ)
    return moment.strftime("%Y-%m-%d"), moment.strftime("%H:%M")


def image_of(images) -> str:
    """Largest non-placeholder image in a Last.fm image array."""
    if not isinstance(images, list):
        return ""
    for size in ("extralarge", "large", "medium", "small"):
        for image in images:
            if isinstance(image, dict) and image.get("size") == size:
                url = field_text(image)
                if url and PLACEHOLDER not in url:
                    return url
    for image in reversed(images):
        url = field_text(image)
        if url and PLACEHOLDER not in url:
            return url
    return ""


def track_key(artist: str, title: str) -> tuple[str, str]:
    return artist.casefold(), title.casefold()


def caa_cover(release_mbid: str) -> str:
    mbid = field_text(release_mbid)
    if not mbid:
        return ""
    return CAA_FRONT.format(mbid=mbid)


def art_indexes(scrobbles: list) -> dict[tuple[str, str], str]:
    """Latest known album art per track, from the Last.fm scrobble archive.

    The key is (artist, title) because two different artists can share a track
    title. `items` is oldest-first, so later entries overwrite earlier ones and
    the newest art wins.
    """
    tracks: dict[tuple[str, str], str] = {}
    rows = scrobbles[-ART_SCAN_LIMIT:] if len(scrobbles) > ART_SCAN_LIMIT else scrobbles
    for row in rows:
        cover = image_of(row.get("image"))
        if not cover:
            continue
        title = field_text(row.get("name"))
        artist = field_text(row.get("artist"))
        if artist and title:
            tracks[track_key(artist, title)] = cover
    return tracks


def lb_art_indexes(listens: list) -> tuple[dict[tuple[str, str], str], dict[tuple[str, str], str]]:
    """Cover Art Archive URLs from ListenBrainz listens.

    Use `track_metadata.mbid_mapping.caa_release_mbid` and hotlink `front-250`.
    Builds both track and album indexes for chart fallback.
    """
    tracks: dict[tuple[str, str], str] = {}
    albums: dict[tuple[str, str], str] = {}
    rows = listens[-ART_SCAN_LIMIT:] if len(listens) > ART_SCAN_LIMIT else listens
    for row in rows:
        meta = row.get("track_metadata") or {}
        mapping = meta.get("mbid_mapping") or {}
        if not isinstance(mapping, dict):
            continue
        cover = caa_cover(mapping.get("caa_release_mbid"))
        if not cover:
            continue
        artist = field_text(meta.get("artist_name"))
        track = field_text(meta.get("track_name"))
        album = field_text(meta.get("release_name"))
        if artist and track:
            tracks[track_key(artist, track)] = cover
        if artist and album:
            albums[track_key(artist, album)] = cover
    return tracks, albums


def pick_cover(*candidates: str) -> str:
    """First usable Last.fm or CAA image, else the shared no-art placeholder."""
    for url in candidates:
        if url and PLACEHOLDER not in url:
            return url
    return NO_MUSIC_ART


def playcount_of(row: dict) -> int:
    return int(row.get("playcount") or 0)


def loved_keys(items) -> set[tuple[str, str]]:
    """(artist, title) pairs from the loved-tracks archive."""
    keys: set[tuple[str, str]] = set()
    for row in items or []:
        artist = field_text(row.get("artist"))
        title = field_text(row.get("name"))
        if artist and title:
            keys.add(track_key(artist, title))
    return keys


def is_loved(artist: str, title: str, keys: set[tuple[str, str]], scrobble_flag=None) -> bool:
    if artist and title and track_key(artist, title) in keys:
        return True
    return str(scrobble_flag) in ("1", "true", "True")


def bar_percent(value: int, top: int) -> int:
    """Log scale: all-time counts span 114..2778, a linear bar flattens the tail.

    A short period can have a top count of 1, where log10() is zero and cannot
    be divided by, so those rows all get a full bar — within a period where
    everything was played once, that is the honest picture.
    """
    if value <= 0 or top <= 1:
        return 0 if value <= 0 else 100
    share = math.log10(value) / math.log10(top)
    return int(round(min(100.0, max(0.0, share * 100))))


def main() -> None:
    lastfm_root = life_data_root() / "data" / "lastfm"
    lb_root = life_data_root() / "data" / "listenbrainz"
    scrobble_path = lastfm_root / "scrobbles.json"
    top_path = lastfm_root / "top.json"
    loved_path = lastfm_root / "loved.json"
    listens_path = lb_root / "listens.json"
    if not scrobble_path.exists() or not top_path.exists():
        print("lastfm source missing, skip")
        return

    scrobbles = load_archive(scrobble_path)
    top = load_archive(top_path)
    loved = load_archive(loved_path) if loved_path.exists() else {"items": []}
    listens = load_archive(listens_path).get("items") or [] if listens_path.exists() else []
    items = scrobbles.get("items") or []
    hearts = loved_keys(loved.get("items"))
    track_art = art_indexes(items)
    lb_tracks, lb_albums = lb_art_indexes(listens)

    stamped = []
    for row in items:
        uts = (row.get("date") or {}).get("uts")
        if uts in (None, ""):
            continue
        stamped.append((int(uts), row))
    stamped.sort(key=lambda item: item[0], reverse=True)

    recent = []
    for uts, row in stamped[:RECENT_LIMIT]:
        day, clock = local_stamp(uts)
        artist = field_text(row.get("artist"))
        track = field_text(row.get("name"))
        key = track_key(artist, track)
        recent.append(
            {
                "album": field_text(row.get("album")),
                "artist": artist,
                "date": day,
                "image": pick_cover(image_of(row.get("image")), lb_tracks.get(key, "")),
                "loved": is_loved(artist, track, hearts, row.get("loved")),
                "time": clock,
                "track": track,
                "url": field_text(row.get("url")),
            }
        )

    # One board set per period, so the page can switch between them. Charts are
    # albums and tracks only: no reachable Last.fm endpoint returns artist
    # artwork, and a leaderboard without pictures next to two with them reads as
    # broken rather than plain.
    periods = []
    for key, label in PERIODS:
        boards = []
        for kind, board_label in CHARTS:
            batch = ((top.get(kind) or {}).get(key) or [])[:50]
            rows = []
            for row in batch:
                title = field_text(row.get("name"))
                artist = field_text(row.get("artist"))
                name_key = track_key(artist, title)
                if kind == "albums":
                    cover = pick_cover(
                        image_of(row.get("image")),
                        lb_albums.get(name_key, ""),
                    )
                else:
                    cover = pick_cover(
                        track_art.get(name_key, ""),
                        lb_tracks.get(name_key, ""),
                    )
                entry = {
                    "artist": artist,
                    "cover": cover,
                    "playcount": playcount_of(row),
                    "title": title,
                    "url": field_text(row.get("url")),
                }
                # Hearts are track-level in Last.fm; albums stay unmarked.
                if kind == "tracks":
                    entry["loved"] = is_loved(artist, title, hearts)
                rows.append(entry)
            if not rows:
                continue
            top_count = max((row["playcount"] for row in rows), default=0)
            for row in rows:
                row["share"] = bar_percent(row["playcount"], top_count)
            boards.append({"id": kind, "items": rows, "label": board_label})
        if boards:
            periods.append({"boards": boards, "id": key, "label": label})

    dump_data(
        "lastfm.json",
        {
            "periods": periods,
            "recent": recent,
            "scrobbled_to": recent[0]["date"] if recent else "",
            "user": top.get("user") or scrobbles.get("user") or "viazure",
        },
    )


if __name__ == "__main__":
    main()
