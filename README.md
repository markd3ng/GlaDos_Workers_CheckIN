# GLaDOS Workers Check-In

一个基于 Cloudflare Workers 的 GLaDOS 自动签到项目，支持多账号、定时任务、手动触发、状态查询，以及钉钉、Telegram、飞书通知。

本项目只使用 Cookie 登录态，不支持账号密码登录、验证码登录或保存密码。Cookie 和通知 Webhook 都属于敏感信息，请使用 Cloudflare Variables 或 Secrets 配置，不要写进源码。

## 功能

- 多账号 GLaDOS 签到
- 查询账号剩余天数
- Cloudflare Cron 定时运行
- HTTP 手动触发，默认关闭，可按需启用
- Cookie 失效识别
- 失败账号不影响其他账号
- 钉钉、Telegram、飞书通知
- TypeScript + Wrangler + Vitest 测试

## 项目命令

```bash
npm install
npm test
npm run type-check
npm run cf:types
npm run dev
npm run deploy
```

说明：

- `npm test`：运行自动测试，测试会 mock 外部 HTTP 请求，不会访问真实 GLaDOS 或通知平台。
- `npm run type-check`：运行 TypeScript 类型检查。
- `npm run cf:types`：根据 `wrangler.jsonc` 生成 Cloudflare Workers 类型。
- `npm run dev`：本地启动 Worker。
- `npm run deploy`：部署到 Cloudflare Workers。

## 推荐部署方式：GitHub Actions

项目已包含 GitHub Workflow：

```text
.github/workflows/glados-workers-deploy.yml
```

触发方式：

- push 到 `main`，且改动包含源码、测试、配置、文档、migration 或 workflow 文件。
- 在 GitHub Actions 页面手动执行 `workflow_dispatch`。

Workflow 会执行：

1. `npm ci`
2. `npm test`
3. `npm run type-check`
4. `npm run cf:types`
5. `npm run db:migrate:remote`
6. `npm run deploy`

### GitHub 侧 Secrets

GitHub Actions 需要 Cloudflare API 权限来执行部署，所以以下两个值放在 GitHub 仓库的 Actions Secrets：

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

可选：

```text
CLOUDFLARE_D1_DATABASE_ID
```

如果你已经手动创建了 D1，可以把真实 database id 放到 GitHub Secrets。没有提供时，Workflow 会按数据库名称自动查找；查不到会自动创建。

可选 GitHub Actions Variable：

```text
CLOUDFLARE_D1_DATABASE_NAME
```

不填时使用 `wrangler.jsonc` 中的默认名称 `glados-checkin`。

`CLOUDFLARE_API_TOKEN` 建议使用权限最小化的 Cloudflare API Token，至少需要能部署目标 Worker。

最小权限建议：

```text
Account / Workers Scripts / Edit
Account / D1 / Edit
```

如果你的 Cloudflare 账户界面要求额外读取权限，再补充：

```text
Account / Account Settings / Read
```

Token 的 Account Resources 限制到当前账号即可，不需要 All accounts。

### Cloudflare 侧 Variables / Secrets

运行时配置继续放 Cloudflare，不放 GitHub。最重要的是 `GLADOS_ACCOUNTS`。

`GLADOS_ACCOUNTS` 不是邮箱，也不是密码。它是一个 JSON 字符串数组，每个账号只需要：

- `name`：你自己给账号起的显示名称。
- `cookie`：登录 GLaDOS 后从浏览器请求头复制出来的完整 Cookie。

单账号示例：

```json
[
  {
    "name": "main",
    "cookie": "koa:sess=YOUR_SESSION;koa:sess.sig=YOUR_SIGNATURE"
  }
]
```

多账号示例：

```json
[
  {
    "name": "account-1",
    "cookie": "koa:sess=ACCOUNT_1_SESSION;koa:sess.sig=ACCOUNT_1_SIGNATURE"
  },
  {
    "name": "account-2",
    "cookie": "koa:sess=ACCOUNT_2_SESSION;koa:sess.sig=ACCOUNT_2_SIGNATURE"
  }
]
```

在 Cloudflare Dashboard 里配置时：

1. 打开 Worker。
2. 进入 Settings。
3. 打开 Variables and Secrets。
4. 新增变量 `GLADOS_ACCOUNTS`。
5. 类型建议选 Secret。
6. Value 粘贴上面的 JSON，注意最外层是 `[` 和 `]`。

运行时变量清单：

