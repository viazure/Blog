---
title: 使用 Resend 与 Cloudflare 实现域名邮箱发信
slug: configure-domain-email-with-resend-and-cloudflare
author:
  - viazure
date: 2025-03-15T09:52:56+08:00
lastmod: 2025-03-21T09:32:44+08:00
categories:
  - tinkering
tags:
  - email
  - cloudflare
  - resend
  - smtp
  - dns
share: true
---

最近尝试解决域名邮箱发信问题，记录下具体操作过程。

## 背景需求

我的个人域名目前托管在 Cloudflare，并启用了其提供的「电子邮件路由（Email Routing）」服务来实现邮件转发功能。但该方案存在一个缺陷：只能接收转发邮件，无法直接通过域名邮箱发送邮件。

为了解决发件需求，我曾尝试按照 Gmail 官方教程《[通过其他地址或别名发送电子邮件](https://support.google.com/mail/answer/22370)》配置邮件代发功能。但在实际使用过程中，发现收件方会提示「发件人未验证」警告。经排查发现，这是由于未配置 DKIM 验证机制导致的问题。

根据 Google Workspace 的《[设置 DKIM](https://support.google.com/a/answer/174124?sjid=17788796605478889522-NC&rd=1#dkim-check-set-up)》指南文档说明：

> 如果您的域名提供商是 Google Domains 或  [Squarespace](https://squarespace.com/)，则 Google 会自动创建 DKIM 密钥，并将其添加到网域的 DNS 记录。

由于我的域名既非托管在 Google Domains/Squarespace，又未开通 Google Workspace，所以暂时无法使用 Google 提供的「自动创建 DKIM 密钥」服务。

现状总结：

✅ 已实现功能

- Cloudflare 域名托管
- 邮件接收及转发服务正常运作

❌ 待解决问题

- 无法通过域名邮箱直接发送邮件
- Gmail 代发触发「未验证」警告（原因：缺失 DKIM 记录）

咨询了 DeepSeek，又参考了多篇技术博客，最终选用 Resend 作为最终邮件发送方案，它有这些优势：

- 无需自建服务器
- API 友好
- 免费额度充足（每天 100 封，对于我这种偶尔发发邮件的场景完全够用）

## 实施步骤

### 服务配置

1. 访问 [Resend 官网](https://resend.com)，注册并登录（推荐使用邮箱注册，详见：[踩坑](configure-domain-email-with-resend-and-cloudflare.md##)）
2. 在 Domains 页面点击 `Add Domain` 添加域名，输入邮箱绑定的域名，并选择区域（Region），例如：`North Virginia (us-east-1)`
3. 域名添加完成后，需要配置 DNS。Resend 提供了两种配置方式：

   1. 自动授权：点击 `Sign in to Cloudflare` 按钮登录授权后，Resend 将自动添加 DNS 记录
   2. 手动添加记录：参考 [官方指南](https://resend.com/docs/knowledge-base/cloudflare)

   ![DNS 记录](https://webpimg.viazure.cc/250316160031078.png)

4. API Keys 页面点击 `Create API Key` 创建并记录下密钥（格式：re_xxxxxx）

### 功能验证

API 接口方式（cURL 示例）：

```bash
curl -X POST 'https://api.resend.com/emails' \
 -H 'Authorization: Bearer re_xxxxxx' \
 -H 'Content-Type: application/json' \
 -d $'{
  "from": "发件人 <发件人邮箱地址>",
  "to": ["接收人邮箱地址"],
  "subject": "hello world",
  "html": "<p>it works!</p>"
}'
```

SMTP 客户端配置：

- 服务器：smtp.resend.com
- 端口：465
- 账户：resend
- 密码：API 密钥

### 使用与优化

**使用**：沿用 Gmail 客户端配置模式，将发送邮件的 SMTP 服务配置改为 Resend 的配置参数。更多示例参考 [官方帮助文档](https://resend.com/docs/send-with-smtp)

**优化**：使用 [Mail Tester](https://www.mail-tester.com/) 测试邮件的**垃圾邮件匹配度**，根据建议调整相关配置。

## 踩坑

1. 账号注册问题：使用 GitHub 直接登录后发现无法修改主邮箱，最后只能删除账号，重新使用邮箱注册。账号删除步骤：控制台 -> Settings -> Team -> `Delete Team` -> `Delete Account`
