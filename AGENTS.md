# AGENTS.md

本仓库是 viazure.cc 个人博客（Hugo + hugo-blog-awesome 主题）。

## 界面风格规范（改样式必读）

所有涉及样式的工作——新增页面、新增组件、新增功能、修改外观、风格统一——开始前先完整阅读并遵守：

[.agents/skills/blog-ui-style/SKILL.md](.agents/skills/blog-ui-style/SKILL.md)

其中规定了本站的配色变量、字体层次、圆角/动效取值、深色模式双路径写法、响应式断点、类名前缀约定与自检清单。禁止在样式里硬编码新颜色。

## 其他约定

- 主题文件在 `themes/hugo-blog-awesome/`（git submodule），不要直接修改；站点自有样式写在 `assets/sass/`，模板覆盖写在 `layouts/`。
- 站内沟通与代码注释使用中文。
