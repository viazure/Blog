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
from datetime import date, datetime, timedelta
from math import ceil
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from paths import dump_data, life_data_root, load_json

ROOT = Path(__file__).resolve().parents[1]
RUN_PAGE = "https://run.viazure.cc"
TRACK_TOLERANCE = 3e-4
TRACK_SIZE = 40
TRAIL_BUDGET = 120000  # bytes; keep the whole trail file bounded

# Garmin type -> (display name, bucket, emoji). The emoji belongs to the
# activity itself; the bucket emoji is only used for the 统计 switcher. An
# unmapped type keeps its raw name and falls into 其他, so a new sport needs no
# change here.
KIND = {
    "running": ("跑步", "跑步", "🏃"),
    "Run": ("跑步", "跑步", "🏃"),
    # Garmin 把 walking / hiking 记成两种 type，展示都归「徒步」
    "walking": ("徒步", "其他", "🥾"),
    "hiking": ("徒步", "其他", "🥾"),
    "swimming": ("游泳", "游泳", "🏊"),
    "training": ("力量训练", "其他", "💪"),
    "Ride": ("骑行", "骑行", "🚴"),
    "cycling": ("骑行", "骑行", "🚴"),
    "biking": ("骑行", "骑行", "🚴"),
    "fitness_equipment": ("普拉提", "其他", "🤸"),
    "hiit": ("HIIT", "其他", "🔥"),
}
SUBTYPE_NAME = {
    "strength_training": "力量训练",
    "pilates": "普拉提",
    "lap_swimming": "游泳",
    "breathing": "呼吸",
}
SUBTYPE_ICON = {
    "strength_training": "💪",
    "pilates": "🤸",
    "lap_swimming": "🏊",
    "breathing": "🧘",
}
# Per-activity colours for tracks / heatmap (bucket chart keeps BUCKETS colours).
SPORT_COLOURS = {
    "跑步": "#f97316",
    "骑行": "#3b82f6",
    "徒步": "#22c55e",
    "游泳": "#14b8a6",
    "力量训练": "#ec4899",
    "HIIT": "#f43f5e",
    "普拉提": "#a855f7",
    "呼吸": "#8b5cf6",
}
DEFAULT_SPORT_COLOUR = "#8b5cf6"
# GitHub-style 4-step palettes (pale → solid), same steps as
# https://github.com/zhaohongxuan/workouts ContributionHeatmap.
HEAT_PALETTES = {
    "跑步": ("#fed7aa", "#fb923c", "#f97316", "#ea580c"),
    "骑行": ("#bfdbfe", "#60a5fa", "#3b82f6", "#2563eb"),
    "徒步": ("#bbf7d0", "#4ade80", "#22c55e", "#16a34a"),
    "游泳": ("#cffafe", "#22d3ee", "#06b6d4", "#0891b2"),
    "力量训练": ("#fce7f3", "#f9a8d4", "#ec4899", "#db2777"),
    "HIIT": ("#fecdd3", "#fb7185", "#f43f5e", "#e11d48"),
    "普拉提": ("#e9d5ff", "#c084fc", "#a855f7", "#7c3aed"),
    "呼吸": ("#ddd6fe", "#a78bfa", "#8b5cf6", "#7c3aed"),
    "其他": ("#e9d5ff", "#c084fc", "#a855f7", "#7c3aed"),
}
# Four core buckets + one catch-all, in display order.
BUCKETS = [("跑步", "🏃", "#f97316"), ("骑行", "🚴", "#3b82f6"),
           ("游泳", "🏊", "#14b8a6"), ("其他", "✨", "#8b5cf6")]


def sport_colour(name: str) -> str:
    return SPORT_COLOURS.get(name, DEFAULT_SPORT_COLOUR)


def heat_colour(name: str, level: int) -> str:
    pal = HEAT_PALETTES.get(name) or HEAT_PALETTES["其他"]
    return pal[max(0, min(3, level - 1))]


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


def card_clock(seconds: int) -> str:
    """Duration on a workout card: H:MM past one hour, else M:SS."""
    if seconds <= 0:
        return ""
    hours = seconds // 3600
    if hours:
        return f"{hours}:{(seconds % 3600) // 60:02d}"
    return f"{seconds // 60}:{seconds % 60:02d}"


def card_extra(pace: float, hr: float, elev: float) -> str:
    parts = []
    if pace:
        total = int(pace)
        parts.append(f"{total // 60}:{total % 60:02d} /km")
    if hr:
        parts.append(f"{hr:.0f} bpm")
    if elev:
        parts.append(f"{elev:.0f} m")
    return " · ".join(parts)


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
        "hours": int(round(moving / 3600)) if moving else 0,
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
        # 「其他」以时长/次数为主，不强调距离
        if bucket != "其他":
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


