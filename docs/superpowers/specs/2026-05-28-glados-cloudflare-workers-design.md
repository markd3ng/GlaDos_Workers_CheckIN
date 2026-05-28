# GLaDOS Cloudflare Workers Check-In Design

Date: 2026-05-28
Status: Draft for user review

## Goal

Build a new TypeScript Cloudflare Workers project that replaces the current local Python script and single-file Worker sample with a safer, more maintainable automated GLaDOS check-in service.

The new project should preserve the useful behavior from both existing implementations:

- Python script strengths: multi-account support, retry handling, per-account failure isolation, cookie-expiration detection, DingTalk signed webhook support, clear Chinese summaries.
- Existing Worker strengths: Cloudflare scheduled trigger support, HTTP endpoints, GLaDOS account status lookup, Telegram notification support.

It should also add Feishu webhook notification support and use modern Workers project structure.

Implementation must follow test-driven development:

- Write failing tests before production code for each behavior.
- Run the targeted test and confirm it fails for the expected reason.
- Implement the smallest production change that makes the test pass.
- Run the test again and keep the full suite green before moving on.
- Automated tests must mock external HTTP calls and must not call real GLaDOS, DingTalk, Telegram, or Feishu endpoints.

## Non-Goals

- Do not keep the DockerHub or wetest Worker scripts as part of the new GLaDOS service. They are unrelated examples.
- Do not build a web dashboard in this iteration.
- Do not store cookies in source code or `wrangler.jsonc`.
- Do not use Cloudflare KV, D1, Durable Objects, Queues, or Workflows unless a later requirement needs persistence or long-running orchestration.
- Do not proxy GLaDOS traffic through another service.

Update: D1 is now in scope because `/log` requires persistent check-in history.

## Recommended Approach

Create a fresh TypeScript Wrangler project in the workspace. The current root is not a git repository, while `GlaDos_Workers_CheckIN` is a nested git checkout containing the old Worker sample. The new project should live in a new directory so the old reference code stays intact during migration.

Recommended directory:

```text
glados-workers/
```

Recommended structure:

```text
glados-workers/
  package.json
  tsconfig.json
  wrangler.jsonc
  README.md
  src/
    index.ts
    config.ts
    glados.ts
    format.ts
    types.ts
    notify/
      index.ts
      dingtalk.ts
      telegram.ts
      feishu.ts
```

## Runtime Model

The Worker exposes both HTTP endpoints and a scheduled handler:

- `scheduled`: runs the full check-in flow and sends enabled notifications.
- `GET /`: returns a small service status/help response.
- `POST /run`: runs check-in plus account status lookup and sends notifications.
- `POST /checkin`: runs check-in plus account status lookup without sending notifications unless explicitly requested by query parameter.
- `GET /status`: queries account status only.
- `GET /health`: returns a minimal health response.
- `GET /log`: when manual endpoints are enabled, returns an HTML table of stored successful check-ins with year/month filters and total earned points.

HTTP endpoints should require an optional shared secret if `ADMIN_TOKEN` is configured:

- If `ADMIN_TOKEN` is unset, endpoints are open for convenience.
- If `ADMIN_TOKEN` is set, protected endpoints require `Authorization: Bearer <token>` or `?token=<token>`.
- Secret comparison should avoid plain string equality where practical by using a timing-safe helper based on Web Crypto.

Manual endpoints are disabled by default. `ENABLE_MANUAL_ENDPOINTS=true` and `ADMIN_TOKEN` are required for `/status`, `/checkin`, `/run`, and `/log`. `/health` remains public.

## Configuration

Use Cloudflare Variables and Secrets only. Sensitive values must not be hardcoded.

Required:

- `GLADOS_ACCOUNTS`: JSON string array.

Account format:

```json
[
  {
    "name": "account-1",
    "cookie": "koa:sess=...; koa:sess.sig=..."
  },
  {
    "name": "account-2",
    "cookie": "koa:sess=...; koa:sess.sig=..."
  }
]
```

Accounts are authenticated with cookies only. Email/password login, password storage, captcha handling, and login-flow automation are explicitly out of scope.

Optional:

- `ADMIN_TOKEN`: protects manual HTTP endpoints.
- `CHECKIN_CONCURRENCY`: max concurrent GLaDOS account operations. Default `2`.
- `CHECKIN_RETRIES`: retry count for transient network/server failures. Default `3`.
- `NOTIFY_ON_STATUS_ONLY`: if `true`, status-only runs can notify. Default `false`.
- `ENABLE_MANUAL_ENDPOINTS`: if `true`, enables protected manual endpoints. Default `false`.

