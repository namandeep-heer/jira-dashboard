/**
 * Unit tests for release report analysis, HTML export, and PPTX smoke.
 * Run: node scripts/test-release-report.js
 */

const assert = require('assert');
const {
  analyzeRelease,
  analyzeProject,
  mergeAiInsights,
  adfToText,
  scoreTicket,
} = require('../lib/release-report');

function issue(opts = {}) {
  return {
    key: opts.key || 'NFS-1',
    fields: {
      summary: opts.summary || 'Do a thing',
      status: { name: opts.status || 'Closed' },
      issuetype: { name: opts.type || 'Enhancement' },
      priority: { name: opts.priority || 'Medium' },
      parent: opts.parent || undefined,
      description: opts.description,
      assignee: opts.assignee ? { displayName: opts.assignee } : undefined,
      customfield_10204: opts.estimate,
      customfield_10203: opts.actual,
      customfield_10200: opts.scope ? { value: opts.scope } : undefined,
      customfield_10208: opts.custcom,
      updated: opts.updated,
      fixVersions: (opts.fixVersions || []).map(name => ({ name })),
    },
    lastActivity: opts.lastActivity,
  };
}

const fieldIds = {
  est: 'customfield_10204',
  act: 'customfield_10203',
  scope: 'customfield_10200',
  custcom: 'customfield_10208',
  clarity: 'customfield_10202',
};

const release = {
  name: '2026.2',
  milestones: { FF: '2026-08-01', GA: '2026-09-15', SC: '2026-06-01' },
};

const milestones = [
  { id: 'SC', label: 'Scope Close', color: '#5b9fd6' },
  { id: 'FF', label: 'Feature Freeze', color: '#e0a040' },
  { id: 'GA', label: 'General Availability', color: '#7cb842' },
];

const now = '2026-08-20T12:00:00.000Z';

function build(issues, extra = {}) {
  return analyzeRelease({
    release,
    milestones,
    fieldIds,
    reportMode: extra.reportMode || 'auto',
    now: extra.now || now,
    projects: [{
      project: { key: 'NFS', name: 'NFS Core', color: '#185FA5' },
      issues,
    }],
  });
}

// ADF flatten
assert.strictEqual(
  adfToText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] }).trim(),
  'Hello'
);

// Customer commitment + description keywords beat a small chore
const high = scoreTicket(issue({
  key: 'NFS-10',
  summary: 'Customer SSO go-live for Acme',
  status: 'Closed',
  type: 'Epic',
  priority: 'Highest',
  estimate: 12,
  custcom: 'Acme Q3',
  description: 'Contractual customer commitment for SSO integration before go-live.',
  scope: 'In scope',
}), fieldIds);
const low = scoreTicket(issue({
  key: 'NFS-11',
  summary: 'Rename a label',
  status: 'Closed',
  type: 'Task',
  priority: 'Low',
  estimate: 0.5,
}), fieldIds);
assert.ok(high.valueScore > low.valueScore + 40, `expected high-value gap, got ${high.valueScore} vs ${low.valueScore}`);
assert.ok(high.valueReasons.some(r => /customer/i.test(r)));

const report = build([
  issue({
    key: 'NFS-10',
    summary: 'Customer SSO go-live for Acme',
    status: 'Closed',
    type: 'Epic',
    priority: 'Highest',
    estimate: 12,
    custcom: 'Acme Q3',
    description: 'Contractual customer commitment for SSO integration.',
    parent: { key: 'NFS-1', fields: { summary: 'Identity platform' } },
  }),
  issue({ key: 'NFS-20', summary: 'Polish tooltip', status: 'Closed', type: 'Enhancement', priority: 'Low', estimate: 1 }),
  issue({ key: 'NFS-30', summary: 'Cancelled extra theme', status: "Won't Fix", type: 'Enhancement', priority: 'Medium' }),
  issue({
    key: 'NFS-40',
    summary: 'Blocked waiting on vendor API',
    status: 'Dev Developing',
    type: 'Enhancement',
    priority: 'High',
    estimate: 8,
    lastActivity: '2026-07-01T00:00:00.000Z',
  }),
  issue({
    key: 'NFS-50',
    summary: 'On-hold billing change',
    status: 'On Hold',
    type: 'Enhancement',
    priority: 'Medium',
    custcom: 'Contoso',
  }),
  issue({ key: 'NFS-60', summary: 'QA regression pack', status: 'PQA', type: 'Enhancement', priority: 'Medium', estimate: 3 }),
]);

