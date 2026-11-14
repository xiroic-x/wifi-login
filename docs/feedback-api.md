# BUG 反馈接口契约 (v1) — wifi-login 官网 + 反馈服务

> 返回 [README](../README.md) · 文档索引 [docs/README.md](README.md)

> 本文是**接口唯一事实来源**。官网前端 (`site/`)、反馈服务 (`server/`)、
> 客户端 (`site/clients/`)、AI skill (`skills/wifi-bug-report/`) 全部按本文实现。
> 变更接口必须先改本文。

## 0. 部件与目录

| 部件 | 目录 | 作用 |
| --- | --- | --- |
| 官网 | `site/` | 静态站: 项目介绍 / BUG 反馈 / 接口预览。服务端同源托管于 `/` |
| 反馈服务 | `server/` | Node ≥18 零依赖 HTTP 服务: 反馈收发 + 静态站 + AI 只读视图 |
| 客户端 | `site/clients/` | 词典笔 QuickJS 一键反馈模块 / Node CLI / curl / adb 采集脚本 |
| AI 入口 | `site/llms.txt` `site/agents.md` `skills/wifi-bug-report/` `site/clients/mcp-feedback.mjs` | AI 一键查看能力 |

默认监听 `http://127.0.0.1:8787`（`PORT` 可覆盖）。所有端点前缀 `/api/v1`。

## 1. 数据模型

```json
{
  "id": "FB-20261113-K7Q2M4",
  "status": "open",                      // open | triaged | fixed | wontfix | duplicate
  "createdAt": "2026-11-13T23:20:11+08:00",
  "updatedAt": "2026-11-13T23:20:11+08:00",
  "source": "pen",                       // pen | cli | web | api | curl
  "summary": "登录后仍无法上网",           // 必填, ≤120 字
  "description": "……",                    // ≤8000 字
  "steps": "1. …",                       // 复现步骤, ≤4000 字
  "contact": "qq:123456",                // 可选
  "app":     { "version": "1.1.4", "appid": "8001865309000001", "build": "rk" },
  "device":  { "model": "X6PRO", "firmware": "…", "serial": "…", "screen": "960x266" },
  "network": { "ssid": "…", "ip": "…", "gateway": "…", "needLogin": true,
               "adapter": "panabit", "portalUrl": "…", "probe": "小米" },
  "status0": { "…": "status.json 原样内容" },
  "logs":    [ { "name": "wifi.log", "bytes": 12345, "truncated": true, "lines": 200, "content": "…" } ],
  "attachments": [ { "name": "shot.png", "bytes": 45863, "mime": "image/png", "path": "…" } ],
  "tags": ["login"],
  "notes":   [ { "at": "…", "author": "maintainer", "text": "已在 CI 复现" } ],
  "meta":    { "ua": "…", "ip": "1.2.3.4", "clientVersion": "1.0.0", "chunked": false }
}
```

- `id` 规则: `FB-<yyyyMMdd>-<6 位 base36 大写>`，URL 安全、大小写敏感。
- 服务端**必须**自动脱敏密码类字段: 形如 `password=xxx` `pwd=xxx` `pass=xxx`
  的值替换为 `***`（保留键名），并在响应里给出 `masked: <n>`。
- 存储: `server/data/tickets/<id>.json`、日志正文同名 `.logs/<name>`、
  追加索引 `server/data/index.jsonl`。目录不存在自动创建。

## 2. 写接口（软件一键反馈）

### 2.1 `POST /api/v1/feedback` — 标准 JSON 提交

- `Content-Type: application/json`，body ≤ 1 MiB（`attachments` 用 base64，可放截图）。
- 请求体字段 = 上面数据模型里客户端可给的子集（`summary` 必填，其余可选）。
- `logs[].content` 直接给文本；`logs[].base64` 给二进制（服务端解码）。
- 成功: `201`

```json
{
  "ok": true,
  "id": "FB-20261113-K7Q2M4",
  "masked": 2,
  "urls": {
    "json": "/api/v1/feedback/FB-20261113-K7Q2M4",
    "md":   "/api/v1/feedback/FB-20261113-K7Q2M4.md",
    "html": "/t/FB-20261113-K7Q2M4",
    "issue": "/api/v1/feedback/FB-20261113-K7Q2M4.issue.md"
  },
  "ai": {
    "view": "/api/v1/ai/ticket/FB-20261113-K7Q2M4",
    "prompt": "阅读 https://<host>/api/v1/ai/ticket/<id> 并按日志定位问题"
  },
  "upload": null
}
```