def four_week_view(by_day: dict[date, list[dict]],
                   today: date) -> tuple[list, list, list, int]:
    """Last 4 weeks relative to today: Monday-first calendar, duration bars
    for weeks with activity, and a colour+emoji legend of sports that appear."""
    monday = today - timedelta(days=today.weekday())
    peak_mv = 1
    weeks_plan = []
    for week in range(4):
        start = monday - timedelta(weeks=3 - week)
        weeks_plan.append(start)
        for offset in range(7):
            day = start + timedelta(days=offset)
            if day > today:
                continue
            mv = sum(h["moving"] for h in by_day.get(day, []))
            if mv > peak_mv:
                peak_mv = mv
    calendar = []
    week_bars = []
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
        recent_rows.extend(week_rows)
        week_mv = sum(h["moving"] for h in week_rows)
        if week_mv <= 0:
            continue
        by_name: dict[str, dict] = {}
        for hit in week_rows:
            slot = by_name.setdefault(hit["name"], {
                "name": hit["name"],
                "icon": hit["icon"],
                "colour": sport_colour(hit["name"]),
                "moving": 0,
            })
            slot["moving"] += hit["moving"]
            slot["icon"] = hit["icon"]
        ordered = sorted(by_name.values(), key=lambda x: -x["moving"])
        segments = [{
            "name": s["name"],
            "colour": s["colour"],
            "pct": round(100.0 * s["moving"] / week_mv, 1),
        } for s in ordered]
        week_bars.append({
            "moving": week_mv,
            "hm": hm_of(week_mv),
            "colour": ordered[0]["colour"],
            "segments": segments,
        })
    week_peak = max((b["moving"] for b in week_bars), default=1) or 1
    for bar in week_bars:
        bar["pct"] = round(100.0 * bar["moving"] / week_peak, 1)
    kind_tot: dict[str, dict] = {}
    for hit in recent_rows:
        slot = kind_tot.setdefault(hit["name"], {
            "name": hit["name"],
            "icon": hit["icon"],
            "colour": sport_colour(hit["name"]),
            "moving": 0,
        })
        slot["moving"] += hit["moving"]
        slot["icon"] = hit["icon"]
    legend = sorted(kind_tot.values(), key=lambda x: (-x["moving"], x["name"]))
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
        try:
            moment = datetime.strptime(stamp, "%Y-%m-%d %H:%M")
        except ValueError:
            try:
                moment = datetime.strptime(stamp[:10], "%Y-%m-%d")
            except ValueError:
                continue
        activity_type = str(entry.get("type") or "")
        subtype = str(entry.get("subtype") or "")
        if activity_type in KIND:
            name, bucket, icon = KIND[activity_type]
        else:
            name = SUBTYPE_NAME.get(subtype) or activity_type or "运动"
            bucket = "其他"
            icon = SUBTYPE_ICON.get(subtype, "•")
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
        row["clock"] = card_clock(moving)
        row["extra"] = card_extra(row["pace"], row["hr"], row["elev"])
        rows.append(row)
        points = trail_points(str(entry.get("summary_polyline") or ""))
        if points:
            trails[str(index)] = points
    if not rows:
        print("no activities parsed, skip")
        return

    rows.sort(key=lambda r: r["date"], reverse=True)
    runs = [r for r in rows if r["bucket"] == "跑步"]
    today = max(r["day"] for r in rows)
    year = today.year
    last4 = today - timedelta(days=28)
    recent_rows = [r for r in rows if r["day"] > last4]

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

    # per-sport panels: 4 weeks / one block per year / all time / records
    years = sorted({r["day"].year for r in rows}, reverse=True)
    panels = []
    for bucket, icon, _colour in BUCKETS:
        mine = [r for r in rows if r["bucket"] == bucket]
        panel = {
            "bucket": bucket,
            "icon": icon,
            "recent": summarise([r for r in mine if r["day"] > last4]),
            "yearly": [dict(summarise([r for r in mine if r["day"].year == y]),
                            year=int(y))
                       for y in years],
            "all": summarise(mine),
            "records": records_for(bucket, mine),
        }
        if bucket == "其他":
            by_name: dict[str, list[dict]] = defaultdict(list)
            for row in mine:
                by_name[row["name"]].append(row)
            kinds = sorted(by_name, key=lambda n: (-len(by_name[n]), n))
            panel["breakdown"] = [{
                "name": name,
                "icon": next((r["icon"] for r in by_name[name] if r.get("icon")), "•"),
                "recent": summarise([r for r in by_name[name] if r["day"] > last4]),
                "yearly": [dict(summarise([r for r in by_name[name]
                                           if r["day"].year == y]), year=int(y))
                           for y in years],
                "all": summarise(by_name[name]),
            } for name in kinds]
        panels.append(panel)

    # one activity list per year ("day" is a date object used for grouping only)
    head_kinds = ("跑步", "骑行", "游泳")

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
        panel["hours"] = int(sum(r["moving"] for r in mine) / 3600)
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
