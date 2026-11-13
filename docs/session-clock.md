# Session Clock（博客 /workouts）

Branch: `feat/workouts-session-clock` (P0 lazy-render base). Merge after P0 → main.

## Product

- All activities open a unified detail shell that **follows the blog theme** (light sheet / `html.dark` sheet; not a forced near-black wall, not a full Activities wall).
- No GPS: left slot = large Session Clock; icon-only legend keys under the SVG, with a reserved two-line slot that shows layer copy only on hover or pin.
- With GPS: left slot = theme-stage silhouette trail (detail polyline from trails-detail.json; list thumbs stay on the coarse 40×40 trails.json), start→end draw on open, bright start dot. No clock⇄map tabs (GPS = silhouette only; trail missing → fall back to clock).
- Three layers (geekplux-aligned):
  - **Outer** — stepped HR/zone crown on a base ring (**48** wedges, fixed ~0.8° seams). **Whole session maps to 360°** (always a full crown), clockwise from 12 o'clock. Heights are fixed by heart-rate zone Z1–Z5 (detail `12/19/26/33/40`); they are not stretched to a session's own min/max.
  - **Inner** — HR **area** (fill inward toward the ~70 bpm floor + stroke) on the same full-session lap as the outer crown.
  - **Core** — full-circle seed disk when moving <1h; one growth ring per completed hour when ≥1h (geekplux `pc`).
- Soft glow / spikes must not be cropped by the viz stage. List mini clock (no-trail cards) shares the same outward-spike grammar (light-card friendly strokes).
- Whole graphic (outer + inner + core) **draws in sync** (~0.9s); not outer-only stagger with inner popping in.
- Missing distance/climb/HR/kcal → `—` (never `0.00`). Chinese metric labels; value above label.
- Sport accent tints clock / trail / pill. Respect `prefers-reduced-motion` (no growth / no trail draw).
- Field `clock` / `clock_unit` = **duration** only. Session Clock payload is `session`.

