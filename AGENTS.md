# AGENTS.md

本仓库是 viazure.cc 个人博客（Hugo + hugo-blog-awesome 主题）。

## 界面风格规范（改样式必读）

所有涉及样式的工作——新增页面、新增组件、新增功能、修改外观、风格统一——开始前先完整阅读并遵守：

[.agents/skills/blog-ui-style/SKILL.md](.agents/skills/blog-ui-style/SKILL.md)

其中规定了本站的配色变量、字体层次、圆角/动效取值、深色模式双路径写法、响应式断点、类名前缀约定与自检清单。禁止在样式里硬编码新颜色。

## UX P0 lazy-load contract

See:

- [docs/ux-p0-lazy-shards.md](docs/ux-p0-lazy-shards.md) — shard URLs, default year/Tab, `workouts:year-loaded`, cache, Session Clock boundary
- [docs/ux-p0-ssr-js-fields.md](docs/ux-p0-ssr-js-fields.md) — SSR/JS field map and `note_html` safety

Read those before changing card fields or shard ids. Session Clock does not land on the P0 branch; do not reuse `clock`/`clock_unit` for session state.

## 其他约定

- 主题文件在 `themes/hugo-blog-awesome/`（git submodule），不要直接修改；站点自有样式写在 `assets/sass/`，模板覆盖写在 `layouts/`。
- 站内沟通与代码注释使用中文。

## 页面数据（life-data）

运动 / 书影音页用的 JSON 是构建产物，不进 Git。本地预览前需要 `viazure/life-data`（默认在同级目录 `../life-data`，也可设环境变量 `LIFE_DATA_DIR`），然后在仓库根目录运行：

```
python scripts/build_lastfm.py
python scripts/build_neodb.py
python scripts/build_workouts.py
```

会写出 `data/*.json`、`static/trails.json` 和 `static/data/` 分片，再执行 `hugo server`。源数据缺失或解析不到活动时，脚本以非零状态退出。
