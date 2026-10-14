# blog-cache

博客临时转存代理 Worker。

- **域名**：`https://cache.viazure.cc`
- **R2 bucket**：`cache`（仅临时转存，不做持久存储，可随时清空；建议对 `cover/` 设 7–30 天生命周期）
- **当前场景**：音乐页封面图 `/cover/lastfm/...`、`/cover/caa/...`

R2 API 不支持 bucket 描述字段；用途说明写在本 README，并在 bucket 根写入 `_PURPOSE.txt`。

```bash
npm install
npx wrangler login                     # 本机首次需要
npx wrangler r2 bucket create cache    # 若尚未创建
npm run deploy
npm run types                          # 生成 worker-configuration.d.ts（含 Env + runtime）
```

若在 Windows 上 `wrangler types` 因 workerd 无法在仓库盘创建目录而失败，可在可写临时目录生成后拷回 `worker-configuration.d.ts`。

行为要点：

- 回源超时 6s；非图片 / 过大（`Content-Length` 或实际 body > 2MB）→ `302` 回上游
- 仅白名单路径；Last.fm size 限 `64s` / `300x300`
- 生产关闭 `workers.dev` / Preview URL / source maps；R2 `cover/` 建议 30 天过期
- Cloudflare 侧已对 `cache.viazure.cc/cover*` 加 Rate Limit（Free：每 IP / 10s 超 **100** 次则 block；给榜单一次展开约 50 张封面留余量）

路由示例：

- `GET /cover/lastfm/300x300/<hash>.png` → Last.fm Fastly 回源
- `GET /cover/caa/<mbid>/front-250` → Cover Art Archive（跟随 307 到 archive.org）
