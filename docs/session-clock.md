# Session Clock（博客 /workouts）

Branch: `feat/workouts-session-clock` (P0 lazy-render base). Merge after P0 → main.

## Product

- All activities open a unified detail shell that **follows the blog theme** (light sheet / `html.dark` sheet; not a forced near-black wall, not a full Activities wall).
- No GPS: left slot = large Session Clock; 3-line **clickable** legend (outer / inner / core highlight).
- With GPS: left slot = theme-stage silhouette trail (trails polyline), start→end draw on open, bright start dot. No clock⇄map tabs (GPS = silhouette only; trail missing → fall back to clock).
- Three layers (geekplux-aligned):
  - **Outer** — dense HR-driven outward spikes on a base ring. **Whole session maps to 360°** (always a full crown), clockwise from 12 o'clock. Bar height/brightness ≈ HR zone.
  - **Inner** — HR **area** (fill inward to ~70 bpm guide + stroke) on the same full-session lap as the outer crown.
  - **Core** — open C-shaped seed arc when moving <1h; one growth ring per full hour when ≥1h. **Only** this layer leaves a gap / grows with hours.
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
| Year shard `/data/workouts/year-YYYY.json` | Full items including `session.bars` (~120) + `session.hr` (~120 when chart present) |
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
| 1 | `chart.hr` (aggregated series, up to ~200 pts from gen_splits) | inner `hr` + outer `bars` (resampled / kept dense, target **120**) |
| 2 | `splits[]` / `laps[]` `hr_avg` weighted by `time` | same, when chart.hr missing |
| 3 | `zones.hr.seconds` | outer bars as sequential zone wedges |
| 4 | activity `average_heartrate` | flat bars |

`scripts/build_workouts.py` attaches per item:

| Field | Meaning |
|-------|---------|
| `run_id` | Garmin/archive id |
| `hr_max` / `kcal` | from split summary when present |
| `session.moving` | seconds |
| `session.bars` | ~120 outer heights (0–24); was 28 |
| `session.hr` | ~120 bpm samples when chart/segments available |
| `session.hr_avg` / `hr_max` / `kcal` / `elev` | detail metrics |

Frontend maps `bars` across the **hour sweep** (`min(360°, moving/3600×360)`), not always a closed 360° — so <1h sessions show the 12 o'clock gap on every layer.

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

- **Desktop (`hover: hover` + `pointer: fine`)**: keep floating tips — list `.card-tip` on hover/focus-within; calendar / heatmap / stack-bar `data-tip` bubbles on hover/`focus-visible`. Prefer `role="tooltip"` on card tips.
- **Touch / coarse pointer**: **no** floating tips (no long-press tip, no tap-to-float tip that covers content). List cards drop `.card-tip`; overview `data-tip` bubbles are CSS-gated off. Card tap still opens detail only.
- **Detail**: Session Clock layer copy stays as **always-visible** legend rows (not hidden in a tip). Metrics that need a definition (`用时` / `能耗` / HR / Session Clock) expose a small **ⓘ** → bottom sheet (`#wk-tip-sheet`) with the same short copy. Close via ×, backdrop, or Escape.

## Out of scope

- running_page product surface
- PR / merge to main (local review first)
- Glassmorphism / large entrance motion
- Vert 3D terrain embed
- Full geekplux Activities wall (Glow, tile size, year chips)


Outer crown shares the hour sweep with inner/core; unused hour uses a dashed ghost track + pie clip so <1h never reads as a full outer ring. Gap gets a soft wedge + end ticks; the old fixed-at-12 "70" bpm label is omitted (it sat in the open gap). Outer bar max height is slightly shorter so the crown does not overpower the open arc.
