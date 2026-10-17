<!-- markdownlint-disable first-line-h1 -->
Hi 👋

这是我的个人博客项目，基于 Hugo 静态网站生成器构建，托管于 Cloudflare Pages 平台。

主题使用 [Hugo Blog Awesome](https://github.com/hugo-sid/hugo-blog-awesome)，以 Git submodule 放在 `themes/hugo-blog-awesome`。站点自己的功能写在本仓库的 `layouts/`、`assets/` 和 `i18n/` 里，覆盖同名的主题文件。

这些功能包括：

- RSS 只收录主分区文章，附带站点图标和 [Follow](https://follow.is/) 订阅认证
- 接入 [Twikoo](https://twikoo.js.org/) 评论和 [GoatCounter](https://www.goatcounter.com/) 统计
- 导航栏提供基于 Fuse.js 的站内搜索，文章页右侧有滚动后才展开的紧凑目录
- 首页标题只显示站点名，文章页标题会附带站点名
- 社交图标栏加入了跑步页入口
- 正文图片支持灯箱查看

文章使用 Obsidian 编写，通过 Enveloppe 插件进行发布。

博客的多项功能实现方案参考了博主 [Pseudoyu](https://www.pseudoyu.com/) 的文章《[2024 年了，我的博客有了什么变化](https://www.pseudoyu.com/zh/2024/06/29/what_changed_in_my_blog_2024)》中提到的相关教程。

**博客地址**：[viazure.cc](https://viazure.cc)
