/**
 * Release delivery report — progress, content, high-value items, and risks.
 * Pure analysis; optional SpaceXAI enrichment is applied by the proxy.
 */

const PHASES = [
  { label: 'Product', re: /^prod/i, color: '533AB7' },
  { label: 'Developer Pending', re: /^dev[\s-]*pending/i, color: '854F0B' },
  { label: 'Developing', re: /^dev[\s-]*(developing|designing|grooming|cr|merge|reopened)/i, color: '185FA5' },
  { label: 'QA', re: /^(qa|pqa|pending[\s-]*dep|eoa[\s-]*pending)/i, color: '0F6E56' },
  { label: 'Rejected / Replied', re: /^(rejected|replied)/i, color: 'C47A0F' },
  { label: 'Closed', re: /^(closed|done|resolved|cancelled|canceled|won't\s*fix)/i, color: '555555' },
];

const ON_HOLD_RE = /^on[\s-]*hold/i;
const DROPPED_RE = /cancelled|canceled|won't\s*fix|wont\s*fix|duplicate/i;
const DELIVERED_RE = /^(closed|done|resolved)$/i;
const BLOCKED_RE = /block|impediment|wait(ing)?\s*on|stuck/i;

const VALUE_KEYWORDS = [
  { re: /\b(customer|client|contract|commit(ment)?|sla|go[- ]live|globally\s+(enabled|live))\b/i, pts: 12, reason: 'Customer / contractual language' },
  { re: /\b(revenue|pricing|billing|invoice|commercial)\b/i, pts: 10, reason: 'Commercial impact' },
  { re: /\b(compliance|audit|gdpr|sox|security|legal|privacy)\b/i, pts: 12, reason: 'Compliance / security' },
  { re: /\b(integration|migration|upgrade|cutover|rollout)\b/i, pts: 8, reason: 'Cross-system change' },
  { re: /\b(performance|scale|throughput|latency)\b/i, pts: 8, reason: 'Performance / scale' },
  { re: /\b(platform|foundation|enabl(e|ing)|shared)\b/i, pts: 6, reason: 'Platform / enabling work' },
];

const STALE_DAYS = 14;
const HIGH_VALUE_LIMIT = 8;
const THEME_LIMIT = 8;

function getPhase(statusName) {
  const s = (statusName || '').trim();
  if (ON_HOLD_RE.test(s)) return { label: 'On Hold', color: 'A32D2D' };
  return PHASES.find(p => p.re.test(s)) || { label: 'Other', color: '888780' };
}

function toDayNumber(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (Array.isArray(val)) return toDayNumber(val[0]);
  const raw = String(val).trim().replace(',', '.');
  const m = raw.match(/-?\d+(?:\.\d+)?/);
  if (!m) return 0;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : 0;
}

function optionText(val) {
  if (val == null || val === '') return '';
  if (typeof val === 'string') {
    if (val.startsWith('{"errorM')) return '';
    return val.trim();
  }
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val)) return val.map(optionText).filter(Boolean).join(', ');
  if (typeof val === 'object') {
    if (val.errorMessage || val.errorMessages) return '';
    return optionText(val.value || val.name || val.displayName || val.key || '');
  }
  return String(val);
}

function adfToText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node !== 'object') return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (Array.isArray(node.content)) {
    const inner = node.content.map(adfToText).join(node.type === 'paragraph' || node.type === 'heading' ? '\n' : '');
    return inner;
  }
  if (node.content) return adfToText(node.content);
  return '';
}

function descriptionText(fields) {
  const raw = fields?.description;
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  return adfToText(raw).trim();
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00' : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function toDateStr(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fieldValue(fields, id) {
  if (!id || !fields) return undefined;
  return fields[id];
}

function statusName(issue) {
  return (issue.fields?.status?.name || '').trim();
}

function isDelivered(status) {
  return DELIVERED_RE.test((status || '').trim());
}

function isDropped(status) {
  return DROPPED_RE.test((status || '').trim());
}

function lastActivityDate(issue) {
  const fromPayload = parseDate(issue.lastActivity);
  if (fromPayload) return fromPayload;
  let best = parseDate(issue.fields?.updated);
  for (const h of issue.changelog?.histories || []) {
    const d = parseDate(h.created);
    if (d && (!best || d > best)) best = d;
  }
  return best;
}

function scorePriority(name) {
  const s = (name || '').toLowerCase();
  if (/blocker|critical|highest/.test(s)) return { pts: 30, reason: 'Critical / highest priority' };
  if (/high/.test(s)) return { pts: 20, reason: 'High priority' };
  if (/medium|major/.test(s)) return { pts: 5, reason: 'Medium priority' };
  return { pts: 0, reason: null };
}