### 2.2 `GET /api/v1/feedback/quick` — 单请求一键反馈（受限客户端 / 笔端）

词典笔原生库 `panet.request(url, method, timeoutSec)` **不支持请求体**，
所以本通道把全部内容放进查询串，方法 GET，可单独使用；也可与 2.3 分片续传配合。

| 查询参数 | 必填 | 说明 |
| --- | --- | --- |
| `s` | ✅ | summary（≤120） |
| `d` | | description（≤2000，本通道限长） |
| `c` | | contact |
| `v` `a` `b` | | 应用 version / appid / build(rk|cvi) |
| `m` `fw` `sn` | | 机型 / 固件 / 序列号 |
| `ssid` `ip` `gw` `need` `adp` `portal` `probe` | | 网络信息 |
| `st` | | status.json 原文（≤8 KB） |
| `log` | | 日志文本块（≤4 KB，自动脱敏） |
| `seq` `id` `token` | | 续传用（见 2.3） |
| `finish` | | `1` = 本块发完即结束 |
| `src` | | source，默认 `pen` |
| `tags` | | 逗号分隔 |

- 整个请求行必须 ≤ 12000 字节，超出返回 `413 {"ok":false,"error":"url_too_long",...}`。
- 首次提交（不带 `id`）→ `201` + 与 2.1 相同结构，另加
  `"upload": { "token": "…", "nextSeq": 1, "chunkMaxBytes": 3072, "maxChunks": 8 }`。
- 续传提交（带 `id`+`token`+`seq`）→ `200 {"ok":true,"id":…,"received":<字节数>,"nextSeq":…}`。
- 需要纯文本回执时带 `fmt=text`。

### 2.3 `POST /api/v1/feedback/:id/append` — 分片续传（有请求体的客户端）

```json
{ "token": "…", "seq": 1, "content": "日志文本", "encoding": "utf8", "name": "wifi.log" }
```
服务端按 `seq` 顺序拼接，`seq` 跳号或超 `maxChunks` 返回 `409`。
令牌错 `403`，超 30 分钟未续传的草稿 `410`（保留数据，仅拒绝续传）。

### 2.4 `POST /api/v1/feedback/:id/comment` — 补充信息 / 维护者备注

```json
{ "text": "又复现了一次", "author": "reporter", "token": "…(维护者可选)" }
```
→ `200 {"ok":true,"id":…,"notes":2}`

### 2.5 维护者写操作（需 `ADMIN_TOKEN`）

- `POST /api/v1/feedback/:id/status` — `{ "status": "triaged", "note": "已定位" }`
- `DELETE /api/v1/feedback/:id`
- 未配置 `ADMIN_TOKEN` 时: 读接口放行，写接口一律 `503 {"ok":false,"error":"admin_disabled"}`。

## 3. 读接口（AI / 人 一键查看）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/ai/tickets` | **AI 首选**。Markdown 列表（最近 N 条）`?limit=20&status=open&q=关键词&platform=rk`；`format=json` 变为 JSON |
| GET | `/api/v1/ai/ticket/:id` | **AI 首选**。单条完整 Markdown（设备/网络/日志/状态/附件/备注/排查提示） |
| GET | `/api/v1/feedback/:id` | 结构化 JSON |
| GET | `/api/v1/feedback/:id.md` | 与 `/api/v1/ai/ticket/:id` 同内容（别名，便于人类记） |
| GET | `/api/v1/feedback/:id.issue.md` | 可直接粘贴到 GitHub Issue 的正文（含模板骨架 + `<details>` 折叠日志） |
| GET | `/api/v1/feedback` | JSON 列表 `?limit=&status=&q=&offset=`；含 `token` 时返回完整字段 |
| GET | `/api/v1/stats` | `{total, byStatus, byPlatform, last24h, last7d}` |
| GET | `/api/v1/openapi.json` | OpenAPI 3.0 描述（与本文一致） |
| GET | `/healthz` | `{"ok":true,"uptime":…,"tickets":…}` |
| GET | `/llms.txt` | AI 入口索引（静态文件 `site/llms.txt`，服务端托管） |
| GET | `/t/:id` | 人类可读的单条 HTML 页面（`site/ticket.html` 模板渲染） |

**AI Markdown 视图格式**（`/api/v1/ai/ticket/:id`），要求稳定、可 diff、token 友好:

