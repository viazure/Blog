# Session Clock（博客 /workouts）

Branch: `feat/workouts-session-clock` (P0 lazy-render base). Merge after P0 → main.

## Product

- All activities open a unified detail shell that **follows the blog theme** (light sheet / `html.dark` or system dark via `prefers-color-scheme`; not a forced near-black wall, not a full Activities wall).
- No GPS: left slot = large Session Clock; icon-only legend keys under the SVG, with a reserved two-line slot that shows layer copy only on hover or pin.
- With GPS: left slot = theme-stage silhouette trail (detail polyline from trails-detail.json; list thumbs stay on the coarse 40×40 trails.json), start→end draw on open, bright start dot. No clock⇄map tabs (GPS = silhouette only; trail missing → fall back to clock).
- Three layers (geekplux-aligned):
  - **Outer** — stepped HR/zone crown on a base ring (**48** wedges, fixed ~0.8° seams). **Whole session maps to 360°** (always a full crown), clockwise from 12 o'clock. Heights are fixed by heart-rate zone Z0–Z5 (detail `5/12/19/26/33/40`); they are not stretched to a session's own min/max. Height changes only when a sample crosses a zone — the outer ring is not a second HR curve. Z0 (below Z1) is a clearly shorter, more transparent tooth in the same activity color.
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
| Card attribute `data-wk` | Summary only: idx, label, name, date/time, metrics, `has_trail`, `run_id`, `has_splits`, and `session: { has_session, moving, hr_avg, hr_max, kcal, elev }` — **no** `bars` / `hr` arrays |
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
(produced by life-archive `vendor/run_page/gen_splits.py` → private `life-data` checkout).