assert.strictEqual(report.releaseName, '2026.2');
assert.strictEqual(report.reportKind, 'snapshot');
assert.strictEqual(report.ticketGroupBy, 'project-status');
assert.strictEqual(report.projects.length, 1);
const p = report.projects[0];
assert.strictEqual(p.insightKind, 'delivery');
assert.strictEqual(p.progress.delivered, 2);
assert.strictEqual(p.progress.dropped, 1);
assert.strictEqual(p.tickets.length, 6);
assert.ok(p.tickets.every(t => t.projectKey === 'NFS' && t.projectName === 'NFS Core'));
assert.ok(p.progress.deliveredPct > 0 && p.progress.deliveredPct < 100);
assert.ok(p.highValue[0].key === 'NFS-10', `top high-value should be NFS-10, got ${p.highValue[0].key}`);
assert.ok(p.delivered.themes.some(t => /Identity/i.test(t.title)));
assert.ok(p.risks.some(r => /high-priority/i.test(r.title)));
assert.ok(p.risks.some(r => /customer-committed/i.test(r.title)));
assert.ok(p.risks.some(r => /on hold/i.test(r.title)));
assert.ok(p.risks.some(r => /no movement/i.test(r.title)));
assert.ok(p.risks.some(r => /Feature Freeze/i.test(r.title)));
const bounced = analyzeProject({
  project: { key: 'NFS', name: 'NFS Core', color: '#185FA5' },
  release,
  milestones,
  fieldIds,
  now,
  issues: [
    issue({ key: 'NFS-70', summary: 'Sent back', status: 'Rejected' }),
    issue({ key: 'NFS-71', summary: 'Answered review', status: 'Replied' }),
    issue({ key: 'NFS-72', summary: 'Unknown park', status: 'Waiting on Legal' }),
  ],
});
assert.strictEqual(bounced.progress.byPhase.find(x => x.label === 'Rejected / Replied')?.count, 2);
assert.ok(!bounced.progress.byPhase.some(x => x.label === 'Rejected' || x.label === 'Replied'));
assert.strictEqual(bounced.progress.byPhase.find(x => x.label === 'Other')?.count, 1);

assert.ok(p.timeline.current && p.timeline.current.id === 'FF');
assert.strictEqual(p.timeline.current.date, '2026-08-01');
assert.ok(p.timeline.next && p.timeline.next.id === 'GA');

const endReport = build(report.projects[0] ? [
  issue({ key: 'NFS-1', summary: 'Done', status: 'Closed' }),
  issue({ key: 'NFS-2', summary: 'Still open', status: 'Dev Developing', priority: 'High' }),
] : [], { now: '2026-09-20T12:00:00.000Z' });
assert.strictEqual(endReport.reportKind, 'end-of-release');
assert.ok(endReport.projects[0].risks.some(r => /GA date has passed/i.test(r.title)));

const merged = mergeAiInsights(report, {
  headline: 'SSO shipped; vendor API is the remaining risk',
  progressNarrative: 'Two items closed.',
  valueNarrative: 'Customer SSO is the headline.',
  deliveredThemes: [{ title: 'Identity', summary: 'SSO for Acme', ticketKeys: ['NFS-10'] }],
  highValueItems: [{ key: 'NFS-10', businessImpact: 'Unblocks Acme go-live', whyItMatters: 'Contractual' }],
  additionalRisks: [{ severity: 'high', title: 'Vendor API silence', detail: 'No update in description', ticketKeys: ['NFS-40'] }],
  closingMessage: 'Ask vendor for a date.',
});
assert.strictEqual(merged.projects[0].narrative.headline, 'SSO shipped; vendor API is the remaining risk');
assert.ok(merged.projects[0].highValue[0].impact.includes('Acme'));
assert.ok(merged.projects[0].risks.some(r => r.source === 'ai'));

