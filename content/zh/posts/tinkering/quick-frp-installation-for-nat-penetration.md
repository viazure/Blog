---
title: 快速安装使用 frp 内网穿透服务
slug: quick-frp-installation-for-nat-penetration
author:
  - viazure
date: 2023-01-20T18:53:25+08:00
lastmod: 2025-03-12T08:54:51+08:00
categories:
  - tinkering
tags:
  - frp
  - network
share: true
---

## 前言

虽然已经能够通过 ZeroTier[^1] 访问公司电脑上部署的服务，但由于 iOS 的 ZeroTier 客户端不支持 moon 服务，在打洞失败时速度很慢，所以我决定使用 frp[^2] 进行内网穿透，以备不时之需。

## 安装过程

### 服务端

ssh 到服务器，通过人家写好的一键配置 shell 脚本 [frps-onekey](https://github.com/mvscode/frps-onekey) 安装 frp 服务端，这个脚本会自动下载并配置 frp 服务端，简化手动配置的步骤。

```shell
wget https://gitee.com/mvscode/frps-onekey/raw/master/install-frps.sh -O ./install-frps.sh
chmod 700 ./install-frps.sh
./install-frps.sh install
```

按照提示进行各种配置，然后启动。

### 客户端

在 frp 项目的 release 中下载最新的 Windows 客户端压缩包，解压后修改启动中的 `frpc.toml` 文件。示例如下：

```toml:frpc.toml
serverAddr = "100.100.100.100"  # 服务器地址
serverPort = 7443  # 服务器端口
auth.method = "token"  # 认证方式
auth.token = "egXXX"  # 认证令牌

[[proxies]]
name = "debug-api"
type = "tcp"
localIP = "127.0.0.1"
localPort = 8084
remotePort = 8084
```

**http 服务可以使用多个子用户名分别映射，没有域名的话可以使用 `tcp` 的方式进行映射。**

配置完成后，通过命令行执行命令启动服务：

```cmd
.\frpc.exe -c frpc.toml
```

但这种启动方式在命令行关闭后就停止服务了，所以可以使用 Shawl[^3] 将其注册为 Windows 服务，示例如下：

```cmd
shawl add --name frp -- C:\Services\frp\frpc.exe -c C:\Services\frp\frpc.toml
```

好了，安装完毕。

## 踩坑

在修改 systemctl 服务配置后，需要执行 `systemctl daemon-reload` 重新加载配置，否则可能会提示：`frps.service: Failed to execute command: Permission denied`。

[^1]: [ZeroTier](https://www.zerotier.com/) 是一款开源的软件定义广域网（SD-WAN）工具，它允许用户轻松在不同设备之间创建虚拟专用网络（VPN）。ZeroTier 采用点对点（P2P）连接和现代加密技术，将不同网络环境下的设备组建成一个虚拟局域网，使局域网内的设备可以互相访问。
[^2]: [frp](https://github.com/fatedier/frp) 是一个专注于内网穿透的高性能的反向代理应用，支持 TCP、UDP、HTTP、HTTPS 等多种协议。可以将内网服务以安全、便捷的方式通过具有公网 IP 节点的中转暴露到公网。
[^3]: [Shawl](https://github.com/mtkennerly/shawl) 是一个用于将任意程序作为 Windows 服务运行的包装器，用 Rust 编写。它为您处理 Windows 服务 API，因此您的程序只需响应 ctrl-C/SIGINT。
