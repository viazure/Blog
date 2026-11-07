# Session Clock（博客 /workouts）

Branch: `feat/workouts-session-clock` (P0 lazy-render base). Merge after P0 → main.

## Product

- All activities open a unified **dark** detail shell (blog dialog; not a full Activities wall).
- No GPS: left slot = large Session Clock; 3-line **clickable** legend (outer / inner / core highlight).
- With GPS: left slot = **dark silhouette** trail (trails polyline), start→end draw on open, bright start dot. No clock↔map tabs (GPS = silhouette only; trail missing → fall back to clock).
- Three layers: outer HR-zone bars as an undulating polar rim (one lap = moving time) + inner HR polyline wrapped on a circle + core (seed <1h / growth rings ≥1h) + ~70 bpm guide.
- List mini clock (no-trail cards) shares the same grammar (light-card friendly strokes).
- Missing distance/climb/HR/kcal → `—` (never `0.00`). Chinese metric labels; value above label.
- Sport accent tints clock / trail / pill. Respect `prefers-reduced-motion` (no growth / no trail draw).
- Field `clock` / `clock_unit` = **duration** only. Session Clock payload is `session`.

Visual reference: [activities.geekplux.com](https://activities.geekplux.com/) (site source closed; reimplemented, not scraped). Vert 3D / full wall / Glow slider are out of scope.

## ADR — `data-wk` payload (accepted)

**Decision: list slim / detail hydrate from year shard.**

| Layer | Holds |
|-------|--------|
| Card attribute `data-wk` | Summary only: idx, label, name, date/time, metrics, `has_trail`, `run_id`, and `session: { has_session, moving, hr_avg, hr_max, kcal, elev }` — **no** `bars` / `hr` arrays |
| Year shard `/data/workouts/year-YYYY.json` | Full items including `session.bars` (28) + `session.hr` (28) |
| In-memory `itemsByIdx` | Prefer richer session (bars/hr) when indexing |

**Why:** Embedding `bars`+`hr` on every SSR/lazy card bloated HTML (tens of KB/year). Year JSON is fetched once and shared by Clock detail + mini clocks.

**Runtime:**

1. Lazy `fillYear` calls `__wkIndexItems(fullItems)`.
2. SSR default year: `workouts-lazy` `indexYearData(actyear)` fetches the shard without re-rendering.
3. `openDetail` → `ensureFullSession` (uses index or fetches year by `date` prefix).
4. Mini clocks draw only after a rich session is indexed.

## Data build

`scripts/session_clock.py` reads `life-data/data/workouts/splits/{run_id}.json`:

- `chart.hr` → inner polyline + outer bar heights (gamma-shaped undulation)
- else `zones.hr.seconds` → outer bars from time-in-zone
- else flat bars from `average_heartrate`

`scripts/build_workouts.py` attaches per item:

| Field | Meaning |
|-------|---------|
| `run_id` | Garmin/archive id |
| `hr_max` / `kcal` | from split summary when present |
| `session.moving` | seconds |
| `session.bars` | 28 outer heights (0–24) |
| `session.hr` | 28 bpm samples (optional) |
| `session.hr_avg` / `hr_max` / `kcal` / `elev` | detail metrics |

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

## Out of scope

- running_page product surface
- PR / merge to main (local review first)
- Glassmorphism / large entrance motion
- Vert 3D terrain embed
- Full geekplux Activities wall (Glow, tile size, year chips)
