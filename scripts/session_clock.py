"""Compact Session Clock payloads from life-data splits JSON.

Outer ring = HR-zone bars over moving time (one lap = whole session).
Inner polyline = HR samples (when chart.hr exists).
Core = seed (<1h) or growth rings (≥1h).

Bars/hr are downsampled to N points so year shards stay small.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

N_SAMPLES = 28
BAR_MAX = 24
BPM_FLOOR = 70
BPM_CEIL = 190


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


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
    """Map bpm → bar height with a soft floor so the rim undulates (polar bar chart)."""
    bars: list[int] = []
    span = float(BPM_CEIL - BPM_FLOOR) or 1.0
    for bpm in hr:
        # gamma < 1 exaggerates mid/high swings for a more "jagged rim" look
        norm = _clamp((float(bpm) - BPM_FLOOR) / span, 0.0, 1.0)
        h = (norm ** 0.85) * BAR_MAX
        bars.append(int(round(_clamp(h, 3, BAR_MAX))))
    return bars


def _bars_from_zones(seconds: list[float]) -> list[int]:
    """Expand time-in-zone into N sequential wedges; height ≈ zone index."""
    usable = [max(0.0, float(s or 0)) for s in (seconds or [])]
    # Garmin often pads a trailing empty bucket; drop trailing zeros for span
    while usable and usable[-1] == 0:
        usable.pop()
    total = sum(usable)
    if total <= 0 or not usable:
        return [4] * N_SAMPLES
    # zone height: Z1 soft → top zone tall
    zone_h = [
        max(3, int(round(4 + (i / max(len(usable) - 1, 1)) * (BAR_MAX - 4))))
        for i in range(len(usable))
    ]
    bars: list[int] = []
    for i, sec in enumerate(usable):
        count = max(1, int(round(N_SAMPLES * sec / total))) if sec > 0 else 0
        bars.extend([zone_h[i]] * count)
    if not bars:
        return [4] * N_SAMPLES
    if len(bars) < N_SAMPLES:
        bars.extend([bars[-1]] * (N_SAMPLES - len(bars)))
    return bars[:N_SAMPLES]


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
        hr_series = _resample([float(x) for x in raw_hr if x is not None], N_SAMPLES)

    bars: list[int]
    if hr_series:
        bars = _bars_from_hr(hr_series)
    elif isinstance(zones.get("seconds"), list) and any(zones.get("seconds") or []):
        bars = _bars_from_zones(list(zones["seconds"]))
    elif hr_avg:
        # flat-ish ring from average only
        h = int(round(_clamp(((hr_avg - BPM_FLOOR) / (BPM_CEIL - BPM_FLOOR)) * BAR_MAX, 4, BAR_MAX)))
        bars = [h] * N_SAMPLES
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
    # elev: only positive; 0/None omitted so UI can show —
    if elev_gain and float(elev_gain) > 0:
        out["elev"] = int(round(float(elev_gain)))
    return out
