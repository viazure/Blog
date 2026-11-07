"""Compact Session Clock payloads from life-data splits JSON.

Outer ring = five-tier HR/zone crown for the whole session (always a full 360° lap).
Inner polyline/area = same HR samples when chart.hr exists (also full lap).
Core = full-circle seed (<1h) or growth rings (≥1h), matching geekplux pc(min).

Source priority (life-data/data/workouts/splits/{run_id}.json):
  1. chart.hr  — aggregated series from gen_splits (up to ~200 pts)
  2. laps / km splits hr_avg sequence
  3. zones.hr.seconds → zone wedges
  4. flat from average_heartrate

Bars/hr are resampled to N_SAMPLES (48) so the crown reads as a coarse
stepped rim (geekplux-aligned), not a fine sawtooth.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

# Coarse stepped crown (geekplux-like 48 wedges); detail pixel heights.
N_SAMPLES = 48
BAR_TIERS = [12, 22, 33, 43, 54]
BAR_MAX = BAR_TIERS[-1]
BPM_FLOOR = 70
BPM_CEIL = 190


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def _tier_index(norm: float) -> int:
    """Map 0..1 → five-tier index; slight power so mid efforts still step up."""
    t = _clamp(float(norm), 0.0, 1.0) ** 0.85
    last = len(BAR_TIERS) - 1
    return int(round(t * last))


def _tier_height(norm: float) -> int:
    return BAR_TIERS[_tier_index(norm)]


def _resample(values: list[float], n: int) -> list[float]:
    if not values:
        return []
    if len(values) == n:
        return [float(x) for x in values]
    if len(values) == 1:
        return [float(values[0])] * n
    out: list[float] = []
    last = len(values) - 1
    for i in range(n):
        pos = i * last / (n - 1)
        lo = int(pos)
        hi = min(lo + 1, last)
        t = pos - lo
        out.append(values[lo] * (1 - t) + values[hi] * t)
    return out


def _bars_from_hr(hr: list[float]) -> list[int]:
    """Normalize bpm, then quantize to the five crown tiers."""
    span = float(BPM_CEIL - BPM_FLOOR) or 1.0
    bars: list[int] = []
    for bpm in hr:
        norm = _clamp((float(bpm) - BPM_FLOOR) / span, 0.0, 1.0)
        bars.append(_tier_height(norm))
    return bars


def _bars_from_zones(seconds: list[float], n: int = N_SAMPLES) -> list[int]:
    """Expand time-in-zone into N sequential wedges; height = zone tier."""
    usable = [max(0.0, float(s or 0)) for s in (seconds or [])]
    while usable and usable[-1] == 0:
        usable.pop()
    total = sum(usable)
    if total <= 0 or not usable:
        return [BAR_TIERS[0]] * n
    last = len(BAR_TIERS) - 1
    zone_h = [
        BAR_TIERS[int(round(i * last / max(len(usable) - 1, 1)))]
        for i in range(len(usable))
    ]
    bars: list[int] = []
    for i, sec in enumerate(usable):
        count = max(1, int(round(n * sec / total))) if sec > 0 else 0
        bars.extend([zone_h[i]] * count)
    if not bars:
        return [BAR_TIERS[0]] * n
    if len(bars) < n:
        bars.extend([bars[-1]] * (n - len(bars)))
    return bars[:n]


def _hr_from_segments(segments: Any) -> list[float]:
    """Coarse HR series from lap / km-split averages, weighted by duration."""
    if not isinstance(segments, list) or not segments:
        return []
    weighted: list[tuple[float, float]] = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        hr = seg.get("hr_avg")
        if hr is None:
            continue
        dur = float(seg.get("time") or 0) or 1.0
        weighted.append((dur, float(hr)))
    if not weighted:
        return []
    total = sum(t for t, _ in weighted) or 1.0
    raw: list[float] = []
    for dur, hr in weighted:
        count = max(1, int(round(N_SAMPLES * dur / total)))
        raw.extend([hr] * count)
    return _resample(raw, N_SAMPLES)


def _load_split(splits_dir: Path, run_id: Any) -> dict | None:
    if run_id is None:
        return None
    path = splits_dir / f"{run_id}.json"
    if not path.is_file():
        return None
    try:
        import json

        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def build_session(
    *,
    run_id: Any,
    moving: int,
    hr_avg: float,
    elev: float,
    splits_dir: Path | None,
) -> dict | None:
    """Return a compact session dict, or None when nothing useful exists."""
    split = _load_split(splits_dir, run_id) if splits_dir else None
    summary = (split or {}).get("summary") if split else None
    summary = summary if isinstance(summary, dict) else {}
    zones = ((split or {}).get("zones") or {}).get("hr") if split else None
    zones = zones if isinstance(zones, dict) else {}
    chart = (split or {}).get("chart") if split else None
    chart = chart if isinstance(chart, dict) else {}

    hr_max = summary.get("hr_max")
    kcal = summary.get("calories")
    elev_gain = summary.get("elev_gain")
    if elev_gain is None and elev:
        elev_gain = elev

    hr_series: list[float] = []
    raw_hr = chart.get("hr")
    if isinstance(raw_hr, list) and raw_hr:
        cleaned = [float(x) for x in raw_hr if x is not None]
        hr_series = _resample(cleaned, N_SAMPLES)
    if not hr_series:
        # Prefer km splits, then laps — finer than zone buckets when chart.hr missing.
        hr_series = _hr_from_segments((split or {}).get("splits"))
    if not hr_series:
        hr_series = _hr_from_segments((split or {}).get("laps"))

    bars: list[int]
    if hr_series:
        bars = _bars_from_hr(hr_series)
    elif isinstance(zones.get("seconds"), list) and any(zones.get("seconds") or []):
        bars = _bars_from_zones(list(zones["seconds"]), N_SAMPLES)
    elif hr_avg:
        norm = _clamp((hr_avg - BPM_FLOOR) / (BPM_CEIL - BPM_FLOOR), 0.0, 1.0)
        bars = [_tier_height(norm)] * N_SAMPLES
    else:
        bars = []

    if not bars and not hr_series and not hr_avg and not moving:
        return None

    out: dict[str, Any] = {
        "moving": int(moving or 0),
        "bars": bars,
    }
    if hr_series:
        out["hr"] = [int(round(x)) for x in hr_series]
    if hr_avg:
        out["hr_avg"] = int(round(hr_avg))
    if hr_max:
        out["hr_max"] = int(round(float(hr_max)))
    if kcal:
        out["kcal"] = int(round(float(kcal)))
    if elev_gain and float(elev_gain) > 0:
        out["elev"] = int(round(float(elev_gain)))
    return out