```text
GLADOS_ACCOUNTS       必填，JSON 字符串数组，保存账号名称和 Cookie
ADMIN_TOKEN           可选，启用手动端点时用于鉴权
DINGTALK_WEBHOOK      可选，钉钉机器人 Webhook
DINGTALK_SECRET       可选，钉钉机器人加签密钥
TELEGRAM_BOT_TOKEN    可选，Telegram Bot Token
TELEGRAM_CHAT_ID      可选，Telegram Chat ID
FEISHU_WEBHOOK        可选，飞书机器人 Webhook
FEISHU_SECRET         可选，飞书机器人签名密钥
```

简单说：

- GitHub Secrets：只放部署所需的 Cloudflare API Token 和 Account ID。
- Cloudflare Variables/Secrets：放 GLaDOS Cookie、通知 Webhook、手动端点 Token 等运行时配置。

## 配置账号

本项目只支持 Cookie 登录态，不支持账号密码登录。不要填写邮箱和密码。

必填变量是 `GLADOS_ACCOUNTS`：

```bash
GLADOS_ACCOUNTS='[
  {
    "name": "account-1",
    "cookie": "koa:sess=YOUR_SESSION;koa:sess.sig=YOUR_SIGNATURE"
  }
]'
```

字段说明：

- `name`：账号显示名称，只用于日志和通知。
- `cookie`：GLaDOS 登录后的完整 Cookie，不是邮箱，不是密码。

不支持以下配置：

- 邮箱 + 密码
- 用户名 + 密码
- 验证码自动登录
- 在 Worker 内模拟登录流程

## 获取 Cookie

1. 登录 GLaDOS 网站。
2. 打开浏览器开发者工具。
3. 进入 Network 面板。
4. 刷新页面。
5. 选择任意发往 `glados.rocks` 的请求。
6. 复制请求头里的完整 `Cookie`。

Cookie 过期后，需要重新复制并更新 `GLADOS_ACCOUNTS`。

## 本地开发

复制示例环境变量文件：

```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`，替换占位符：

```bash
npm run dev
```

本地端点默认是：

```text
http://127.0.0.1:8787
```

## Cloudflare 配置

### D1 数据库

签到日志使用 Cloudflare D1 保存。

推荐让 GitHub Workflow 自动准备 D1：

1. 如果设置了 `CLOUDFLARE_D1_DATABASE_ID`，Workflow 会直接使用这个数据库。
2. 如果没有设置 ID，Workflow 会按 `CLOUDFLARE_D1_DATABASE_NAME` 或 `wrangler.jsonc` 中的 `database_name` 查找。
3. 如果仍然找不到，Workflow 会自动创建 D1，并把真实 `database_id` 写入本次 CI 工作区的 `wrangler.jsonc`，然后再执行 migration 和 deploy。

也可以手动创建数据库：

```bash
npx wrangler d1 create glados-checkin
```

命令会输出 `database_id`。你可以把它填入 GitHub Secret `CLOUDFLARE_D1_DATABASE_ID`，也可以手动填入 `wrangler.jsonc`：

```jsonc
{
  "d1_databases": [
    {
      "binding": "CHECKIN_DB",
      "database_name": "glados-checkin",
      "database_id": "YOUR_D1_DATABASE_ID"
    }
  ]
}
```

本地或首次部署前可手动应用 migration：

```bash
npm run db:prepare
npm run db:migrate:remote
```

GitHub Workflow 会在部署前自动执行 `db:prepare` 和 `db:migrate:remote`。

推荐把敏感信息设置为 Secrets：

```bash
npx wrangler secret put GLADOS_ACCOUNTS
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put DINGTALK_WEBHOOK
npx wrangler secret put DINGTALK_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put FEISHU_WEBHOOK
npx wrangler secret put FEISHU_SECRET
```

非敏感默认值可以保留在 `wrangler.jsonc`：

```jsonc
{
  "vars": {
    "CHECKIN_CONCURRENCY": "2",
    "CHECKIN_RETRIES": "3",
    "ENABLE_MANUAL_ENDPOINTS": "false",
    "NOTIFY_ON_STATUS_ONLY": "false"
  }
}
```

也可以在 Cloudflare Dashboard 里配置：

1. 打开 Workers & Pages。
2. 进入当前 Worker。
3. 打开 Settings。
4. 进入 Variables and Secrets。
5. 添加上面的变量。

## 定时任务

默认 Cron：

```text
0 0 * * *
```

这表示每天 UTC 00:00 执行，也就是北京时间 08:00。

如需修改，编辑 `wrangler.jsonc`：

```jsonc
{
  "triggers": {
    "crons": ["0 0 * * *"]
  }
}
```

