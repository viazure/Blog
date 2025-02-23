---
title: 使用 docsify 在离线环境中部署文档服务
slug: deploying-docsify-in-offline-environment
date: 2024-12-29 09:05:52
updated: 2025-02-23 14:55:29
categories:
  - tools
tags:
  - docsify
  - service
author:
  - viazure
share: true
---

> 由于公司的开发服务器经历了一次被迫系统重装，导致之前使用 [docsify](https://docsify.js.org/#/) 部署的文档服务未能保留。今天着手重新部署该服务，鉴于当前服务器无法接入互联网，我计划实施一个适用于离线环境的部署方案。以下是我为此次部署过程所做的记录。
>
> 本文由 [Kimi. ai](https://kimi.moonshot.cn/) 协助润色完成。

## 步骤 1：在有网络的环境中准备

1. 安装 `docsify-cli` 与 `docsify-tools`

   - 打开命令行工具，并确保已经安装了 `npm`。
   - 运行以下命令来安装 `docsify-cli`：

   ```bash
   npm install -g docsify-cli
   npm install -g docsify-tools
   ```

2. 创建一个新的目录 `docsify-setup`，用于存放 `docsify-cli` 与 `docsify-tools` 及其依赖。

   ```bash
   mkdir docsify-setup
   cd docsify-setup
   ```

3. 运行以下命令，在新目录中初始化一个新的 `package.json` 文件。

   ```bash
   npm init -y
   ```

4. 运行以下命令，将 `docsify-cli` 及其依赖保存到当前目录。

   ```bash
   npm install docsify-cli --save
   npm install docsify-tools --save
   ```

## 步骤 2：将目录传输到离线环境

将整个 `docsify-setup` 目录拷贝到离线计算机中。

## 步骤 3：在离线环境中安装

1. 在离线计算机上，打开命令行工具，导航到包含 `docsify-setup` 目录的位置。
2. 在 `docsify-setup` 目录中，运行以下命令来安装 `docsify-cli` 及其依赖：

   ```bash
   npm install -g
   ```

3. 安装完成后，将 `docsify-setup` 所在目录的 `<path>\node_modules\.bin` 加入到环境变量 `PATH` 中。
4. 可以通过运行以下命令来验证 `docsify-cli` 是否安装成功，如果 `docsify-cli` 安装成功，它将显示版本号。

   ```bash
   docsify -v
   ```
