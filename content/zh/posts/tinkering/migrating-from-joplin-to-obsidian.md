---
title: 从 Joplin 到 Obsidian：我的笔记工具迁移之旅
slug: migrating-from-joplin-to-obsidian
author:
  - viazure
date: 2024-10-27T19:38:13+08:00
lastmod: 2025-03-12T08:54:21+08:00
categories:
  - tinkering
tags:
  - joplin
  - obsidian
share: true
---

## 失掉的安全感

我一直在使用 Joplin 存储我的笔记和剪裁的文章。得益于一个 Joplin 爱好者开发的 VS Code 插件 [joplin-vscode-plugin](https://marketplace.visualstudio.com/items?itemName=rxliuli.joplin-vscode-plugin)，我能够在 VS Code 中编写我钟爱的 Markdown 格式的笔记内容。借助 VS Code 里好用的插件，我能通过 AI 联想我的输入文本内容，通过绘图插件绘制流程图等内容。Joplin 我只用作笔记的统一管理、同步、其他客户端的查看。这些需求 Joplin 都能很好的满足，这也是我一直使用它的原因。

Obsidian 出来后我也一直在纠结是否需要迁移，因为我目前其实用不上 Obsidian 的亮点功能——双链笔记，Joplin 完全够我使用了，我一直告诉自己，不用为了使用工具而使用工具，不要折腾，把时间用在其他有用的地方。

我忍住了自己的折腾之心，我也一直用着我的 VS Code + Joplin 组合。我爱他们，我习惯着他们。直到前两个月发现的一件事情让我又重拾迁移之心。

我有一个习惯，我会定时的将本地存储的东西进行备份，我永远保持着「鸡蛋不能放在同一个篮子里」的想法。我希望我的东西 99.99% 不会丢失，所以每个月我都会将 Joplin 中的笔记导出，再备份到 OneDrive 里。

有一天，我打开笔记备份目录，想看看历史笔记的东西，结果发现所有笔记都没了，只剩下资源文件夹 `_resources` 静静的躺在那儿，我有点崩溃，此时我以为是我备份的问题。但由于其他琐事繁忙，我暂时将此事搁置。

到了下一个月的备份日，我再次将 Joplin 笔记导出，这次我发现导出的内容仍然只有 `_resources` 文件夹。我试着去寻找问题的原因，最终在 Joplin 社区发现了有同样问题的帖子。原因是目录名称里含有 emoji，同时作者也回复确认了此 BUG，并建立了对应的 [issue](https://github.com/laurent22/joplin/issues/11110)。这个 issue 搁置了两个月一直没有动静，直到今天有用户回复新版本已经没有了这个问题。

我更新到新版本后，发现问题确实得到了解决。但是我不由的思考，开源软件虽然有其独特的优势，但在某些情况下，一些小问题也可能对用户体验产生较大的影响，让我觉得不再那么有安全感。

## 分享欲的出口

上半年网上冲浪时，在一个技术大佬的博客里发现了一个行程地图 —— [exping](https://exping.world/) 。我一向特别中意这种 UI 漂亮的产品，试用了下很快就决定将其作为我的行程记录工具。我很喜欢这款产品，我将上半年出差和旅行时觉得不错的地点都记录在了上面，我为每个打卡点精心挑选了照片，写下体验感受，我希望它能成为我的旅行日记，也同时希望能被 exping 社区的一小撮人看到（快来看我精心写下的游记呀）。

可是，这件事情在前两天突然发生了变故，exping 突然发布了 [停止运营的公告](https://exping.world/zh/goodbye)。我在和朋友感慨「小而美的产品不好做啊」的同时，也在思考旅途数据的下一个归宿。

除了他们，其实我还有一些想要输出的想法或分享的东西想被非熟人看到，我希望有一个虽然少有人关顾，但我又乐意打理的地方。我又拾起了写博客的想法，它确实适合做我输出内容的野花园。

我是个拥有完美主义的**懒**人，这就导致了我的好多想法和产出都难产或者夭折。我曾经使用 Hexo 搭建过博客，也曾在博客园写过几篇技术文章。但是长时间却只有几篇不算高质量的内容产出，这使我没有太多动力做这事情，我归档了我的 Hexo 博客，博客园里也只留下几篇阅读量还行的文章。

我毕竟还是有分享的欲望，虽然大多是比较私人的事情，但我希望有一个地方能够保留这些内容，即使被陌生人看到对我的生活也没太多影响，或许不经意能对上脑波呢。

我第一时间想到了前文提到的开发 Joplin VS Code 扩展的那个大佬，他还开发了一款用于发布博客的 Joplin 插件 —— [Joplin Publisher](https://joplin-utils.rxliuli.com/zh-CN/joplin-publisher/)，它可以帮我发布 Joplin 笔记到 GitHub，并通过 GitHub Actions 来自动化构建部署成博客文章。但是今天，我发现导出的文章有些丢失了我辛苦编辑的，完全符合 Markdown Lint 的笔记内容，例如它在一些有序列表中增加了多余的空格，加上无法掌控的可能失修的 Bug，我放弃了这个想法。

Obsidian 拥有强大且丰富的插件资源，尤其是当我发现有博客发布相关的插件后，便决定从 Joplin 迁移到 Obsidian。Obsidian 的文件库管理方式非常灵活，让我可以直接使用从 Joplin 导出的 Markdown 文档，从而大大减少了迁移的工作量。接下来，我只需要：

- [x] 解决笔记的同步： [Remotely Save](https://github.com/remotely-save/remotely-save) + Cloudflare R2
- [x] 找到我在 VS Code 中已使用习惯的插件或者更好用的插件：[我使用的 Obsidian 插件](https://viazure.cc/posts/tinkering/obsidian-plugins-i-use/)
- [x] 搭建博客并发布我想要分享的内容。
- [x] 将我的旅行日记重建为文章/相册，并发布。

## 后记

2024-12-21：今天在小众软件上看到一篇文章《[Obsidian：一场来自意大利的"求爱"风波 - 小众软件](https://www.appinn.com/obsidian-and-bending-spoons/)》，只希望「被收购」这种事情尽量不要发生吧。
