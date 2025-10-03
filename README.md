# ops-kit-backend

最小可运行的后端（Node/Express），提供 3 个接口：

- `GET /health` → 存活检查
- `POST /process` → 受理任务（传入 url），返回 `{ jobId }`
- `GET /status?jobId=...` → 轮询任务状态，成功时返回 `videoUrl/audioUrl/text`

> 需要容器安装 `ffmpeg` 与 `yt-dlp`。在 Railway 可通过 `NIXPACKS_PKGS` 添加这两个包。
> 环境变量：`PUBLIC_BASE` 部署一次拿到域名后回填。

## 本地快速运行（可选）
```bash
npm i
cp .env.example .env
# 本地开发时，把 PUBLIC_BASE 改为 http://localhost:8080
npm run dev
```

## 请求示例
POST /process
```json
{
  "url": "https://www.bilibili.com/video/BV1xx411c7mD",
  "options": { "extractText": true, "audioOnly": true }
}
```
