"""Compact Session Clock payloads from life-data splits JSON.

Outer ring = five-tier HR/zone crown for the whole session (always a full 360° lap).
Inner polyline/area = same HR samples when chart.hr exists (also full lap).
Core = full-circle seed (<1h) or growth rings (≥1h), matching geekplux pc(min).

Source priority (life-data/data/workouts/splits/{run_id}.json):
  1. chart.hr  — aggregated series from gen_splits (up to ~200 pts),
     including time-bucketed indoor FIT curves when distance is 0
  2. laps / km splits hr_avg sequence (actual BPM, remapped to the configured LTHR)
  3. flat from average_heartrate at that BPM's new-zone height
  zones.hr.seconds is not used: those buckets belong to a different zone
  table and must not be treated as time-in-zone under the configured LTHR.

Bars/hr are resampled to N_SAMPLES (48) so the crown reads as a coarse
stepped rim (geekplux-aligned), not a fine sawtooth.
"""

from __future__ import annotations

from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

# Coarse stepped crown (geekplux-like 48 wedges). Heights are fixed by
# Z1-Z5, never stretched to a session's own min/max or 70-190 linear scale.
N_SAMPLES = 48
BAR_TIERS = [12, 19, 26, 33, 40]  # Z1 .. Z5
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


def _zone_index(bpm: float, bounds: list[int] | list[float]) -> int:
    """Map a heart-rate sample to Z1..Z5 (0..4).

    Inclusive on each zone's high boundary: 141 is Z1, 142 is Z2.
    Below the lowest bound (114 at default) is Z1; above the top (189) is Z5.
    """
    if bpm <= bounds[1]:
        return 0
    if bpm <= bounds[2]:
        return 1
    if bpm <= bounds[3]:
        return 2
    if bpm <= bounds[4]:
        return 3
    return 4


def _bars_from_hr(hr: list[float], bounds: list[int] | list[float]) -> list[int]:
    """Fixed Z1-Z5 heights from the configured LTHR table."""
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

    bounds = lthr_boundaries(lthr if lthr is not None else get_lactate_threshold())
    bars: list[int]
    if hr_series:
        bars = _bars_from_hr(hr_series, bounds)
    elif hr_avg:
        # Flat bars at the zone height of the session average when no HR series exists.
        bars = [BAR_TIERS[_zone_index(float(hr_avg), bounds)]] * N_SAMPLES
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
