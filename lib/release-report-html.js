/**
 * Standalone HTML ticket list for a release report.
 * Grouping: status | project | project-status
 */

const { PHASES, normalizeTicketGroupBy } = require('./release-report');
const { sanitizeFilename } = require('./release-report-pptx');

const GROUP_BY = {
  STATUS: 'status',
  PROJECT: 'project',
  PROJECT_STATUS: 'project-status',
};

const GROUP_LABELS = {
  status: 'by status',
  project: 'by project',
  'project-status': 'by project, then status',
};

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

function formatDate(iso) {
  if (!iso) return '';
  const s = String(iso);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function slug(text) {
  return String(text || 'section')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'section';
}

function phaseIndex(status) {
  const s = String(status || '').trim();
  if (/^on[\s-]*hold/i.test(s)) return PHASES.length;
  const idx = PHASES.findIndex(p => p.re.test(s));
  return idx === -1 ? PHASES.length + 1 : idx;
}

function priorityRank(priority) {
  const s = String(priority || '').toLowerCase();
  if (/blocker|critical|highest/.test(s)) return 0;
  if (/high/.test(s)) return 1;
  if (/medium|major/.test(s)) return 2;
  if (/low|minor|lowest/.test(s)) return 3;
  return 4;
}

function sortTickets(tickets) {
  return tickets.slice().sort((a, b) => {
    const pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr) return pr;
    return String(a.key || '').localeCompare(String(b.key || ''), undefined, { numeric: true });
  });
}

function compareStatus(a, b) {
  const pi = phaseIndex(a) - phaseIndex(b);
  if (pi) return pi;
  return String(a || '').localeCompare(String(b || ''));
}

