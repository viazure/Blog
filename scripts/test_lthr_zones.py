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
    _zone_index,
    build_session,
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
        # Z1: …–141, Z2: 142–157, Z3: 158–167, Z4: 168–176, Z5: 177…
        cases = {
            80: 0,
            113: 0,
            114: 0,
            141: 0,
            142: 1,
            157: 1,
            158: 2,
            167: 2,
            168: 3,
            176: 3,
            177: 4,
            189: 4,
            190: 4,
            220: 4,
        }
        for bpm, zi in cases.items():
            self.assertEqual(_zone_index(bpm, self.b), zi, f"bpm={bpm}")

    def test_same_z_same_height(self):
        self.assertEqual(BAR_TIERS, [12, 19, 26, 33, 40])
        self.assertEqual(BAR_TIERS[_zone_index(120, self.b)], 12)
        self.assertEqual(BAR_TIERS[_zone_index(180, self.b)], 40)


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


class TestBuildFallback(unittest.TestCase):
    def test_prefers_hr_curve_over_old_seconds(self):
        with tempfile.TemporaryDirectory() as tmp:
            splits = Path(tmp)
            (splits / "1.json").write_text(
                """{
                  "summary": {"hr_max": 150, "calories": 100},
                  "zones": {"hr": {"seconds": [0, 10, 20, 300, 200, 100, 0],
                                   "high_boundary": [90, 110, 130, 150, 170, 190],
                                   "max_hr": 200}},
                  "chart": {"hr": [120, 120, 120, 120]}
                }""",
                encoding="utf-8",
            )
            out = build_session(
                run_id=1, moving=600, hr_avg=120, elev=0, splits_dir=splits, lthr=176
            )
            self.assertIsNotNone(out)
            # 120 is Z1 under 176-table (≤141), height 12 — not a mix of old Z3/Z4 seconds
            self.assertEqual(out["bars"], [12] * N_SAMPLES)
            self.assertEqual(out["hr"][0], 120)

    def test_seconds_only_does_not_fabricate_new_zones(self):
        with tempfile.TemporaryDirectory() as tmp:
            splits = Path(tmp)
            (splits / "2.json").write_text(
                """{
                  "summary": {},
                  "zones": {"hr": {"seconds": [0, 10, 20, 300, 200, 100, 0],
                                   "high_boundary": [90, 110, 130, 150, 170, 190]}}
                }""",
                encoding="utf-8",
            )
            out = build_session(run_id=2, moving=600, hr_avg=0, elev=0, splits_dir=splits, lthr=176)
            self.assertIsNotNone(out)
            self.assertEqual(out["bars"], [])
            self.assertNotIn("hr", out)

    def test_seconds_plus_avg_uses_flat_new_table_not_old_seconds(self):
        with tempfile.TemporaryDirectory() as tmp:
            splits = Path(tmp)
            # Device seconds look mixed, but boundaries are not the 176 table.
            # 117 bpm is Z1 under 176 (≤141) → flat 12, not a seconds block layout.
            (splits / "2b.json").write_text(
                """{
                  "summary": {"hr_avg": 117, "hr_max": 138},
                  "zones": {"hr": {"seconds": [266, 621, 13, 0, 0, 0, 0],
                                   "high_boundary": [113, 137, 154, 162, 169, 190]}}
                }""",
                encoding="utf-8",
            )
            out = build_session(
                run_id="2b", moving=900, hr_avg=117, elev=0, splits_dir=splits, lthr=176
            )
            self.assertEqual(out["bars"], [12] * N_SAMPLES)
            self.assertNotIn("hr", out)

    def test_chart_hr_time_series_drives_ordered_bars(self):
        with tempfile.TemporaryDirectory() as tmp:
            splits = Path(tmp)
            # Chronological indoor curve: 20 samples at 120 (Z1), then 20 at 150 (Z2).
            # Old seconds (mostly Z3/Z4) must not replace this order.
            hr = [120] * 20 + [150] * 20
            (splits / "4.json").write_text(
                """{
                  "summary": {"hr_avg": 135, "hr_max": 150},
                  "zones": {"hr": {"seconds": [0, 0, 0, 500, 400, 0, 0],
                                   "high_boundary": [113, 137, 154, 162, 169, 190]}},
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
            # Time order: first half Z1, second half Z2 — not a seconds-block start
            mid = N_SAMPLES // 2
            self.assertEqual(set(out["bars"][: mid // 2]), {12})
            self.assertEqual(set(out["bars"][-(mid // 2) :]), {19})
            self.assertIn("hr", out)

    def test_hr_avg_flat_uses_new_table(self):
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


if __name__ == "__main__":
    unittest.main()
