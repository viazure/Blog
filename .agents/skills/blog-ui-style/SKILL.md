---
name: blog-ui-style
description: 统一 viazure.cc 博客（Hugo + hugo-blog-awesome 主题）的界面风格。规范所有新页面、新组件、新功能的样式实现，覆盖配色、字体、圆角、交互、深色模式、响应式与类命名。当用户要求添加新页面/新组件/新功能、修改样式、或提到"风格统一"时使用。
---

# 博客界面风格规范

本博客基于 Hugo + [hugo-blog-awesome](https://github.com/hugo-sid/hugo-blog-awesome) 主题。主题文件在 `themes/hugo-blog-awesome/`（不动），站点自有样式全部写在 `assets/sass/`。全站入口是 `main.scss`（`_custom.scss` 负责正文字体覆盖，并引入灯箱）。数据页（运动、书影音）另有入口 `page-workouts.scss` / `page-media.scss`，只在对应 layout 加载。

改样式前先读变量文件。**禁止新写未入变量的色值**；半透明罩层等例外见下文「颜色」。

## 工作流程

1. **找参考**：确定要做的组件最接近下文「组件模式」表里的哪一种，读那个参考文件；拿不准就问用户要不要按某个现有页面的风格。
2. **写亮色**：只用既有变量实现亮色版，类名加功能前缀。
3. **写深色**：包进 `@mixin <组件>-on-dark`，两条切换路径各调用一次。
4. **补降级**：动效加 `prefers-reduced-motion`；交互元素补 `:focus-visible`；过一遍 `$on-mobile` 断点。
5. **自检**：跑一遍文末「改动清单」，全部勾上才算完成；然后 `hugo` 构建验证。

## 设计基调

安静、克制、内容优先：大量留白，细分隔线（1px），几乎无阴影，无大色块。强调靠字重、大小和灰度层次，不靠彩色。唯一的彩色是正文链接蓝和运动项目强调色。

## 设计令牌

### 变量放哪

| 文件 | 谁能用 | 放什么 |
|---|---|---|
| `_variables.scss` | `main.scss` 和数据页入口都会先导入 | 全站色、断点；浮层底 `$chrome-bg`、控件墨色 `$chrome-ink`、深色浮层底 `$surface-dark` |
| `_page-vars.scss` | 仅 `page-workouts.scss` / `page-media.scss` | `$rule`、`$rule-dark`、`$dark-text`、`$workout-kinds` |

主站样式（灯箱、搜索、导航、目录）**不能**引用 `$rule` / `$dark-text`，否则构建失败。数据页深色正文用 `$dark-text`，主站深色正文用 `$dark-text-base-color`。

新页面要用 `$rule` 或 `$workout-kinds` 时：入口先 `@import "variables"` 再 `@import "page-vars"`，并在 `layouts/_partials/custom-head.html` 按 layout 挂上。不要塞进 `main.scss`，避免全站加载数据页 CSS。

### 颜色（亮色 → 深色）

| 用途 | 亮色 | 深色 |
|---|---|---|
| 正文 | `$text-base-color` #383c40 | `$dark-text-base-color` #c9cdd3 |
| 标题/强调 | `$black` #0d122b | `$dark-white` #eaeaea |
| 链接（悬停） | `$text-link-blue` #003fff（#0036c7） | `$dark-text-link-blue` #77a8fd（#5292ff） |
| 次要文字/标签 | `$gray` #6b7886 | `$dark-gray` #767f87 |
| 分隔线 | `$rule` #e6e8ea（主题内用 `$light` #ececec） | `$rule-dark` #262932 |
| 数据页正文 | `$text-base-color` | `$dark-text` #babdc4 |
| 内联代码 | `$inline-code-text` / `$inline-code-bg` | `$dark-inline-code-text` / `$dark-inline-code-bg` |
| 悬浮按钮底 | `$go-top-bg` #dfe0e397（半透明+blur） | `$dark-go-top-bg` #676767b3 |
| 灯箱底 / 控件墨色 | `$chrome-bg` #f4f4f5 / `$chrome-ink` #1c1c1e | 深色罩层用半透明黑，控件改 `$white` |
| 深色浮层底（菜单、气泡） | — | `$surface-dark` #1a1d24 |

运动项目强调色只加在 `$workout-kinds`（Tailwind 调色板取色），通过 `--workout-accent` 下发到卡片局部。

允许不新开变量的写法：

- 半透明罩层、阴影、hover 轻染：`rgba($已有变量, α)`，或已写明的 `rgba(0, 0, 0, 0.035)`（深色 `rgba(255, 255, 255, 0.04)`）。`$black` 不是纯黑，罩层要纯黑时写 `rgba(0, 0, 0, α)`，不要用 `rgba($black, α)`。
- 主题遗留的选区黄（`mark` 的 `#ff0`）不要扩散到新组件。

### 字体

- 实际正文字体在 `_custom.scss`，覆盖主题 Roboto：`ui-sans-serif` 系统栈（含 PingFang / 微软雅黑等中文），`font-weight: 450`。`$sans-family: Roboto` 是主题遗留，新样式不要再指定 Roboto。主题只内嵌了 Roboto 400。
- 代码字体同样在 `_custom.scss`：`ui-monospace` 栈，回退 Consolas。
- 基准 16px，行高 1.85。
- 界面字重以 450（正文）和 `$bold-weight`（700）为主；大数字展示可用 300。
- 次要文字用 `$gray` + 小号（0.68–0.82rem），这是本站最主要的视觉层次手段。
- **所有数字（日期、计数、统计）必须加 `font-variant-numeric: tabular-nums`**。

### 圆角

| 元素 | 圆角 |
|---|---|
| 数据卡片 `.run-card` | 12px |
| 下拉菜单 / 气泡提示 | 6px |
| 胶囊 chips / 计数徽标 | 999px |
| FAB 按钮 | 50% 或 10% |

### 动效

- 标准时长 **0.16s ease-out**（浮层可用 0.18–0.2s）；只动 opacity / transform / background-color。
- 所有动效块必须配 `@media (prefers-reduced-motion: reduce)` 降级。
- 可点击元素 hover 用背景轻染 `rgba(0, 0, 0, 0.035)`（深色 `rgba(255, 255, 255, 0.04)`）或灰→正文色变化。

## 组件模式（按这些既有模式扩展，不要发明新的）

| 模式 | 实现 | 参考文件 |
|---|---|---|
| 分区小标题 | `$gray` 0.75rem 大写 + `letter-spacing: 0.09em`，右侧接 1px 弹性横线 | `_workouts.scss` `.sec > h2` |
| 大数字统计 | 3.2–4.2rem / 300 / `-0.03em` / tabular-nums，单位小号灰色 | `.stv-n` |
| 胶囊切换 chips | 隐藏 radio + `:has()` 控制选中态，选中即深色文字+浅底 | `.chips` / `.heat-chips` |
| 折叠块 | `details/summary`，去 marker，箭头用 `▸` / `▴` 文本 | `_data-shared.scss` `.fold` |
| 悬停气泡 | `data-tip` 属性 + `::after`，白底 1px `$rule` 边 6px 圆角 0.68rem | `@mixin tip-bubble` |
| 下拉菜单 | 绝对定位 `top: calc(100% + 4px)`，1px `$rule` 边 + `0 4px 14px rgba(0,0,0,.06)` 阴影 | `.year-dd-list` |
| 浮动按钮 | 半透明底 + `backdrop-filter: blur(6px)`，右下角纵向排列 | `_tableOfContent.scss` `.toc-fab` |
| 无交互覆盖层（灯箱/搜索） | 全屏 fixed、跟随亮暗主题、控件圆形半透明 blur | `_lightbox.scss`、`_search.scss` |
| 音乐时间线 / 周期页签 | 封面栅格 + 隐藏 radio 页签，选中态同 chips | `_music.scss` |

标题链（卡片标题、时间线标题、运动记录标题）：默认 `color: inherit`，悬停或聚焦才变链接蓝。选择器要比主题 `.page-content a` 更具体，否则有链接的标题会变蓝、没链接的不变。短评和正文里的外链仍用链接蓝。参考 `_data-shared.scss`。

无 JS 优先：切换、折叠、页签尽量用隐藏 radio / checkbox + `:has()` 或 `details` 纯 CSS 实现（参考 `page-workouts.scss` 的 `$switcher-slots` 生成模式）。必须 JS 时才写，脚本放 `assets/js/`。

## 深色模式

- 每个新组件写一个 `@mixin xxx-on-dark`，在两处调用：`html.dark { @include …; }` 和 `@media (prefers-color-scheme: dark) { html:not(.light) { @include …; } }`（主题用 class 切换 + 跟随系统两种模式）。
- 深色下映射规则：灰字→`$dark-gray`，数据页正文→`$dark-text`（主站用 `$dark-text-base-color`），边线→`$rule-dark`（主站用 `$dark-light` / `$dark-smoke`），白底浮层→`$surface-dark`，阴影加深。
- 写深色覆盖时用中文注释说明「为什么」（选择器层级、覆盖主题的原因）。

## 响应式

- 断点用 `@include media-query($on-mobile)`（768px）。
- 移动端：网格塌成单列 `1fr`；横向滚动条隐藏（`scrollbar-width: none` + `::-webkit-scrollbar` 清零）；灯箱箭头等控件移到下方。
- 触控目标 ≥ 44px（参考灯箱 44px 圆钮）。

## 可访问性

- 默认可聚焦控件：`outline: 2px solid currentColor; outline-offset: 2px`。
- 导航等需要更高对比时，用链接蓝半透明（如 `rgba($text-link-blue-active, 0.6)`），深色对应 `$dark-text-link-blue`。灯箱罩层本身不画 outline，焦点落在箭头和工具按钮上。
- 自定义控件保留 `role`/`aria-*`；纯 CSS 方案用 `:focus-visible` 镜像 `:hover`。

## 类命名

- 站点自有组件加功能前缀防冲突：`stv-`（运动统计）、`hm-`（热力图）、`lb-`（灯箱）、`data-`/`card-`（书影音）、`run-`（运动卡片）。`.card`、`.cards` 等通用名已被书影音页占用，新页面不得复用。
- 新页面样式文件：`assets/sass/_<页面名>.scss`，在对应入口 scss 里 `@import`；页面专属变量放 `_page-vars.scss`。

## 改动清单（每次改样式后自检）

- [ ] 新颜色进了对应变量文件；半透明只用 `rgba($变量, α)` 或上文允许的轻染 / 纯黑罩层
- [ ] 主站样式没有引用 `$rule`、`$dark-text` 等仅数据页可用的变量
- [ ] 亮、暗两套都写了，且两种切换路径（`html.dark` 与 prefers-color-scheme）都覆盖
- [ ] 数字有 tabular-nums；次要信息用 `$gray` 小字而不是新颜色
- [ ] 圆角、动效时长、hover/focus 样式与上文表格一致
- [ ] 有 `prefers-reduced-motion` 降级；移动端单列布局正常
- [ ] 类名有前缀、不与主题及既有页面冲突
- [ ] `hugo` 构建通过（scss 有静态校验，变量拼错会报错）