const empty = analyzeRelease({
  release, milestones, fieldIds, now,
  projects: [{ project: { key: 'X', name: 'Empty' }, issues: [] }],
});
assert.strictEqual(empty.projects[0].progress.total, 0);
assert.strictEqual(empty.projects[0].progress.deliveredPct, 0);

const portfolioReport = analyzeRelease({
  release, milestones, fieldIds, now,
  projects: [
    {
      project: { key: 'NFS', name: 'Lease Accounting 6.x', color: '#185FA5' },
      issues: [
        issue({
          key: 'NFS-10',
          summary: 'Customer SSO go-live for Acme',
          status: 'Closed',
          type: 'Epic',
          priority: 'Highest',
          estimate: 12,
          custcom: 'Acme Q3',
          description: 'Contractual customer commitment for SSO integration.',
        }),
        issue({
          key: 'NFS-40',
          summary: 'Blocked waiting on vendor API',
          status: 'Dev Developing',
          type: 'Enhancement',
          priority: 'High',
          estimate: 8,
          lastActivity: '2026-07-01T00:00:00.000Z',
        }),
      ],
    },
    {
      project: { key: 'P2P', name: 'Procure To Pay', color: '#0F6E56' },
      issues: [
        issue({
          key: 'P2P-5',
          summary: 'Invoice matching compliance upgrade',
          status: 'Closed',
          type: 'Epic',
          priority: 'High',
          estimate: 10,
          description: 'Audit and compliance upgrade for invoice matching.',
        }),
        issue({
          key: 'P2P-9',
          summary: 'Blocked waiting on tax engine',
          status: 'Dev Developing',
          type: 'Enhancement',
          priority: 'High',
          estimate: 6,
          lastActivity: '2026-07-02T00:00:00.000Z',
        }),
      ],
    },
  ],
});
assert.strictEqual(portfolioReport.portfolio.projectCount, 2);
const hvProjects = new Set((portfolioReport.portfolio.highValue || []).map(t => t.projectKey));
assert.ok(hvProjects.has('NFS') && hvProjects.has('P2P'), 'high-value list should cover every project');
assert.ok(portfolioReport.portfolio.highValue.some(t => t.key === 'NFS-10' && t.delivered));
const freezeRisks = (portfolioReport.portfolio.risks || []).filter(r => r.kind === 'feature-freeze');
assert.strictEqual(freezeRisks.length, 1, 'feature-freeze should roll up to one portfolio risk');
assert.ok(freezeRisks[0].projectNames.includes('Lease Accounting 6.x'));
assert.ok(freezeRisks[0].projectNames.includes('Procure To Pay'));
assert.ok(/across 2 projects/i.test(freezeRisks[0].title));
const blocked = (portfolioReport.portfolio.risks || []).find(r => r.kind === 'blocked');
assert.ok(blocked && blocked.count >= 2);