修改后重新生成类型并部署：

```bash
npm run cf:types
npm run deploy
```

## HTTP 端点

这个项目的核心是 Cron 自动签到，所以手动端点默认关闭。

保留端点的意义：

- `/health`：用于部署后检查 Worker 是否正常启动。
- `/status`：手动查看 Cookie 是否仍有效和剩余天数。
- `/checkin`：临时补签或测试新 Cookie。
- `/run`：手动执行一次完整流程并发送通知。
- `/log`：查看 D1 中累计成功签到记录、获得 Point、剩余天数等信息。

如果你只需要每日自动签到，可以保持默认：

```text
ENABLE_MANUAL_ENDPOINTS=false
```

此时 `/status`、`/checkin`、`/run`、`/log` 会返回 `404`，减少公开攻击面。`/health` 仍保留。

如需启用手动端点，必须同时配置：

```text
ENABLE_MANUAL_ENDPOINTS=true
ADMIN_TOKEN=YOUR_ADMIN_TOKEN
```

### 健康检查

```bash
curl https://YOUR_WORKER_DOMAIN/health
```

### 查询状态

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://YOUR_WORKER_DOMAIN/status
```

### 手动签到，不发送通知

```bash
curl -X POST -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://YOUR_WORKER_DOMAIN/checkin
```

### 手动签到并发送通知

```bash
curl -X POST -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://YOUR_WORKER_DOMAIN/run
```

### 查看签到日志

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://YOUR_WORKER_DOMAIN/log
```

按年份筛选：

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" "https://YOUR_WORKER_DOMAIN/log?year=2026"
```

按月份筛选：

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" "https://YOUR_WORKER_DOMAIN/log?year=2026&month=05"
```

`/log` 返回 HTML 表格，包含日期时间、账号、状态、Point、剩余天数、触发方式、消息，并显示当前筛选范围内的累计 Point。

### 带 ADMIN_TOKEN

受保护端点需要 Bearer token：

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://YOUR_WORKER_DOMAIN/status
curl -X POST -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://YOUR_WORKER_DOMAIN/run
```

也可以用查询参数：

```bash
curl "https://YOUR_WORKER_DOMAIN/status?token=YOUR_ADMIN_TOKEN"
```

## 通知配置

通知渠道是可选的。配置完整的渠道会自动启用，缺失或空值会跳过。

### 钉钉

```bash
DINGTALK_WEBHOOK=https://oapi.dingtalk.com/robot/send?access_token=YOUR_ACCESS_TOKEN
DINGTALK_SECRET=SECxxxxxxxxxxxxxxxx
```

`DINGTALK_SECRET` 可选。机器人开启加签时必须配置。

### Telegram

```bash
TELEGRAM_BOT_TOKEN=123456789:YOUR_BOT_TOKEN
TELEGRAM_CHAT_ID=123456789
```

Telegram 使用纯文本消息，避免 Markdown/HTML 转义导致发送失败。

### 飞书

```bash
FEISHU_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/YOUR_HOOK_ID
FEISHU_SECRET=YOUR_FEISHU_SIGNING_SECRET
```

`FEISHU_SECRET` 可选。机器人开启签名校验时必须配置。

## 排障

### `GLADOS_ACCOUNTS is required`

没有配置 `GLADOS_ACCOUNTS`，或变量为空。请检查 Cloudflare Variables/Secrets 或本地 `.dev.vars`。

### `GLADOS_ACCOUNTS must be a JSON array`

账号配置不是合法 JSON 数组。建议先用 JSON 校验工具检查格式。

### `Account ... must include a cookie`

账号缺少 `cookie` 字段。本项目不支持账号密码登录。

### Cookie 失效

通知或响应里出现 Cookie 失效时，重新登录 GLaDOS，复制新的 Cookie，然后更新 `GLADOS_ACCOUNTS`。

### 通知失败

通知失败不会影响签到结果。请检查：

- Webhook 是否完整。
- 钉钉或飞书是否开启了加签但未配置 secret。
- Telegram Bot Token 和 Chat ID 是否正确。

### `wrangler types` 失败

先确认依赖已安装：

```bash
npm install
```

再运行：

```bash
npm run cf:types
```

## 安全说明

- 不要提交真实 Cookie、Webhook、Token。
- 不要把 Cookie 写进 `wrangler.jsonc`。
- 推荐设置 `ADMIN_TOKEN` 保护 `/status`、`/checkin`、`/run`。
- 日志只记录账号名称和状态，不记录 Cookie。
