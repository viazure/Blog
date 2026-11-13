"""Compact Session Clock payloads from life-data splits JSON.

Outer ring = six-tier HR/zone crown (Z0–Z5) for the whole session (always a full 360° lap).
Inner polyline/area = same HR samples when chart.hr exists (also full lap).
Core = full-circle seed (<1h) or growth rings (≥1h), matching geekplux pc(min).

Source priority (life-data/data/workouts/splits/{run_id}.json):
  Prefer a real device time-in-zone table (bounds + seconds, calc_type
  not estimated/derived). Map HR samples to that table; if there is no
  HR series, draw bars from the device seconds. Estimates such as
  percent_max_hr_estimated, and activities with no device zones, use
  the configured LTHR table instead. Never paste estimated or foreign
  seconds onto the LTHR bounds.
  1. chart.hr  — aggregated series from gen_splits (up to ~200 pts),
     including time-bucketed indoor FIT curves when distance is 0
  2. laps / km splits hr_avg sequence (actual BPM)
  3. device zones.hr.seconds when no HR series exists
  4. flat from average_heartrate at that BPM's LTHR-zone height

Bars/hr are resampled to N_SAMPLES (48) so the crown reads as a coarse
stepped rim (geekplux-aligned), not a fine sawtooth.
"""

from __future__ import annotations

import re
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

# Coarse stepped crown (geekplux-like 48 wedges). Heights are fixed by
# Z0-Z5, never stretched to a session's own min/max or 70-190 linear scale.
N_SAMPLES = 48
BAR_TIERS = [5, 12, 19, 26, 33, 40]  # Z0 .. Z5
BAR_MAX = BAR_TIERS[-1]
# Zone BPM boundaries come from a single configured lactate threshold
# (hugo.toml params.workouts.lactateThresholdBpm, default 176), not from
# each activity's high_boundary or max_hr. See lthr_boundaries().
DEFAULT_LTHR_BPM = 176
ZONE_PCTS = (0.65, 0.80, 0.89, 0.95, 1.00, 1.07)


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


def _round_half_up(value) -> int:
    """Half-up to nearest int (0.5 away from zero), not Python 3 banker's round."""
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def lthr_boundaries(lthr: float | int | None = None) -> list[int]:
    """Six BPM boundaries from LTHR × ZONE_PCTS.

    The first five use half-up rounding. The 107% cap uses
    max(half-up(LTHR×1.07), LTHR+ceil(LTHR×0.07)) so the default 176
    matches Garmin Connect's displayed [114, 141, 157, 167, 176, 189]
    (176×1.07 = 188.32, which half-up alone would be 188).
    """
    if lthr is None or float(lthr) <= 0:
        lthr = DEFAULT_LTHR_BPM
    lthr_d = Decimal(str(lthr))
    bounds: list[int] = []
    for pct in ZONE_PCTS:
        bounds.append(_round_half_up(lthr_d * Decimal(str(pct))))
    z5 = int(lthr_d) + int((lthr_d * Decimal("0.07")).to_integral_value(rounding=ROUND_CEILING))
    bounds[5] = max(bounds[5], z5)
    for i in range(1, len(bounds)):
        if bounds[i] < bounds[i - 1]:
            bounds[i] = bounds[i - 1]
    return bounds


def load_lactate_threshold(config_path: Path | None = None) -> int:
    """Read params.workouts.lactateThresholdBpm from hugo.toml. Default 176."""
    import tomllib

    path = config_path or (Path(__file__).resolve().parents[1] / "hugo.toml")
    try:
        with path.open("rb") as fh:
            data = tomllib.load(fh)
    except (OSError, tomllib.TOMLDecodeError):
        return DEFAULT_LTHR_BPM
    workouts = (data.get("params") or {}).get("workouts") or {}
    raw = workouts.get("lactateThresholdBpm", workouts.get("lactate_threshold_bpm"))
    try:
        val = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_LTHR_BPM
    return val if val > 0 else DEFAULT_LTHR_BPM


_lthr_cache: int | None = None


def get_lactate_threshold() -> int:
    global _lthr_cache
    if _lthr_cache is None:
        _lthr_cache = load_lactate_threshold()
    return _lthr_cache


def is_estimated_hr_zone(calc_type: Any) -> bool:
    """True when gen_splits (or similar) marked the table as an estimate."""
    return bool(calc_type and re.search(r"estimated|derived", str(calc_type), re.I))


def is_device_hr_zone(hr: Any) -> bool:
    """Real device time-in-zone: bounds + seconds, not an estimate."""
    if not isinstance(hr, dict):
        return False
    bounds = _clean_bounds(hr.get("high_boundary"))
    seconds = hr.get("seconds")
    if len(bounds) < 5:
        return False
    if not isinstance(seconds, list) or not seconds:
        return False
    return not is_estimated_hr_zone(hr.get("calc_type"))


def _clean_bounds(bounds: Any) -> list[float]:
    if not isinstance(bounds, list):
        return []
    out: list[float] = []
    for b in bounds:
        if b is None:
            continue
        try:
            val = float(b)
        except (TypeError, ValueError):
            continue
        if val > 0:
            out.append(val)
    return out