Visual reference: [activities.geekplux.com](https://activities.geekplux.com/) (site source closed; reimplemented, not scraped). Vert 3D / full wall / Glow slider are out of scope.

## ADR — `data-wk` payload (accepted)

**Decision: list slim / detail hydrate from year shard.**

| Layer | Holds |
|-------|--------|
| Card attribute `data-wk` | Summary only: idx, label, name, date/time, metrics, `has_trail`, `run_id`, and `session: { has_session, moving, hr_avg, hr_max, kcal, elev }` — **no** `bars` / `hr` arrays |
| Year shard `/data/workouts/year-YYYY.json` | Full items including `session.bars` (**48**) + `session.hr` (**48** when chart present) |
| In-memory `itemsByIdx` | Prefer richer session (bars/hr) when indexing |

**Why:** Embedding `bars`+`hr` on every SSR/lazy card bloated HTML (tens of KB/year). Year JSON is fetched once and shared by Clock detail + mini clocks.

**Runtime:**

1. Lazy `fillYear` calls `__wkIndexItems(fullItems)`.
2. SSR default year: `workouts-lazy` `indexYearData(actyear)` fetches the shard without re-rendering.
3. `openDetail` → `ensureFullSession` (uses index or fetches year by `date` prefix).
4. Mini clocks draw only after a rich session is indexed.

## Data build

`scripts/session_clock.py` reads **`life-data/data/workouts/splits/{run_id}.json`**
(produced by life-archive `vendor/run_page/gen_splits.py` → private `life-data` checkout):

| Priority | Source field | → |
|----------|--------------|---|
| 1 | `chart.hr` (aggregated series, up to ~200 pts from gen_splits) | inner `hr` + outer `bars` (resampled to **48**; each sample maps to Z1–Z5 via the **configured lactate threshold**, not the activity's `high_boundary` / `max_hr`. Indoor FIT sessions with no advancing distance get a time-bucketed `chart.hr` from `gen_splits`. Below the lowest bound and Z1 both use height 12; above the top bound uses Z5 / 40) |
| 2 | `splits[]` / `laps[]` `hr_avg` weighted by `time` | same, when chart.hr missing (these are actual BPM values) |
| 3 | activity `average_heartrate` | flat bars at the zone height of that average under the configured LTHR table |
| — | `zones.hr.seconds` | **not used.** Those buckets were accumulated under a different zone table and must not be treated as time-in-zone for the configured LTHR. If no HR series and no average exist, `bars` are omitted rather than invented. |

Lactate threshold is set once in `hugo.toml`:

```toml
[params.workouts]
  lactateThresholdBpm = 176
```

Default `176` produces boundaries `[114, 141, 157, 167, 176, 189]` (65/80/89/95/100/107%). The first five bounds use half-up rounding; the 107% cap is `max(half-up(LTHR×1.07), LTHR+ceil(LTHR×0.07))` because `176×1.07 = 188.32` would otherwise become 188, not Garmin's displayed 189. Change `lactateThresholdBpm` in `hugo.toml`, rerun `python scripts/build_workouts.py`, and deploy; the next build is when it takes effect. The front end does not read this setting — it only draws the stored `session.bars` heights (`12/19/26/33/40`). Inclusive on each zone's high edge (141 is Z1, 142 is Z2).

`scripts/build_workouts.py` attaches per item:

| Field | Meaning |
|-------|---------|
| `run_id` | Garmin/archive id |
| `hr_max` / `kcal` | from split summary when present |
| `session.moving` | seconds |
| `session.bars` | **48** outer heights — five tiers `12/19/26/33/40` |
| `session.hr` | **48** bpm samples when chart/segments available |
| `session.hr_avg` / `hr_max` / `kcal` / `elev` | detail metrics |

Frontend maps outer `bars` and inner `hr` across a **full 360 deg** session lap. Core alone is a full seed (<1h) or hour growth rings (>=1h).

## Front-end

- `layouts/_partials/session-clock-script.html` — `<dialog>` shell + SVG drawers
- Cards: `role="button"` + `data-idx` + slim `data-wk`
- After lazy fill / default-year index: `__wkIndexItems(items)` then `workouts:year-loaded`

## Sync rule

Changing **session shape** requires updating **all four**:

1. emit / `build_workouts.py` (+ `session_clock.py`)
2. SSR `workout-card.html` (slim summary fields)
3. `workouts-lazy` `renderCard` / `slimSession`
4. detail shell `session-clock-script.html` (`drawSessionClock` / `fillMeta` / `ensureFullSession`)

Also update [ux-p0-ssr-js-fields.md](./ux-p0-ssr-js-fields.md).



## Tips / 说明分流（accepted）

- **Desktop (`hover: hover` + `pointer: fine`)**: keep floating tips — list `.card-tip` on hover/focus-visible; calendar / heatmap / stack-bar `data-tip` bubbles on hover/`focus-visible`. Prefer `role="tooltip"` on card tips.
- **Touch / coarse pointer**: **no** floating tips (no long-press tip, no tap-to-float tip that covers content). List cards drop `.card-tip`; overview `data-tip` bubbles are CSS-gated off. Card tap still opens detail only.
- **Detail**: Session Clock legend lives under the clock (icon keys only). Layer sentences appear in the reserved two-line slot on hover or pin; there is no info mark and the slot does not expand to show all three sentences. Outer copy injects the metric duration (`elapsedLabel`, e.g. 0:40); core covers both the <1h solid seed disk and +1 ring per completed hour. The detail sheet is capped to the viewport: no native scrollbar on the rounded card; the clock stage shrinks to fit, and the right column's metrics and 心率趋势 scroll together with a thin thumb; the title and prev/next pager stay fixed. `能耗` exposes a small **ⓘ** that opens an in-page `.wk-info-tip` (hover on fine pointers, click to toggle `.is-open`) with the copy 「估算消耗，非实测。」. `用时` / 平均心率 / 最大心率 have no tip. There is no second `#wk-tip-sheet` dialog. Escape / blank click dismisses an open metric tip first, then the legend slot, then closes detail.
- **HR scrub (v1)**: detail meta under metrics — collapsed 「心率趋势」 when `session.hr` exists; expand for area + scrub (elapsed/bpm). No map/clock linkage.
- **Regression guard**: `node scripts/check_session_clock_tip_guard.js` — static + `node:vm` mock ensures click/hover tips keep working via `.wk-info-tip` / `.is-open` with no `#wk-tip-sheet` dependency. Not a real browser/phone test.

## Out of scope

- running_page product surface
- PR / merge to main (local review first)
- Glassmorphism / large entrance motion
- Vert 3D terrain embed
- Full geekplux Activities wall (Glow, tile size, year chips)

Detail geometry (UI/UX lock): `baseR=120`, `barMinH=12`, `barMaxH=40`, `N=48`, `gapDeg=0.8`, `hrFloorR=48`, `hrSpan=60`; mini ~0.9x (`baseR=110`, `11/36`, mid `44/54`). Core seed r~6.5.