Notification settings:

- `DINGTALK_WEBHOOK`
- `DINGTALK_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `FEISHU_WEBHOOK`
- `FEISHU_SECRET`

Persistence:

- `CHECKIN_DB`: Cloudflare D1 binding for check-in history.
- Migration creates `checkin_logs` with account name, check time, status, message, points, remaining days, and trigger.

Any notification channel with enough configuration should be enabled. Missing or incomplete channels should be skipped without failing the check-in run.

## GLaDOS API Behavior

Check-in request:

- Method: `POST`
- URL: `https://glados.rocks/api/user/checkin`
- Body: `{ "token": "glados.one" }`
- Headers: include `Cookie`, fixed desktop Chrome-style `User-Agent`, `Origin`, `Referer`, `Accept`, `Accept-Language`, and JSON content type.

Status request:

- Method: `GET`
- URL: `https://glados.rocks/api/user/status`
- Headers: include `Cookie` and the same browser-like request headers.

The implementation should keep the endpoint constants centralized in `glados.ts` so a future domain change is easy to update.

The implementation must not keep the old Worker sample's hardcoded fake `Authorization` header.

## Result Classification

Each account run should return a structured result instead of formatted text:

```ts
type CheckinStatus = "success" | "already_checked_in" | "expired" | "failed";

type AccountRunResult = {
  accountName: string;
  checkin: {
    status: CheckinStatus;
    message: string;
    httpStatus?: number;
  };
  accountStatus?: {
    leftDays?: string;
    message?: string;
  };
};
```

Classification rules:

- HTTP `401` or `403` means `expired`.
- Business messages containing login or unauthorized indicators mean `expired`.
- GLaDOS success code or messages like `Checkin! Got ... Points` mean `success`.
- Repeat/tomorrow messages mean `already_checked_in`, which counts as a successful daily outcome.
- Network timeout, malformed response, HTTP `5xx`, or unknown business response means `failed`.

The final summary should count:

- successful or already checked-in accounts
- failed accounts
- expired-cookie accounts

## Concurrency and Retry

Use bounded concurrency for account operations. Default concurrency is `2`, matching the conservative behavior of the Python script.

Retry only transient failures:

- network errors
- timeouts
- HTTP `429`
- HTTP `5xx`

Do not retry:

- expired cookies
- HTTP `400`, `401`, `403`
- known business-level repeat-check-in messages

Backoff should be simple and Workers-friendly:

- attempt 1: immediate
- attempt 2: wait about 2 seconds
- attempt 3: wait about 4 seconds

Avoid long random delays in Workers because scheduled invocations have execution limits and many users will configure a small number of accounts. A tiny per-account jitter is acceptable but not required.

## Notification Design

All notification channels receive the same normalized run summary.

Formatter responsibilities:

- Produce one concise Chinese plain-text summary.
- Produce a channel-specific body when needed:
  - DingTalk Markdown
  - Feishu text or post message
  - Telegram HTML or MarkdownV2-safe text
- Include run time in Asia/Shanghai.
- Include per-account result lines.
- Include remaining days when available.
- Avoid leaking full cookies or sensitive headers.

DingTalk:

- Send Markdown message.
- If `DINGTALK_SECRET` is set, append timestamp and HMAC-SHA256 signature to the webhook URL.

Telegram:

- Send `sendMessage`.
- Use configured `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- Escape content for the selected parse mode, or use plain text to avoid parse errors.

Feishu:

- Send webhook message.
- If `FEISHU_SECRET` is set, include Feishu timestamp/sign payload.
- Prefer a simple text message first; rich card support can be added later.

Notification failure handling:

- A failed notification must not change the check-in result.
- The HTTP response should include notification success/failure details.
- The scheduled handler should log notification failures.

## Cloudflare Workers Practices

The implementation should follow current Workers best practices:

- Use `wrangler.jsonc`.
- Set a current `compatibility_date`.
- Enable `nodejs_compat` only if dependencies require it. The initial implementation should avoid Node-only dependencies and use Web APIs.
- Generate Worker types with `wrangler types` after config is in place.
- Do not use global mutable request state.
- Do not store secrets in source or config.
- Use `ctx.waitUntil()` only for non-critical background work. The scheduled handler should await the main check-in and notification flow so logs reflect completion.
- Use structured logs with account names and statuses, never cookies.
- Keep every promise awaited, returned, or intentionally passed to `ctx.waitUntil()`.

## Error Handling

Configuration errors:

- Missing `GLADOS_ACCOUNTS`: HTTP endpoints return a clear `500` JSON error; scheduled handler logs the error and exits.
- Malformed `GLADOS_ACCOUNTS`: same as missing configuration.
- Empty accounts array: return a clear error.

Per-account errors:

- One account failure should not stop other accounts.
- Include a short safe error message in the result.

HTTP endpoint errors:

- Unauthorized manual request returns `401`.
- Unknown route returns `404` JSON.
- Unexpected top-level errors return `500` JSON.

## API Responses

Manual endpoints should return JSON.

Example `/run` response:

```json
{
  "ok": true,
  "trigger": "manual",
  "startedAt": "2026-05-28T08:00:00.000Z",
  "summary": {
    "total": 2,
    "ok": 2,
    "failed": 0,
    "expired": 0
  },
  "results": [
    {
      "accountName": "account-1",
      "checkin": {
        "status": "success",
        "message": "Checkin! Got 1 Points"
      },
      "accountStatus": {
        "leftDays": "123.45"
      }
    }
  ],
  "notifications": [
    {
      "channel": "dingtalk",
      "ok": true
    }
  ]
}
```

## README Requirements

The new README should include:

- What the project does.
- How it improves on the old Python and Worker versions.
- Local install commands.
- Wrangler deploy commands.
- Secret/variable setup examples.
- Cron trigger configuration.
- Manual endpoint usage examples.
- How to obtain a GLaDOS cookie.
- Security notes about cookie handling.
- Troubleshooting for expired cookies, notification failures, malformed JSON, and missing permissions.
- Clear usage examples for local development, Cloudflare Dashboard configuration, Wrangler CLI configuration, manual endpoint calls, and cron deployment.
- A direct statement that only Cookie-based authentication is supported.
- Copyable examples that use placeholders only, never real cookies, webhooks, or tokens.
- GitHub Actions deployment instructions.
- Minimum Cloudflare API token permissions for deployment: `Account / Workers Scripts / Edit` and `Account / D1 / Edit`, with `Account / Account Settings / Read` only if the account requires it.
- D1 creation, `database_id` replacement, migration, and `/log` usage.

## Verification Plan

Before considering implementation complete:

- Run TypeScript type-check.
- Run Wrangler config/type generation if dependencies are available.
- Add focused tests for:
  - account config parsing
  - result classification
  - notification channel enablement
  - DingTalk signing
  - Feishu signing
  - Telegram message formatting/escaping
- Run a local Wrangler dev smoke test if possible.
- Do not call the real GLaDOS API in automated tests. Mock fetch responses.
- Verify D1 log storage, `/log` HTML rendering, year/month filtering, and total points calculation.

## Open Decisions

The following defaults are proposed and can be changed before implementation:

- New project directory: `glados-workers/`
- Cron schedule: daily at `0 0 * * *` UTC, equivalent to 08:00 Asia/Shanghai.
- Manual endpoint protection: optional `ADMIN_TOKEN`; open if unset.
- Telegram message format: plain text first to avoid parse-mode escaping bugs.
- Feishu format: simple text first, signed webhook supported.
- Manual endpoints: disabled by default; enable only with `ENABLE_MANUAL_ENDPOINTS=true` and `ADMIN_TOKEN`.
- Logs: successful or already-checked-in outcomes are stored in D1, and `/log` displays an HTML table with optional `year` and `month` query parameters.
- Deployment: GitHub Actions runs tests, type-check, Wrangler type generation, D1 migrations, then Worker deploy.

## Acceptance Criteria

- A new TypeScript Wrangler project exists under `glados-workers/`.
- The project can run scheduled check-in and manual HTTP-triggered check-in.
- Multiple GLaDOS accounts are supported from `GLADOS_ACCOUNTS`.
- Check-in and account-status lookup results are classified consistently.
- DingTalk, Telegram, and Feishu notifications are supported independently.
- Missing notification configuration does not fail check-in.
- Cookies and webhook secrets are never committed in source/config.
- The implementation avoids global mutable request state.
- The README is sufficient for deployment by copying commands and environment examples.
- GitHub Actions workflow deploys from the repository root while using `glados-workers/` as the working directory.
- `/log` supports cumulative successful check-in history and total points by all time, year, or month.