function scoreType(name) {
  const s = (name || '').toLowerCase();
  if (s === 'epic') return { pts: 22, reason: 'Epic-sized capability' };
  if (/enhancement|story|feature|new feature/.test(s)) return { pts: 14, reason: 'Feature / enhancement' };
  if (/bug/.test(s)) return { pts: 6, reason: 'Defect' };
  return { pts: 4, reason: null };
}

function hasCustomerCommitment(text) {
  const t = (text || '').trim();
  if (!t) return false;
  return !/^(no|n\/a|na|none|false|-)$/i.test(t);
}

function scoreTicket(issue, fieldIds) {
  const fields = issue.fields || {};
  const summary = fields.summary || '';
  const status = statusName(issue);
  const type = optionText(fields.issuetype);
  const priority = optionText(fields.priority);
  const parent = fields.parent;
  const parentKey = parent?.key || '';
  const parentSummary = parent?.fields?.summary || '';
  const estimate = toDayNumber(fieldValue(fields, fieldIds.est));
  const actual = toDayNumber(fieldValue(fields, fieldIds.act));
  const scope = optionText(fieldValue(fields, fieldIds.scope));
  const custcom = optionText(fieldValue(fields, fieldIds.custcom));
  const clarity = optionText(fieldValue(fields, fieldIds.clarity));
  const desc = descriptionText(fields);
  const detail = `${summary}\n${desc}`.slice(0, 4000);
  const phase = getPhase(status);

  const reasons = [];
  let score = 0;

  if (hasCustomerCommitment(custcom)) {
    score += 40;
    reasons.push(`Customer commitment: ${custcom}`);
  }
  const pri = scorePriority(priority);
  if (pri.pts) { score += pri.pts; reasons.push(pri.reason); }
  const typ = scoreType(type);
  if (typ.pts >= 14) { score += typ.pts; reasons.push(typ.reason); }
  else score += typ.pts;

  if (estimate >= 8) { score += 15; reasons.push(`Large estimate (${estimate} days)`); }
  else if (estimate >= 4) { score += 8; reasons.push(`Substantial estimate (${estimate} days)`); }

  if (/commit|in[- ]scope|yes|sc\b/i.test(scope)) {
    score += 10;
    reasons.push(`In-scope: ${scope}`);
  }

  VALUE_KEYWORDS.forEach(k => {
    if (k.re.test(detail)) {
      score += k.pts;
      reasons.push(k.reason);
    }
  });

  if (/high|clear|ready/i.test(clarity)) score += 3;

  const uniqueReasons = [...new Set(reasons)];
  return {
    key: issue.key,
    summary,
    type,
    priority,
    status,
    phase: phase.label,
    parentKey,
    parentSummary,
    estimate,
    actual,
    scope,
    customerCommitment: custcom,
    description: desc,
    valueScore: score,
    valueReasons: uniqueReasons,
    delivered: isDelivered(status),
    dropped: isDropped(status),
    onHold: ON_HOLD_RE.test(status),
    lastActivity: lastActivityDate(issue),
    assignee: optionText(fields.assignee),
  };
}

function countBy(items, keyFn) {
  const map = {};
  items.forEach(item => {
    const k = keyFn(item) || 'Unknown';
    map[k] = (map[k] || 0) + 1;
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
}

function resolveReportKind(mode, release, now, milestoneDefs) {
  if (mode === 'snapshot' || mode === 'end-of-release') return mode;
  const ga = datedMilestone(release, milestoneDefs, 'GA');
  if (ga && now >= ga.date) return 'end-of-release';
  const ge = datedMilestone(release, milestoneDefs, 'GE') || datedMilestone(release, milestoneDefs, 'GE2');
  if (ge && now >= ge.date) return 'end-of-release';
  return 'snapshot';
}

function datedMilestone(release, milestoneDefs, id) {
  const def = (milestoneDefs || []).find(m => m.id === id);
  const raw = release?.milestones?.[id];
  const date = parseDate(raw);
  if (!date) return null;
  return {
    id,
    label: def?.label || id,
    fullName: def?.fullName || def?.label || id,
    color: (def?.color || '#185FA5').replace('#', ''),
    date,
  };
}

function milestoneTimeline(release, milestoneDefs, now) {
  const items = (milestoneDefs || [])
    .map(m => datedMilestone(release, milestoneDefs, m.id))
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);
  let current = null;
  let next = null;
  items.forEach(m => {
    if (m.date <= now) current = m;
    else if (!next) next = m;
  });
  return {
    items: items.map(m => ({
      id: m.id,
      label: m.label,
      fullName: m.fullName,
      color: m.color,
      date: toDateStr(m.date),
      past: m.date <= now,
      daysFromNow: daysBetween(now, m.date),
    })),
    current: current ? { id: current.id, label: current.label, date: toDateStr(current.date) } : null,
    next: next ? { id: next.id, label: next.label, date: toDateStr(next.date), daysAway: daysBetween(now, next.date) } : null,
  };
}

function groupDeliveredThemes(scored) {
  const delivered = scored.filter(t => t.delivered);
  const byParent = {};
  const ungrouped = [];
  delivered.forEach(t => {
    if (t.parentKey) {
      if (!byParent[t.parentKey]) {
        byParent[t.parentKey] = {
          title: t.parentSummary || t.parentKey,
          ticketKeys: [],
          items: [],
        };
      }
      byParent[t.parentKey].ticketKeys.push(t.key);
      byParent[t.parentKey].items.push(t);
    } else {
      ungrouped.push(t);
    }
  });
  const themes = Object.values(byParent)
    .sort((a, b) => b.items.reduce((s, i) => s + i.valueScore, 0) - a.items.reduce((s, i) => s + i.valueScore, 0))
    .map(g => ({
      title: g.title,
      summary: `${g.items.length} delivered item${g.items.length === 1 ? '' : 's'}`,
      ticketKeys: g.ticketKeys,
    }));

  const byType = {};
  ungrouped.forEach(t => {
    const label = t.type || 'Other';
    if (!byType[label]) byType[label] = [];
    byType[label].push(t);
  });
  Object.entries(byType)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([type, items]) => {
      themes.push({
        title: type,
        summary: items.slice(0, 3).map(i => i.summary).join('; '),
        ticketKeys: items.map(i => i.key),
      });
    });

  return themes.slice(0, THEME_LIMIT);
}

