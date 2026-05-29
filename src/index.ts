import { parseConfig } from "./config";
import { runAccounts, summarizeResults } from "./glados";
import { sendEnabledNotifications } from "./notify";
import { buildLogHtml, listCheckinLogs, recordSuccessfulCheckins } from "./storage";
import type { EnvLike, RunReport } from "./types";

type ExecutionContextLike = {
  waitUntil?: (promise: Promise<unknown>) => void;
  passThroughOnException?: () => void;
  props?: Record<string, unknown>;
};

const worker = {
  async fetch(request: Request, env: EnvLike): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return json({ ok: false, error: safeError(error) }, 500);
    }
  },

  async scheduled(_controller: unknown, env: EnvLike, _ctx: ExecutionContextLike): Promise<void> {
    try {
      await executeRun(env, "scheduled", true);
    } catch (error) {
      console.error(JSON.stringify({ event: "scheduled_failed", error: safeError(error) }));
    }
  }
};

export default worker;

async function handleRequest(request: Request, env: EnvLike): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "glados-workers" });
  }

  if (request.method === "GET" && url.pathname === "/") {
    const auth = await requireAdmin(request, env);
    if (auth) {
      return auth;
    }
    return html(renderIndexPage());
  }

  if (!["/status", "/checkin", "/test", "/run", "/log"].includes(url.pathname)) {
    return json({ ok: false, error: "Not found" }, 404);
  }

  const auth = await requireAdmin(request, env);
  if (auth) {
    return auth;
  }

  if (url.pathname === "/log" && request.method === "GET") {
    if (!env.CHECKIN_DB) {
      return json({ ok: false, error: "CHECKIN_DB binding is required" }, 500);
    }
    const logs = await listCheckinLogs(env.CHECKIN_DB, {
      year: url.searchParams.get("year"),
      month: url.searchParams.get("month")
    });
    return html(buildLogHtml(logs));
  }

  if (url.pathname === "/status" && request.method === "GET") {
    return json(await executeRun(env, "manual", getEnvString(env, "NOTIFY_ON_STATUS_ONLY")?.toLowerCase() === "true", true));
  }

  if (url.pathname === "/checkin" && request.method === "POST") {
    const shouldNotify = url.searchParams.get("notify") === "true";
    return json(await executeRun(env, "manual", shouldNotify));
  }

  if (url.pathname === "/test" && request.method === "POST") {
    return json(await executeRun(env, "manual", true));
  }

  if (url.pathname === "/run" && request.method === "POST") {
    return json(await executeRun(env, "manual", true));
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}

async function executeRun(
  env: EnvLike,
  trigger: RunReport["trigger"],
  notify: boolean,
  statusOnly = false
): Promise<RunReport> {
  const config = parseConfig(env);
  const results = statusOnly
    ? await runAccounts(config.accounts, {
        concurrency: config.checkinConcurrency,
        retries: config.checkinRetries,
        fetcher: statusOnlyFetcher,
        sleep: async () => undefined
      })
    : await runAccounts(config.accounts, {
        concurrency: config.checkinConcurrency,
        retries: config.checkinRetries
      });

  const report: RunReport = {
    ok: results.every((result) => result.checkin.status !== "failed" && result.checkin.status !== "expired"),
    trigger,
    startedAt: new Date().toISOString(),
    summary: summarizeResults(results),
    results,
    notifications: [],
    notificationSummary: {
      configured: config.notifications.length,
      attempted: 0,
      succeeded: 0,
      failed: 0
    }
  };

  await recordSuccessfulCheckins(env.CHECKIN_DB, results, trigger, report.startedAt);

  if (notify) {
    report.notifications = await sendEnabledNotifications(report, { channels: config.notifications });
    report.notificationSummary = summarizeNotifications(config.notifications.length, report.notifications);
  }

  console.log(
    JSON.stringify({
      event: "glados_run_completed",
      trigger,
      summary: report.summary,
      notifications: report.notifications
    })
  );

  return report;
}

