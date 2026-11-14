# SSR / JS 字段对照

默认年份/Tab 由 Hugo SSR 输出；其余切片来自 `static/data` + 前端模板。
**改字段或 markup 须同步**：emit（若新增）→ SSR 模板 → JS `render*`。

## 运动 · `workout-card.html` ↔ `workouts-lazy.html` `renderCard`

| 字段 | SSR | JS | 说明 |
|------|-----|----|------|
| `name` | `kind-{{ $c.name }}` | `kind-` + esc(c.name) | kind class |
| `label` | `.name` | esc(c.label) | 展示名 |
| `date` / `time` | `<time datetime>` | 同左 | time 可选 |
| `km` | metric km | toFixed(2) | 距离 |
| `clock` / `clock_unit` | duration metric | 同左 | 运动时长（duration），勿当会话状态 |
| `pace` | mm:ss /km | paceLabel | 秒 |
| `hr` / `elev` | tip only | tip only | 心率 / 海拔 |
| `has_trail` / `idx` / `icon` | svg.rmap 或 .ico | 同左 | 轨迹由 track-script IO |
| `run_id` / `hr_max` / `kcal` | `data-wk` JSON | renderCard 同左 | Session Clock 的 id / 指标 |
| `has_splits` | `data-wk`（仅 true 时写入） | renderCard 写入 `!!c.has_splits` | 仅跑步，且构建期确认 `splits/{run_id}.json` 存在；详情「分段分析」用 |
| `session`（精简） | `data-wk`：`has_session`、`moving`、`hr_avg`、`hr_max`、`kcal`、`elev`，**不含 bars/hr** | `slimSession()` | 仅列表摘要 |
| `session`（完整） | 不在 attribute 里；年份分片 → `__wkIndexItems` | 同左 | Clock 用的 `bars`（48）+ `hr`（48），以及 `source` / `estimated` / `empty_reason` |
| `moving` | 写入 `data-wk` | 同左 | 秒，用于 elapsed / core |

事件：`fillYear` 或 SSR `indexYearData` 后派发 `workouts:year-loaded`（`detail.year`）；`track-script` 重新 observe `.rmap`；Clock 会 hydrate mini 时钟。

### Session 结构同步

改 `session` 字段或 markup 须同步：**emit + SSR `workout-card` + `renderCard`/`slimSession` + 详情壳**（`session-clock-script.html` + `assets/js/session-clock.js`）。见 [session-clock.md](./session-clock.md)。

## 书影音 · `media.html` ↔ `media-lazy.html`

| 表面 | SSR | JS |
|------|-----|-----|
| NeoDB 卡片 | `media-card` | `mediaCard` |
| 想看/想读 | `media-want` | `mediaWant` |
| 评分 | `media-grade` | `mediaGrade` |
| 日期 | `media-date` | `mediaDate` |
| 音乐行 | board `<li>` | `musicRow` |
| 最近听 | timeline | `timelineCover` + shell |
| 封面 onerror | `cover-broken` + 1x1 gif | `coverImg` / `timelineCover` 同左 |

### `note_html` 安全

- 构建：`scripts/paths.py` `note_html()` 先全量转义，再回填白名单
  `<a href="https?://..." rel="nofollow noopener" target="_blank">...</a>`。
- SSR：`{{ . | safeHTML }}`（信任构建产出）。
- 前端：**禁止**直接插入 `item.note_html`；须用 `safeNoteHtml(...)`。

## 分片约定

见 [lazy-shards.md](./lazy-shards.md)。