const qualityReport = analyzeRelease({
  release, milestones, fieldIds, now,
  projects: [{
    project: { key: 'BUGS', name: 'Open Bugs (All Projects)', color: '#D32F2F', category: 'Quality' },
    issues: [
      issue({
        key: 'NFS-200',
        summary: 'Lease posting fails for customer Acme',
        status: 'Dev Developing',
        type: 'Bug',
        priority: 'Blocker',
        custcom: 'Acme',
        lastActivity: '2026-07-01T00:00:00.000Z',
        fixVersions: ['N2026.R2.P1'],
      }),
      issue({
        key: 'NFS-201',
        summary: 'Support: cannot export report',
        status: 'Prod Pending',
        type: 'Support',
        priority: 'High',
        lastActivity: '2026-08-18T00:00:00.000Z',
        fixVersions: ['N2026.R2'],
      }),
      issue({
        key: 'NFS-202',
        summary: 'Typo on label',
        status: 'QA',
        type: 'Bug',
        priority: 'Low',
      }),
      issue({
        key: 'NFS-203',
        summary: 'Unowned patch regression',
        status: 'Dev Pending',
        type: 'Bug',
        priority: 'Medium',
        lastActivity: '2026-06-01T00:00:00.000Z',
      }),
      issue({
        key: 'NFS-204',
        summary: 'Another unowned bug',
        status: 'Prod Pending',
        type: 'Bug',
        priority: 'Medium',
      }),
      issue({
        key: 'NFS-205',
        summary: 'Third unowned bug',
        status: 'Prod Pending',
        type: 'Bug',
        priority: 'Medium',
      }),
    ],
  }],
});
const q = qualityReport.projects[0];
assert.strictEqual(q.insightKind, 'quality');
assert.ok(q.quality);
assert.strictEqual(q.progress.open, 6);
assert.ok(q.quality.highPriority >= 2);
assert.ok(q.quality.unassigned >= 2);
assert.ok(q.mustFix.length);
assert.ok(q.mustFix.some(t => t.key === 'NFS-200'));
assert.strictEqual(q.highValue.length, 0);
assert.ok(q.risks.some(r => r.kind === 'quality-blockers'));
assert.ok(q.risks.some(r => r.kind === 'quality-unassigned'));
assert.ok(q.risks.some(r => r.kind === 'quality-stale'));
assert.ok(!q.risks.some(r => r.kind === 'feature-freeze'), 'quality insights must not use feature-freeze language');
assert.ok(/open quality ticket/i.test(q.narrative.headline));
assert.ok(qualityReport.portfolio.qualityProjectCount === 1);
assert.ok(qualityReport.portfolio.deliveryProjectCount === 0);
assert.ok((qualityReport.portfolio.mustFix || []).some(t => t.key === 'NFS-200'));
assert.strictEqual((qualityReport.portfolio.highValue || []).length, 0);

const mixedReport = analyzeRelease({
  release, milestones, fieldIds, now,
  projects: [
    {
      project: { key: 'NFS', name: 'Lease Accounting 6.x', color: '#185FA5', category: 'Core Modules' },
      issues: [
        issue({
          key: 'NFS-10',
          summary: 'Customer SSO go-live for Acme',
          status: 'Closed',
          type: 'Epic',
          priority: 'Highest',
          estimate: 12,
          custcom: 'Acme Q3',
          description: 'Contractual customer commitment for SSO integration.',
        }),
      ],
    },
    {
      project: { key: 'BUGS', name: 'Open Bugs (All Projects)', color: '#D32F2F', category: 'Quality' },
      issues: [
        issue({ key: 'BUG-1', summary: 'Crash on save', status: 'Dev Developing', type: 'Bug', priority: 'Blocker' }),
      ],
    },
  ],
});
assert.strictEqual(mixedReport.portfolio.deliveryProjectCount, 1);
assert.strictEqual(mixedReport.portfolio.qualityProjectCount, 1);
assert.ok(mixedReport.portfolio.highValue.some(t => t.key === 'NFS-10'));
assert.ok(mixedReport.portfolio.mustFix.some(t => t.key === 'BUG-1'));
assert.ok(!mixedReport.portfolio.highValue.some(t => t.key === 'BUG-1'));

const groupedStatus = analyzeRelease({
  release, milestones, fieldIds, now, ticketGroupBy: 'status',
  projects: [{ project: { key: 'NFS', name: 'NFS Core' }, issues: [
    issue({ key: 'NFS-10', summary: 'A', status: 'Closed' }),
    issue({ key: 'NFS-11', summary: 'B', status: 'Closed' }),
    issue({ key: 'NFS-12', summary: 'C', status: 'Dev Developing' }),
  ] }],
});
assert.strictEqual(groupedStatus.ticketGroupBy, 'status');

const {
  collectReleaseTickets,
  groupReleaseTickets,
  buildTicketListHtml,
  buildReleaseReportHtml,
  htmlFilename,
  ticketListFilename,
} = require('../lib/release-report-html');

const allTickets = collectReleaseTickets(portfolioReport);
assert.strictEqual(allTickets.length, 4);
assert.ok(allTickets.some(t => t.key === 'NFS-10'));
assert.ok(allTickets.some(t => t.key === 'P2P-9'));