function collectRisks(scored, timeline, reportKind, now) {
  const risks = [];
  const open = scored.filter(t => !t.delivered && !t.dropped);
  const highOpen = open.filter(t => /high|highest|critical|blocker/i.test(t.priority));
  if (highOpen.length) {
    risks.push({
      kind: 'high-priority-open',
      severity: 'high',
      count: highOpen.length,
      title: `${highOpen.length} high-priority item${highOpen.length === 1 ? '' : 's'} still open`,
      detail: 'These should be called out in the company briefing — they are visible, time-sensitive, or blocking others.',
      ticketKeys: highOpen.slice(0, 12).map(t => t.key),
    });
  }

  const openCommitments = open.filter(t => hasCustomerCommitment(t.customerCommitment));
  if (openCommitments.length) {
    risks.push({
      kind: 'customer-commitment',
      severity: 'high',
      count: openCommitments.length,
      title: `${openCommitments.length} customer-committed item${openCommitments.length === 1 ? '' : 's'} not delivered`,
      detail: 'Customer commitments that miss the release create commercial and trust risk.',
      ticketKeys: openCommitments.slice(0, 12).map(t => t.key),
    });
  }

  const onHold = scored.filter(t => t.onHold);
  if (onHold.length) {
    risks.push({
      kind: 'on-hold',
      severity: 'medium',
      count: onHold.length,
      title: `${onHold.length} ticket${onHold.length === 1 ? '' : 's'} on hold`,
      detail: 'On-hold work is parked without a finish date. Confirm whether it is in or out of this release.',
      ticketKeys: onHold.slice(0, 12).map(t => t.key),
    });
  }

  const developing = open.filter(t => t.phase === 'Developing' || t.phase === 'Developer Pending');
  const stale = developing.filter(t => {
    if (!t.lastActivity) return false;
    return daysBetween(t.lastActivity, now) >= STALE_DAYS;
  });
  if (stale.length) {
    risks.push({
      kind: 'stale-dev',
      severity: 'medium',
      count: stale.length,
      title: `${stale.length} in-development ticket${stale.length === 1 ? '' : 's'} with no movement in ${STALE_DAYS}+ days`,
      detail: 'Stale development work often hides blockers, missing owners, or scope that will slip.',
      ticketKeys: stale.slice(0, 12).map(t => t.key),
    });
  }

  const blocked = open.filter(t => BLOCKED_RE.test(t.status) || BLOCKED_RE.test(t.summary));
  if (blocked.length) {
    risks.push({
      kind: 'blocked',
      severity: 'high',
      count: blocked.length,
      title: `${blocked.length} blocked or impeded ticket${blocked.length === 1 ? '' : 's'}`,
      detail: 'Explicit blockers will not clear without intervention.',
      ticketKeys: blocked.slice(0, 12).map(t => t.key),
    });
  }

  const missingEst = open.filter(t => t.estimate <= 0 && t.phase !== 'Product');
  if (missingEst.length >= 3) {
    risks.push({
      kind: 'missing-estimate',
      severity: 'low',
      count: missingEst.length,
      title: `${missingEst.length} in-flight tickets have no dev estimate`,
      detail: 'Without estimates, remaining effort and slip risk cannot be sized for leadership.',
      ticketKeys: missingEst.slice(0, 12).map(t => t.key),
    });
  }

  const overruns = scored.filter(t => t.estimate > 0 && t.actual > t.estimate * 1.5);
  if (overruns.length) {
    risks.push({
      kind: 'overrun',
      severity: 'medium',
      count: overruns.length,
      title: `${overruns.length} ticket${overruns.length === 1 ? '' : 's'} running well over estimate`,
      detail: 'Actual days exceed 1.5× the estimate — remaining work may still grow.',
      ticketKeys: overruns.slice(0, 12).map(t => t.key),
    });
  }

  const ff = timeline.items.find(m => m.id === 'FF');
  const ga = timeline.items.find(m => m.id === 'GA');
  const stillDev = developing.length;
  if (ff && ff.past && stillDev) {
    risks.push({
      kind: 'feature-freeze',
      severity: 'high',
      count: stillDev,
      title: `Feature Freeze has passed with ${stillDev} item${stillDev === 1 ? '' : 's'} still in development`,
      detail: `Feature Freeze was ${ff.date}. Development after freeze is a release-content risk.`,
      ticketKeys: developing.slice(0, 12).map(t => t.key),
    });
  }
  if (ga && ga.past && open.length) {
    risks.push({
      kind: 'ga-passed',
      severity: reportKind === 'end-of-release' ? 'high' : 'medium',
      count: open.length,
      title: `GA date has passed with ${open.length} item${open.length === 1 ? '' : 's'} still open`,
      detail: `General Availability was ${ga.date}. Open work is either a slip or needs an explicit carry-over decision.`,
      ticketKeys: open.slice(0, 12).map(t => t.key),
    });
  }

  const qa = open.filter(t => t.phase === 'QA');
  const vr = timeline.items.find(m => m.id === 'VR');
  if (qa.length >= 5 && ((vr && vr.past) || (ff && ff.past))) {
    risks.push({
      kind: 'qa-bottleneck',
      severity: 'medium',
      count: qa.length,
      title: `QA bottleneck: ${qa.length} tickets in validation`,
      detail: 'A large QA queue near freeze/validation dates can miss the remaining quality window.',
      ticketKeys: qa.slice(0, 12).map(t => t.key),
    });
  }

  const remainingDays = open.reduce((s, t) => s + Math.max(0, t.estimate - t.actual), 0);
  if (timeline.next && remainingDays > 0 && timeline.next.daysAway < remainingDays) {
    risks.push({
      kind: 'effort-vs-milestone',
      severity: 'medium',
      count: remainingDays,
      title: `Remaining estimated effort (${remainingDays.toFixed(0)} days) exceeds time to ${timeline.next.label} (${timeline.next.daysAway} days)`,
      detail: 'Even with no new surprises, current estimates do not fit the next dated milestone.',
      ticketKeys: open.filter(t => t.estimate > 0).sort((a, b) => (b.estimate - b.actual) - (a.estimate - a.actual)).slice(0, 8).map(t => t.key),
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return risks.sort((a, b) => order[a.severity] - order[b.severity] || 0);
}

function plural(n, one, many) {
  return n === 1 ? one : (many || one + 's');
}

function portfolioRiskTitle(kind, count, projectCount) {
  const across = `across ${projectCount} ${plural(projectCount, 'project')}`;
  switch (kind) {
    case 'high-priority-open':
      return `${count} high-priority ${plural(count, 'item')} still open ${across}`;
    case 'customer-commitment':
      return `${count} customer-committed ${plural(count, 'item')} not delivered ${across}`;
    case 'on-hold':
      return `${count} ${plural(count, 'ticket')} on hold ${across}`;
    case 'stale-dev':
      return `${count} in-development ${plural(count, 'ticket')} with no movement in ${STALE_DAYS}+ days ${across}`;
    case 'blocked':
      return `${count} blocked or impeded ${plural(count, 'ticket')} ${across}`;
    case 'missing-estimate':
      return `${count} in-flight tickets have no dev estimate ${across}`;
    case 'overrun':
      return `${count} ${plural(count, 'ticket')} running well over estimate ${across}`;
    case 'feature-freeze':
      return `Feature Freeze has passed with ${count} ${plural(count, 'item')} still in development ${across}`;
    case 'ga-passed':
      return `GA date has passed with ${count} ${plural(count, 'item')} still open ${across}`;
    case 'qa-bottleneck':
      return `QA bottleneck: ${count} tickets in validation ${across}`;
    case 'effort-vs-milestone':
      return `Remaining estimated effort exceeds time to the next milestone ${across}`;
    default:
      return `${count} risk ${plural(count, 'item')} ${across}`;
  }
}

function rollupPortfolioRisks(projectReports) {
  const groups = {};
  const ungrouped = [];
  const sevOrder = { high: 0, medium: 1, low: 2 };
  (projectReports || []).forEach(p => {
    (p.risks || []).forEach(r => {
      const tagged = {
        ...r,
        projectName: p.projectName,
        projectKey: p.projectKey,
      };
      if (!r.kind || r.kind === 'ai' || r.source === 'ai') {
        ungrouped.push(tagged);
        return;
      }
      if (!groups[r.kind]) {
        groups[r.kind] = {
          kind: r.kind,
          severity: r.severity || 'medium',
          count: 0,
          projectNames: [],
          projectKeys: [],
          ticketKeys: [],
          detail: r.detail || '',
        };
      }
      const g = groups[r.kind];
      g.count += Number(r.count) || (r.ticketKeys || []).length || 1;
      if (p.projectName && !g.projectNames.includes(p.projectName)) g.projectNames.push(p.projectName);
      if (p.projectKey && !g.projectKeys.includes(p.projectKey)) g.projectKeys.push(p.projectKey);
      (r.ticketKeys || []).forEach(k => {
        if (k && !g.ticketKeys.includes(k)) g.ticketKeys.push(k);
      });
      if (sevOrder[r.severity] < sevOrder[g.severity]) g.severity = r.severity;
      if (r.detail && !g.detail) g.detail = r.detail;
    });
  });

  const rolled = Object.values(groups).map(g => {
    const who = (g.projectKeys.length ? g.projectKeys : g.projectNames).join(', ');
    return {
      kind: g.kind,
      severity: g.severity,
      count: g.count,
      title: portfolioRiskTitle(g.kind, g.count, g.projectNames.length),
      detail: who ? `${who} — ${g.detail}`.trim() : g.detail,
      ticketKeys: g.ticketKeys.slice(0, 16),
      projectNames: g.projectNames,
      projectKeys: g.projectKeys,
    };
  });

  const extras = ungrouped.map(r => ({
    kind: r.kind || 'other',
    severity: r.severity || 'medium',
    count: r.count || (r.ticketKeys || []).length || 1,
    title: r.title,
    detail: r.projectName ? `${r.projectName}: ${r.detail || ''}`.trim() : (r.detail || ''),
    ticketKeys: r.ticketKeys || [],
    projectNames: r.projectName ? [r.projectName] : [],
    source: r.source,
  }));

  return [...rolled, ...extras].sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || 0);
}

function decoratePortfolioTicket(t, p) {
  const reasons = t.valueReasons || [];
  const notable = reasons.find(r => !/priority/i.test(r)) || reasons[0];
  return {
    ...t,
    projectName: p.projectName,
    projectKey: p.projectKey,
    impact: t.impact || notable || 'Notable from ticket details',
    whyItMatters: t.whyItMatters || reasons.filter(r => !/priority/i.test(r)).slice(0, 3).join(' · ') || notable || t.summary,
  };
}

function portfolioHighValue(projectReports, perProject = 2, cap = 12) {
  const picked = [];
  const seen = new Set();
  const add = (t, p) => {
    if (!t || !t.key || seen.has(t.key)) return false;
    seen.add(t.key);
    picked.push(decoratePortfolioTicket(t, p));
    return true;
  };

  (projectReports || []).forEach(p => {
    const fromHv = (p.highValue || []).filter(t => t.delivered);
    let pool = fromHv;
    if (!pool.length) {
      pool = (p.delivered?.items || []).slice().sort((a, b) => (b.valueScore || 0) - (a.valueScore || 0));
    }
    if (!pool.length) pool = p.highValue || [];
    let n = 0;
    for (const t of pool) {
      if (n >= perProject) break;
      if (add(t, p)) n += 1;
    }
  });
  return picked.slice(0, cap);
}

function attachPortfolioRollups(report) {
  const projects = report.projects || [];
  const highValue = portfolioHighValue(projects);
  const risks = rollupPortfolioRisks(projects);
  const highRiskItems = risks.filter(r => r.severity === 'high');
  report.portfolio = {
    ...(report.portfolio || {}),
    highValue,
    risks,
    topValue: highValue.slice(0, 10),
    topRisks: risks.slice(0, 8),
    highRiskKinds: highRiskItems.length,
  };
  return report;
}

function heuristicNarrative(projectName, releaseName, reportKind, progress, highValue, risks) {
  const kindLabel = reportKind === 'end-of-release' ? 'end-of-release delivery' : 'in-flight release progress';
  const headline = `${projectName} · ${releaseName} — ${progress.deliveredPct}% delivered`;
  const progressBlurb = `${progress.delivered} of ${progress.total} tickets are delivered (${progress.deliveredPct}%). `
    + `${progress.inQa} in QA, ${progress.inDev} in development, ${progress.inProduct} still with product`
    + (progress.onHold ? `, ${progress.onHold} on hold` : '') + '.';
  const valueItems = highValue.filter(t => t.delivered).slice(0, 3);
  const valueBlurb = valueItems.length
    ? `Highest-value delivered work includes ${valueItems.map(t => t.key + ' (' + t.summary + ')').join('; ')}.`
    : (highValue.length
      ? `Highest-value items are still in flight: ${highValue.slice(0, 3).map(t => t.key).join(', ')}.`
      : 'No standout high-value items were identified from ticket details.');
  const highRisks = risks.filter(r => r.severity === 'high');
  const riskBlurb = highRisks.length
    ? `Watch-outs: ${highRisks.map(r => r.title).join('; ')}.`
    : (risks.length ? `No high-severity risks; ${risks.length} medium/low item${risks.length === 1 ? '' : 's'} to monitor.` : 'No material risks identified from current ticket data.');
  const closing = reportKind === 'end-of-release'
    ? `${projectName} ${releaseName} ${kindLabel}: ${progress.deliveredPct}% of scoped tickets closed. ${highRisks.length ? 'Call out remaining risks before declaring the release complete.' : 'Ready to brief the company on what shipped.'}`
    : `${projectName} is ${progress.deliveredPct}% through ${releaseName}. Focus the briefing on delivered value and the ${highRisks.length ? 'open risks above' : 'path to the next milestone'}.`;
  return { headline, progressBlurb, valueBlurb, riskBlurb, closing };
}

function analyzeProject(input) {
  const now = parseDate(input.now) || new Date();
  const fieldIds = {
    est: input.fieldIds?.est || 'customfield_10204',
    act: input.fieldIds?.act || 'customfield_10203',
    scope: input.fieldIds?.scope || 'customfield_10200',
    custcom: input.fieldIds?.custcom || 'customfield_10208',
    clarity: input.fieldIds?.clarity || 'customfield_10202',
  };
  const project = input.project || { key: '', name: 'Project', color: '#185FA5' };
  const release = input.release || { name: 'Release', milestones: {} };
  const milestoneDefs = input.milestones || [];
  const issues = Array.isArray(input.issues) ? input.issues : [];
  const reportKind = resolveReportKind(input.reportMode || 'auto', release, now, milestoneDefs);

  const scored = issues.map(issue => scoreTicket(issue, fieldIds));
  const delivered = scored.filter(t => t.delivered);
  const dropped = scored.filter(t => t.dropped);
  const open = scored.filter(t => !t.delivered && !t.dropped);

  const byPhaseMap = {};
  ['Product', 'Developer Pending', 'Developing', 'QA', 'Rejected / Replied', 'Closed', 'On Hold', 'Other'].forEach(l => { byPhaseMap[l] = 0; });
  scored.forEach(t => { byPhaseMap[t.phase] = (byPhaseMap[t.phase] || 0) + 1; });

  const inQa = byPhaseMap.QA || 0;
  const inDev = (byPhaseMap.Developing || 0) + (byPhaseMap['Developer Pending'] || 0);
  const inProduct = byPhaseMap.Product || 0;
  const onHold = byPhaseMap['On Hold'] || 0;
  const total = scored.length;
  const deliveredPct = total ? Math.round(delivered.length / total * 100) : 0;
  const qaOrClosedPct = total ? Math.round((inQa + delivered.length + dropped.length) / total * 100) : 0;

  const estimateDays = scored.reduce((s, t) => s + t.estimate, 0);
  const actualDays = scored.reduce((s, t) => s + t.actual, 0);
  const remainingDays = open.reduce((s, t) => s + Math.max(0, t.estimate - t.actual), 0);

  const highValue = [...scored]
    .sort((a, b) => b.valueScore - a.valueScore || Number(b.delivered) - Number(a.delivered))
    .filter(t => t.valueScore >= 20 || t.customerCommitment)
    .slice(0, HIGH_VALUE_LIMIT);

  if (highValue.length < 4) {
    const extra = [...scored]
      .sort((a, b) => b.valueScore - a.valueScore)
      .filter(t => !highValue.some(h => h.key === t.key))
      .slice(0, 4 - highValue.length);
    highValue.push(...extra);
  }

  const timeline = milestoneTimeline(release, milestoneDefs, now);
  const risks = collectRisks(scored, timeline, reportKind, now);
  const themes = groupDeliveredThemes(scored);
  const narrative = heuristicNarrative(project.name, release.name, reportKind, {
    total, delivered: delivered.length, deliveredPct, inQa, inDev, inProduct, onHold,
  }, highValue, risks);

  const highRiskCount = risks.filter(r => r.severity === 'high').length;
  const hvDelivered = highValue.filter(t => t.delivered).length;
  const hvPct = highValue.length ? hvDelivered / highValue.length : deliveredPct / 100;
  const health = Math.max(0, Math.min(100, Math.round(
    deliveredPct * 0.45
    + (100 - Math.min(100, highRiskCount * 18 + risks.length * 4)) * 0.3
    + hvPct * 100 * 0.25
  )));

  const phaseColors = {
    Product: '533AB7',
    'Developer Pending': '854F0B',
    Developing: '185FA5',
    QA: '0F6E56',
    'Rejected / Replied': 'C47A0F',
    Closed: '555555',
    'On Hold': 'A32D2D',
    Other: '888780',
  };

  return {
    projectKey: project.key,
    projectName: project.name,
    projectColor: (project.color || '#185FA5').replace('#', ''),
    releaseName: release.name,
    reportKind,
    generatedAt: now.toISOString(),
    health,
    progress: {
      total,
      delivered: delivered.length,
      dropped: dropped.length,
      open: open.length,
      inQa,
      inDev,
      inProduct,
      onHold,
      other: byPhaseMap.Other || 0,
      deliveredPct,
      qaOrClosedPct,
      estimateDays,
      actualDays,
      remainingDays,
      byPhase: Object.entries(byPhaseMap)
        .filter(([, c]) => c > 0)
        .map(([label, count]) => ({ label, count, color: phaseColors[label] || '888780' })),
      byType: countBy(scored, t => t.type),
      byPriority: countBy(scored, t => t.priority || 'None'),
    },
    timeline,
    delivered: {
      count: delivered.length,
      items: delivered
        .sort((a, b) => b.valueScore - a.valueScore)
        .slice(0, 40)
        .map(slimTicket),
      themes,
    },
    remaining: {
      count: open.length,
      highPriority: open.filter(t => /high|highest|critical|blocker/i.test(t.priority)).map(slimTicket),
      customerCommitments: open.filter(t => hasCustomerCommitment(t.customerCommitment)).map(slimTicket),
      items: open.sort((a, b) => b.valueScore - a.valueScore).slice(0, 20).map(slimTicket),
    },
    highValue: highValue.map(t => ({
      ...slimTicket(t),
      impact: t.valueReasons[0] || 'Notable from ticket details',
      whyItMatters: t.valueReasons.slice(0, 3).join(' · ') || t.summary,
    })),
    risks,
    narrative,
    dropped: dropped.slice(0, 15).map(slimTicket),
    tickets: scored.map(t => ({
      ...slimTicket(t),
      projectKey: project.key,
      projectName: project.name,
    })),
  };
}

function slimTicket(t) {
  return {
    key: t.key,
    summary: t.summary,
    type: t.type,
    priority: t.priority,
    status: t.status,
    phase: t.phase,
    parentKey: t.parentKey,
    estimate: t.estimate,
    actual: t.actual,
    customerCommitment: t.customerCommitment,
    valueScore: t.valueScore,
    valueReasons: t.valueReasons,
    delivered: t.delivered,
    assignee: t.assignee,
  };
}

function normalizeTicketGroupBy(value) {
  const v = String(value || '').toLowerCase().trim();
  if (v === 'status' || v === 'project' || v === 'project-status') return v;
  return 'project-status';
}

function analyzeRelease(input) {
  const now = input.now || new Date().toISOString();
  const projects = Array.isArray(input.projects) ? input.projects : [];
  const release = input.release || { name: 'Release', milestones: {} };
  const ticketGroupBy = normalizeTicketGroupBy(input.ticketGroupBy);
  const reportKind = resolveReportKind(
    input.reportMode || 'auto',
    release,
    parseDate(now) || new Date(),
    input.milestones || []
  );

  const projectReports = projects.map(p => analyzeProject({
    project: p.project,
    issues: p.issues,
    release,
    milestones: input.milestones,
    fieldIds: input.fieldIds,
    reportMode: reportKind,
    now,
  }));

  const totals = projectReports.reduce((acc, p) => {
    acc.total += p.progress.total;
    acc.delivered += p.progress.delivered;
    acc.open += p.progress.open;
    acc.inQa += p.progress.inQa;
    acc.inDev += p.progress.inDev;
    acc.onHold += p.progress.onHold;
    acc.risks += p.risks.length;
    acc.highRisks += p.risks.filter(r => r.severity === 'high').length;
    return acc;
  }, { total: 0, delivered: 0, open: 0, inQa: 0, inDev: 0, onHold: 0, risks: 0, highRisks: 0 });

  const deliveredPct = totals.total ? Math.round(totals.delivered / totals.total * 100) : 0;
  const report = {
    generatedAt: (parseDate(now) || new Date()).toISOString(),
    releaseName: release.name,
    reportKind,
    ticketGroupBy,
    ai: { used: false },
    projects: projectReports,
    portfolio: {
      projectCount: projectReports.length,
      total: totals.total,
      delivered: totals.delivered,
      deliveredPct,
      open: totals.open,
      inQa: totals.inQa,
      inDev: totals.inDev,
      onHold: totals.onHold,
      highRisks: totals.highRisks,
    },
  };
  return attachPortfolioRollups(report);
}

function mergeAiInsights(report, ai) {
  if (!ai || typeof ai !== 'object') return report;
  const next = { ...report, ai: { used: true, ...(report.ai || {}) } };
  if (ai.headline) next.portfolio = { ...next.portfolio, headline: ai.headline };
  next.projects = (next.projects || []).map(p => {
    const copy = { ...p, narrative: { ...p.narrative } };
    if (ai.progressNarrative) copy.narrative.progressBlurb = ai.progressNarrative;
    if (ai.valueNarrative) copy.narrative.valueBlurb = ai.valueNarrative;
    if (ai.headline && next.projects.length === 1) copy.narrative.headline = ai.headline;
    if (ai.closingMessage) copy.narrative.closing = ai.closingMessage;
    if (Array.isArray(ai.deliveredThemes) && ai.deliveredThemes.length) {
      const forProject = ai.deliveredThemes.filter(th => {
        if (!th.ticketKeys || !th.ticketKeys.length) return true;
        return th.ticketKeys.some(k => (p.delivered.items || []).some(i => i.key === k) || (p.highValue || []).some(i => i.key === k));
      });
      if (forProject.length) {
        copy.delivered = { ...copy.delivered, themes: forProject.map(th => ({
          title: th.title,
          summary: th.summary,
          ticketKeys: th.ticketKeys || [],
        })) };
      }
    }
    if (Array.isArray(ai.highValueItems) && ai.highValueItems.length) {
      const byKey = {};
      ai.highValueItems.forEach(item => { if (item.key) byKey[item.key] = item; });
      copy.highValue = copy.highValue.map(t => {
        const extra = byKey[t.key];
        if (!extra) return t;
        return {
          ...t,
          impact: extra.businessImpact || t.impact,
          whyItMatters: extra.whyItMatters || t.whyItMatters,
        };
      });
      ai.highValueItems.forEach(item => {
        if (!item.key || copy.highValue.some(t => t.key === item.key)) return;
        const found = [...(p.delivered.items || []), ...(p.remaining.items || [])].find(t => t.key === item.key);
        if (found) {
          copy.highValue.push({
            ...found,
            impact: item.businessImpact,
            whyItMatters: item.whyItMatters,
          });
        }
      });
    }
    if (Array.isArray(ai.additionalRisks) && ai.additionalRisks.length) {
      const extras = ai.additionalRisks
        .filter(r => r.title)
        .map(r => ({
          kind: 'ai',
          severity: r.severity || 'medium',
          title: r.title,
          detail: r.detail || '',
          ticketKeys: r.ticketKeys || [],
          source: 'ai',
        }));
      copy.risks = [...copy.risks, ...extras];
    }
    return copy;
  });
  return attachPortfolioRollups(next);
}

const AI_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string', description: 'One-line company briefing headline' },
    progressNarrative: { type: 'string', description: '2-3 sentences on release progress in business language' },
    valueNarrative: { type: 'string', description: '2-3 sentences on the value of what shipped' },
    deliveredThemes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          ticketKeys: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'summary', 'ticketKeys'],
      },
    },
    highValueItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string' },
          businessImpact: { type: 'string' },
          whyItMatters: { type: 'string' },
        },
        required: ['key', 'businessImpact', 'whyItMatters'],
      },
    },
    additionalRisks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          ticketKeys: { type: 'array', items: { type: 'string' } },
        },
        required: ['severity', 'title', 'detail', 'ticketKeys'],
      },
    },
    closingMessage: { type: 'string' },
  },
  required: ['headline', 'progressNarrative', 'valueNarrative', 'deliveredThemes', 'highValueItems', 'additionalRisks', 'closingMessage'],
};

