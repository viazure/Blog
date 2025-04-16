---
title: 使用 docsify 在离线环境中部署文档服务
slug: deploying-docsify-in-offline-environment
author:
  - viazure
  - Kimi
date: 2024-12-29T09:05:52+08:00
lastmod: 2025-04-16T09:00:33+08:00
categories:
  - development
tags:
  - docsify
  - markdown
  - example
share: true
---

> 本文初稿由 [Kimi](https://kimi.moonshot.cn/) 协助润色完成。
>
> **2025-04-15 更新**：为方便快速上手，我已将本文中的示例代码和配置文件上传至 [GitHub](https://github.com/viazure/docsify-in-offline-example)/[Gitee](https://gitee.com/viazure/docsify-in-offline-example)。可以直接克隆或下载此项目作为模板，根据自身需求进行修改和使用。该示例项目包含了所有离线部署所需的基础文件和配置，能够在没有网络连接的环境中使用 IIS 或 Nginx 等工具迅速搭建起文档服务。如有任何问题或建议，欢迎通过评论和 GitHub Issues 与我交流。

由于公司的开发服务器经历了一次被迫系统重装，导致之前使用 [docsify](https://docsify.js.org/#/) 部署的文档服务未能保留。今天着手重新部署该服务，鉴于当前服务器无法接入互联网，我计划实施一个适用于离线环境的部署方案。以下是我为此次部署过程所做的记录。

## 步骤 1：在有网络的环境中准备

1. 访问 [Node.js 官网](https://nodejs.org/) ，下载安装程序。
2. 运行安装程序，按照安装程序中的说明进行操作，同时安装 Node.js 和 `npm`。
3. 安装 `docsify-cli` 与 `docsify-tools`（若无「自动生成侧边栏」需求，可不安装 `docsify-tools` ）。

   - 打开命令行工具，运行以下命令来安装 `docsify-cli` 与 `docsify-tools`：

   ```bash
   npm install -g docsify-cli
   npm install -g docsify-tools
   ```

4. 创建一个新的目录 `docsify-setup`，用于存放 `docsify-cli` 与 `docsify-tools` 及其依赖。

   ```bash
   mkdir docsify-setup
   cd docsify-setup
   ```

5. 运行以下命令，在新目录中初始化一个新的 `package.json` 文件。

   ```bash
   npm init -y
   ```

6. 运行以下命令，将 `docsify-cli` 及其依赖保存到当前目录。

   ```bash
   npm install docsify-cli --save
   npm install docsify-tools --save
   ```

7. 下载并保存项目所需的资源文件。

   - 下载 `index.html` 文件所需的 [vue.css](https://cdn.jsdelivr.net/npm/docsify/themes/vue.css) 与 [docsify.min.js](https://cdn.jsdelivr.net/npm/docsify/lib/docsify.min.js) 文件。也可提前使用 `docsify init` 命令生成初始的 `index.html` 文件，用于获取最新引用的 `css` 与 `js` 地址。
   - 按相同方式提前下载好需要使用的插件资源文件。

## 步骤 2：将目录传输到离线环境

将 Node.js 安装包和整个 ` docsify-setup ` 目录以及下载的资源文件拷贝到离线计算机中。

## 步骤 3：在离线环境中安装

1. 在离线计算机上，打开命令行工具，导航到包含 `docsify-setup` 目录的位置。
2. 在 `docsify-setup` 目录中，运行以下命令来安装 `docsify-cli` 及其依赖：

   ```bash
   npm install -g
   ```

3. 安装完成后，将 `docsify-setup` 所在目录的 `[你的路径]\node_modules\.bin` 加入到环境变量 `PATH` 中。
4. 可以通过运行以下命令来验证 `docsify-cli` 是否安装成功，如果 `docsify-cli` 安装成功，它将显示版本号。

   ```bash
   docsify -v
   ```

## 步骤 4：项目部署与运行

1. 在离线计算机中通过 `docsify init` 命令生成初始项目文件，或直接拷贝本地已生成好的相关文件。
2. 将 `index.html` 中引用的资源文件路径替换为本地相对路径，配置可参考 [docsify-in-offline-example/index.html](https://github.com/viazure/docsify-in-offline-example/blob/main/index.html)。
3. 运行 `docsify serve` 命令启动文档服务，或通过 IIS 或 Nginx 等工具直接部署修改好的静态页面。（注：在 IIS 中部署时需要添加 MIME 类型 `text/markdown`。）
