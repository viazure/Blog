# UX P0 · SSR / JS field map

Default year/Tab = Hugo SSR; other slices from `static/data` + client templates.
**Changing a field/markup requires sync**: emit (if new) -> SSR template -> JS `render*`.

## Workouts · `workout-card.html` <-> `workouts-lazy.html` `renderCard`

| Field | SSR | JS | Notes |
|------|-----|----|-------|
| `name` | `kind-{{ $c.name }}` | `kind-` + esc(c.name) | kind class |
| `label` | `.name` | esc(c.label) | display name |
| `date` / `time` | `<time datetime>` | same | time optional |
| `km` | metric km | toFixed(2) | distance |
| `clock` / `clock_unit` | duration metric | same | **duration**, not Session Clock |
| `pace` | mm:ss /km | paceLabel | seconds |
| `hr` / `elev` | tip only | tip only | HR / elev |
| `has_trail` / `idx` / `icon` | svg.rmap or .ico | same | trail via track-script IO |
| `run_id` / `hr_max` / `kcal` | `data-wk` JSON | same in renderCard | Session Clock ids / metrics |
| `session` (slim) | `data-wk`: `has_session`, `moving`, `hr_avg`, `hr_max`, `kcal`, `elev` — **no bars/hr** | `slimSession()` | List summary only |
| `session` (full) | not in attribute; year shard → `__wkIndexItems` | same | `bars` (28) + `hr` (28) for Clock |
| `moving` | in `data-wk` | same | seconds for elapsed / core |

Event: after `fillYear` **or** SSR `indexYearData`, dispatch `workouts:year-loaded` (`detail.year`); `track-script` re-observes `.rmap`; Clock hydrates mini clocks.

### Session shape sync

Changing `session` fields/markup requires **emit + SSR `workout-card` + `renderCard`/`slimSession` + detail shell** (`session-clock-script`). See [session-clock.md](./session-clock.md).

## Media · `media.html` <-> `media-lazy.html`

| Surface | SSR | JS |
|---------|-----|-----|
| NeoDB card | `media-card` | `mediaCard` |
| wishlist | `media-want` | `mediaWant` |
| grade | `media-grade` | `mediaGrade` |
| date | `media-date` | `mediaDate` |
| music row | board `<li>` | `musicRow` |
| recent | timeline | `timelineCover` + shell |
| cover onerror | `cover-broken` + 1x1 gif | `coverImg` / `timelineCover` same |

### `note_html` safety

- Build: `scripts/paths.py` `note_html()` escapes all, reinserts whitelist
  `<a href="https?://..." rel="nofollow noopener" target="_blank">...</a>`.
- SSR: `{{ . | safeHTML }}` (trusts build output).
- Client: **must not** raw-insert `item.note_html`; use `safeNoteHtml(...)`.

## Shard contract

See [ux-p0-lazy-shards.md](./ux-p0-lazy-shards.md).
