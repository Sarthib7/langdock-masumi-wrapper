/**
 * HTML template for the read-only `/admin` dashboard.
 *
 * Server-renders the initial state and includes a small inline script that
 * polls `/admin/api/state` every 5 seconds. The page reuses the colour
 * palette from `loginHtml.ts` so the operator UI feels cohesive.
 */

type AgentView = {
  slug: string;
  name: string;
  description: string;
  agentIdentifier: string;
  apiBaseUrl: string;
  priceAmounts: Array<{ amount: string; unit: string }>;
};

type JobView = {
  id: string;
  agentSlug: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  failedAt: number | null;
  blockchainIdentifier: string;
  error: string | null;
  awaitingInput: boolean;
};

type PaymentHealth = {
  reachable: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  checkedAt: number;
  error: string | null;
};

type AdminState = {
  user: { username: string; displayName: string | null };
  network: string;
  paymentMode: string;
  paymentHealth: PaymentHealth;
  agents: AgentView[];
  jobs: JobView[];
  stats: {
    totalJobs: number;
    awaitingPayment: number;
    awaitingInput: number;
    running: number;
    completed: number;
    failed: number;
  };
  serverTime: number;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderAdminDashboardHtml(state: AdminState): string {
  const initialState = JSON.stringify(state).replace(/</g, "\\u003c");
  const displayName = state.user.displayName || state.user.username;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Operator dashboard — Langdock Masumi</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f4;
      --panel: #ffffff;
      --panel-soft: #f1f3ef;
      --text: #1a1a18;
      --muted: #5b605a;
      --border: #d9ddd5;
      --accent: #0f6a5f;
      --accent-soft: #e4f4f1;
      --accent-text: #ffffff;
      --warning-bg: #fef6e7;
      --warning-text: #92561e;
      --warning-border: #f3d8a8;
      --error-bg: #fef2f2;
      --error-text: #991b1b;
      --error-border: #fecaca;
      --info-bg: #eef2ff;
      --info-text: #3730a3;
      --info-border: #c7d2fe;
      --ok-bg: #ecfdf5;
      --ok-text: #064e3b;
      --ok-border: #a7f3d0;
      --shadow: 0 1px 2px rgba(20, 24, 20, 0.05), 0 4px 18px rgba(20, 24, 20, 0.04);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #131512;
        --panel: #1d1f1b;
        --panel-soft: #252821;
        --text: #eaeae6;
        --muted: #b9bbb3;
        --border: #3a3b35;
        --accent: #38b7a6;
        --accent-soft: #153b35;
        --accent-text: #061f1b;
        --warning-bg: #2a2210;
        --warning-text: #facc6f;
        --warning-border: #5a3f10;
        --error-bg: #2a1010;
        --error-text: #f8a8a8;
        --error-border: #5a1717;
        --info-bg: #14163a;
        --info-text: #a5b4fc;
        --info-border: #3b3d80;
        --ok-bg: #0d2a1f;
        --ok-text: #a7f3d0;
        --ok-border: #145239;
        --shadow: 0 1px 2px rgba(0, 0, 0, 0.28), 0 6px 22px rgba(0, 0, 0, 0.32);
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      min-height: 100dvh;
      background: var(--bg);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      line-height: 1.5;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      backdrop-filter: saturate(180%) blur(10px);
    }
    .topbar-inner {
      display: flex;
      align-items: center;
      gap: 16px;
      max-width: 1280px;
      margin: 0 auto;
      padding: 14px 24px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 750;
      font-size: 15px;
    }
    .brand-icon {
      width: 32px;
      height: 32px;
      background: var(--accent);
      color: var(--accent-text);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 900;
    }
    .brand small {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .nav { display: flex; gap: 6px; margin-left: 12px; }
    .nav a {
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
      padding: 6px 10px;
      border-radius: 6px;
    }
    .nav a.active {
      color: var(--text);
      background: var(--panel-soft);
    }
    .nav a:hover { color: var(--text); text-decoration: none; background: var(--panel-soft); }

    .topbar-right {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 13px;
      color: var(--muted);
    }
    .who { display: flex; flex-direction: column; align-items: flex-end; }
    .who strong { color: var(--text); font-size: 13px; }
    .who span { font-size: 11px; }
    .signout {
      background: none;
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 8px;
      padding: 7px 12px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 650;
      transition: background-color 120ms ease-out, color 120ms ease-out;
    }
    .signout:hover { background: var(--panel-soft); }

    main {
      max-width: 1280px;
      margin: 0 auto;
      padding: 28px 24px 60px;
      display: grid;
      gap: 24px;
    }

    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
    }
    .stat {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px 18px;
      box-shadow: var(--shadow);
    }
    .stat-label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .stat-value {
      font-size: 28px;
      font-weight: 750;
      margin-top: 4px;
      line-height: 1.1;
    }
    .stat-foot {
      color: var(--muted);
      font-size: 12px;
      margin-top: 2px;
    }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin-bottom: 10px;
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .card-hd {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
    }
    .card-hd h2 {
      font-size: 16px;
      font-weight: 700;
    }
    .card-hd .hint { color: var(--muted); font-size: 12px; }

    .grid-2 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 24px;
    }
    @media (max-width: 900px) {
      .grid-2 { grid-template-columns: minmax(0, 1fr); }
    }

    .agent-list { display: grid; gap: 0; }
    .agent-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
      gap: 12px;
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
    }
    .agent-row:last-child { border-bottom: none; }
    .agent-name { font-weight: 700; font-size: 14px; }
    .agent-slug { color: var(--muted); font-size: 12px; margin-top: 1px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .agent-desc { color: var(--muted); font-size: 12.5px; margin-top: 6px; line-height: 1.45; }
    .agent-meta { color: var(--muted); font-size: 11px; margin-top: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
    .agent-price {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      background: var(--panel-soft);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 8px;
      white-space: nowrap;
    }

    table.jobs {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    table.jobs th, table.jobs td {
      padding: 10px 14px;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid var(--border);
    }
    table.jobs th {
      font-size: 11px;
      font-weight: 650;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: var(--panel-soft);
    }
    table.jobs tr:last-child td { border-bottom: none; }
    table.jobs td.mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: var(--muted);
    }
    table.jobs td.id {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty {
      padding: 28px 20px;
      color: var(--muted);
      font-size: 13px;
      text-align: center;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      border: 1px solid var(--border);
      background: var(--panel-soft);
      color: var(--muted);
      white-space: nowrap;
    }
    .badge .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.7;
    }
    .badge.ok { background: var(--ok-bg); color: var(--ok-text); border-color: var(--ok-border); }
    .badge.warn { background: var(--warning-bg); color: var(--warning-text); border-color: var(--warning-border); }
    .badge.err { background: var(--error-bg); color: var(--error-text); border-color: var(--error-border); }
    .badge.info { background: var(--info-bg); color: var(--info-text); border-color: var(--info-border); }

    .health-line {
      padding: 16px 20px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      color: var(--muted);
    }
    .health-line strong { color: var(--text); font-weight: 700; }

    .footer-note {
      color: var(--muted);
      font-size: 11px;
      text-align: center;
      padding-top: 16px;
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <div class="brand-icon" aria-hidden="true">LM</div>
        <div>
          <small>Operator console</small>
          Langdock Masumi
        </div>
      </div>
      <nav class="nav" aria-label="Primary">
        <a href="/admin" class="active">Dashboard</a>
        <a href="/dashboard">Setup</a>
      </nav>
      <div class="topbar-right">
        <div class="who">
          <strong>${esc(displayName)}</strong>
          <span>signed in</span>
        </div>
        <button type="button" class="signout" id="signoutBtn">Sign out</button>
      </div>
    </div>
  </header>

  <main>
    <section aria-labelledby="overviewTitle">
      <h1 id="overviewTitle" class="section-title">Overview</h1>
      <div class="stat-grid" id="statGrid"></div>
    </section>

    <section class="card" aria-labelledby="healthTitle">
      <div class="card-hd">
        <h2 id="healthTitle">Payment service health</h2>
        <span class="hint" id="healthHint">probed every 30s</span>
      </div>
      <div class="health-line" id="healthLine"></div>
    </section>

    <section class="grid-2">
      <section class="card" aria-labelledby="agentsTitle">
        <div class="card-hd">
          <h2 id="agentsTitle">Agents</h2>
          <span class="hint" id="agentsHint"></span>
        </div>
        <div class="agent-list" id="agentList"></div>
      </section>

      <section class="card" aria-labelledby="jobsTitle">
        <div class="card-hd">
          <h2 id="jobsTitle">Recent jobs</h2>
          <span class="hint" id="jobsHint"></span>
        </div>
        <div id="jobsContainer"></div>
      </section>
    </section>

    <p class="footer-note" id="footerNote"></p>
  </main>

  <script>
    (function() {
      var initial = ${initialState};

      function fmtRelative(ts) {
        if (!ts) return '—';
        var diff = Date.now() - ts;
        if (diff < 0) diff = 0;
        var s = Math.floor(diff / 1000);
        if (s < 60) return s + 's ago';
        var m = Math.floor(s / 60);
        if (m < 60) return m + 'm ago';
        var h = Math.floor(m / 60);
        if (h < 24) return h + 'h ago';
        var d = Math.floor(h / 24);
        return d + 'd ago';
      }

      function escText(s) {
        if (s == null) return '';
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function statusBadge(status) {
        var cls = 'badge info';
        if (status === 'completed') cls = 'badge ok';
        else if (status === 'failed' || status === 'refunded') cls = 'badge err';
        else if (status === 'awaiting_input' || status === 'awaiting_payment') cls = 'badge warn';
        else if (status === 'running') cls = 'badge info';
        return '<span class="' + cls + '"><span class="dot" aria-hidden="true"></span>' + escText(status) + '</span>';
      }

      function priceText(amounts) {
        if (!amounts || amounts.length === 0) return '<span class="agent-price">no price</span>';
        return amounts.map(function(p) {
          var unit = p.unit === 'lovelace' ? 'ADA (' + p.amount + ' lovelace)' : escText(p.amount) + ' ' + escText(String(p.unit).slice(0, 14)) + (String(p.unit).length > 14 ? '…' : '');
          return '<span class="agent-price">' + unit + '</span>';
        }).join(' ');
      }

      function renderStats(state) {
        var s = state.stats;
        var net = state.network + ' · ' + state.paymentMode;
        var cards = [
          { label: 'Total jobs', value: s.totalJobs, foot: net },
          { label: 'Awaiting payment', value: s.awaitingPayment, foot: 'on-chain pending' },
          { label: 'Awaiting input', value: s.awaitingInput, foot: 'HITL' },
          { label: 'Running', value: s.running, foot: 'in flight' },
          { label: 'Completed', value: s.completed, foot: 'paid out' },
          { label: 'Failed / refunded', value: s.failed, foot: 'investigate' }
        ];
        document.getElementById('statGrid').innerHTML = cards.map(function(c) {
          return '<div class="stat"><div class="stat-label">' + escText(c.label) + '</div>' +
            '<div class="stat-value">' + escText(String(c.value)) + '</div>' +
            '<div class="stat-foot">' + escText(c.foot) + '</div></div>';
        }).join('');
      }

      function renderHealth(state) {
        var h = state.paymentHealth;
        var badge;
        if (!h.reachable) {
          badge = '<span class="badge err"><span class="dot" aria-hidden="true"></span>unreachable</span>';
        } else if (h.statusCode && h.statusCode >= 500) {
          badge = '<span class="badge err"><span class="dot" aria-hidden="true"></span>HTTP ' + h.statusCode + '</span>';
        } else if (h.statusCode && h.statusCode >= 400) {
          badge = '<span class="badge warn"><span class="dot" aria-hidden="true"></span>HTTP ' + h.statusCode + '</span>';
        } else {
          badge = '<span class="badge ok"><span class="dot" aria-hidden="true"></span>healthy</span>';
        }
        var line = badge;
        if (h.latencyMs != null) {
          line += ' <span><strong>' + h.latencyMs + 'ms</strong> round-trip</span>';
        }
        line += ' <span>last checked <strong>' + fmtRelative(h.checkedAt) + '</strong></span>';
        if (h.error) {
          line += ' <span style="color:var(--error-text)">' + escText(h.error) + '</span>';
        }
        document.getElementById('healthLine').innerHTML = line;
      }

      function renderAgents(state) {
        var html = state.agents.map(function(a) {
          var meta = '';
          if (a.agentIdentifier) {
            meta += '<div class="agent-meta">id: ' + escText(a.agentIdentifier) + '</div>';
          }
          if (a.apiBaseUrl) {
            meta += '<div class="agent-meta">base: ' + escText(a.apiBaseUrl) + '</div>';
          }
          return '<div class="agent-row">' +
            '<div>' +
              '<div class="agent-name">' + escText(a.name) + '</div>' +
              '<div class="agent-slug">/agents/' + escText(a.slug) + '</div>' +
              (a.description ? '<div class="agent-desc">' + escText(a.description) + '</div>' : '') +
              meta +
            '</div>' +
            '<div>' + priceText(a.priceAmounts) + '</div>' +
          '</div>';
        }).join('');
        document.getElementById('agentList').innerHTML = html || '<div class="empty">No agents configured.</div>';
        document.getElementById('agentsHint').textContent = state.agents.length + ' configured';
      }

      function renderJobs(state) {
        if (!state.jobs.length) {
          document.getElementById('jobsContainer').innerHTML = '<div class="empty">No jobs yet. They appear here as soon as a buyer hits /start_job.</div>';
          document.getElementById('jobsHint').textContent = '';
          return;
        }
        var rows = state.jobs.map(function(j) {
          var agent = j.agentSlug ? '<code>/' + escText(j.agentSlug) + '</code>' : '<span style="color:var(--muted)">(legacy)</span>';
          return '<tr>' +
            '<td class="id" title="' + escText(j.id) + '">' + escText(j.id) + '</td>' +
            '<td class="mono">' + agent + '</td>' +
            '<td>' + statusBadge(j.status) + '</td>' +
            '<td class="mono">' + fmtRelative(j.createdAt) + '</td>' +
            '<td class="mono">' + (j.completedAt ? 'done ' + fmtRelative(j.completedAt) : j.failedAt ? 'failed ' + fmtRelative(j.failedAt) : '—') + '</td>' +
          '</tr>';
        }).join('');
        document.getElementById('jobsContainer').innerHTML =
          '<table class="jobs"><thead><tr>' +
            '<th>Job ID</th><th>Agent</th><th>Status</th><th>Started</th><th>Finished</th>' +
          '</tr></thead><tbody>' + rows + '</tbody></table>';
        document.getElementById('jobsHint').textContent = 'showing newest ' + Math.min(state.jobs.length, 50);
      }

      function render(state) {
        renderStats(state);
        renderHealth(state);
        renderAgents(state);
        renderJobs(state);
        document.getElementById('footerNote').textContent =
          'Polling every 5s · Jobs are in-memory and reset on redeploy · ' + state.network + ' · ' + state.paymentMode;
      }

      function refresh() {
        fetch('/admin/api/state', { headers: { accept: 'application/json' } })
          .then(function(r) {
            if (!r.ok) throw new Error('refresh failed (' + r.status + ')');
            return r.json();
          })
          .then(render)
          .catch(function() { /* keep last state */ });
      }

      render(initial);
      setInterval(refresh, 5000);

      document.getElementById('signoutBtn').addEventListener('click', function() {
        fetch('/auth/logout', { method: 'POST' })
          .finally(function() { window.location.href = '/'; });
      });
    })();
  </script>
</body>
</html>`;
}