Zone baseline (aligned with running_page `resolveHrZones`; never use this activity's peak HR as the 100% anchor):

1. Prefer a real device time-in-zone table (`high_boundary` + `seconds`, `calc_type` not `estimated`/`derived`, for example `percent_lthr` / `percent_max_hr`). `percent_max_hr_estimated` is not a device table. The HR series is mapped to those bounds; if there is no series, outer `bars` come from the device seconds (Z0=`seconds[0]`, Z1=`seconds[1]`, Z2–Z4=`seconds[2:5]`, Z5=`seconds[5]` plus any overflow; do not merge `seconds[0]+seconds[1]` into Z1). Source: `device`.
2. Else, if a lactate threshold can be resolved — `LTHR_BPM` (environment or gitignored `.env`), then an optional site `lthr` if one were ever present, then this activity's FIT `threshold_hr` — rebin the HR series onto the site LTHR table (65/80/89/95/100/107%). Source: `lthr`. There is no max-HR environment variable; Z5 is half-up(`LTHR×1.07`), so an example threshold of `176` yields `[114, 141, 157, 167, 176, 188]`.
3. Else use the public `birthday_month` in `hugo.toml` (`YYYY-MM`). Age is calculated on the activity date in UTC+8 (the missing day is treated as the 1st of that month, not today): `220−age`, then `maxhr_percents` `[50, 60, 70, 80, 90, 100]`. Source: `maxhr_age`, marked `estimated`.
4. Else do not paint zone teeth and do not invent an all-zero crown (`source: none`, `empty_reason: no_baseline`). If a baseline exists but there is no HR series and no real device table, also leave `bars` empty (`empty_reason: no_hr_data`). A lone session average is not turned into a flat crown.

Series used to paint teeth (still resampled to **48**; this sampling is unchanged):

| Priority | Source field | → |
|----------|--------------|---|
| 1 | `chart.hr` (aggregated series, up to ~200 pts from gen_splits) | inner `hr` + outer `bars`. Indoor FIT sessions with no advancing distance get a time-bucketed `chart.hr` from `gen_splits`. On a 6-bound table, at or below `bounds[0]` is Z0 / height 5; Z1 is up to `bounds[1]` / height 12; above `bounds[4]` (including the last bound and overflow) uses Z5 / 40 — there is no Z6 tooth |
| 2 | `splits[]` / `laps[]` `hr_avg` weighted by `time` | same, when chart.hr is missing (these are actual BPM values) |
| — | `zones.hr` (device, no series) | outer `bars` from device seconds, as above |

Lactate threshold is optional and is not stored in the repo.

- Locally: set `LTHR_BPM` in a gitignored `.env` at the repo root (see `.env.example`), or export the same variable in the shell. Leaving it unset is valid.
- Production: the GitHub Actions variable `LTHR_BPM` may be set (Actions → Variables, not Secrets). `deploy.yml` still injects it into the "Build data pages" step; an empty value is treated as unset.
- Public identity `birthday_month` lives in `hugo.toml` under `[params.workouts]` (currently `1995-02`). Do not invent a birthday environment variable.

After changing `LTHR_BPM` or `birthday_month`, rerun `python scripts/build_workouts.py` and deploy; the next build is when it takes effect. The front end does not read these settings — it draws the stored `session.bars` heights (`5/12/19/26/33/40`) and shows `session.source` / `session.estimated` / `session.empty_reason` in the legend. Inclusive on each zone's high edge: 114 is Z0, 115–141 is Z1, 142 is Z2. The same 6-tier cut applies to a device 6-bound table and to the age table. A 5-bound device table has no separate Z0 slot (`bounds[0]` is Z1 high).

`scripts/build_workouts.py` attaches per item:

| Field | Meaning |
|-------|---------|
| `run_id` | Garmin/archive id |
| `has_splits` | `true` only for 跑步 when `life-data/data/workouts/splits/{run_id}.json` exists at build time. Other sports, missing life-data, or a missing file are treated as no splits (the flag is omitted). Re-run `python scripts/build_workouts.py` after splits are available; emit then copies the flag into year shards. |
| `hr_max` / `kcal` | from split summary when present |
| `session.moving` | seconds |
| `session.bars` | **48** outer heights — six tiers `5/12/19/26/33/40` (Z0–Z5); empty when there is no baseline or no HR to draw |
| `session.hr` | **48** bpm samples when chart/segments available |
| `session.source` | `device` / `lthr` / `maxhr_age` / `none` |
| `session.estimated` | `true` only for the age estimate |
| `session.empty_reason` | `no_baseline` or `no_hr_data` when `bars` is empty |
| `session.hr_avg` / `hr_max` / `kcal` / `elev` | detail metrics |

Frontend maps outer `bars` and inner `hr` across a **full 360 deg** session lap. Core alone is a full seed (<1h) or hour growth rings (>=1h).

## Front-end

- `layouts/_partials/session-clock-script.html` — `<dialog>` shell + a small config object via `data-*` (trail URLs, year shard base, Running Page root)
- `assets/js/session-clock.js` — SVG drawers, detail logic, and the「分段分析」link
- Cards: `role="button"` + `data-idx` + slim `data-wk`
- After lazy fill / default-year index: `__wkIndexItems(items)` then `workouts:year-loaded`

### Running Page 分段分析

Detail (not the list card) may show a split-analysis control: on desktop, a 16px bar-chart icon in the 跑步 kind color (from `$workout-kinds`, slightly transparent at rest) immediately after the date (not right-aligned); on mobile, a text link under the date. It appears only when the activity is 跑步, has a `run_id`, **and** has build-time `has_splits`. Styles must override `.page-content a` link blue and the theme `target="_blank"` arrow. The href is `{runningPage}/#run_{id}/analysis` (e.g. `https://run.viazure.cc/#run_1794478711000/analysis`), opened in a new tab (`target="_blank"` `rel="noopener noreferrer"`). The root address is `params.workouts.runningPage` in `hugo.toml` (default `https://run.viazure.cc`). The front end does not fetch `https://run.viazure.cc/splits/index.json`. Until `build_workouts.py` is run against a life-data checkout that contains the split files, generated `data/workouts.json` will not carry `has_splits` and the button stays hidden.

## Sync rule

Changing **session shape** requires updating **all four**:

1. emit / `build_workouts.py` (+ `session_clock.py`)
2. SSR `workout-card.html` (slim summary fields)
3. `workouts-lazy` `renderCard` / `slimSession`
4. detail shell `session-clock-script.html` + `assets/js/session-clock.js` (`drawSessionClock` / `fillMeta` / `ensureFullSession` / `syncSplitLink`)

Also update [ux-p0-ssr-js-fields.md](./ux-p0-ssr-js-fields.md).



## Tips / 说明分流（accepted）

- **Desktop (`hover: hover` + `pointer: fine`)**: keep floating tips — list `.card-tip` on hover/focus-visible; calendar / heatmap / stack-bar `data-tip` bubbles on hover/`focus-visible`. Prefer `role="tooltip"` on card tips.
- **Touch / coarse pointer**: **no** floating tips (no long-press tip, no tap-to-float tip that covers content). List cards drop `.card-tip`; overview `data-tip` bubbles are CSS-gated off. Card tap still opens detail only.
- **Detail**: Session Clock legend lives under the clock (icon keys only). Layer sentences appear in the reserved two-line slot on hover or pin; there is no info mark and the slot does not expand to show all three sentences. Outer copy states that one lap is the whole session, starting from the top and unfolding clockwise; each outer-ring slice is a stretch of time whose height and brightness change as the heart-rate zone rises. When the slot is idle, it shows the heart-rate zone title and source (or the empty-state sentences) without replacing that settled outer sentence. The slot still reserves two lines of minimum height and has no max height. Core covers both the <1h solid seed disk and +1 ring per completed hour. The detail sheet is capped to the viewport: no native scrollbar on the rounded card; the clock stage shrinks to fit, and the right column's metrics and 心率趋势 scroll together with a thin thumb; the title and prev/next pager stay fixed. `能耗` exposes a small **ⓘ** that opens an in-page `.wk-info-tip` (hover on fine pointers, click to toggle `.is-open`) with the copy 「估算消耗，非实测。」. `用时` / 平均心率 / 最大心率 have no tip. There is no second `#wk-tip-sheet` dialog. Escape / blank click dismisses an open metric tip first, then the legend slot, then closes detail.
- **HR scrub (v1)**: detail meta under metrics — collapsed 「心率趋势」 when `session.hr` exists; expand for area + scrub (elapsed/bpm). No map/clock linkage.
- **Regression guard**: `node scripts/check_session_clock_tip_guard.js` — static + `node:vm` mock ensures click/hover tips keep working via `.wk-info-tip` / `.is-open` with no `#wk-tip-sheet` dependency. Not a real browser/phone test.

## Out of scope

- running_page product surface
- PR / merge to main (local review first)
- Glassmorphism / large entrance motion
- Vert 3D terrain embed
- Full geekplux Activities wall (Glow, tile size, year chips)

Detail geometry (UI/UX lock): `baseR=120`, Z0 height `5`, `barMinH=12` (Z1 baseline; Z1–Z5 opacity is still computed from 12–40), `barMaxH=40`, tiers `5/12/19/26/33/40`, `N=48`, `gapDeg=0.8`, `hrFloorR=48`, `hrSpan=60`; mini ~0.9x (`baseR=110`, Z0 `5`, Z1–Z5 `11/36`, mid `44/54`). Z0 teeth use the same activity color at lower opacity (~0.16 vs Z1 0.32). Core seed r~6.5.
