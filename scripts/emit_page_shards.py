#!/usr/bin/env python3
"""从 data/*.json 切出静态分片，供运动/书影音页按需加载。

Hugo 首屏只 SSR 默认年/默认 Tab；其余年份与榜单从 /data/... 拉取。
build_workouts / build_lastfm / build_neodb 写完 data 后应调用本模块。
也可单独执行：python scripts/emit_page_shards.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
STATIC = ROOT / "static" / "data"


def _load(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def _dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def emit_workouts() -> None:
    w = _load("workouts.json")
    years = (w.get("heatmap") or {}).get("years") or []
    groups = {g["year"]: g for g in w.get("groups") or []}
    out = STATIC / "workouts"
    # 清掉旧年份分片，避免删年后面还留文件
    if out.exists():
        for old in out.glob("year-*.json"):
            old.unlink()
    index = {
        "years": [y["year"] for y in years],
        "default_year": years[0]["year"] if years else None,
    }
    _dump(out / "index.json", index)
    for y in years:
        year = y["year"]
        payload = {
            "year": year,
            "heatmap": y,
            "group": groups.get(year)
            or {"year": year, "count": 0, "items": [], "kinds": []},
        }
        _dump(out / f"year-{year}.json", payload)
    print("workouts shards: %d years -> %s" % (len(years), out))


def emit_lastfm() -> None:
    lf = _load("lastfm.json")
    out = STATIC / "media" / "lastfm"
    if out.exists():
        for old in out.glob("period-*.json"):
            old.unlink()
    periods = lf.get("periods") or []
    _dump(
        out / "meta.json",
        {
            "scrobbled_to": lf.get("scrobbled_to") or "",
            "user": lf.get("user") or "",
            "recent": lf.get("recent") or [],
            "periods": [{"id": p["id"], "label": p["label"]} for p in periods],
            "default_period": periods[0]["id"] if periods else None,
        },
    )
    for p in periods:
        _dump(out / f"period-{p['id']}.json", p)
    print("lastfm shards: %d periods -> %s" % (len(periods), out))


def emit_neodb() -> None:
    nd = _load("neodb.json")
    out = STATIC / "media" / "neodb"
    if out.exists():
        for old in out.glob("cat-*.json"):
            old.unlink()
    cats = nd.get("categories") or []
    _dump(
        out / "meta.json",
        {
            "categories": [{"id": c["id"], "label": c["label"]} for c in cats],
            "default_category": cats[0]["id"] if cats else None,
        },
    )
    for c in cats:
        _dump(out / f"cat-{c['id']}.json", c)
    print("neodb shards: %d cats -> %s" % (len(cats), out))


def main() -> None:
    emit_workouts()
    emit_lastfm()
    emit_neodb()


if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(1)
