---
title: 使用 Resend 与 Cloudflare 实现域名邮箱发信
slug: configure-domain-email-with-resend-and-cloudflare
author:
  - viazure
date: 2025-03-15T09:52:56+08:00
lastmod: 2025-03-15T21:54:42+08:00
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

- 域名托管在 Cloudflare，已配置邮件收件转发
- 无法直接通过域名邮箱发送邮件
- 此前用 Gmail 代发出现「未验证」警告（未配置 DKIM 导致）

咨询了 DeepSeek 并参考多篇技术博客，最终选用 Resend 作为邮件发送方案，优势包括：

- 无需自建服务器
- API 优化
- 免费额度充足（每天 100 封）

## 实施步骤

### 服务配置

1. 访问 [Resend 官网](https://resend.com)，注册并登录（推荐使用邮箱注册，详见：[踩坑](#踩坑)）
2. 在 Domains 页面点击 `Add Domain` 添加域名，输入邮箱绑定的域名，并选择区域（Region），例如：`North Virginia (us-east-1)`
3. 域名添加完成后，Resend 将自动生成 DNS 记录配置：

   | Type | Name               | Content                               | TTL  | Priority | Status   |
   | ---- | ------------------ | ------------------------------------- | ---- | -------- | -------- |
   | MX   | send               | feedback-smtp.us-east-1.amazonses.com | Auto | 10       | verified |
   | TXT  | send               | v=spf1 include:amazonses.com ~all     | Auto |          | verified |
   | TXT  | resend.\_domainkey | p=MIGxxx                              | Auto |          | verified |
   | TXT  | \_dmarc            | v=DMARC1; p=none;                     | Auto |          |          |

4. 配置 DNS，Resend 提供了两种配置方式：

   1. 自动授权：点击 `Sigin in to Cloudflare` 按钮，登录授权后， Resend 将自动添加 DNS 记录
   2. 手动添加记录：参考 [官方指南](https://resend.com/docs/knowledge-base/cloudflare)

5. API Keys 页面点击 `Create API Key` 创建并记录下密钥（格式：re_xxxxxx）

### 功能验证

API 接口方式（cURL 示例）：

```bash
curl -X POST 'https://api.resend.com/emails' \
  -H 'Authorization: Bearer re_xxxxxx' \
  -H 'Content-Type: application/json' \
  -d $'{
    "from": "发件账户 <admin@你的域名>",
    "to": ["接收邮箱@gmail.com"],
    "subject": "配置验证邮件",
    "html": "<p>此邮件显示 DNS 配置已生效</p>"
  }'
```

SMTP 客户端配置：

- 服务器：smtp.resend.com
- 端口：465 (加密/TLS 连接使用 `2465`, `587` 或者 `2587`)
- 账户：resend
- 密码：API 密钥

### 使用与优化

**使用**：沿用 Gmail 客户端配置模式，将发送邮件的 SMTP 服务配置改为 Resend 的配置参数。更多示例参考 [官方帮助文档](https://resend.com/docs/send-with-smtp)

**优化**：使用 [Mail Tester](https://www.mail-tester.com/) 测试邮件的垃圾邮件匹配度，根据评分建议调整相关配置。

## 踩坑

1. 账号注册问题：使用 GitHub 直接登录后无法修改主邮箱，最后只能删除账号，重新使用邮箱注册。账号删除步骤：控制台 -> Settings -> Team -> `Delete Team` -> `Delete Account`