function ticketsForAi(report, maxTickets = 80) {
  const rows = [];
  (report.projects || []).forEach(p => {
    const pool = [];
    const seen = new Set();
    const add = (t, desc) => {
      if (!t || !t.key || seen.has(t.key)) return;
      seen.add(t.key);
      pool.push({ ...t, description: desc || '' });
    };
    (p.highValue || []).forEach(t => add(t));
    (p.delivered.items || []).forEach(t => add(t));
    (p.remaining.customerCommitments || []).forEach(t => add(t));
    (p.remaining.highPriority || []).forEach(t => add(t));
    (p.remaining.items || []).forEach(t => add(t));
    pool.forEach(t => {
      rows.push({
        project: p.projectKey,
        key: t.key,
        summary: t.summary,
        type: t.type,
        priority: t.priority,
        status: t.status,
        estimate: t.estimate,
        customerCommitment: t.customerCommitment,
        valueScore: t.valueScore,
        reasons: t.valueReasons,
        delivered: t.delivered,
      });
    });
  });
  return rows.slice(0, maxTickets);
}

module.exports = {
  PHASES,
  analyzeProject,
  analyzeRelease,
  mergeAiInsights,
  scoreTicket,
  adfToText,
  descriptionText,
  AI_RESPONSE_SCHEMA,
  ticketsForAi,
  resolveReportKind,
  rollupPortfolioRisks,
  portfolioHighValue,
  normalizeTicketGroupBy,
};
