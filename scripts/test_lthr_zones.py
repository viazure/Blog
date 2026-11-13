"""Build-time LTHR zone boundaries and fallback tests. Not a browser test."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from session_clock import (  # noqa: E402
    BAR_TIERS,
    DEFAULT_LTHR_BPM,
    N_SAMPLES,
    _bars_from_zone_durations,
    _zone_durations_from_seconds,
    _zone_index,
    build_session,
    is_device_hr_zone,
    is_estimated_hr_zone,
    load_lactate_threshold,
    lthr_boundaries,
)


class TestBoundaries(unittest.TestCase):
    def test_default_176_matches_garmin_screenshot(self):
        self.assertEqual(DEFAULT_LTHR_BPM, 176)
        self.assertEqual(lthr_boundaries(176), [114, 141, 157, 167, 176, 189])
        self.assertEqual(lthr_boundaries(None), [114, 141, 157, 167, 176, 189])

    def test_another_threshold_170(self):
        # 170×0.65=110.5 → 111 (half-up, not banker's 110)
        # 170×0.80=136; ×0.89=151.3 → 151; ×0.95=161.5 → 162
        # 170×1.07=181.9 → 182, and 170+ceil(11.9)=182
        self.assertEqual(lthr_boundaries(170), [111, 136, 151, 162, 170, 182])

    def test_half_up_not_bankers(self):
        # builtin round(110.5) == 110 on Python 3; we need 111
        self.assertNotEqual(round(170 * 0.65), 111)
        self.assertEqual(lthr_boundaries(170)[0], 111)


class TestZoneIndex(unittest.TestCase):
    def setUp(self):
        self.b = lthr_boundaries(176)

    def test_inclusive_high_edges(self):
        # Z0: …–114, Z1: 115–141, Z2: 142–157, Z3: 158–167, Z4: 168–176, Z5: 177…
        cases = {
            80: 0,
            97: 0,
            113: 0,
            114: 0,
            115: 1,
            141: 1,
            142: 2,
            157: 2,
            158: 3,
            167: 3,
            168: 4,
            176: 4,
            177: 5,
            189: 5,
            190: 5,
            220: 5,
        }
        for bpm, zi in cases.items():
            self.assertEqual(_zone_index(bpm, self.b), zi, f"bpm={bpm}")

    def test_same_z_same_height(self):
        self.assertEqual(BAR_TIERS, [5, 12, 19, 26, 33, 40])
        self.assertEqual(BAR_TIERS[_zone_index(97, self.b)], 5)
        self.assertEqual(BAR_TIERS[_zone_index(120, self.b)], 12)
        self.assertEqual(BAR_TIERS[_zone_index(180, self.b)], 40)

    def test_below_z1_is_z0_on_device_table(self):
        bounds = [117, 146, 162, 172, 181, 195]
        self.assertEqual(_zone_index(93, bounds), 0)
        self.assertEqual(_zone_index(97, bounds), 0)
        self.assertEqual(_zone_index(117, bounds), 0)
        self.assertEqual(_zone_index(118, bounds), 1)
        self.assertEqual(_zone_index(146, bounds), 1)
        self.assertEqual(_zone_index(147, bounds), 2)
        self.assertEqual(BAR_TIERS[_zone_index(97, bounds)], 5)
        self.assertEqual(BAR_TIERS[_zone_index(140, bounds)], 12)
        self.assertEqual(BAR_TIERS[_zone_index(147, bounds)], 19)

    def test_five_bound_table_has_no_z0(self):
        bounds = [110, 130, 150, 170, 190]
        self.assertEqual(_zone_index(80, bounds), 1)
        self.assertEqual(BAR_TIERS[_zone_index(80, bounds)], 12)
        self.assertEqual(_zone_index(110, bounds), 1)
        self.assertEqual(_zone_index(111, bounds), 2)
        self.assertEqual(_zone_index(191, bounds), 5)
        self.assertEqual(BAR_TIERS[_zone_index(191, bounds)], 40)


class TestConfigLoad(unittest.TestCase):
    def test_reads_camel_case_field(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "hugo.toml"
            path.write_text(
                "[params.workouts]\n  lactateThresholdBpm = 170\n",
                encoding="utf-8",
            )
            self.assertEqual(load_lactate_threshold(path), 170)

    def test_reads_snake_case_alias(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "hugo.toml"
            path.write_text(
                "[params.workouts]\n  lactate_threshold_bpm = 165\n",
                encoding="utf-8",
            )
            self.assertEqual(load_lactate_threshold(path), 165)

    def test_missing_or_invalid_defaults_to_176(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "hugo.toml"
            path.write_text('title = "x"\n', encoding="utf-8")
            self.assertEqual(load_lactate_threshold(path), 176)
            path.write_text(
                "[params.workouts]\n  lactateThresholdBpm = 0\n",
                encoding="utf-8",
            )
            self.assertEqual(load_lactate_threshold(path), 176)
            self.assertEqual(load_lactate_threshold(path / "nope.toml"), 176)

    def test_repo_hugo_toml_is_176(self):
        self.assertEqual(load_lactate_threshold(ROOT / "hugo.toml"), 176)


class TestDeviceZoneDetection(unittest.TestCase):
    def test_estimated_flag(self):
        self.assertTrue(is_estimated_hr_zone("percent_max_hr_estimated"))
        self.assertTrue(is_estimated_hr_zone("percent_threshold_pace_estimated"))
        self.assertFalse(is_estimated_hr_zone("percent_lthr"))
        self.assertFalse(is_estimated_hr_zone("percent_max_hr"))
        self.assertFalse(is_estimated_hr_zone(None))

    def test_device_requires_bounds_seconds_and_not_estimated(self):
        base = {
            "seconds": [10, 20, 30, 40, 50, 0, 0],
            "high_boundary": [114, 141, 157, 167, 176, 189],
            "calc_type": "percent_lthr",
        }
        self.assertTrue(is_device_hr_zone(base))
        est = dict(base, calc_type="percent_max_hr_estimated")
        self.assertFalse(is_device_hr_zone(est))
        self.assertFalse(is_device_hr_zone({"seconds": [1], "high_boundary": []}))
        self.assertFalse(is_device_hr_zone(None))


class TestBuildFallback(unittest.TestCase):
    def test_device_bounds_map_curve_not_lthr_or_seconds_blocks(self):
        with tempfile.TemporaryDirectory() as tmp:
            splits = Path(tmp)
            (splits / "1.json").write_text(
                """{
                  "summary": {"hr_max": 150, "calories": 100},
                  "zones": {"hr": {"seconds": [0, 10, 20, 300, 200, 100, 0],
                                   "high_boundary": [90, 110, 130, 150, 170, 190],
                                   "calc_type": "percent_max_hr",
                                   "max_hr": 200}},
                  "chart": {"hr": [120, 120, 120, 120]}
                }""",
                encoding="utf-8",
            )
            out = build_session(
                run_id=1, moving=600, hr_avg=120, elev=0, splits_dir=splits, lthr=176
            )
            self.assertIsNotNone(out)
            # 120 is Z2 under device bounds (≤130, >110), height 19 — not LTHR Z1 (12)
            # and not a mix of the mostly-Z3/Z4 device seconds.
            self.assertEqual(out["bars"], [19] * N_SAMPLES)
            self.assertEqual(out["hr"][0], 120)

    def test_device_seconds_used_when_no_hr_series(self):
        with tempfile.TemporaryDirectory() as tmp:
            splits = Path(tmp)
            seconds = [0, 10, 20, 300, 200, 100, 0]
            bounds = [90, 110, 130, 150, 170, 190]
            (splits / "2.json").write_text(
                """{
                  "summary": {},
                  "zones": {"hr": {"seconds": %s,
                                   "high_boundary": %s,
                                   "calc_type": "percent_lthr"}}
                }"""
                % (seconds, bounds),
                encoding="utf-8",
            )
            out = build_session(run_id=2, moving=600, hr_avg=0, elev=0, splits_dir=splits, lthr=176)
            self.assertIsNotNone(out)
            expected = _bars_from_zone_durations(_zone_durations_from_seconds(seconds, 6))
            self.assertEqual(out["bars"], expected)
            self.assertEqual(len(out["bars"]), N_SAMPLES)
            self.assertNotIn("hr", out)

    def test_device_seconds_win_over_hr_avg_flat(self):
        with tempfile.TemporaryDirectory() as tmp:
            splits = Path(tmp)
            seconds = [266, 621, 13, 0, 0, 0, 0]
            bounds = [113, 137, 154, 162, 169, 190]
            (splits / "2b.json").write_text(
                """{
                  "summary": {"hr_avg": 117, "hr_max": 138},
                  "zones": {"hr": {"seconds": %s,
                                   "high_boundary": %s,
                                   "calc_type": "percent_lthr"}}
                }"""
                % (seconds, bounds),
                encoding="utf-8",
            )
            out = build_session(
                run_id="2b", moving=900, hr_avg=117, elev=0, splits_dir=splits, lthr=176
            )
            expected = _bars_from_zone_durations(_zone_durations_from_seconds(seconds, 6))
            self.assertEqual(out["bars"], expected)
            # Z0=266s, Z1=621s, Z2=13s — not merged into almost-all Z1, and not a flat 48×12.
            self.assertEqual(out["bars"].count(5), 14)
            self.assertEqual(out["bars"].count(12), 33)
            self.assertEqual(out["bars"].count(19), 1)
            self.assertNotIn("hr", out)

    def test_chart_hr_time_series_drives_ordered_bars(self):
        with tempfile.TemporaryDirectory() as tmp:
            splits = Path(tmp)
            # Chronological indoor curve: 20 samples at 120 (Z1), then 20 at 150 (Z2)
            # under the device table. Seconds (mostly Z3/Z4) must not replace this order.
            hr = [120] * 20 + [150] * 20
            (splits / "4.json").write_text(
                """{
                  "summary": {"hr_avg": 135, "hr_max": 150},
                  "zones": {"hr": {"seconds": [0, 0, 0, 500, 400, 0, 0],
                                   "high_boundary": [113, 137, 154, 162, 169, 190],
                                   "calc_type": "percent_lthr"}},
                  "chart": {"hr": %s}
                }"""
                % (hr,),
                encoding="utf-8",
            )
            out = build_session(
                run_id=4, moving=600, hr_avg=135, elev=0, splits_dir=splits, lthr=176
            )
            self.assertEqual(len(out["bars"]), N_SAMPLES)
            self.assertEqual(set(out["bars"]), {12, 19})
            mid = N_SAMPLES // 2
            self.assertEqual(set(out["bars"][: mid // 2]), {12})
            self.assertEqual(set(out["bars"][-(mid // 2) :]), {19})
            self.assertIn("hr", out)

    def test_estimated_zones_are_rebinned_to_lthr(self):
        with tempfile.TemporaryDirectory() as tmp:
            splits = Path(tmp)
            # 120 would be Z2 under these estimated max-HR bounds (≤130, >110),
            # but estimates must use the site LTHR table: 120 is Z1 (≤141).
            (splits / "5.json").write_text(
                """{
                  "summary": {"hr_max": 154},
                  "zones": {"hr": {"seconds": [0, 10, 20, 300, 200, 100, 0],
                                   "high_boundary": [90, 110, 130, 150, 170, 190],
                                   "calc_type": "percent_max_hr_estimated",
                                   "max_hr": 154}},
                  "chart": {"hr": [120, 120, 120, 120]}
                }""",
                encoding="utf-8",
            )
            out = build_session(
                run_id=5, moving=600, hr_avg=120, elev=0, splits_dir=splits, lthr=176
            )
            self.assertEqual(out["bars"], [12] * N_SAMPLES)

    def test_estimated_seconds_without_curve_do_not_paint_bars(self):
        with tempfile.TemporaryDirectory() as tmp:
            splits = Path(tmp)
            (splits / "6.json").write_text(
                """{
                  "summary": {},
                  "zones": {"hr": {"seconds": [0, 10, 20, 300, 200, 100, 0],
                                   "high_boundary": [90, 110, 130, 150, 170, 190],
                                   "calc_type": "percent_max_hr_estimated"}}
                }""",
                encoding="utf-8",
            )
            out = build_session(run_id=6, moving=600, hr_avg=0, elev=0, splits_dir=splits, lthr=176)
            self.assertIsNotNone(out)
            self.assertEqual(out["bars"], [])
            self.assertNotIn("hr", out)

    def test_hr_avg_flat_uses_lthr_when_no_device_zones(self):
        with tempfile.TemporaryDirectory() as tmp:
            splits = Path(tmp)
            (splits / "3.json").write_text(
                """{"summary": {}}""",
                encoding="utf-8",
            )
            # 168 is Z4 under 176-table (≤176 and >167) → 33
            out = build_session(
                run_id=3, moving=600, hr_avg=168, elev=0, splits_dir=splits, lthr=176
            )
            self.assertEqual(out["bars"], [33] * N_SAMPLES)

    def test_seconds_folding_keeps_z0_separate(self):
        seconds = [48, 1866, 45, 0, 0, 0, 0]
        parts = _zone_durations_from_seconds(seconds, 6)
        self.assertEqual(parts, [48.0, 1866.0, 45.0, 0.0, 0.0, 0.0])
        bars = _bars_from_zone_durations(parts)
        self.assertEqual(len(bars), N_SAMPLES)
        self.assertEqual(set(bars), {5, 12, 19})
        # 48/1959*48 ≈ 1.18, 1866/1959*48 ≈ 45.72, 45/1959*48 ≈ 1.10
        self.assertGreater(bars.count(12), bars.count(5))
        self.assertGreater(bars.count(5), 0)
        self.assertGreater(bars.count(19), 0)

    def test_seconds_fold_overflow_into_z5_not_z6(self):
        seconds = [10, 20, 30, 40, 50, 60, 70]
        parts = _zone_durations_from_seconds(seconds, 6)
        self.assertEqual(parts, [10.0, 20.0, 30.0, 40.0, 50.0, 130.0])
        bars = _bars_from_zone_durations(parts)
        self.assertEqual(len(bars), N_SAMPLES)
        self.assertEqual(set(bars), set(BAR_TIERS))
        self.assertNotIn(47, set(BAR_TIERS))  # no extra tier above 40

    def test_lthr_curve_warmup_is_z0(self):
        with tempfile.TemporaryDirectory() as tmp:
            splits = Path(tmp)
            # No device table: 97 is below LTHR bounds[0]=114 → Z0 / height 5.
            # 120 is Z1 / 12. Estimated max-HR must not hide this.
            (splits / "7.json").write_text(
                """{
                  "summary": {"hr_avg": 110, "hr_max": 120},
                  "zones": {"hr": {"seconds": [0, 10, 20, 300, 200, 100, 0],
                                   "high_boundary": [90, 110, 130, 150, 170, 190],
                                   "calc_type": "percent_max_hr_estimated"}},
                  "chart": {"hr": [97, 97, 97, 97, 120, 120, 120, 120]}
                }""",
                encoding="utf-8",
            )
            out = build_session(
                run_id=7, moving=600, hr_avg=110, elev=0, splits_dir=splits, lthr=176
            )
            self.assertEqual(set(out["bars"]), {5, 12})
            self.assertEqual(out["bars"][0], 5)
            self.assertEqual(out["bars"][-1], 12)

    def test_device_curve_warmup_is_z0(self):
        with tempfile.TemporaryDirectory() as tmp:
            splits = Path(tmp)
            # Device percent_lthr table from the 2026-11-12 evening run.
            # 97 is Z0 (<=117), 136 is Z1 (<=146), 147 is Z2.
            hr = [97] * 8 + [136] * 32 + [147] * 8
            (splits / "8.json").write_text(
                """{
                  "summary": {"hr_avg": 136, "hr_max": 148},
                  "zones": {"hr": {"seconds": [48, 1866, 45, 0, 0, 0, 0],
                                   "high_boundary": [117, 146, 162, 172, 181, 195],
                                   "calc_type": "percent_lthr",
                                   "threshold": 176}},
                  "chart": {"hr": %s}
                }"""
                % (hr,),
                encoding="utf-8",
            )
            out = build_session(
                run_id=8, moving=1959, hr_avg=136, elev=0, splits_dir=splits, lthr=176
            )
            self.assertEqual(set(out["bars"]), {5, 12, 19})
            self.assertEqual(out["bars"][0], 5)
            self.assertEqual(out["bars"][N_SAMPLES // 2], 12)
            self.assertEqual(out["bars"][-1], 19)
            self.assertEqual(BAR_TIERS[_zone_index(97, [117, 146, 162, 172, 181, 195])], 5)


if __name__ == "__main__":
    unittest.main()