const byStatus = groupReleaseTickets(allTickets, 'status');
assert.ok(byStatus.some(g => g.title === 'Closed' && g.count === 2));
assert.ok(byStatus.some(g => g.title === 'Dev Developing' && g.count === 2));
assert.ok(!byStatus.some(g => g.subgroups));

const byProject = groupReleaseTickets(allTickets, 'project');
assert.strictEqual(byProject.length, 2);
assert.ok(byProject[0].title.includes('Lease') || byProject[0].title.includes('Procure'));
assert.ok(byProject.every(g => g.tickets.length === 2));

const byProjectStatus = groupReleaseTickets(allTickets, 'project-status');
assert.strictEqual(byProjectStatus.length, 2);
assert.ok(byProjectStatus.every(g => Array.isArray(g.subgroups) && g.subgroups.length >= 1));
const nfsGroup = byProjectStatus.find(g => /Lease/i.test(g.title));
assert.ok(nfsGroup.subgroups.some(s => s.title === 'Closed' && s.tickets.some(t => t.key === 'NFS-10')));

const html = buildReleaseReportHtml(portfolioReport, {
  groupBy: 'project-status',
  jiraBaseUrl: 'https://jira.example.com/',
});
assert.ok(html.includes('<!DOCTYPE html>'));
assert.ok(html.includes('2026.2'));
assert.ok(html.includes('NFS-10'));
assert.ok(html.includes('P2P-9'));
assert.ok(html.includes('Lease Accounting 6.x'));
assert.ok(html.includes('https://jira.example.com/browse/NFS-10'));
assert.ok(html.includes('by project, then status'));
assert.strictEqual(htmlFilename(portfolioReport), '2026.2-tickets.html');

const listHtml = buildTicketListHtml({
  title: 'Open Bugs filtered',
  kicker: 'Quality Insights · filtered ticket list',
  tickets: allTickets,
  groupBy: 'project-status',
  jiraBaseUrl: 'https://jira.example.com/',
  toolbarMeta: 'search: War',
});
assert.ok(listHtml.includes('Open Bugs filtered'));
assert.ok(listHtml.includes('filtered ticket list'));
assert.ok(listHtml.includes('NFS-10'));
assert.ok(listHtml.includes('search: War'));
assert.ok(listHtml.includes('data-tab="insights"'));
assert.ok(listHtml.includes('data-tab="tickets"'));
assert.ok(listHtml.includes('By phase'));
assert.ok(listHtml.includes('By priority'));
assert.ok(listHtml.includes('panel-insights'));
assert.strictEqual(ticketListFilename('Open Bugs (All Projects)'), 'Open-Bugs-All-Projects.html');

const xssReport = build([issue({
  key: 'NFS-99',
  summary: '<script>alert(1)</script>',
  status: 'Closed',
})]);
const xssHtml = buildReleaseReportHtml(xssReport, { groupBy: 'status' });
assert.ok(!xssHtml.includes('<script>alert(1)</script>'));
assert.ok(xssHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));

const statusHtml = buildReleaseReportHtml(portfolioReport, { groupBy: 'status' });
assert.ok(statusHtml.includes('by status'));
assert.ok(statusHtml.includes('<th>Project</th>'));

console.log('release-report analysis: ok');
console.log('release-report html: ok');

async function testPptx() {
  const { buildReleaseReportPptx } = require('../lib/release-report-pptx');
  const buf = await buildReleaseReportPptx(report);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 2000);
  assert.strictEqual(buf.slice(0, 2).toString(), 'PK');
  const qualityBuf = await buildReleaseReportPptx(qualityReport);
  assert.ok(Buffer.isBuffer(qualityBuf) && qualityBuf.length > 2000);
  const mixedBuf = await buildReleaseReportPptx(mixedReport);
  assert.ok(Buffer.isBuffer(mixedBuf) && mixedBuf.length > 2000);
  console.log('release-report pptx: ok (' + buf.length + ' bytes)');
}

testPptx().catch(err => {
  console.error(err);
  process.exit(1);
});
