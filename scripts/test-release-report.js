/**
 * Unit tests for release report analysis (and PPTX smoke if pptxgenjs is installed).
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
assert.strictEqual(report.projects.length, 1);
const p = report.projects[0];
assert.strictEqual(p.progress.delivered, 2);
assert.strictEqual(p.progress.dropped, 1);
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

console.log('release-report analysis: ok');

async function testPptx() {
  let buildReleaseReportPptx;
  try {
    ({ buildReleaseReportPptx } = require('../lib/release-report-pptx'));
  } catch (err) {
    console.log('pptx skipped (pptxgenjs not installed)');
    return;
  }
  const buf = await buildReleaseReportPptx(report);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 2000);
  assert.strictEqual(buf.slice(0, 2).toString(), 'PK');
  console.log('release-report pptx: ok (' + buf.length + ' bytes)');
}

testPptx().catch(err => {
  console.error(err);
  process.exit(1);
});
