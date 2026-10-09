#!/usr/bin/env python3
"""Build the workouts page data: activities, heatmap, year groups, sport stats.

Everything the template needs is computed here, so the Hugo side only loops.
Outputs two files:

  data/workouts.json  — page data (no polylines)
  static/trails.json  — simplified track outlines, rendered on demand by the page

The track geometry is simplified with Douglas-Peucker at a tolerance suited to a
40px thumbnail (1px in a 40px box is about 2.5e-4 degrees), which takes ~394
tracks from ~980k points down to about 65 KB.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from math import ceil
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from paths import dump_data, life_data_root, load_json

ROOT = Path(__file__).resolve().parents[1]
# Workouts are dated in local time. China has no DST, so a fixed offset
# matches build_lastfm.DISPLAY_TZ and does not depend on the runner's zone.
DISPLAY_TZ = timezone(timedelta(hours=8))
RUN_PAGE = "https://run.viazure.cc"
TRACK_TOLERANCE = 3e-4
TRACK_SIZE = 40
TRAIL_BUDGET = 120000  # bytes; keep the whole trail file bounded
# Must match assets/sass/_page-vars.scss $switcher-slots: extra sport
# panels have no :has() rule, so they would render as a blank page.
SWITCHER_SLOTS = 20

# Garmin type -> (display name, bucket, emoji). The emoji belongs to the
# activity itself; the bucket emoji is only used for the 统计 switcher. An
# unmapped type keeps its raw name and falls into 其他, so a new sport needs no
# change here.
KIND = {
    "running": ("跑步", "跑步", "🏃"),
    "Run": ("跑步", "跑步", "🏃"),
    "walking": ("走路", "其他", "🚶"),
    "hiking": ("徒步", "其他", "🥾"),
    "swimming": ("游泳", "游泳", "🏊"),
    "training": ("自由训练", "其他", "🎽"),
    "Ride": ("骑行", "骑行", "🚴"),
    "cycling": ("骑行", "骑行", "🚴"),
    "biking": ("骑行", "骑行", "🚴"),
    "fitness_equipment": ("健身器械", "其他", "🏋️"),
    "hiit": ("HIIT", "其他", "🔥"),
    "skateboarding": ("滑板", "其他", "🛹"),
}
# Subtype wins over type so training/jump_rope is 跳绳, not 训练.
SUBTYPE_NAME = {
    "strength_training": "力量训练",
    "pilates": "普拉提",
    "lap_swimming": "游泳",
    "breathing": "呼吸",
    "jump_rope": "跳绳",
    "yoga": "瑜伽",
    "stair_climbing": "爬楼",
}
SUBTYPE_ICON = {
    "strength_training": "💪",
    "pilates": "🤸",
    "lap_swimming": "🏊",
    "breathing": "🌬️",
    "jump_rope": "🪢",
    "yoga": "🧘",
    "stair_climbing": "🪜",
}
# GitHub-style 4-step palettes (pale → solid). The only activity colours:
# heatmap cells, the 4-week bars, and multi-sport day pies all read from here.
# https://github.com/zhaohongxuan/workouts ContributionHeatmap.
HEAT_PALETTES = {
    "跑步": ("#fed7aa", "#fb923c", "#f97316", "#ea580c"),
    "骑行": ("#bfdbfe", "#60a5fa", "#3b82f6", "#2563eb"),
    "徒步": ("#bbf7d0", "#4ade80", "#22c55e", "#16a34a"),
    "走路": ("#d9f99d", "#a3e635", "#84cc16", "#65a30d"),
    "游泳": ("#cffafe", "#22d3ee", "#06b6d4", "#0891b2"),
    "力量训练": ("#fce7f3", "#f9a8d4", "#ec4899", "#db2777"),
    "自由训练": ("#fbcfe8", "#f472b6", "#db2777", "#be185d"),
    "体感游戏": ("#fecdd3", "#fb7185", "#e11d48", "#be123c"),
    "HIIT": ("#fecdd3", "#fb7185", "#f43f5e", "#e11d48"),
    "普拉提": ("#e9d5ff", "#c084fc", "#a855f7", "#7c3aed"),
    "呼吸": ("#ddd6fe", "#a78bfa", "#8b5cf6", "#7c3aed"),
    "跳绳": ("#fde68a", "#fbbf24", "#f59e0b", "#d97706"),
    "瑜伽": ("#f5d0fe", "#e879f9", "#c026d3", "#a21caf"),
    "爬楼": ("#e7e5e4", "#a8a29e", "#78716c", "#57534e"),
    "滑板": ("#bae6fd", "#38bdf8", "#0ea5e9", "#0284c7"),
    "健身器械": ("#e2e8f0", "#94a3b8", "#64748b", "#475569"),
    "其他": ("#e9d5ff", "#c084fc", "#a855f7", "#7c3aed"),
}
# First three stat chips stay put. The fourth opens a menu of the remaining sports.


def kind_of(activity_type: str, subtype: str, raw_name: str = "") -> tuple[str, str, str]:
    """Display name, stats bucket, emoji. Subtype is more specific than type."""
    if subtype in SUBTYPE_NAME:
        name = SUBTYPE_NAME[subtype]
        icon = SUBTYPE_ICON.get(subtype, "•")
        bucket = KIND[activity_type][1] if activity_type in KIND else "其他"
        if name == "游泳":
            bucket = "游泳"
        return name, bucket, icon
    if activity_type == "training" and subtype in ("", "generic"):
        lower = raw_name.lower()
        if "somatosensory" in lower:
            return "体感游戏", "其他", "🎮"
        return "自由训练", "其他", "🎽"
    if activity_type in KIND:
        return KIND[activity_type]
    return (activity_type or "运动", "其他", "•")


def heat_palette(name: str) -> tuple[str, str, str, str]:
    return HEAT_PALETTES.get(name) or HEAT_PALETTES["其他"]


def sport_colour(name: str) -> str:
    """Solid step of the heatmap palette, for multi-sport day pies."""
    return heat_palette(name)[2]


def heat_colour(name: str, level: int) -> str:
    return heat_palette(name)[max(0, min(3, level - 1))]


def seconds_of(value: str) -> float:
    """Parse H:MM:SS, including Garmin's fractional seconds (JS Number)."""
    bits = [float(part) for part in (value or "0").split(":") if part != ""]
    total = 0.0
    for bit in bits:
        total = total * 60 + bit
    return total