function groupByLabel(items, keyFn, compareKeys) {
  const map = new Map();
  items.forEach(item => {
    const key = keyFn(item) || 'Unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  const keys = [...map.keys()];
  if (compareKeys) keys.sort(compareKeys);
  return keys.map(key => ({ key, items: map.get(key) }));
}

function collectReleaseTickets(report) {
  const rows = [];
  const seen = new Set();
  (report.projects || []).forEach(p => {
    const lists = p.tickets && p.tickets.length
      ? [p.tickets]
      : [
        p.delivered?.items || [],
        p.remaining?.items || [],
        p.remaining?.highPriority || [],
        p.remaining?.customerCommitments || [],
        p.dropped || [],
        p.highValue || [],
      ];
    lists.forEach(list => {
      (list || []).forEach(t => {
        if (!t || !t.key || seen.has(t.key)) return;
        seen.add(t.key);
        rows.push({
          key: t.key,
          summary: t.summary || '',
          type: t.type || '',
          priority: t.priority || '',
          status: t.status || '',
          phase: t.phase || '',
          assignee: t.assignee || '',
          estimate: t.estimate,
          actual: t.actual,
          delivered: !!t.delivered,
          projectKey: t.projectKey || p.projectKey || '',
          projectName: t.projectName || p.projectName || t.projectKey || p.projectKey || 'Project',
        });
      });
    });
  });
  return rows;
}

function groupReleaseTickets(tickets, groupBy) {
  const mode = normalizeTicketGroupBy(groupBy);
  if (mode === GROUP_BY.STATUS) {
    return groupByLabel(tickets, t => t.status || 'No status', compareStatus).map(g => ({
      id: 'status-' + slug(g.key),
      title: g.key,
      count: g.items.length,
      tickets: sortTickets(g.items),
    }));
  }
  if (mode === GROUP_BY.PROJECT) {
    return groupByLabel(tickets, t => t.projectName || t.projectKey || 'Project', null).map(g => ({
      id: 'project-' + slug(g.key),
      title: g.key,
      count: g.items.length,
      tickets: sortTickets(g.items),
    }));
  }
  return groupByLabel(tickets, t => t.projectName || t.projectKey || 'Project', null).map(p => {
    const subgroups = groupByLabel(p.items, t => t.status || 'No status', compareStatus).map(g => ({
      id: 'status-' + slug(p.key) + '-' + slug(g.key),
      title: g.key,
      count: g.items.length,
      tickets: sortTickets(g.items),
    }));
    return {
      id: 'project-' + slug(p.key),
      title: p.key,
      count: p.items.length,
      subgroups,
    };
  });
}

function ticketHref(ticket, jiraBaseUrl) {
  if (!jiraBaseUrl || !ticket.key) return '';
  return String(jiraBaseUrl).replace(/\/+$/, '') + '/browse/' + encodeURIComponent(ticket.key);
}

function formatDays(n) {
  if (n == null || n === '' || Number(n) === 0) return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return String(num);
}

function renderTicketRows(tickets, opts) {
  const { jiraBaseUrl, showProject } = opts;
  return tickets.map(t => {
    const href = ticketHref(t, jiraBaseUrl);
    const keyCell = href
      ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(t.key)}</a>`
      : esc(t.key);
    return `<tr>
      <td class="key">${keyCell}</td>
      <td class="sum">${esc(t.summary)}</td>
      <td>${esc(t.type || '—')}</td>
      <td>${esc(t.priority || '—')}</td>
      <td>${esc(t.status || '—')}</td>
      ${showProject ? `<td>${esc(t.projectName || t.projectKey || '—')}</td>` : ''}
      <td>${esc(t.assignee || 'Unassigned')}</td>
      <td class="num">${esc(formatDays(t.estimate))}</td>
    </tr>`;
  }).join('\n');
}

function tableHead(showProject) {
  return `<thead><tr>
    <th>Key</th>
    <th>Summary</th>
    <th>Type</th>
    <th>Priority</th>
    <th>Status</th>
    ${showProject ? '<th>Project</th>' : ''}
    <th>Assignee</th>
    <th>Est. days</th>
  </tr></thead>`;
}

function renderTable(tickets, opts) {
  if (!tickets.length) {
    return '<p class="empty">No tickets in this group.</p>';
  }
  return `<div class="table-wrap"><table>
    ${tableHead(opts.showProject)}
    <tbody>${renderTicketRows(tickets, opts)}</tbody>
  </table></div>`;
}

function groupLabel(groupBy) {
  return GROUP_LABELS[normalizeTicketGroupBy(groupBy)] || GROUP_LABELS['project-status'];
}

function ticketPhase(ticket) {
  const s = String(ticket && (ticket.phase || ticket.status) || '').trim();
  if (/^on[\s-]*hold/i.test(s)) return 'On Hold';
  const hit = PHASES.find(p => p.re.test(s) || p.label === s);
  return hit ? hit.label : (s || 'Other');
}

function countInsightBuckets(tickets, keyFn) {
  const map = {};
  (tickets || []).forEach(t => {
    const label = keyFn(t) || 'Unknown';
    map[label] = (map[label] || 0) + 1;
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([label, count]) => ({ label, count }));
}

function renderInsightBars(items) {
  const max = Math.max(1, ...items.map(i => i.count));
  if (!items.length) return '<p class="empty">None</p>';
  return `<div class="insight-bars">${items.map(item => `
    <div class="insight-bar-row">
      <span class="insight-bar-label">${esc(item.label)}</span>
      <div class="insight-bar-track"><span style="width:${Math.round(item.count / max * 100)}%"></span></div>
      <span class="insight-bar-count">${item.count}</span>
    </div>`).join('')}</div>`;
}

function renderInsightsPanel(tickets) {
  const list = tickets || [];
  const high = list.filter(t => /blocker|critical|highest|\bhigh\b/i.test(t.priority || '')).length;
  const unassigned = list.filter(t => !t.assignee || /unassigned|unowned/i.test(t.assignee)).length;
  const closed = list.filter(t => ticketPhase(t) === 'Closed').length;
  const qa = list.filter(t => ticketPhase(t) === 'QA').length;
  const phaseOrder = PHASES.map(p => p.label).concat(['On Hold', 'Other']);
  const byPhase = countInsightBuckets(list, ticketPhase).sort((a, b) => {
    const ai = phaseOrder.indexOf(a.label);
    const bi = phaseOrder.indexOf(b.label);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const byPriority = countInsightBuckets(list, t => t.priority || 'None').sort((a, b) => priorityRank(a.label) - priorityRank(b.label));
  const byProject = countInsightBuckets(list, t => t.projectName || t.projectKey || 'Project');
  const byType = countInsightBuckets(list, t => t.type || 'Unknown');
  const byStatus = countInsightBuckets(list, t => t.status || 'No status');

  return `
    <div class="kpi-grid">
      <div class="kpi"><div class="v">${list.length}</div><div class="l">Tickets</div></div>
      <div class="kpi"><div class="v">${high}</div><div class="l">High / critical</div></div>
      <div class="kpi"><div class="v">${qa}</div><div class="l">In QA</div></div>
      <div class="kpi"><div class="v">${closed}</div><div class="l">Closed</div></div>
      <div class="kpi"><div class="v">${unassigned}</div><div class="l">Unassigned</div></div>
    </div>
    <div class="insight-grid">
      <section class="project-block">
        <h2>By phase</h2>
        ${renderInsightBars(byPhase)}
      </section>
      <section class="project-block">
        <h2>By priority</h2>
        ${renderInsightBars(byPriority)}
      </section>
      <section class="project-block">
        <h2>By project</h2>
        ${renderInsightBars(byProject)}
      </section>
      <section class="project-block">
        <h2>By status</h2>
        ${renderInsightBars(byStatus.slice(0, 16))}
      </section>
      ${byType.length > 1 ? `<section class="project-block">
        <h2>By type</h2>
        ${renderInsightBars(byType)}
      </section>` : ''}
    </div>`;
}

function buildTicketListHtml(options = {}) {
  const tickets = Array.isArray(options.tickets) ? options.tickets : [];
  const groupBy = normalizeTicketGroupBy(options.groupBy);
  const jiraBaseUrl = options.jiraBaseUrl || '';
  const sections = groupReleaseTickets(tickets, groupBy);
  const showProject = groupBy === GROUP_BY.STATUS;
  const heading = options.title || 'Tickets';
  const kicker = options.kicker || 'Ticket list';
  const generated = formatDate(options.generatedAt) || formatDate(new Date().toISOString());
  const grouped = groupLabel(groupBy);
  const subtitle = options.subtitle
    || `${tickets.length} ticket${tickets.length === 1 ? '' : 's'} grouped ${grouped} · Generated ${generated}`;
  const tableOpts = { jiraBaseUrl, showProject };
  const toolbarMeta = options.toolbarMeta || '';

  const toc = sections.map(sec => {
    const sub = (sec.subgroups || []).map(g =>
      `<a href="#${esc(g.id)}">${esc(g.title)} <span>${g.count}</span></a>`
    ).join('');
    return `<div class="toc-item">
      <a href="#${esc(sec.id)}"><strong>${esc(sec.title)}</strong> <span>${sec.count}</span></a>
      ${sub ? `<div class="toc-sub">${sub}</div>` : ''}
    </div>`;
  }).join('');

  const body = sections.map(sec => {
    if (sec.subgroups) {
      const inner = sec.subgroups.map(g => `
        <section class="status-block" id="${esc(g.id)}">
          <h3>${esc(g.title)} <span class="count">${g.count}</span></h3>
          ${renderTable(g.tickets, tableOpts)}
        </section>`).join('');
      return `<section class="project-block" id="${esc(sec.id)}">
        <h2>${esc(sec.title)} <span class="count">${sec.count}</span></h2>
        ${inner}
      </section>`;
    }
    return `<section class="project-block" id="${esc(sec.id)}">
      <h2>${esc(sec.title)} <span class="count">${sec.count}</span></h2>
      ${renderTable(sec.tickets, tableOpts)}
    </section>`;
  }).join('\n');

  const title = `${heading} — tickets ${grouped}`;
  const insights = renderInsightsPanel(tickets);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<style>
  :root {
    --bg: #f7f6f3; --card: #ffffff; --text: #1a1a18; --muted: #5a5955; --faint: #9b9a96;
    --line: rgba(0,0,0,.11); --blue: #185FA5; --navy: #0B1F3A; --blue-bg: #E6F1FB;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; font-family: "Segoe UI", Calibri, system-ui, sans-serif;
    background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.45;
  }
  header {
    background: var(--navy); color: #fff; padding: 28px 32px 24px;
  }
  header .kicker {
    font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #7EB6E8; margin: 0 0 8px;
  }
  header h1 { margin: 0 0 8px; font-size: 28px; font-weight: 700; }
  header p { margin: 0; color: #C5D4E8; font-size: 14px; }
  .toolbar {
    display: flex; gap: 12px; flex-wrap: wrap; align-items: center;
    padding: 14px 32px; background: var(--card); border-bottom: 1px solid var(--line);
    position: sticky; top: 0; z-index: 2;
  }
  .tabs { display: flex; gap: 6px; }
  .tab {
    border: 1px solid var(--line); background: var(--bg); color: var(--text);
    border-radius: 999px; padding: 6px 14px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .tab.is-on { background: var(--blue-bg); border-color: var(--blue); color: var(--blue); }
  .toolbar input {
    flex: 1; min-width: 220px; max-width: 420px; padding: 8px 11px;
    border: 1px solid var(--line); border-radius: 8px; font: inherit;
  }
  .toolbar .meta { color: var(--muted); font-size: 13px; }
  main { padding: 24px 32px 64px; max-width: 1280px; }
  .panel { display: none; }
  .panel.is-on { display: block; }
  .kpi-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px; margin-bottom: 18px;
  }
  .kpi {
    background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px;
  }
  .kpi .v { font-size: 26px; font-weight: 700; line-height: 1.1; color: var(--navy); }
  .kpi .l { font-size: 11px; color: var(--muted); margin-top: 4px; }
  .insight-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
  .insight-bars { display: flex; flex-direction: column; gap: 7px; }
  .insight-bar-row { display: grid; grid-template-columns: 140px 1fr 36px; gap: 8px; align-items: center; font-size: 12px; }
  .insight-bar-label { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .insight-bar-track { height: 8px; background: #ecebe7; border-radius: 99px; overflow: hidden; }
  .insight-bar-track span { display: block; height: 100%; background: var(--blue); border-radius: 99px; }
  .insight-bar-count { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
  .toc {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px; margin-bottom: 28px;
  }
  .toc-item {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px;
  }
  .toc a { color: var(--navy); text-decoration: none; display: flex; justify-content: space-between; gap: 8px; }
  .toc a:hover { color: var(--blue); }
  .toc span, h2 .count, h3 .count {
    color: var(--muted); font-weight: 600; font-size: 12px;
  }
  .toc-sub { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
  .toc-sub a { font-size: 12px; color: var(--muted); }
  .project-block { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; margin-bottom: 18px; }
  h2 { margin: 0 0 12px; font-size: 18px; color: var(--navy); display: flex; align-items: baseline; gap: 8px; }
  h3 { margin: 16px 0 8px; font-size: 14px; color: var(--blue); display: flex; align-items: baseline; gap: 8px; }
  .status-block + .status-block { margin-top: 8px; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th {
    text-align: left; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
    color: var(--faint); padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap;
  }
  td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  td.key { font-family: ui-monospace, Consolas, monospace; font-weight: 600; white-space: nowrap; }
  td.key a { color: var(--blue); text-decoration: none; }
  td.key a:hover { text-decoration: underline; }
  td.sum { min-width: 240px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .empty { color: var(--muted); font-size: 13px; }
  tr.hidden { display: none; }
  @media print {
    header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .toolbar { display: none; }
    .panel { display: block !important; }
    .project-block { break-inside: avoid; }
    a { color: inherit; text-decoration: none; }
  }
</style>
</head>
<body>
  <header>
    <p class="kicker">${esc(kicker)}</p>
    <h1>${esc(heading)}</h1>
    <p>${esc(subtitle)}</p>
  </header>
  <div class="toolbar">
    <div class="tabs">
      <button type="button" class="tab is-on" data-tab="insights">Insights</button>
      <button type="button" class="tab" data-tab="tickets">Tickets</button>
    </div>
    <input id="filter" type="search" placeholder="Filter by key, summary, assignee, status…" />
    <div class="meta">${esc(clip(toolbarMeta, 80))}</div>
  </div>
  <main>
    <div id="panel-insights" class="panel is-on">${insights}</div>
    <div id="panel-tickets" class="panel">
      <nav class="toc">${toc}</nav>
      ${body || '<p class="empty">No tickets to list.</p>'}
    </div>
  </main>
  <script>
    (function () {
      var tabs = document.querySelectorAll('.tab');
      var filter = document.getElementById('filter');
      function show(name) {
        document.querySelectorAll('.tab').forEach(function (btn) {
          btn.classList.toggle('is-on', btn.getAttribute('data-tab') === name);
        });
        document.querySelectorAll('.panel').forEach(function (panel) {
          panel.classList.toggle('is-on', panel.id === 'panel-' + name);
        });
        if (filter) filter.style.display = name === 'tickets' ? '' : 'none';
      }
      tabs.forEach(function (btn) {
        btn.addEventListener('click', function () { show(btn.getAttribute('data-tab')); });
      });
      show('insights');
      if (!filter) return;
      filter.addEventListener('input', function () {
        var q = (filter.value || '').toLowerCase().trim();
        document.querySelectorAll('#panel-tickets tbody tr').forEach(function (tr) {
          tr.classList.toggle('hidden', q && tr.textContent.toLowerCase().indexOf(q) === -1);
        });
      });
    })();
  </script>
</body>
</html>
`;
}

function htmlFilename(report) {
  return sanitizeFilename(report && report.releaseName) + '-tickets.html';
}

function ticketListFilename(title) {
  return sanitizeFilename(title || 'tickets') + '.html';
}

function buildReleaseReportHtml(report, options = {}) {
  const tickets = collectReleaseTickets(report);
  const released = (report && report.releaseName) || 'Release';
  const kind = report && report.reportKind === 'end-of-release' ? 'End of release' : 'Release snapshot';
  const generated = formatDate(report && report.generatedAt) || formatDate(new Date().toISOString());
  const groupBy = options.groupBy || (report && report.ticketGroupBy);
  return buildTicketListHtml({
    title: released,
    kicker: `${kind} · ticket list`,
    subtitle: `${tickets.length} ticket${tickets.length === 1 ? '' : 's'} grouped ${groupLabel(groupBy)} · Generated ${generated}`,
    tickets,
    groupBy,
    jiraBaseUrl: options.jiraBaseUrl,
    toolbarMeta: ((report && report.projects) || []).map(p => p.projectName).filter(Boolean).join(' · '),
    generatedAt: report && report.generatedAt,
  });
}

module.exports = {
  GROUP_BY,
  normalizeTicketGroupBy,
  collectReleaseTickets,
  groupReleaseTickets,
  buildTicketListHtml,
  buildReleaseReportHtml,
  htmlFilename,
  ticketListFilename,
};
