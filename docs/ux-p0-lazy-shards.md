# UX P0 · Lazy shard contract (ADR)

Status: accepted on `feat/ux-p0-lazy-render`; carried forward on `feat/workouts-session-clock`.

## Merge order

1. **P0** (`feat/ux-p0-lazy-render`) → `main` (local review first; no PR until川川 says so)
2. **Session Clock** (`feat/workouts-session-clock`, based on P0 tip) → `main` after P0
3. Do not land Clock onto the P0-only branch; keep Clock as a follow-on branch

## Goal

First HTML paint = chrome + **default year / default Tab** body; rest `fetch` from `static/data`.

## Shard URLs

| Surface | Path | Producer |
|---------|------|----------|
| workouts index | `/data/workouts/index.json` | `emit_workouts` |
| workouts year | `/data/workouts/year-{YYYY}.json` | heatmap + group.items (+ full `session`) |
| Last.fm meta | `/data/media/lastfm/meta.json` | recent + periods |
| Last.fm period | `/data/media/lastfm/period-{id}.json` | `7day` `1month` `3month` `6month` `12month` `overall` |
| NeoDB meta | `/data/media/neodb/meta.json` | categories |
| NeoDB cat | `/data/media/neodb/cat-{id}.json` | `book` `movie` `tv` `game` `podcast` (**no** `performance`) |

Music tab id is `music` (UI only); data lives in lastfm shards.

## Defaults

- Workouts: heatmap year radios and activity year radios are **independent**.
- Media: default Tab = music (if lastfm) else first NeoDB category; default period = periods[0].
- SCSS `$media-tabs` / `$music-periods` must match these ids.

## Events

- `workouts:year-loaded`: fired after year cards are written **or** after SSR default year is indexed from its shard; `track-script` re-IO-observes trail SVGs; Session Clock hydrates mini clocks.

## Cache

- In-page JS memory `cache`, no TTL (OK for static site).
- CDN/browser: `static/_headers` -> `/data/*` short cache (`max-age=300` + SWR). Filenames have no hash; rely on short TTL after rebuild.

## Session Clock

- Card fields `clock` / `clock_unit` mean **duration**; do not reuse for session state.
- Full `session.bars` / `session.hr` live in year shards; list `data-wk` is slim (see [session-clock.md](./session-clock.md)).
- Changing session shape must sync: emit + SSR `workout-card` + `renderCard` + detail shell (see field map).

## Dual render

When changing markup/fields, sync:

1. `layouts/_partials/workout-card.html` <-> `workouts-lazy` `renderCard`
2. `layouts/page/media.html` <-> `media-lazy` `render*`
3. `docs/ux-p0-ssr-js-fields.md`