```markdown
# FB-<id> · <summary>
- 状态: open | 来源: pen | 创建: 2026-11-13 23:20:11 +08:00 | 更新: …
- 应用: wifi-login 1.1.4 (rk) appid 8001865309000001
- 设备: X6PRO | 固件 … | 屏幕 960x266 | SN …
- 网络: SSID=… IP=… 网关=… 需认证=是 适配器=panabit 探测源=小米
- 联系: …
- 标签: login, rk
- 附件: shot.png (45 KB)
## 描述
……
## 复现步骤
……
## status.json
```json
{ … }
```
## 日志 wifi.log（尾部 200 行 / 12.3 KB，已脱敏）
```text
[11-13 23:19:02][检测] status=portal …
```
## 维护者备注
- 2026-11-13 23:30 [maintainer] 已定位
## 给 AI 的排查提示
- 时间戳为设备本地时间；关键行标签: [检测] [登录] [适配器] [心跳] [下线]
- 端口/适配器识别失败看 `[适配器]` 是否缺行；`status=free` 需带 `confirm=` 复核对
```

**列表 Markdown 格式**（`/api/v1/ai/tickets`）:

```markdown
# BUG 反馈列表 (共 3 条 · 过滤: status=open)
| ID | 状态 | 创建 | 平台 | 摘要 |
| --- | --- | --- | --- | --- |
| FB-20261113-K7Q2M4 | open | 11-13 23:20 | rk | 登录后仍无法上网 |
```

## 4. 错误约定

所有错误返回 `{"ok":false,"error":"<code>","message":"<人话>"}`:

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `bad_request` / `missing_summary` | 参数缺失或非法 |
| 403 | `bad_token` | 续传令牌错 |
| 404 | `not_found` | 工单不存在 |
| 409 | `seq_gap` / `too_many_chunks` | 分片顺序错 / 超上限 |
| 410 | `draft_expired` | 草稿过期 |
| 413 | `url_too_long` / `payload_too_large` | 超长 |
| 429 | `rate_limited` | 每 IP 每分钟 > 30 次写 |
| 503 | `admin_disabled` | 维护者写操作未启用 |

## 5. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 8787 | 监听端口 |
| `HOST` | 127.0.0.1 | 绑定地址（局域网演示用 0.0.0.0） |
| `DATA_DIR` | `server/data` | 数据目录 |
| `SITE_DIR` | `site` | 静态站点目录 |
| `ADMIN_TOKEN` | 空 | 维护者写操作令牌；空 = 写操作禁用 |
| `WRITE_TOKEN` | 空 | 非空时，提交接口需带 `token`（对外部署用） |
| `BASE_URL` | 按请求推导 | 生成绝对链接用 |
| `RATE_LIMIT` | 30 | 每 IP 每分钟写次数 |

## 6. 一键反馈动线（必须跑通的三条）

1. **笔端一键**: `clients/miniapp/feedback.js` 收集 版本/机型/SSID/IP/status.json/日志尾部
   → `GET /api/v1/feedback/quick`（超 4 KB 自动分片）→ 拿到 `id` 与 `ai.view` 链接。
2. **电脑一键**: `node clients/feedback-cli.mjs --desc "…" [--adb] [--log 文件] [--ssid x]`
   → adb 采集（若可用）+ 粘贴/读取日志 → `POST /api/v1/feedback` → 打印 Markdown 链接与 Issue 正文。
3. **AI 一键**: `curl -s $BASE/api/v1/ai/tickets?limit=20` 看列表 →
   `curl -s $BASE/api/v1/ai/ticket/<id>` 读全文（或 MCP `feedback_list` / `feedback_view`）。

## 7. 官网页面与接口预览要求

- `site/index.html` 落地页: 一句话定位 / 功能 / 平台矩阵 (RK·CVI) / 截图 / 快速开始 / 下载 (指向 Releases) / 文档导航 / 许可 / dsh 徽章 / 页脚。
- `site/feedback.html`: 表单字段与 `.github/ISSUE_TEMPLATE/bug-report.md` **对齐**（版本/机型固件/认证系统/SSID/描述/复现/日志/截图），
  支持粘贴日志、拖拽 `wifi.log`/`status.json`、浏览器侧基础设备信息自动填充；
  提交后展示 `id` + Markdown 链接 + **一键复制的 GitHub Issue 正文**。
- `site/api.html`: 接口预览 —— 端点表 + 请求/响应示例 + **在线调试台**
  （可真实调用 `/api/v1/feedback/quick`、`/api/v1/ai/tickets`、`/api/v1/ai/ticket/:id`，
  展示返回的 Markdown/JSON）+ 客户端代码片段（QuickJS / Node / curl / adb）。
- 同源部署：服务端把 `site/` 托管在 `/`，所以前端一律用相对路径 `/api/v1/...`，无 CORS 问题。
