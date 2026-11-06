# Session Clock（博客 /workouts）

Branch: `feat/workouts-session-clock`. Does **not** live on `feat/ux-p0-lazy-render`.

## Product

- All activities open a unified detail shell.
- No GPS: left slot = large Session Clock; 3-line legend required.
- With GPS: left slot = map by default; toggle 「轨迹 / 心率钟」; Clock secondary.
- Three layers: outer HR-zone bars (one lap = moving time) + inner HR polyline + core (seed &lt;1h / growth rings ≥1h).
- List mini clock (no-trail cards) shares the same grammar.
- Missing distance/climb/HR/kcal → `—` (never `0.00`).
- Warm paper + purple accents; respect `prefers-reduced-motion` (no growth animation).
- Field `clock` / `clock_unit` = **duration** only. Session Clock payload is `session`.

## Data

`scripts/session_clock.py` reads `life-data/data/workouts/splits/{run_id}.json`:

- `chart.hr` → inner polyline + outer bar heights
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

Year shards (`static/data/workouts/year-YYYY.json`) carry the same fields. Lazy `renderCard` and SSR `workout-card` both emit `data-wk` JSON for the detail shell.

## Front-end

- `layouts/_partials/session-clock-script.html` — `<dialog>` shell + SVG drawers
- Cards: `role="button"` + `data-idx` + `data-wk`
- After lazy fill: `__wkIndexItems(items)` then `workouts:year-loaded` (track IO unchanged)

## Out of scope

- running_page product surface
- PR / merge to main (local review first)
- Glassmorphism / large entrance motion