def clock_of(seconds: float) -> str:
    """Same as workouts PersonalBest formatTime: Math.floor on h/m/s."""
    if seconds <= 0:
        return ""
    total = float(seconds)
    hours = int(total // 3600)
    minutes = int((total % 3600) // 60)
    secs = int(total % 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def hm_of(seconds: int) -> str:
    """Strava-style duration: 1h 7m / 30m."""
    if seconds <= 0:
        return "0m"
    minutes, _secs = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    if hours and minutes:
        return "%dh %dm" % (hours, minutes)
    if hours:
        return "%dh" % hours
    return "%dm" % minutes


def card_clock_parts(seconds: int) -> tuple[str, str]:
    """Hero duration as (num, unit), same layout as km + unit.

    en ICU short: 40 + min, 1 + hr, compound "1 hr 18 min".
    """
    if seconds <= 0:
        return "", ""
    minutes, _secs = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    if hours and minutes:
        return "%d hr %d min" % (hours, minutes), ""
    if hours:
        return str(hours), "hr"
    return str(minutes), "min"


def hours_label(seconds: float) -> str:
    """Banner / stats duration. Under 1 hour show minutes, else hours.

    Whole hours stay integers; partial hours get one decimal so a year of
    short indoor sessions is not 「0 小时」.
    """
    if seconds <= 0:
        return "0 分钟"
    if seconds < 3600:
        return "%d 分钟" % max(1, int(round(seconds / 60)))
    hours = seconds / 3600
    if abs(hours - round(hours)) < 0.05:
        return "%d 小时" % int(round(hours))
    return "%.1f 小时" % hours


def title_for(hour: int, name: str, km: float) -> str:
    """Same hour buckets as running_page titleForRun, with Chinese labels."""
    if name == "跑步":
        if 20 < km < 40:
            return "半程马拉松"
        if km >= 40:
            return "全程马拉松"
    if hour <= 10:
        period = "晨间"
    elif hour <= 14:
        period = "午间"
    elif hour <= 18:
        period = "午后"
    elif hour <= 21:
        period = "傍晚"
    else:
        period = "夜晚"
    return period + name


def decode_polyline(encoded: str, precision: int = 5) -> list[tuple[float, float]]:
    coords, index, lat, lng = [], 0, 0, 0
    factor = float(10 ** precision)
    while index < len(encoded):
        for _axis in range(2):
            shift, result = 0, 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if (result & 1) else (result >> 1)
            if _axis == 0:
                lat += delta
            else:
                lng += delta
        coords.append((lat / factor, lng / factor))
    return coords


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Douglas-Peucker, iterative so deep tracks cannot blow the stack."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        (y1, x1), (y2, x2) = points[first], points[last]
        dx, dy = x2 - x1, y2 - y1
        norm = (dx * dx + dy * dy) ** 0.5 or 1e-9
        best, best_i = -1.0, -1
        for i in range(first + 1, last):
            y0, x0 = points[i]
            dist = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
            if dist > best:
                best, best_i = dist, i
        if best > tolerance:
            keep[best_i] = True
            stack.append((first, best_i))
            stack.append((best_i, last))
    return [p for p, k in zip(points, keep) if k]


def trail_points(polyline: str) -> str:
    """Normalised "x y" pairs for one track, or '' when unusable."""
    if not polyline:
        return ""
    try:
        pts = decode_polyline(polyline)
    except Exception:
        return ""
    if len(pts) < 2:
        return ""
    for lat, lng in pts:
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            return ""
    pts = simplify(pts, TRACK_TOLERANCE)
    if len(pts) < 2:
        return ""
    lats = [p[0] for p in pts]
    lngs = [p[1] for p in pts]
    min_lat, max_lat, min_lng, max_lng = min(lats), max(lats), min(lngs), max(lngs)
    lat_range = (max_lat - min_lat) or 1e-6
    lng_range = (max_lng - min_lng) or 1e-6
    pad = 4
    scale = min((TRACK_SIZE - pad * 2) / lng_range, (TRACK_SIZE - pad * 2) / lat_range)
    off_x = (TRACK_SIZE - lng_range * scale) / 2
    off_y = (TRACK_SIZE - lat_range * scale) / 2
    return " ".join(
        "%.0f %.0f" % ((lng - min_lng) * scale + off_x,
                       TRACK_SIZE - ((lat - min_lat) * scale + off_y))
        for lat, lng in pts
    )


def summarise(rows: list[dict]) -> dict:
    moving = sum(r["moving"] for r in rows)
    return {
        "n": len(rows),
        "km": round(sum(r["km"] for r in rows), 1),
        "elev": round(sum(r["elev"] for r in rows)),
        "moving": moving,
        "hours": hours_label(moving),
    }


def records_for(bucket: str, rows: list[dict]) -> list[dict]:
    out = []
    if bucket == "跑步":
        paced = [r for r in rows if r["pace"]]
        for label, lo, hi in (("5K", 4.90, 5.20), ("10K", 9.80, 10.30),
                              ("半程马拉松", 21.0, 21.5)):
            found = [r for r in paced if lo <= r["km"] <= hi]
            if found:
                best = min(found, key=lambda r: r["moving"])
                out.append({"label": label,
                            "value": clock_of(best["moving"]),
                            "year": best["date"][:4]})
        days = sorted({r["day"] for r in rows})
        if days:
            best, cur, end = 1, 1, days[0]
            for prev, current in zip(days, days[1:]):
                if (current - prev).days == 1:
                    cur += 1
                    if cur > best:
                        best, end = cur, current
                else:
                    cur = 1
            out.append({"label": "最长连续跑步", "value": "%d 天" % best,
                        "year": str(end.year)})
    if rows:
        longest = max(rows, key=lambda r: r["km"])
        if longest["km"] >= 0.1:
            out.append({"label": "最长距离", "value": "%.2f 公里" % longest["km"],
                        "year": longest["date"][:4]})
        longest_t = max(rows, key=lambda r: r["moving"])
        out.append({"label": "最长单次", "value": clock_of(longest_t["moving"]),
                    "year": longest_t["date"][:4]})
        top_elev = max(rows, key=lambda r: r["elev"])
        if top_elev["elev"]:
            out.append({"label": "单次最大爬升", "value": "%.0f 米" % top_elev["elev"],
                        "year": top_elev["date"][:4]})
    return out


def four_week_start(today: date) -> date:
    """Monday of the oldest week in the 4-week calendar (this Monday minus 3)."""
    monday = today - timedelta(days=today.weekday())
    return monday - timedelta(weeks=3)


def four_week_view(by_day: dict[date, list[dict]],
                   today: date) -> tuple[list, list, list, int]:
    """Last 4 weeks relative to today: Monday-first calendar, duration bars
    for weeks with activity, and one legend entry per sport that appears."""
    origin = four_week_start(today)
    peak_mv = 1
    weeks_plan = [origin + timedelta(weeks=w) for w in range(4)]
    for start in weeks_plan:
        for offset in range(7):
            day = start + timedelta(days=offset)
            if day > today:
                continue
            mv = sum(h["moving"] for h in by_day.get(day, []))
            if mv > peak_mv:
                peak_mv = mv
    calendar = []
    weeks_hits: list[list[dict]] = []
    recent_rows: list[dict] = []
    for start in weeks_plan:
        cells = []
        week_rows: list[dict] = []
        for offset in range(7):
            day = start + timedelta(days=offset)
            in_range = day <= today
            hits = by_day.get(day, []) if in_range else []
            classes = ["cd"]
            if not in_range:
                classes.append("future")
            if hits:
                classes.append("on")
            if day == today:
                classes.append("today")
            detail = " · ".join(
                ("%s %.2f km" % (h["label"], h["km"])) if h["km"] >= 0.1
                else ("%s %s" % (h["label"], clock_of(h["moving"])))
                for h in hits
            )
            mv = sum(h["moving"] for h in hits)
            size = 6 + int(8 * ((mv / peak_mv) ** 0.5)) if hits else 0
            cells.append({
                "class": " ".join(classes),
                "date": day.isoformat(),
                "day": day.day,
                "title": detail,
                "today": day == today,
                "size": size,
                "km": round(sum(h["km"] for h in hits), 1),
            })
            week_rows.extend(hits)
        calendar.append(cells)
        weeks_hits.append(week_rows)
        recent_rows.extend(week_rows)

    # One slot per sport. Lightest palette step so stacked bars stay calm.
    totals: dict[str, dict] = {}
    for hit in recent_rows:
        slot = totals.setdefault(hit["name"], {
            "name": hit["name"], "icon": hit["icon"], "moving": 0,
        })
        slot["moving"] += hit["moving"]
        slot["icon"] = hit["icon"]
    legend = [{
        "name": s["name"],
        "icon": s["icon"],
        "colour": heat_colour(s["name"], 1),
    } for s in sorted(totals.values(), key=lambda s: (-s["moving"], s["name"]))]

    week_bars = []
    for week_rows in weeks_hits:
        week_mv = sum(h["moving"] for h in week_rows)
        if week_mv <= 0:
            continue
        by_name: dict[str, int] = defaultdict(int)
        for hit in week_rows:
            by_name[hit["name"]] += hit["moving"]
        segments = []
        for item in legend:
            moving = by_name.get(item["name"], 0)
            if moving <= 0:
                continue
            hm = hm_of(moving)
            segments.append({
                "name": item["name"],
                "colour": item["colour"],
                "pct": round(100.0 * moving / week_mv, 1),
                "hm": hm,
                "tip": "%s %s" % (item["name"], hm),
            })
        week_bars.append({
            "moving": week_mv,
            "hm": hm_of(week_mv),
            "segments": segments,
        })
    week_peak = max((b["moving"] for b in week_bars), default=1) or 1
    for bar in week_bars:
        bar["pct"] = round(100.0 * bar["moving"] / week_peak, 1)
    return calendar, week_bars, legend, len(recent_rows)


def build_heatmap(rows: list[dict], years: list[int],
                  by_day: dict[date, list[dict]]) -> dict:
    """GitHub-style year heatmaps; cells coloured by activity name."""
    year_panels = []
    for year in years:
        jan1 = date(year, 1, 1)
        # Pad to Monday so weeks align
        start = jan1 - timedelta(days=jan1.weekday())
        dec31 = date(year, 12, 31)
        end = dec31 + timedelta(days=(6 - dec31.weekday()))

        def hit_load(h: dict) -> float:
            return h["moving"] / 60.0 + h["km"]

        type_peak: dict[str, float] = defaultdict(lambda: 1.0)
        for day, hits in by_day.items():
            if day.year != year:
                continue
            by_n: dict[str, float] = defaultdict(float)
            for h in hits:
                by_n[h["name"]] += hit_load(h)
            for n, v in by_n.items():
                if v > type_peak[n]:
                    type_peak[n] = v

        weeks = []
        cursor = start
        week_index = 0
        while cursor <= end:
            cells = []
            for offset in range(7):
                day = cursor + timedelta(days=offset)
                in_year = day.year == year
                hits = by_day.get(day, []) if in_year else []
                if not in_year:
                    cells.append({"class": "hm out", "title": "", "colour": "",
                                  "segments": []})
                    continue
                if not hits:
                    cells.append({"class": "hm", "title": day.isoformat(),
                                  "colour": "", "segments": []})
                    continue
                # Aggregate km (or count) per activity name for pie segments
                by_name: dict[str, float] = defaultdict(float)
                for hit in hits:
                    weight = hit["km"] if hit["km"] >= 0.1 else max(hit["moving"] / 3600, 0.1)
                    by_name[hit["name"]] += weight
                total_w = sum(by_name.values()) or 1
                names = sorted(by_name, key=by_name.get, reverse=True)
                primary = names[0]
                segments = []
                angle = 0.0
                for name in names:
                    pct = 100 * by_name[name] / total_w
                    segments.append({"name": name, "colour": sport_colour(name),
                                     "pct": round(pct, 1), "start": round(angle, 1)})
                    angle += pct
                detail = " · ".join(
                    ("%s %.2f km" % (h["label"], h["km"])) if h["km"] >= 0.1
                    else ("%s %s" % (h["label"], clock_of(h["moving"])))
                    for h in hits
                )
                pie = ""
                if len(segments) > 1:
                    stops = []
                    for seg in segments:
                        end_a = seg["start"] + seg["pct"]
                        stops.append("%s %.1f%% %.1f%%" % (
                            seg["colour"], seg["start"], end_a))
                    pie = "conic-gradient(%s)" % ", ".join(stops)
                cls = "hm on" + (" multi" if pie else "")
                prim_load = sum(hit_load(h) for h in hits if h["name"] == primary)
                peak = type_peak[primary]
                level = max(1, min(4, int(ceil(min(prim_load / peak, 1.0) * 4))))
                cells.append({
                    "class": cls,
                    "title": "%s · %s" % (day.isoformat(), detail),
                    "colour": heat_colour(primary, level),
                    "pie": pie,
                    "segments": segments,
                })
            weeks.append(cells)
            cursor += timedelta(days=7)
            week_index += 1
        # 月份按 12 等分钉死，不跟「1 号所在周」走，换年标签不会挪。
        month_marks = [{"label": "%d月" % m, "pct": round(100.0 * (m - 1) / 12, 3)}
                       for m in range(1, 13)]
        names_used = sorted({
            h["name"] for day, hits in by_day.items()
            if day.year == year for h in hits
        }, key=lambda n: (0 if n == "跑步" else 1, n))
        legend = [{"name": n, "colours": list(HEAT_PALETTES.get(n) or HEAT_PALETTES["其他"])}
                  for n in names_used]
        year_panels.append({
            "year": year,
            "weeks": weeks,
            "months": month_marks,
            "legend": legend,
        })
    return {"years": year_panels}


def main() -> None:
    path = life_data_root() / "data" / "workouts" / "activities.json"
    if not path.exists():
        print("activities source missing, skip")
        return
    raw = load_json(path)
    if not isinstance(raw, list):
        raise SystemExit("workouts/activities.json must be a JSON array")

    rows = []
    trails = {}
    for index, entry in enumerate(raw):
        stamp = (entry.get("start_date_local") or "")[:16]
        started = ""
        try:
            moment = datetime.strptime(stamp, "%Y-%m-%d %H:%M")
            started = moment.strftime("%H:%M")
        except ValueError:
            try:
                moment = datetime.strptime(stamp[:10], "%Y-%m-%d")
            except ValueError:
                continue
        activity_type = str(entry.get("type") or "")
        subtype = str(entry.get("subtype") or "")
        name, bucket, icon = kind_of(activity_type, subtype, str(entry.get("name") or ""))
        meters = float(entry.get("distance") or 0)
        moving = int(seconds_of(str(entry.get("moving_time") or "")))
        pace = None
        if name == "跑步" and meters >= 100 and moving:
            candidate = moving / (meters / 1000)
            # the archive holds a 21-second 5 km entry; reject impossible paces
            if 150 <= candidate <= 900:
                pace = candidate
        row = {
            "bucket": bucket,
            "date": moment.strftime("%Y-%m-%d"),
            "day": moment.date(),
            "elev": float(entry.get("elevation_gain") or 0),
            "hr": float(entry["average_heartrate"]) if entry.get("average_heartrate") else 0,
            "icon": icon,
            "idx": index,
            "km": round(meters / 1000, 2),
            "label": title_for(moment.hour, name, meters / 1000),
            "moving": moving,
            "name": name,
            "pace": round(pace, 1) if pace else 0,
            "has_trail": False,
        }
        if started:
            row["time"] = started
        clock_num, clock_unit = card_clock_parts(moving)
        row["clock"] = clock_num
        row["clock_unit"] = clock_unit
        rows.append(row)
        points = trail_points(str(entry.get("summary_polyline") or ""))
        if points:
            trails[str(index)] = points
    if not rows:
        print("no activities parsed, skip")
        return

    rows.sort(key=lambda r: (r["date"], r.get("time") or ""), reverse=True)
    runs = [r for r in rows if r["name"] == "跑步"]
    today = datetime.now(DISPLAY_TZ).date()
    year = today.year
    win_start = four_week_start(today)
    recent_rows = [r for r in rows if win_start <= r["day"] <= today]

    # trails first so cards know whether a polyline survived the size budget
    ordered = sorted(trails.items(), key=lambda kv: int(kv[0]))
    trimmed, used = {}, 0
    for key, points in ordered:
        if used + len(points) > TRAIL_BUDGET:
            continue
        trimmed[key] = points
        used += len(points)
    for row in rows:
        row["has_trail"] = str(row["idx"]) in trimmed
    static_dir = ROOT / "static"
    static_dir.mkdir(parents=True, exist_ok=True)
    (static_dir / "trails.json").write_text(
        json.dumps({"points": trimmed}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    # one panel per sport, ranked by count in the latest calendar year
    years = sorted({r["day"].year for r in rows}, reverse=True)
    by_name: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_name[row["name"]].append(row)
    rank_year = years[0] if years else today.year
    year_n = {
        n: sum(1 for r in rs if r["day"].year == rank_year)
        for n, rs in by_name.items()
    }
    ranked = sorted(
        by_name,
        key=lambda n: (-year_n[n], -len(by_name[n]), n),
    )
    if len(ranked) > SWITCHER_SLOTS:
        print("warning: %d sports exceed %d switcher slots; truncating"
              % (len(ranked), SWITCHER_SLOTS), file=sys.stderr)
        ranked = ranked[:SWITCHER_SLOTS]

    panels = []
    for name in ranked:
        mine = by_name[name]
        all_s = summarise(mine)
        panels.append({
            "bucket": name,
            "icon": next((r["icon"] for r in mine if r.get("icon")), "•"),
            "hide_km": all_s["km"] < 0.1,
            "recent": summarise([r for r in mine if win_start <= r["day"] <= today]),
            "yearly": [dict(summarise([r for r in mine if r["day"].year == y]),
                            year=int(y))
                       for y in years],
            "all": all_s,
            "records": records_for(name, mine),
        })

    # one activity list per year ("day" is a date object used for grouping only)
    head_kinds = ("跑步", "骑行", "游泳", "徒步", "走路")

    def kinds_in(items: list[dict]) -> list[dict]:
        seen: dict[str, str] = {}
        for row in items:
            seen.setdefault(row["name"], row["icon"])
        ordered = [n for n in head_kinds if n in seen]
        ordered += sorted(n for n in seen if n not in head_kinds)
        return [{"name": n, "icon": seen[n]} for n in ordered]

    groups = []
    for y in years:
        items = [{k: v for k, v in r.items() if k != "day"}
                 for r in rows if r["day"].year == y]
        groups.append({
            "year": y,
            "count": len(items),
            "items": items,
            "kinds": kinds_in(items),
        })

    # 4-week dot calendar, Monday-first, newest week last. Rows are precomputed
    # here so the template only loops.
    by_day: dict[date, list[dict]] = defaultdict(list)
    for row in rows:
        by_day[row["day"]].append(row)
    heatmap = build_heatmap(rows, years, by_day)
    cal, bars, kinds, recent_n = four_week_view(by_day, today)
    heatmap["last4"] = {
        "recent_n": recent_n,
        "calendar": cal,
        "week_bars": bars,
        "week_kinds": kinds,
    }
    for panel in heatmap["years"]:
        y = panel["year"]
        mine = [r for r in rows if r["day"].year == y]
        panel["km"] = round(sum(r["km"] for r in mine), 1)
        panel["hours"] = hours_label(sum(r["moving"] for r in mine))
        panel["n"] = len(mine)

    dump_data("workouts.json", {
        "generated_from": "life-data/workouts/activities.json",
        "stopgap": False,
        "totals": {
            "km": round(sum(r["km"] for r in rows), 1),
            "moving": sum(r["moving"] for r in rows),
            "runs": len(runs),
            "sessions": len(rows),
        },
        "latest": max(r["date"] for r in rows),
        "year": year,
        "last4": summarise(recent_rows),
        "heatmap": heatmap,
        "groups": groups,
        "panels": panels,
        "run_page": RUN_PAGE,
    })
    print("workouts ok (%d activities, %d trails, %.0f KB of track data)"
          % (len(rows), len(trimmed), used / 1024))


if __name__ == "__main__":
    main()
