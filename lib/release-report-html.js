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

function buildReleaseReportHtml(report, options = {}) {
  const groupBy = normalizeTicketGroupBy(options.groupBy || report.ticketGroupBy);
  const jiraBaseUrl = options.jiraBaseUrl || '';
  const tickets = collectReleaseTickets(report);
  const sections = groupReleaseTickets(tickets, groupBy);
  const showProject = groupBy === GROUP_BY.STATUS;
  const released = report.releaseName || 'Release';
  const kind = report.reportKind === 'end-of-release' ? 'End of release' : 'Release snapshot';
  const generated = formatDate(report.generatedAt) || formatDate(new Date().toISOString());
  const tableOpts = { jiraBaseUrl, showProject };

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

  const title = `${released} — tickets ${groupLabel(groupBy)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<style>
  :root {
    --bg: #f7f6f3; --card: #ffffff; --text: #1a1a18; --muted: #5a5955; --faint: #9b9a96;
    --line: rgba(0,0,0,.11); --blue: #185FA5; --navy: #0B1F3A;
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
  .toolbar input {
    flex: 1; min-width: 220px; max-width: 420px; padding: 8px 11px;
    border: 1px solid var(--line); border-radius: 8px; font: inherit;
  }
  .toolbar .meta { color: var(--muted); font-size: 13px; }
  main { padding: 24px 32px 64px; max-width: 1280px; }
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
    .project-block { break-inside: avoid; }
    a { color: inherit; text-decoration: none; }
  }
</style>
</head>
<body>
  <header>
    <p class="kicker">${esc(kind)} · ticket list</p>
    <h1>${esc(released)}</h1>
    <p>${esc(tickets.length)} ticket${tickets.length === 1 ? '' : 's'} grouped ${esc(groupLabel(groupBy))} · Generated ${esc(generated)}</p>
  </header>
  <div class="toolbar">
    <input id="filter" type="search" placeholder="Filter by key, summary, assignee, status…" />
    <div class="meta">${esc(clip((report.projects || []).map(p => p.projectName).filter(Boolean).join(' · '), 80))}</div>
  </div>
  <main>
    <nav class="toc">${toc}</nav>
    ${body || '<p class="empty">No tickets in this release report.</p>'}
  </main>
  <script>
    (function () {
      var input = document.getElementById('filter');
      if (!input) return;
      input.addEventListener('input', function () {
        var q = (input.value || '').toLowerCase().trim();
        document.querySelectorAll('tbody tr').forEach(function (tr) {
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

module.exports = {
  GROUP_BY,
  normalizeTicketGroupBy,
  collectReleaseTickets,
  groupReleaseTickets,
  buildReleaseReportHtml,
  htmlFilename,
};