function summarizeNotifications(configured: number, notifications: RunReport["notifications"]): RunReport["notificationSummary"] {
  return {
    configured,
    attempted: notifications.length,
    succeeded: notifications.filter((notification) => notification.ok).length,
    failed: notifications.filter((notification) => !notification.ok).length
  };
}

async function statusOnlyFetcher(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof input === "string" && input.endsWith("/api/user/checkin")) {
    return new Response(JSON.stringify({ code: 0, message: "Status only" }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  return fetch(input, init);
}

async function requireAdmin(request: Request, env: EnvLike): Promise<Response | undefined> {
  const expectedUser = getEnvString(env, "ADMIN_USER")?.trim() || "admin";
  const expectedToken = getEnvString(env, "ADMIN_TOKEN")?.trim();
  if (!expectedToken) {
    return json({ ok: false, error: "ADMIN_TOKEN is required" }, 404);
  }

  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Basic ")) {
    const credentials = parseBasicCredentials(authorization);
    if (
      credentials &&
      (await timingSafeEqual(credentials.username, expectedUser)) &&
      (await timingSafeEqual(credentials.password, expectedToken))
    ) {
      return undefined;
    }
  }

  if (authorization?.startsWith("Bearer ")) {
    const provided = authorization.slice("Bearer ".length);
    if (await timingSafeEqual(provided, expectedToken)) {
      return undefined;
    }
  }

  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="GLaDOS Workers Check-In", charset="UTF-8"',
      "Content-Type": "text/plain;charset=UTF-8"
    }
  });
}

function parseBasicCredentials(authorization: string): { username: string; password: string } | undefined {
  try {
    const decoded = atob(authorization.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator < 0) {
      return undefined;
    }
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return undefined;
  }
}

function getEnvString(env: EnvLike, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" ? value : undefined;
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const leftDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(left)));
  const rightDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(right)));
  let diff = left.length === right.length ? 0 : 1;
  for (let index = 0; index < leftDigest.length; index += 1) {
    diff |= (leftDigest[index] ?? 0) ^ (rightDigest[index] ?? 0);
  }
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json;charset=UTF-8" }
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html;charset=UTF-8" }
  });
}

function renderIndexPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GLaDOS Workers Check-In</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;color:#172033;background:#f4f6fa}
main{max-width:1760px;margin:0 auto;padding:28px 18px 44px}
h1{font-size:26px;margin:0 0 10px}
h2{font-size:18px;margin:0 0 14px}
p{line-height:1.65;margin:0;color:#40506a}
.panel{background:#fff;border:1px solid #dce3ef;border-radius:8px;padding:18px;box-shadow:0 10px 28px rgba(26,39,68,.07)}
.hero{margin-bottom:18px}
.workspace{display:grid;grid-template-columns:minmax(240px,320px) minmax(0,1fr);gap:18px;margin-bottom:18px}
.actions{display:grid;gap:10px}
button{width:100%;border:1px solid #cfd8e6;background:#f8fafc;color:#172033;border-radius:7px;padding:11px 12px;text-align:left;font-weight:650;cursor:pointer;transition:background .15s,border-color .15s,transform .15s}
button:hover{background:#eef4ff;border-color:#9db6da}
button:active{transform:translateY(1px)}
button[disabled]{cursor:wait;opacity:.66}
.endpoint-link{display:inline;width:auto;border:0;background:transparent;border-radius:0;padding:0;color:#5b21b6;text-decoration:underline;text-align:left;font:inherit;font-weight:700}
.endpoint-link:hover{background:transparent;border-color:transparent;color:#3b0764}
.endpoint-link:active{transform:none}
.result-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.result-title{font-weight:700}
.badge{display:inline-flex;align-items:center;min-height:26px;border-radius:999px;background:#edf1f7;color:#40506a;padding:3px 10px;font-size:13px}
#result-body{min-height:520px;border:1px solid #dce3ef;border-radius:7px;background:#0f172a;color:#dbeafe;overflow:auto}
.placeholder{display:grid;place-items:center;min-height:520px;color:#71809a;background:#f8fafc}
.result-view{background:#fff;color:#172033;min-height:520px;padding:14px}
.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}
.metric{border:1px solid #dce3ef;border-radius:7px;padding:10px;background:#f8fafc}
.metric-label{font-size:12px;color:#66758f;margin-bottom:5px}
.metric-value{font-size:20px;font-weight:760}
.section-title{font-size:15px;font-weight:760;margin:14px 0 8px}
.exchange-panel{border:1px solid #dce3ef;border-radius:8px;margin:0 0 14px;background:#f8fafc;overflow:hidden}
.exchange-head{font-size:15px;font-weight:760;padding:12px 14px;border-bottom:1px solid #dce3ef}
.exchange-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:14px}
.exchange-card{border:1px solid #dce3ef;border-radius:7px;background:#fff;padding:16px;text-align:center}
.exchange-title{font-weight:760;margin-bottom:4px}
.exchange-rate{font-size:12px;color:#66758f;margin-bottom:18px}
.exchange-need{font-weight:700;color:#66758f}
.mini-table{border-radius:7px;margin:0 0 12px;font-size:13px;table-layout:fixed}
.mini-table th,.mini-table td{padding:9px 10px}
.account-cell{width:260px;word-break:break-word}
.status-cell{width:96px;white-space:nowrap}
.http-cell,.days-cell{width:76px;white-space:nowrap}
.points-cell,.earned-cell{width:92px;white-space:nowrap}
.message-cell{min-width:320px;line-height:1.45}
.channel-cell{width:160px}
.notify-status-cell{width:120px;white-space:nowrap}
.status-pill{display:inline-flex;border-radius:999px;padding:2px 8px;font-weight:700;font-size:12px;background:#edf1f7;color:#40506a}
.status-ok{background:#dcfce7;color:#166534}
.status-warn{background:#fef3c7;color:#92400e}
.status-bad{background:#fee2e2;color:#991b1b}
.muted{color:#66758f}
pre{margin:0;padding:14px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.55}
iframe{display:block;width:100%;min-height:520px;border:0;background:#fff}
table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;margin-top:0;overflow:hidden;border:1px solid #d8deea;border-radius:8px}
th,td{border-bottom:1px solid #d8deea;padding:11px 12px;text-align:left;vertical-align:top}
tr:last-child td{border-bottom:0}
th{background:#eef2f8}
code{background:#edf1f7;padding:2px 5px;border-radius:4px}
@media (max-width:900px){.workspace{grid-template-columns:1fr}main{padding:18px 12px 32px}table{font-size:14px}.metric-grid,.exchange-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.mini-table{table-layout:auto}.account-cell,.status-cell,.http-cell,.days-cell,.points-cell,.earned-cell,.message-cell,.channel-cell,.notify-status-cell{width:auto;min-width:0;white-space:normal}}
</style>
</head>
<body>
<main>
<section class="panel hero">
  <h1>GLaDOS Workers Check-In</h1>
  <p>定时签到由 Cloudflare Cron 自动执行。页面和手动端点使用 Basic Auth 保护；用户名来自 <code>ADMIN_USER</code>，密码来自 <code>ADMIN_TOKEN</code>。</p>
</section>
<section class="workspace">
  <div class="panel">
    <h2>操作</h2>
    <div class="actions">
      <button type="button" data-method="GET" data-action="/status">查询状态</button>
      <button type="button" data-method="POST" data-action="/test">测试签到、Cookie 和通知</button>
      <button type="button" data-method="POST" data-action="/checkin">手动签到，不通知</button>
      <button type="button" data-method="POST" data-action="/run">手动签到并通知</button>
      <button type="button" data-method="GET" data-action="/log">查看日志</button>
    </div>
  </div>
  <div class="panel">
    <div class="result-head">
      <div class="result-title">执行结果</div>
      <div class="badge" id="result-status">等待操作</div>
    </div>
    <div id="result-body"><div class="placeholder">点击左侧操作后，结果会显示在这里。</div></div>
  </div>
</section>
<table>
<thead><tr><th>端点</th><th>作用</th><th>调用方式</th></tr></thead>
<tbody>
<tr><td><button type="button" class="endpoint-link" data-method="GET" data-action="/health">/health</button></td><td>健康检查。</td><td><code>GET /health</code></td></tr>
<tr><td><button type="button" class="endpoint-link" data-method="GET" data-action="/status">/status</button></td><td>只查询账号状态，用来检查 Cookie 当前是否有效和剩余天数。</td><td><code>GET /status</code></td></tr>
<tr><td><button type="button" class="endpoint-link" data-method="POST" data-action="/test">/test</button></td><td>一次性测试签到、Cookie 有效性、通知渠道数量和推送效果。</td><td><code>POST /test</code></td></tr>
<tr><td><button type="button" class="endpoint-link" data-method="POST" data-action="/checkin">/checkin</button></td><td>手动触发一次签到，不发送通知，除非加 <code>?notify=true</code>。</td><td><code>POST /checkin</code></td></tr>
<tr><td><button type="button" class="endpoint-link" data-method="POST" data-action="/run">/run</button></td><td>手动执行完整签到并发送已启用的通知。</td><td><code>POST /run</code></td></tr>
<tr><td><button type="button" class="endpoint-link" data-method="GET" data-action="/log">/log</button></td><td>查看 D1 签到日志。支持 <code>year</code> 和 <code>month</code> 筛选。</td><td><code>GET /log?year=2026&amp;month=05</code></td></tr>
</tbody>
</table>
</main>
<script>
const resultStatus = document.getElementById('result-status');
const resultBody = document.getElementById('result-body');
const buttons = Array.from(document.querySelectorAll('button[data-action]'));

function setBusy(button) {
  buttons.forEach((item) => {
    item.disabled = true;
  });
  resultStatus.textContent = button.textContent + '...';
  resultBody.innerHTML = '<div class="placeholder">正在执行，请稍候。</div>';
}

function setReady(label) {
  buttons.forEach((item) => {
    item.disabled = false;
  });
  resultStatus.textContent = label;
}

function renderText(text, isError) {
  resultBody.innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = text;
  if (isError) {
    pre.style.color = '#fecaca';
  }
  resultBody.appendChild(pre);
}

function renderHtml(html) {
  resultBody.innerHTML = '';
  const frame = document.createElement('iframe');
  frame.setAttribute('title', '签到日志');
  frame.srcdoc = html;
  resultBody.appendChild(frame);
}

function createEl(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = String(text);
  }
  return element;
}

function appendMetric(container, label, value) {
  const metric = createEl('div', 'metric');
  metric.appendChild(createEl('div', 'metric-label', label));
  metric.appendChild(createEl('div', 'metric-value', value ?? '-'));
  container.appendChild(metric);
}

function renderExchangePlans(results) {
  const plans = results.flatMap((item) => item.accountStatus?.exchangePlans || []);
  if (plans.length === 0) {
    return undefined;
  }
  const panel = createEl('div', 'exchange-panel');
  panel.appendChild(createEl('div', 'exchange-head', 'Exchange Points'));
  const grid = createEl('div', 'exchange-grid');
  plans.slice(0, 3).forEach((plan) => {
    const card = createEl('div', 'exchange-card');
    card.appendChild(createEl('div', 'exchange-title', plan.points + ' -> ' + plan.days + ' Days'));
    card.appendChild(createEl('div', 'exchange-rate', plan.pointsPerDay + ' points/day'));
    card.appendChild(createEl('div', 'exchange-need', plan.needMore > 0 ? 'Need ' + plan.needMore + ' more' : 'Available'));
    grid.appendChild(card);
  });
  panel.appendChild(grid);
  return panel;
}

function statusLabel(status) {
  const labels = {
    success: '成功',
    already_checked_in: '已签到',
    expired: 'Cookie 失效',
    failed: '失败'
  };
  return labels[status] || status || '-';
}

function statusClass(status) {
  if (status === 'success') return 'status-pill status-ok';
  if (status === 'already_checked_in') return 'status-pill status-warn';
  if (status === 'expired' || status === 'failed') return 'status-pill status-bad';
  return 'status-pill';
}

function formatSignedPoints(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '+0';
  }
  return '+' + (Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(8).replace(/\\.?0+$/, ''));
}

function buildTable(headers, rows, classes) {
  const table = createEl('table', 'mini-table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headers.forEach((header, index) => headerRow.appendChild(createEl('th', classes?.[index] || '', header)));
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    row.forEach((cell, index) => {
      const td = document.createElement('td');
      if (classes?.[index]) {
        td.className = classes[index];
      }
      if (cell instanceof Node) {
        td.appendChild(cell);
      } else {
        td.textContent = String(cell ?? '-');
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderRunReport(report) {
  if (!report || typeof report !== 'object' || !report.summary || !Array.isArray(report.results)) {
    renderText(JSON.stringify(report, null, 2), false);
    return;
  }

  resultBody.innerHTML = '';
  const view = createEl('div', 'result-view');
  const metrics = createEl('div', 'metric-grid');
  appendMetric(metrics, '账号总数', report.summary.total);
  appendMetric(metrics, '成功账号', report.summary.ok);
  appendMetric(metrics, '失败账号', report.summary.failed);
  appendMetric(metrics, '失效账号', report.summary.expired);
  view.appendChild(metrics);

  view.appendChild(createEl('div', 'section-title', '账号结果'));
  const exchangePlans = renderExchangePlans(report.results);
  if (exchangePlans) {
    view.appendChild(exchangePlans);
  }
  view.appendChild(
    buildTable(
      ['账号', '签到状态', 'HTTP', '剩余天数', '账号 Points', '签到收益', '消息'],
      report.results.map((item) => [
        item.accountName,
        createEl('span', statusClass(item.checkin?.status), statusLabel(item.checkin?.status)),
        item.checkin?.httpStatus,
        item.accountStatus?.leftDays,
        item.accountStatus?.points,
        formatSignedPoints(item.checkin?.earnedPoints),
        item.checkin?.message
      ]),
      ['account-cell', 'status-cell', 'http-cell', 'days-cell', 'points-cell', 'earned-cell', 'message-cell']
    )
  );

  const notificationSummary = report.notificationSummary || {};
  view.appendChild(createEl('div', 'section-title', '通知结果'));
  const notifyMetrics = createEl('div', 'metric-grid');
  appendMetric(notifyMetrics, '已配置', notificationSummary.configured ?? 0);
  appendMetric(notifyMetrics, '已尝试', notificationSummary.attempted ?? 0);
  appendMetric(notifyMetrics, '成功', notificationSummary.succeeded ?? 0);
  appendMetric(notifyMetrics, '失败', notificationSummary.failed ?? 0);
  view.appendChild(notifyMetrics);

  const notifications = Array.isArray(report.notifications) ? report.notifications : [];
  if (notifications.length > 0) {
    view.appendChild(
      buildTable(
        ['渠道', '状态', '错误'],
        notifications.map((item) => [
          item.channel,
          createEl('span', item.ok ? 'status-pill status-ok' : 'status-pill status-bad', item.ok ? '成功' : '失败'),
          item.error || '-'
        ]),
        ['channel-cell', 'notify-status-cell', 'message-cell']
      )
    );
  } else {
    view.appendChild(createEl('div', 'muted', '本次没有发送通知。'));
  }

  view.appendChild(createEl('div', 'muted', '触发方式：' + (report.trigger || '-') + ' · 开始时间：' + (report.startedAt || '-')));
  resultBody.appendChild(view);
}

buttons.forEach((button) => {
  button.addEventListener('click', async () => {
    const action = button.dataset.action;
    const method = button.dataset.method || 'GET';
    setBusy(button);
    try {
      const response = await fetch(action, { method, credentials: 'same-origin', headers: { Accept: 'application/json,text/html' } });
      const contentType = response.headers.get('Content-Type') || '';
      if (contentType.includes('text/html')) {
        renderHtml(await response.text());
      } else {
        const data = await response.json();
        if (response.ok) {
          renderRunReport(data);
        } else {
          renderText(JSON.stringify(data, null, 2), true);
        }
      }
      setReady(response.ok ? '完成' : '失败 ' + response.status);
    } catch (error) {
      renderText(error instanceof Error ? error.message : 'Unknown error', true);
      setReady('请求失败');
    }
  });
});
</script>
</body>
</html>`;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : "Unknown error";
}
