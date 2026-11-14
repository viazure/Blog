"""Compact Session Clock payloads from life-data splits JSON.

Outer ring = six-tier HR/zone crown (Z0–Z5) for the whole session (always a full 360° lap).
Inner polyline/area = same HR samples when chart.hr exists (also full lap).
Core = full-circle seed (<1h) or growth rings (≥1h), matching geekplux pc(min).

Zone baseline priority (aligned with running_page resolveHrZones):
  1. Real device time-in-zone (bounds + seconds, calc_type not estimated/derived).
     percent_max_hr_estimated is not a device table.
  2. Else a lactate threshold (LTHR_BPM env / gitignored .env, then an optional
     site config lthr, then this activity's FIT threshold_hr) with method
     percent_lthr: rebin the HR series onto the site LTHR table.
  3. Else 220−age from the public birthday_month vs the activity date
     (source maxhr_age, marked estimated). Never use this activity's peak HR
     as the 100% anchor, and never introduce a max-HR environment variable.
  4. Else no baseline: do not paint zone teeth or an all-zero placeholder.
     If a baseline exists but there is no HR series and no real device table:
     do not paint teeth. The front end leaves the idle legend slot empty
     and does not explain the missing series.

Series used to paint teeth when a baseline exists:
  1. chart.hr — aggregated series from gen_splits (up to ~200 pts),
     including time-bucketed indoor FIT curves when distance is 0
  2. laps / km splits hr_avg sequence (actual BPM)
  3. device zones.hr.seconds when no HR series exists (device path only)

Bars/hr are resampled to N_SAMPLES (48) so the crown reads as a coarse
stepped rim (geekplux-aligned), not a fine sawtooth.
"""

from __future__ import annotations

import os
import re
import tomllib
from collections.abc import Mapping
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

# Coarse stepped crown (geekplux-like 48 wedges). Heights are fixed by
# Z0-Z5, never stretched to a session's own min/max or 70-190 linear scale.
N_SAMPLES = 48
BAR_TIERS = [5, 12, 19, 26, 33, 40]  # Z0 .. Z5
BAR_MAX = BAR_TIERS[-1]
# LTHR high bounds from <Z1 upward, same percents as running_page.
# Z5 is half-up(LTHR×107%); there is no max-HR env cap on this site.
LTHR_PERCENTS = (65, 80, 89, 95, 100, 107)
# Age-estimate high bounds (% of 220−age), same as running_page maxhr_percents.
MAXHR_PERCENTS = (50, 60, 70, 80, 90, 100)
REPO_ROOT = Path(__file__).resolve().parents[1]
LTHR_ENV_KEY = "LTHR_BPM"
_UNSET = object()


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