def _zone_index(bpm: float, bounds: list[int] | list[float]) -> int:
    """Map a heart-rate sample to Z0..Z5 (0..5).

    Inclusive on each zone's high boundary.
    For the 6-bound LTHR / Garmin table, Z0 is everything up to bounds[0]
    (65% LTHR / first high), Z1 is up to bounds[1] (80% LTHR). Above
    bounds[4] (100%) is Z5, including the last bound and overflow.
    A 5-bound table has no separate below-Z1 slot: bounds[0] is Z1 high,
    so values at or below it are Z1 (index 1).
    """
    if len(bounds) >= 6:
        if bpm <= bounds[0]:
            return 0
        if bpm <= bounds[1]:
            return 1
        if bpm <= bounds[2]:
            return 2
        if bpm <= bounds[3]:
            return 3
        if bpm <= bounds[4]:
            return 4
        return 5
    # 5-bound (or shorter): no Z0; first high is Z1.
    if bpm <= bounds[0]:
        return 1
    if len(bounds) > 1 and bpm <= bounds[1]:
        return 2
    if len(bounds) > 2 and bpm <= bounds[2]:
        return 3
    if len(bounds) > 3 and bpm <= bounds[3]:
        return 4
    return 5


def _zone_durations_from_seconds(seconds: Any, n_bounds: int) -> list[float]:
    """Collapse device time-in-zone seconds into Z0–Z5 or Z1–Z5 durations."""
    secs: list[float] = []
    if not isinstance(seconds, list):
        return []
    for x in seconds:
        try:
            secs.append(float(x or 0))
        except (TypeError, ValueError):
            secs.append(0.0)
    if n_bounds >= 6 and len(secs) >= 6:
        # 6 highs, typically 7 slots: <=b0, <=b1, …, <=b5, >b5.
        # Z0=s[0], Z1=s[1], Z2=s[2], Z3=s[3], Z4=s[4], Z5=s[5]+s[6]+…
        # Do not merge s[0]+s[1] into Z1.
        parts = [secs[0], secs[1], secs[2], secs[3], secs[4], sum(secs[5:])]
    elif len(secs) == 5:
        parts = secs  # Z1–Z5, no Z0
    elif n_bounds == 5 and len(secs) == 6:
        parts = [secs[0], secs[1], secs[2], secs[3], sum(secs[4:])]
    else:
        return []
    return parts if sum(parts) > 0 else []


def _bars_from_zone_durations(durations: list[float]) -> list[int]:
    """48 stepped crown wedges, proportional to zone time, no interpolated heights."""
    total = sum(durations)
    if total <= 0:
        return []
    if len(durations) == 6:
        tiers = BAR_TIERS  # Z0–Z5
    elif len(durations) == 5:
        tiers = BAR_TIERS[1:]  # Z1–Z5 (5-bound tables have no Z0 slot)
    else:
        return []
    raw = [N_SAMPLES * d / total for d in durations]
    counts = [int(x) for x in raw]
    remain = N_SAMPLES - sum(counts)
    order = sorted(range(len(durations)), key=lambda i: raw[i] - counts[i], reverse=True)
    for i in range(remain):
        counts[order[i]] += 1
    bars: list[int] = []
    for zi, count in enumerate(counts):
        if count > 0:
            bars.extend([tiers[zi]] * count)
    return bars


def _bars_from_hr(hr: list[float], bounds: list[int] | list[float]) -> list[int]:
    """Fixed Z0–Z5 heights from the device or configured LTHR table."""
    return [BAR_TIERS[_zone_index(float(bpm), bounds)] for bpm in hr]


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
    lthr: int | None = None,
) -> dict | None:
    """Return a compact session dict, or None when nothing useful exists."""
    split = _load_split(splits_dir, run_id) if splits_dir else None
    summary = (split or {}).get("summary") if split else None
    summary = summary if isinstance(summary, dict) else {}
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
        # Prefer km splits, then laps, when chart.hr is missing.
        hr_series = _hr_from_segments((split or {}).get("splits"))
    if not hr_series:
        hr_series = _hr_from_segments((split or {}).get("laps"))

    zone_block = (split or {}).get("zones") if split else None
    zone_hr = zone_block.get("hr") if isinstance(zone_block, dict) else None
    device = zone_hr if is_device_hr_zone(zone_hr) else None
    lthr_bounds = lthr_boundaries(lthr if lthr is not None else get_lactate_threshold())
    device_bounds = _clean_bounds(device.get("high_boundary")) if device else []
    bounds = device_bounds or lthr_bounds
    bars: list[int]
    if hr_series:
        bars = _bars_from_hr(hr_series, bounds)
    elif device:
        bars = _bars_from_zone_durations(
            _zone_durations_from_seconds(device.get("seconds"), len(device_bounds))
        )
        if not bars and hr_avg:
            bars = [BAR_TIERS[_zone_index(float(hr_avg), bounds)]] * N_SAMPLES
    elif hr_avg:
        # Flat bars at the zone height of the session average under the LTHR table.
        bars = [BAR_TIERS[_zone_index(float(hr_avg), lthr_bounds)]] * N_SAMPLES
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
