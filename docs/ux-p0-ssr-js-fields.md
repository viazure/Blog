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

Event: after `fillYear`, dispatch `workouts:year-loaded` (`detail.year`); `track-script` re-observes `.rmap`.

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