def _parse_positive_bpm(raw: object) -> int | None:
    """Strict integer BPM for environment / .env values."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        val = int(text)
    except (TypeError, ValueError):
        return None
    return val if val > 0 else None


def _positive_hr(raw: object) -> int | None:
    """Accept int or whole-number BPM from FIT / optional site config."""
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw if raw > 0 else None
    if isinstance(raw, float):
        if raw <= 0 or raw != raw:  # NaN
            return None
        rounded = _round_half_up(raw)
        return rounded if rounded > 0 else None
    return _parse_positive_bpm(raw)


def _parse_dotenv(path: Path) -> dict[str, str]:
    """Parse a simple KEY=VALUE .env (blanks and # comments ignored)."""
    out: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return out
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key:
            out[key] = value
    return out


def bounds_from_percents(anchor: float | int, pcts: list[int] | tuple[int, ...]) -> list[int]:
    """High bounds from percent-of-anchor, half-up, kept non-decreasing."""
    try:
        anchor_f = float(anchor)
    except (TypeError, ValueError) as exc:
        raise ValueError("anchor must be a positive number") from exc
    if anchor_f <= 0:
        raise ValueError("anchor must be a positive number")
    anchor_d = Decimal(str(anchor))
    bounds = [_round_half_up(anchor_d * Decimal(int(p)) / Decimal(100)) for p in pcts]
    for i in range(1, len(bounds)):
        if bounds[i] < bounds[i - 1]:
            bounds[i] = bounds[i - 1]
    return bounds


def lthr_boundaries(lthr: float | int, max_hr_cap: int | None = None) -> list[int]:
    """Six BPM boundaries from LTHR × LTHR_PERCENTS.

    Rounding matches running_page lthrHighBounds: half-up of LTHR×percent
    for every bound. A max_hr_cap, when given and the last percent is above
    100, only replaces the Z5 high bound. This site has no max-HR environment
    variable, so production calls leave the cap unset.
    """
    bounds = bounds_from_percents(lthr, LTHR_PERCENTS)
    if max_hr_cap is not None and max_hr_cap > 0 and LTHR_PERCENTS and LTHR_PERCENTS[-1] > 100:
        bounds[-1] = _round_half_up(max_hr_cap)
        for i in range(1, len(bounds)):
            if bounds[i] < bounds[i - 1]:
                bounds[i] = bounds[i - 1]
    return bounds


def load_lactate_threshold(
    *,
    environ: Mapping[str, str] | None = None,
    env_file: Path | None = None,
) -> int | None:
    """Read LTHR_BPM from the environment, then a repo-root .env.

    Optional: missing, empty, non-integer, or non-positive values are unset
    and return None. There is no fallback to a hardcoded personal threshold,
    and the value is never read from hugo.toml. See docs/session-clock.md.
    """
    env = os.environ if environ is None else environ
    val = _parse_positive_bpm(env.get(LTHR_ENV_KEY))
    if val is not None:
        return val

    path = REPO_ROOT / ".env" if env_file is None else env_file
    if path.is_file():
        val = _parse_positive_bpm(_parse_dotenv(path).get(LTHR_ENV_KEY))
        if val is not None:
            return val
    return None


def parse_birthday_month(raw: str | None) -> tuple[int, int] | None:
    """Public identity YYYY-MM; missing day is treated as the 1st."""
    match = re.match(r"^(\d{4})-(\d{2})$", (raw or "").strip())
    if not match:
        return None
    year = int(match.group(1))
    month = int(match.group(2))
    if month < 1 or month > 12:
        return None
    return year, month


def parse_activity_date(raw: str | None) -> tuple[int, int, int] | None:
    """Calendar date YYYY-MM-DD, optionally followed by a time."""
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", (raw or "").strip())
    if not match:
        return None
    year = int(match.group(1))
    month = int(match.group(2))
    day = int(match.group(3))
    if month < 1 or month > 12 or day < 1 or day > 31:
        return None
    return year, month, day


def age_on_activity_date(
    birthday_month: str | None,
    activity_date: str | None,
) -> int | None:
    """Age in whole years on the activity date, not today.

    birthday_month uses day 1 of that month (same rule as running_page).
    """
    born = parse_birthday_month(birthday_month)
    on = parse_activity_date(activity_date)
    if not born or not on:
        return None
    age = on[0] - born[0]
    # born day is 1; `on[2] < 1` is kept to match running_page verbatim.
    if on[1] < born[1] or (on[1] == born[1] and on[2] < 1):
        age -= 1
    if age <= 0 or age >= 220:
        return None
    return age


def estimated_max_hr_from_age(age: int) -> int:
    """220−age. No defaultMaxHeartRate / FIT profile age hook."""
    return 220 - age


def estimated_max_hr_from_birthday(
    birthday_month: str | None,
    activity_date: str | None,
) -> int | None:
    age = age_on_activity_date(birthday_month, activity_date)
    if age is None:
        return None
    max_hr = estimated_max_hr_from_age(age)
    return max_hr if max_hr > 0 else None


def maxhr_age_boundaries(max_hr: float | int) -> list[int]:
    return bounds_from_percents(max_hr, MAXHR_PERCENTS)


def load_workouts_site_config(hugo_toml: Path | None = None) -> dict[str, Any]:
    """Public workouts settings from hugo.toml [params.workouts].

    birthday_month is public identity. An optional lthr would be accepted if
    present, but personal thresholds belong in LTHR_BPM / .env, not the repo.
    """
    path = REPO_ROOT / "hugo.toml" if hugo_toml is None else hugo_toml
    out: dict[str, Any] = {"birthday_month": None, "lthr": None}
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return out
    workouts = (data.get("params") or {}).get("workouts") or {}
    born = parse_birthday_month(str(workouts.get("birthday_month") or "") or None)
    if born:
        out["birthday_month"] = f"{born[0]:04d}-{born[1]:02d}"
    out["lthr"] = _positive_hr(workouts.get("lthr"))
    return out


def load_birthday_month(hugo_toml: Path | None = None) -> str | None:
    return load_workouts_site_config(hugo_toml).get("birthday_month")


_lthr_cache: Any = _UNSET
_site_config_cache: dict[str, Any] | None = None


def reset_lactate_threshold_cache() -> None:
    """Clear cached threshold / site config so tests can reload them."""
    global _lthr_cache, _site_config_cache
    _lthr_cache = _UNSET
    _site_config_cache = None


def get_lactate_threshold() -> int | None:
    global _lthr_cache
    if _lthr_cache is _UNSET:
        _lthr_cache = load_lactate_threshold()
    return _lthr_cache


def get_workouts_site_config() -> dict[str, Any]:
    global _site_config_cache
    if _site_config_cache is None:
        _site_config_cache = load_workouts_site_config()
    return _site_config_cache


def resolve_lactate_threshold(
    *,
    explicit: int | None = None,
    config_lthr: int | None = None,
    fit_threshold_hr: int | None = None,
) -> int | None:
    """LTHR_BPM (env / .env) → optional site config lthr → FIT threshold_hr."""
    if explicit is not None and explicit > 0:
        return int(explicit)
    env_lthr = get_lactate_threshold()
    if env_lthr is not None and env_lthr > 0:
        return int(env_lthr)
    if config_lthr is not None and config_lthr > 0:
        return int(config_lthr)
    if fit_threshold_hr is not None and fit_threshold_hr > 0:
        return int(fit_threshold_hr)
    return None


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


def _fit_threshold_hr(zone_hr: Any) -> int | None:
    if not isinstance(zone_hr, dict):
        return None
    return _positive_hr(zone_hr.get("threshold_hr"))


def _zone_index(bpm: float, bounds: list[int] | list[float]) -> int:
    """Map a heart-rate sample to Z0..Z5 (0..5).

    Inclusive on each zone's high boundary.
    For the 6-bound LTHR / Garmin / age table, Z0 is everything up to bounds[0]
    (first high), Z1 is up to bounds[1]. Above bounds[4] is Z5, including the
    last bound and overflow. A 5-bound table has no separate below-Z1 slot:
    bounds[0] is Z1 high, so values at or below it are Z1 (index 1).
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
    """Fixed Z0–Z5 heights from the resolved zone table."""
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


def _session_out(
    *,
    moving: int,
    bars: list[int],
    hr_series: list[float],
    hr_avg: float,
    hr_max: Any,
    kcal: Any,
    elev_gain: Any,
    source: str,
    estimated: bool,
    empty_reason: str | None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "moving": int(moving or 0),
        "bars": bars,
        "source": source,
        "estimated": bool(estimated),
    }
    if empty_reason:
        out["empty_reason"] = empty_reason
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


def build_session(
    *,
    run_id: Any,
    moving: int,
    hr_avg: float,
    elev: float,
    splits_dir: Path | None,
    lthr: int | None = None,
    birthday_month: str | None = None,
    activity_date: str | None = None,
    config_lthr: int | None = None,
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
    resolved_lthr = resolve_lactate_threshold(
        explicit=lthr,
        config_lthr=config_lthr,
        fit_threshold_hr=_fit_threshold_hr(zone_hr),
    )
    device_bounds = _clean_bounds(device.get("high_boundary")) if device else []

    bars: list[int] = []
    source = "none"
    estimated = False
    empty_reason: str | None = None

    if device:
        if hr_series:
            bars = _bars_from_hr(hr_series, device_bounds)
        else:
            bars = _bars_from_zone_durations(
                _zone_durations_from_seconds(device.get("seconds"), len(device_bounds))
            )
        if bars:
            source = "device"
        else:
            empty_reason = "no_hr_data"
    elif resolved_lthr:
        if hr_series:
            bars = _bars_from_hr(hr_series, lthr_boundaries(resolved_lthr))
            source = "lthr"
        else:
            empty_reason = "no_hr_data"
    else:
        age_max = estimated_max_hr_from_birthday(birthday_month, activity_date)
        if age_max:
            if hr_series:
                bars = _bars_from_hr(hr_series, maxhr_age_boundaries(age_max))
                source = "maxhr_age"
                estimated = True
            else:
                empty_reason = "no_hr_data"
        else:
            empty_reason = "no_baseline"

    if not bars and not hr_series and not hr_avg and not moving:
        return None

    return _session_out(
        moving=moving,
        bars=bars,
        hr_series=hr_series,
        hr_avg=hr_avg,
        hr_max=hr_max,
        kcal=kcal,
        elev_gain=elev_gain,
        source=source,
        estimated=estimated,
        empty_reason=empty_reason,
    )
