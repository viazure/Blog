# 懒加载分片约定

首屏 HTML = 外壳 + **默认年份 / 默认 Tab** 正文；其余由前端 `fetch` `static/data` 分片加载。

## 分片 URL

| 页面 | 路径 | 产出方 |
|------|------|--------|
| 运动索引 | `/data/workouts/index.json` | `emit_workouts` |
| 运动年份 | `/data/workouts/year-{YYYY}.json` | heatmap + group.items（含完整 `session`） |
| Last.fm meta | `/data/media/lastfm/meta.json` | recent + periods |
| Last.fm 周期 | `/data/media/lastfm/period-{id}.json` | `7day` `1month` `3month` `6month` `12month` `overall` |
| NeoDB meta | `/data/media/neodb/meta.json` | categories |
| NeoDB 分类 | `/data/media/neodb/cat-{id}.json` | `book` `movie` `tv` `game` `podcast`（**不含** `performance`） |

音乐 Tab id 为 `music`（仅 UI）；数据在 lastfm 分片中。

## 默认值

- 运动：热力图年份与活动列表年份相互独立。
- 书影音：默认 Tab = music（有 lastfm 时）否则第一个 NeoDB 分类；默认周期 = periods[0]。
- SCSS `$media-tabs` / `$music-periods` 须与上述 id 一致。

## 事件

- `workouts:year-loaded`：年份卡片写入后，或 SSR 默认年份从分片建完索引后触发；`track-script` 重新 IO 观察轨迹 SVG；Session Clock 会 hydrate 列表 mini 时钟。

## 缓存

- 页内 JS 内存 `cache`，无 TTL（静态站可接受）。
- CDN/浏览器：`static/_headers` → `/data/*` 短缓存（`max-age=300` + SWR）。文件名无 hash；重建后依赖短 TTL。


## Session Clock

- 卡片字段 `clock` / `clock_unit` 表示运动时长（duration），勿当会话状态。
- 完整 `session.bars` / `session.hr` 在年份分片里；列表 `data-wk` 是精简摘要（见 [session-clock.md](./session-clock.md)）。
- 改 session 结构须同步：emit + SSR `workout-card` + `renderCard` + 详情壳（见字段对照）。

## 双端渲染

改 markup/字段时须同步：

1. `layouts/_partials/workout-card.html` ↔ `workouts-lazy` `renderCard`
2. `layouts/page/media.html` ↔ `media-lazy` `render*`
3. `docs/ssr-js-fields.md`
