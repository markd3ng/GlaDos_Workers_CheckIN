# GLaDOS Workers Check-In

> 在 Cloudflare Workers 上运行 GLaDOS 自动签到，支持多账号、三种通知渠道（钉钉/Telegram/飞书）、D1 日志持久化。
> 部署后无需服务器，免费额度完全覆盖日常签到。

## 目录

- [看完这篇你能得到什么](#看完这篇你能得到什么)
- [项目原理（30 秒版）](#项目原理30-秒版)
- [前置准备：你需要准备什么](#前置准备你需要准备什么)
- [第一步：Fork 项目到你的 GitHub](#第一步fork-项目到你的-github)
- [第二步：获取 GLaDOS Cookie](#第二步获取-glados-cookie)
- [第三步：创建 Cloudflare API Token](#第三步创建-cloudflare-api-token)
- [第四步：找到你的 Cloudflare Account ID](#第四步找到你的-cloudflare-account-id)
- [第五步：在 GitHub 配置 Secrets](#第五步在-github-配置-secrets)
- [第六步：在 Cloudflare 配置运行时变量](#第六步在-cloudflare-配置运行时变量)
- [第七步：触发首次部署](#第七步触发首次部署)
- [第八步：验证部署结果](#第八步验证部署结果)
- [（可选）配置通知](#可选配置通知)
- [（可选）本地开发](#可选本地开发)
- [HTTP 端点说明](#http-端点说明)
- [排障指南](#排障指南)
- [安全说明](#安全说明)
- [项目结构](#项目结构)

## 看完这篇你能得到什么

1. **自动签到**：每天北京时间 08:00（UTC 00:00）自动签到，无需人工操作。
2. **多账号支持**：不管你有几个 GLaDOS 账号，一次配置全部签完。
3. **Cookie 失效通知**：Cookie 过期时准时提醒你更新。
4. **签到日志**：所有签到记录持久化在 Cloudflare D1，随时可查。

整个过程大约需要 **15 分钟**，大部分时间是在 Cloudflare 和 GitHub 页面上点按钮。

## 项目原理（30 秒版）

```text
Cloudflare Cron（每天 UTC 00:00）
  → 触发 Worker
  → Worker 用你提供的 Cookie 向 glados.rocks 发签到请求
  → 签到结果写入 D1 数据库
  → （可选）通过钉钉/Telegram/飞书推送结果
```

Worker 只使用 Cookie 模拟浏览器请求，**不存储密码、不模拟登录流程**。Cookie 过期后你需要手动更新。

## 前置准备：你需要准备什么

开始之前，请确认你有以下三样东西：

| 序号 | 需要什么 | 用来做什么 |
|------|---------|-----------|
| 1 | GitHub 账号 | Fork 项目、触发自动部署 |
| 2 | Cloudflare 账号 | 运行 Worker、存储日志数据库 |
| 3 | GLaDOS 账号 | 要签到的目标账号 |

不需要服务器、不需要域名、不需要信用卡。

## 第一步：Fork 项目到你的 GitHub

1. 打开本项目的 GitHub 页面。
2. 点击右上角 **Fork** 按钮。
3. 在弹出页面上点击 **Create fork**。

完成后你会得到一个自己的副本：`https://github.com/<你的用户名>/GlaDos_Workers_CheckIN`。

## 第二步：获取 GLaDOS Cookie

本项目的核心身份凭证就是 Cookie，获取方式如下：

### 2.1 登录 GLaDOS

在浏览器中打开 [https://glados.rocks](https://glados.rocks) 并登录。

### 2.2 打开开发者工具

按 `F12` 或 `Cmd+Option+I`（macOS）打开浏览器开发者工具。

### 2.3 切换到 Network 面板

在开发者工具顶部点击 **Network**（网络）标签页。

### 2.4 刷新页面

按 `F5` 或 `Cmd+R` 刷新页面，确保 Network 面板捕获到请求。

### 2.5 找到发往 glados.rocks 的请求

在 Network 面板的筛选框中输入 `glados.rocks`，任意选择一个请求点击。

### 2.6 复制 Cookie

在请求详情中：
1. 找到 **Request Headers**（请求头）部分。
2. 找到 `Cookie:` 这一行。
3. 复制整行冒号后面的完整内容。

Cookie 示例（你的实际 Cookie 会比这个长）：

```text
koa:sess=eyJ...很长一串;koa:sess.sig=另...一串签名
```

> **注意**：Cookie 是敏感信息。不要在公共场合分享，不要截图发到群里。

### 2.7 多账号怎么办

每个账号分别登录 GLaDOS 并重复上面的步骤，各获取一组 Cookie。最终你会得到一个 JSON 数组：

```json
[
  {
    "name": "主号",
    "cookie": "koa:sess=主号SESSION;koa:sess.sig=主号SIGNATURE"
  },
  {
    "name": "小号",
    "cookie": "koa:sess=小号SESSION;koa:sess.sig=小号SIGNATURE"
  }
]
```

`name` 是你自己给账号起的名字，只用于日志和通知中的显示。只有一个账号也得用数组 `[...]` 包起来。

## 第三步：创建 Cloudflare API Token

GitHub Actions 需要 API Token 才能把 Worker 部署到你 Cloudflare 账号上。这里是**完整的点击路径**。

### 3.1 进入 API Token 管理页面

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)。
2. 点击右上角**头像图标** → **My Profile**。
3. 点击左侧 **API Tokens** 标签页。

### 3.2 创建自定义 Token

**不要用** `Edit Cloudflare Workers` 模板——那个模板缺少 D1 权限。

点击 **Create Token** → 选择 **Create Custom Token**（在页面右侧）。

### 3.3 配置权限

在 **Permissions** 区域添加以下三行：

| 权限行 | 选择步骤 |
|--------|---------|
| **第一行** | 左侧下拉选 `Account` → 中间下拉选 `Workers Scripts` → 右侧下拉选 `Edit` |
| **第二行** | 左侧下拉选 `Account` → 中间下拉选 `D1` → 右侧下拉选 `Edit` |
| **第三行** | 左侧下拉选 `Account` → 中间下拉选 `Account Settings` → 右侧下拉选 `Read` |

每添加一行后点击 **+ Add more** 按钮。

配置完成后的效果：左侧统一是 `Account`，三行分别是 `Workers Scripts | Edit`、`D1 | Edit`、`Account Settings | Read`。

### 3.4 配置资源范围

在 **Account Resources** 区域：

1. 选择 `Include` → `Specific account` → 从下拉列表选择你的 Cloudflare 账号。
2. **不要**选 `All accounts`——最小权限原则。

在 **Zone Resources** 区域：

1. 选择 `Include` → `All zones`（本项目不需要特定域名，保持默认即可）。

### 3.5 其他设置

- **Client IP Address Filtering**：留空（不限制 IP）。
- **TTL**：可以不设置过期时间，或者设一个较远的日期，避免 Token 过期导致自动部署失败。

### 3.6 生成并保存 Token

1. 点击 **Continue to summary**。
2. 核对权限：确认有三行权限，资源范围正确。
3. 点击 **Create Token**。
4. **立即复制**显示的 Token 值。这个值只会出现一次，关闭页面后就看不到了。

Token 格式类似：`cfut_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

> **先把 Token 存到安全的地方**（比如密码管理器），下一步马上要用。

## 第四步：找到你的 Cloudflare Account ID

有两种方式，任选其一：

**方式一：从 URL 中获取**

登录 Cloudflare Dashboard 后，浏览器地址栏是：

```text
https://dash.cloudflare.com/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`/` 后面那串 32 位十六进制字符就是 Account ID。

**方式二：从 Workers & Pages 页面获取**

1. 左侧导航点击 **Workers & Pages**。
2. 页面右侧的 **Account details** 区域。
3. 点击 **Account ID** 旁的复制按钮。

也把它存到安全的地方，下一步要用。

## 第五步：在 GitHub 配置 Secrets

这些值只用于 GitHub Actions 部署，**不是** Worker 运行时的配置。

1. 打开你 Fork 的仓库页面：`https://github.com/<你的用户名>/GlaDos_Workers_CheckIN`。
2. 点击 **Settings** → 左侧 **Secrets and variables** → **Actions**。
3. 点击 **New repository secret**。

添加以下两个 Secret：

| Name | Value | 说明 |
|------|-------|------|
| `CLOUDFLARE_API_TOKEN` | 第三步复制的 Token（`cfut_...`） | 部署 Worker 用的 API 凭证 |
| `CLOUDFLARE_ACCOUNT_ID` | 第四步复制的 Account ID（32 位 hex） | 指示部署到哪个 Cloudflare 账号 |

> 这两个就够了。D1 数据库由部署脚本自动创建，不需要手动建。

添加完成后，页面应显示两个 repository secret：

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

## 第六步：在 Cloudflare 配置运行时变量

这些是 Worker **运行时**读取的配置，存在 Cloudflare 端。最重要的是账号 Cookie。

### 6.1 先触发一次部署（生成 Worker）

跳回 GitHub 仓库页面：

1. 点击 **Actions** 标签页。
2. 左侧找到 **Deploy GLaDOS Worker** 工作流。
3. 点击 **Run workflow** → **Run workflow**（绿色按钮）。

等大约 1-2 分钟，首次部署完成。这会：
- 在 Cloudflare 创建 Worker（名称为 `glados-workers`）
- 自动创建 D1 数据库（名称为 `glados-checkin`）
- 执行数据库迁移

### 6.2 配置 Worker 变量

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)。
2. 左侧导航点击 **Workers & Pages**。
3. 点击刚刚创建的 `glados-workers`。
4. 点击 **Settings** → **Variables and Secrets**。

### 6.3 添加必填变量

| 变量名 | 值 | 类型建议 | 说明 |
|--------|---|---------|------|
| `GLADOS_ACCOUNTS` | 第二步准备的 JSON 数组 | **Secret** | 账号和 Cookie 列表 |
| `ADMIN_TOKEN` | 自己设一个长随机字符串 | **Secret** | 访问页面的密码 |

`ADMIN_TOKEN` 自己生成一个，建议 32 位以上。例如在终端执行：

```bash
openssl rand -hex 20
```

### 6.4 添加 GLADOS_ACCOUNTS

1. 点击 **Add** → 选择 **Secret**。
2. Variable name 填 `GLADOS_ACCOUNTS`。
3. Value 粘贴第二步准备的 JSON：

```json
[{"name":"主号","cookie":"koa:sess=你的SESSION;koa:sess.sig=你的SIGNATURE"}]
```

> **Value 必须是一个合法的 JSON 数组**。即使只有一个账号，也不能省略最外层的 `[...]`。建议先在本地用 [JSONLint](https://jsonlint.com) 验证格式。

点击 **Save**。

### 6.5 添加 ADMIN_TOKEN

1. 再次点击 **Add** → **Secret**。
2. Variable name 填 `ADMIN_TOKEN`。
3. Value 填你生成的长随机字符串。

点击 **Save**。

### 6.6（可选）已有预设的默认值

以下变量已有默认值，不需要手动添加：

| 变量名 | 默认值 | 作用 |
|--------|-------|------|
| `CHECKIN_CONCURRENCY` | `2` | 同时签到的最大账号数 |
| `CHECKIN_RETRIES` | `3` | 签到失败后重试次数 |
| `ADMIN_USER` | `admin` | 访问页面的用户名 |

如果你要修改这些值，在 Variables and Secrets 页面添加同名变量即可。

## 第七步：触发首次部署

Cloudflare 变量配好后，再次部署一次让 Worker 读取到新变量：

1. 回到 GitHub 仓库 → **Actions**。
2. 找到 **Deploy GLaDOS Worker**。
3. 点击 **Run workflow** → **Run workflow**。

这次部署后 Worker 才能正确读取刚配置的 `GLADOS_ACCOUNTS` 和 `ADMIN_TOKEN`。

## 第八步：验证部署结果

### 8.1 查看 Worker URL

1. Cloudflare Dashboard → **Workers & Pages**。
2. 点击 `glados-workers`。
3. 在页面顶部能看到你的 Worker URL，格式：`https://glados-workers.<你的子域>.workers.dev`。

### 8.2 测试健康检查

在浏览器里打开：

```text
https://你的Worker域名/health
```

应返回：

```json
{ "ok": true, "service": "glados-workers" }
```

### 8.3 测试签到

在浏览器打开 Worker 首页（即 Worker URL 根路径 `/`），会弹出 Basic Auth 登录框：

- 用户名填 `admin`（或你自定义的 `ADMIN_USER`）
- 密码填你设置的 `ADMIN_TOKEN`

登录后你会看到一个操作面板，点击 **测试签到、Cookie 和通知** 即可手动触发一次签到测试。执行结果会以摘要卡片形式显示在右侧面板中：

| 指标 | 含义 |
|------|------|
| 账号总数 | 已配置的账号数 |
| 成功账号 | 签到成功或已签到 |
| 失败账号 | 签到失败（网络错误等） |
| 失效账号 | Cookie 失效需更新 |

### 8.4 确认定时任务已生效

定时任务由 Cloudflare Cron 驱动，默认每天 UTC 00:00 执行。部署后第二天就可以在 `/log` 页面看到自动签到记录。

在 Worker 首页点击 **查看日志**，即可看到 D1 中记录的签到历史，包含日期时间、账号、状态、获得 Point、剩余天数等信息。支持按年份和月份筛选。

## （可选）配置通知

签到结果可以推送到钉钉、Telegram 或飞书。**不配也能用**，只是不会收到通知。

### 钉钉

1. 在钉钉中创建群聊机器人（群设置 → 智能群助手 → 添加机器人 → 自定义）。
2. 安全设置选择 **加签**，复制生成的 `SEC` 开头的密钥。
3. 复制 Webhook 地址中的 `access_token` 参数值。

在 Cloudflare Worker 的 Variables and Secrets 中添加：

| 变量名 | 值 |
|--------|---|
| `DINGTALK_WEBHOOK` | `https://oapi.dingtalk.com/robot/send?access_token=你的token` |
| `DINGTALK_SECRET` | 加签密钥（`SEC...`） |

### Telegram

1. 在 Telegram 中搜索 `@BotFather`，发送 `/newbot` 创建一个 Bot，获取 `token`。
2. 搜索 `@userinfobot`，发送任意消息获取你的 `chat_id`。

| 变量名 | 值 |
|--------|---|
| `TELEGRAM_BOT_TOKEN` | `123456789:你的BotToken` |
| `TELEGRAM_CHAT_ID` | 你的 Chat ID（纯数字） |

### 飞书

1. 在飞书群聊中，群设置 → 群机器人 → 添加机器人 → 自定义机器人。
2. 安全设置选择 **签名校验**，复制生成的密钥。
3. 复制 Webhook 地址。

| 变量名 | 值 |
|--------|---|
| `FEISHU_WEBHOOK` | `https://open.feishu.cn/open-apis/bot/v2/hook/你的HookID` |
| `FEISHU_SECRET` | 签名校验密钥 |

配置完成后，在 Worker 首页点击 **测试签到、Cookie 和通知**，结果面板下方会显示通知发送结果：成功会显示绿色，失败会显示红色并附带错误信息。

### 变量速查总表

所有可配置的运行时变量：

| 变量名 | 必填 | 默认值 | 类型 | 说明 |
|--------|:--:|--------|:----:|------|
| `GLADOS_ACCOUNTS` | 是 | - | Secret | 账号 Cookie JSON 数组 |
| `ADMIN_TOKEN` | 是 | - | Secret | 页面/API 访问密码 |
| `ADMIN_USER` | - | `admin` | Plain | 页面/API 访问用户名 |
| `CHECKIN_CONCURRENCY` | - | `2` | Plain | 并发签到数 |
| `CHECKIN_RETRIES` | - | `3` | Plain | 签到失败重试次数 |
| `NOTIFY_ON_STATUS_ONLY` | - | `false` | Plain | `/status` 接口是否发通知 |
| `DINGTALK_WEBHOOK` | - | - | Secret | 钉钉 Webhook |
| `DINGTALK_SECRET` | - | - | Secret | 钉钉加签密钥 |
| `TELEGRAM_BOT_TOKEN` | - | - | Secret | Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | - | - | Secret | Telegram Chat ID |
| `FEISHU_WEBHOOK` | - | - | Secret | 飞书 Webhook |
| `FEISHU_SECRET` | - | - | Secret | 飞书签名密钥 |

## （可选）本地开发

如果你想在本地调试 Worker：

```bash
# 克隆你的 Fork 仓库
git clone https://github.com/<你的用户名>/GlaDos_Workers_CheckIN.git
cd GlaDos_Workers_CheckIN

# 安装依赖
npm install

# 复制环境变量模板
cp .dev.vars.example .dev.vars

# 编辑 .dev.vars 填入真实值
# 然后启动本地 Worker
npm run dev
```

本地 Worker 在 `http://127.0.0.1:8787` 运行。

## HTTP 端点说明

所有端点（除 `/health`）都需要认证：

| 端点 | 方法 | 认证 | 说明 |
|------|------|:--:|------|
| `/` | GET | Basic Auth | 操作面板页面 |
| `/health` | GET | - | 健康检查，公开访问 |
| `/status` | GET | Basic/Bearer | 查询账号状态和剩余天数 |
| `/test` | POST | Basic/Bearer | 测试签到+Cookie+通知全流程 |
| `/checkin` | POST | Basic/Bearer | 仅签到，不发通知。加 `?notify=true` 则发送 |
| `/run` | POST | Basic/Bearer | 签到并发送通知 |
| `/log` | GET | Basic/Bearer | 查看签到日志，支持 `?year=2026&month=05` 筛选 |

**认证方式**：

```bash
# Basic Auth
curl -u "admin:你的ADMIN_TOKEN" https://你的域名/status

# Bearer Token
curl -H "Authorization: Bearer 你的ADMIN_TOKEN" https://你的域名/status
```

如果未配置 `ADMIN_TOKEN`，除 `/health` 外的受保护端点均返回 `404`。

## 排障指南

### Q: 部署失败：`CLOUDFLARE_API_TOKEN` 相关错误

**原因**：GitHub Secret 的 Token 权限不足或 Token 错误。

**检查步骤**：
1. 确认 Token 是否完整复制（以 `cfut_` 开头）。
2. 确认 Token 是否包含三行权限：`Workers Scripts:Edit`、`D1:Edit`、`Account Settings:Read`。
3. 确认 Cloudflare API Token 管理页该 Token 的 **Status** 为 `Active`。

### Q: Worker 部署了但访问 404

**原因**：首次部署后 Worker 需要生效，另有可能 Worker 因变量缺失启动后报错。

**检查步骤**：
1. 确认 Sixth 步的 `GLADOS_ACCOUNTS` 和 `ADMIN_TOKEN` 已正确配置，且第七步重新部署已完成。
2. 在 Cloudflare Dashboard → Workers & Pages → `glados-workers` → Logs 中查看实时日志。

### Q: `GLADOS_ACCOUNTS is required`

Worker 启动时找不到账号配置。

**检查**：Cloudflare Dashboard → Workers & Pages → `glados-workers` → Settings → Variables and Secrets，确认 `GLADOS_ACCOUNTS` 存在且值不为空。

### Q: `GLADOS_ACCOUNTS must be a JSON array`

账号配置不是合法的 JSON 数组。

**检查**：用 [JSONLint](https://jsonlint.com) 粘贴你的值验证格式。确保最外层是 `[...]`，每个对象内的字段用双引号。

### Q: Cookie 失效

通知或响应显示 Cookie 已失效。

**处理**：重新登录 GLaDOS，按第二步获取新的 Cookie，更新 Cloudflare 里的 `GLADOS_ACCOUNTS`。然后可以手动触发一次 `/test` 验证新 Cookie 是否生效。

### Q: Cookie 不会自动刷新

这是设计如此。Worker 请求不会把服务器返回的 `Set-Cookie` 写回 Cloudflare Secret。Cookie 到期后必须手动更新。通知里的 "Cookie 到期时间：未知" 是正常的。

### Q: 通知发不出去

不影响签到结果。根据错误提示检查：
- 钉钉/飞书 Webhook 地址是否完整（含 `access_token` 或 `hook_id`）。
- 机器人安全设置是否开启了加签/签名校验但未配置对应的 `_SECRET`。
- Telegram Bot Token 和 Chat ID 是否正确。

### Q: 怎么修改签到时间

默认是每天 UTC 00:00（北京时间 08:00）。修改方法：

1. 编辑仓库根目录的 `wrangler.jsonc` 中 `triggers.crons` 字段。
2. Cron 表达式格式为 `分 时 日 月 周`，例如 `0 12 * * *` 表示每天 UTC 12:00。
3. 提交并 push 到 GitHub，自动触发重新部署。

## 安全说明

- **永远不要把真实 Cookie、Webhook、Token 写进源码。** 所有敏感值都通过 Cloudflare Secret 或 GitHub Secret 注入。
- **不要提交 `.dev.vars` 文件。** 本地开发时从 `.dev.vars.example` 复制并填写。
- **日志不记录 Cookie。** D1 数据库中的签到日志只保留账号名称、签到状态、Point、剩余天数。
- **必须设置 `ADMIN_TOKEN`。** 没有它时受保护端点返回 404。`ADMIN_USER` 默认值是 `admin`，可以改。

## 项目结构

```text
GlaDos_Workers_CheckIN/
├── .github/workflows/glados-workers-deploy.yml   # CI/CD：自动测试+部署
├── migrations/0001_create_checkin_logs.sql        # D1 数据库建表语句
├── scripts/                                        # 部署工具脚本
│   ├── d1-config.mjs                               #   D1 配置解析/自动创建
│   ├── prepare-d1.mjs                              #   D1 自动准备（CI 用）
│   └── migrate-d1.mjs                              #   D1 migration 执行
├── src/
│   ├── index.ts                                    # Worker 入口：路由+HTTP处理
│   ├── config.ts                                   # 环境变量解析+配置校验
│   ├── glados.ts                                   # GLaDOS API 调用：签到+状态查询
│   ├── notify/index.ts                             # 通知模块：钉钉/Telegram/飞书
│   ├── storage.ts                                  # D1 日志读写+HTML日志页
│   ├── format.ts                                   # 报告文本格式化
│   └── types.ts                                    # TypeScript 类型定义
├── test/                                           # Vitest 单元测试
├── package.json
├── wrangler.jsonc                                  # Cloudflare Workers 配置
└── tsconfig.json
```
