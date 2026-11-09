/**
 * Company all-hands PowerPoint for a release delivery report.
 * Uses PptxGenJS. Colors are 6-char hex without '#'.
 */

const { splitReportByKind } = require('./release-report');

function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

function kindLabel(kind) {
  return kind === 'end-of-release' ? 'End of release' : 'Release snapshot';
}

function kindSubtitle(kind, report) {
  const quality = report?.portfolio?.qualityProjectCount || 0;
  const delivery = report?.portfolio?.deliveryProjectCount;
  const deliveryCount = delivery == null
    ? (report?.projects || []).filter(p => p.insightKind !== 'quality').length
    : delivery;
  if (quality && !deliveryCount) {
    return kind === 'end-of-release'
      ? 'Open defects and support tickets remaining after GA'
      : 'Bugs and support tickets for this market release and its patches';
  }
  if (quality && deliveryCount) {
    return kind === 'end-of-release'
      ? 'Feature delivery plus remaining bugs and support tickets'
      : 'Feature progress, plus quality/support load on patches';
  }
  return kind === 'end-of-release'
    ? 'What we delivered, the value it created, and remaining risks'
    : 'Progress, value delivered so far, and risks to the remaining plan';
}

function formatDate(iso) {
  if (!iso) return '';
  const s = String(iso);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function severityColor(sev) {
  if (sev === 'high') return 'A32D2D';
  if (sev === 'medium') return '7A4808';
  return '555555';
}

function makeShadow() {
  return { type: 'outer', color: '000000', blur: 6, offset: 2, angle: 135, opacity: 0.1 };
}

// Delivery slides use the blue theme, quality slides the orange/crimson one,
// so the two sections are instantly distinguishable.
const THEMES = {
  delivery: { name: 'DELIVERY', accent: '185FA5', dark: '0B1F3A', soft: 'E6F1FB', glow: '2F7FD0', light: '7EB6E8', footerText: 'C5D4E8' },
  quality: { name: 'QUALITY', accent: 'D9480F', dark: '3B0F0F', soft: 'FDEBE3', glow: 'F0793F', light: 'FFB38A', footerText: 'F3CFC0' },
};
let THEME = THEMES.delivery;
function setTheme(name) { THEME = THEMES[name] || THEMES.delivery; }

function addFooter(slide, report, extra) {
  slide.addShape('rect', {
    x: 0, y: 5.35, w: 10, h: 0.275,
    fill: { color: THEME.dark }, line: { color: THEME.dark },
  });
  slide.addShape('rect', {
    x: 0, y: 5.33, w: 10, h: 0.03,
    fill: { color: THEME.accent }, line: { color: THEME.accent },
  });
  slide.addText(clip(`${report.releaseName || 'Release'}  ·  Internal company briefing${extra ? '  ·  ' + extra : ''}`, 90), {
    x: 0.35, y: 5.36, w: 8.2, h: 0.24,
    fontFace: 'Calibri', fontSize: 10, color: THEME.footerText, margin: 0, valign: 'middle',
  });
  slide.slideNumber = { x: 9.0, y: 5.36, w: 0.65, h: 0.24, fontFace: 'Calibri', fontSize: 10, color: THEME.footerText, align: 'right' };
}

function addAccentBar(slide) {
  slide.addShape('rect', {
    x: 0, y: 0, w: 0.1, h: 5.625,
    fill: { color: THEME.accent }, line: { color: THEME.accent },
  });
  // Soft decorative circles in the top-right corner, behind the content.
  slide.addShape('ellipse', {
    x: 8.6, y: -0.9, w: 2.2, h: 2.2,
    fill: { color: THEME.accent, transparency: 90 }, line: { color: THEME.accent, transparency: 100 },
  });
  slide.addShape('ellipse', {
    x: 9.3, y: -0.35, w: 1.2, h: 1.2,
    fill: { color: THEME.glow, transparency: 82 }, line: { color: THEME.glow, transparency: 100 },
  });
}

function addTitleBlock(slide, title, subtitle) {
  slide.addText(THEME.name, {
    x: 7.6, y: 0.1, w: 2.0, h: 0.2,
    fontFace: 'Calibri', fontSize: 9, bold: true, charSpacing: 3, color: THEME.accent, align: 'right', margin: 0,
  });
  slide.addText(title, {
    x: 0.4, y: 0.22, w: 9.2, h: 0.42,
    fontFace: 'Calibri', fontSize: 24, bold: true, color: THEME.dark, margin: 0,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.4, y: 0.62, w: 9.2, h: 0.28,
      fontFace: 'Calibri', fontSize: 12, color: '5A5955', margin: 0,
    });
  }
}

function tableHead(text) {
  return {
    text,
    options: { fill: { color: THEME.dark }, color: 'FFFFFF', bold: true, align: 'left', valign: 'middle' },
  };
}

function isMultiProject(report) {
  return (report.projects || []).length > 1;
}

function addKpi(slide, x, y, w, h, value, label, accent) {
  slide.addShape('rect', {
    x, y, w, h,
    fill: { color: 'FFFFFF' },
    line: { color: 'E4E2DC' },
    shadow: makeShadow(),
  });
  slide.addShape('rect', {
    x, y, w: 0.08, h,
    fill: { color: accent }, line: { color: accent },
  });
  slide.addText(String(value), {
    x: x + 0.18, y: y + 0.12, w: w - 0.28, h: 0.5,
    fontFace: 'Calibri', fontSize: 28, bold: true, color: accent, margin: 0,
  });
  slide.addText(label, {
    x: x + 0.18, y: y + 0.62, w: w - 0.28, h: Math.max(0.32, h - 0.7), valign: 'top',
    fontFace: 'Calibri', fontSize: 11, color: '5A5955', margin: 0,
  });
}

function addTitleSlide(pres, report) {
  const slide = pres.addSlide();
  slide.background = { color: '0B1F3A' };
  // Decorative layered circles on the right and a multi-color accent strip on the left.
  [
    { x: 6.4, y: -1.6, d: 5.0, c: '185FA5', t: 82 },
    { x: 7.6, y: 1.1, d: 3.6, c: '0F9D8A', t: 80 },
    { x: 5.9, y: 3.2, d: 2.6, c: 'F2A900', t: 84 },
    { x: 8.7, y: 3.9, d: 1.9, c: 'E4572E', t: 80 },
  ].forEach(o => slide.addShape('ellipse', {
    x: o.x, y: o.y, w: o.d, h: o.d,
    fill: { color: o.c, transparency: o.t }, line: { color: o.c, transparency: 100 },
  }));
  ['185FA5', '0F9D8A', 'F2A900', 'E4572E'].forEach((c, i) => slide.addShape('rect', {
    x: 0, y: i * 1.40625, w: 0.18, h: 1.40625, fill: { color: c }, line: { color: c },
  }));
  const multi = (report.projects || []).length > 1;
  const projectLine = multi
    ? `${report.portfolio.projectCount} projects`
    : (report.projects[0]?.projectName || 'Project');
  slide.addText(kindLabel(report.reportKind).toUpperCase(), {
    x: 0.7, y: 1.15, w: 8.6, h: 0.32,
    fontFace: 'Calibri', fontSize: 12, bold: true, color: '7EB6E8', margin: 0, charSpacing: 2,
  });
  slide.addText(report.releaseName || 'Release', {
    x: 0.7, y: 1.5, w: 8.6, h: 0.7,
    fontFace: 'Calibri', fontSize: 36, bold: true, color: 'FFFFFF', margin: 0,
  });
  slide.addText(projectLine, {
    x: 0.7, y: 2.22, w: 8.6, h: 0.4,
    fontFace: 'Calibri', fontSize: 20, color: 'D5E4F5', margin: 0,
  });
  slide.addText(kindSubtitle(report.reportKind, report), {
    x: 0.7, y: 2.85, w: 8.6, h: 0.5,
    fontFace: 'Calibri', fontSize: 14, color: '9BB3CC', margin: 0,
  });
  const p = report.portfolio;
  if (p && p.total != null) {
    const stats = [
      [String(p.total), 'Tickets in scope'],
      [`${p.deliveredPct || 0}%`, 'Delivered'],
      [String(p.open || 0), 'Still open'],
      [String(p.highRisks || 0), 'High risks'],
    ];
    const statColors = ['7EB6E8', '6EE7B7', 'FCD34D', 'FCA5A5'];
    slide.addShape('line', { x: 0.7, y: 3.7, w: 8.6, h: 0, line: { color: '2C4A70', width: 1 } });
    stats.forEach(([value, label], i) => {
      const sx = 0.7 + i * 2.15;
      slide.addText(value, {
        x: sx, y: 3.85, w: 2, h: 0.55,
        fontFace: 'Calibri', fontSize: 32, bold: true, color: statColors[i], margin: 0,
      });
      slide.addText(label, {
        x: sx, y: 4.4, w: 2, h: 0.28,
        fontFace: 'Calibri', fontSize: 12, color: '9BB3CC', margin: 0,
      });
    });
  }
  slide.addText(`Generated ${formatDate(report.generatedAt)}  ·  For internal company presentation`, {
    x: 0.7, y: 4.85, w: 8.6, h: 0.28,
    fontFace: 'Calibri', fontSize: 12, color: '7A8EA3', margin: 0,
  });
}

/** Full-bleed section divider so delivery and quality read as separate chapters. */
function addDividerSlide(pres, report, themeName, heading, blurb, stats) {
  const t = THEMES[themeName];
  const slide = pres.addSlide();
  slide.background = { color: t.dark };
  [
    { x: 5.8, y: -1.2, d: 5.4, c: t.accent, tr: 70 },
    { x: 7.4, y: 1.8, d: 3.8, c: t.glow, tr: 78 },
    { x: 4.9, y: 3.6, d: 2.3, c: t.light, tr: 86 },
  ].forEach(o => slide.addShape('ellipse', {
    x: o.x, y: o.y, w: o.d, h: o.d,
    fill: { color: o.c, transparency: o.tr }, line: { color: o.c, transparency: 100 },
  }));
  slide.addShape('rect', { x: 0, y: 0, w: 0.18, h: 5.625, fill: { color: t.accent }, line: { color: t.accent } });
  slide.addText(t.name, {
    x: 0.7, y: 1.6, w: 8, h: 0.3,
    fontFace: 'Calibri', fontSize: 13, bold: true, charSpacing: 4, color: t.light, margin: 0,
  });
  slide.addText(heading, {
    x: 0.7, y: 1.95, w: 7, h: 0.9,
    fontFace: 'Calibri', fontSize: 40, bold: true, color: 'FFFFFF', margin: 0,
  });
  slide.addText(blurb, {
    x: 0.7, y: 2.9, w: 6.2, h: 0.7,
    fontFace: 'Calibri', fontSize: 15, color: 'D5E4F5', margin: 0, valign: 'top',
  });
  (stats || []).forEach(([value, label], i) => {
    const sx = 0.7 + i * 2.1;
    slide.addText(String(value), {
      x: sx, y: 3.9, w: 2, h: 0.55,
      fontFace: 'Calibri', fontSize: 30, bold: true, color: t.light, margin: 0,
    });
    slide.addText(label, {
      x: sx, y: 4.45, w: 2, h: 0.28,
      fontFace: 'Calibri', fontSize: 12, color: 'D5E4F5', margin: 0,
    });
  });
  slide.addText(`${report.releaseName || 'Release'}  ·  Internal company briefing`, {
    x: 0.7, y: 5.1, w: 8.6, h: 0.24,
    fontFace: 'Calibri', fontSize: 10, color: t.footerText, margin: 0,
  });
}

function addPortfolioSlide(pres, report) {
  const p = report.portfolio;
  if (!p || (report.projects || []).length < 2) return;
  const qualityOnly = (p.qualityProjectCount || 0) > 0 && !(p.deliveryProjectCount);
  const slide = pres.addSlide();
  slide.background = { color: 'F7F6F3' };
  addAccentBar(slide);
  addTitleBlock(slide, qualityOnly ? 'Quality at a glance' : 'Release at a glance', `${report.releaseName} across ${p.projectCount} projects`);
  if (qualityOnly) {
    addKpi(slide, 0.4, 1.05, 2.2, 1.05, String(p.qualityOpen || p.open), 'Open tickets', '7A4808');
    addKpi(slide, 2.75, 1.05, 2.2, 1.05, String(p.qualityHighPriority || 0), 'High / critical', 'A32D2D');
    addKpi(slide, 5.1, 1.05, 2.2, 1.05, String(p.open), 'Still open', '7A4808');
    addKpi(slide, 7.45, 1.05, 2.15, 1.05, String(p.highRisks), 'High risks', p.highRisks ? 'A32D2D' : '2D6A10');
  } else {
    addKpi(slide, 0.4, 1.05, 2.2, 1.05, `${p.deliveredPct}%`, 'Delivered', '2D6A10');
    addKpi(slide, 2.75, 1.05, 2.2, 1.05, String(p.delivered), 'Tickets closed', '185FA5');
    addKpi(slide, 5.1, 1.05, 2.2, 1.05, String(p.open), 'Still open', '7A4808');
    addKpi(slide, 7.45, 1.05, 2.15, 1.05, String(p.highRisks), 'High risks', p.highRisks ? 'A32D2D' : '2D6A10');
  }

  const rows = [[
    tableHead('Project'),
    tableHead(qualityOnly ? 'Kind' : 'Delivered'),
    tableHead('Open'),
    tableHead('Health'),
    tableHead(qualityOnly ? 'High / critical' : 'Focus'),
  ]];
  report.projects.forEach(pr => {
    const quality = pr.insightKind === 'quality';
    const hv = (pr.highValue || []).filter(t => t.delivered).length;
    rows.push([
      pr.projectName,
      qualityOnly ? 'Quality' : (quality ? 'Quality' : `${pr.progress.delivered}/${pr.progress.total} (${pr.progress.deliveredPct}%)`),
      String(pr.progress.open),
      String(pr.health),
      quality ? String(pr.quality?.highPriority || 0) : String(hv),
    ]);
  });
  slide.addTable(rows, {
    x: 0.4, y: 2.3, w: 9.2, h: Math.min(2.9, rows.length * 0.36),
    colW: [2.6, 2.2, 1.3, 1.3, 1.8],
    border: { pt: 0.5, color: 'E4E2DC' },
    fontFace: 'Calibri',
    fontSize: 11,
    color: '1A1A18',
    align: 'left',
    valign: 'middle',
  });
  addFooter(slide, report);
}

// ---------------------------------------------------------------------------
// Charts: A + Clarity and status
// ---------------------------------------------------------------------------

const PHASE_ORDER = ['Product', 'Developer Pending', 'Developing', 'QA', 'Rejected / Replied', 'Closed', 'On Hold', 'Other'];
const CLARITY_PALETTE = ['185FA5', '0F9D8A', 'F2A900', '7A5AF8', 'E4572E', '4A90D9'];
const CLARITY_UNSET = 'Not set';
const CLARITY_UNSET_COLOR = 'B4B2A9';
const MAX_CHART_BARS = 7;

function pct(n, total) {
  return total ? Math.round((n / total) * 100) : 0;
}

/** Sum phase counts across projects, in a stable workflow order. */
function statusItems(projects) {
  const map = new Map();
  (projects || []).forEach(pr => {
    (pr.progress?.byPhase || []).forEach(ph => {
      const cur = map.get(ph.label) || { label: ph.label, count: 0, color: ph.color || '185FA5' };
      cur.count += ph.count;
      map.set(ph.label, cur);
    });
  });
  const rank = l => { const i = PHASE_ORDER.indexOf(l); return i < 0 ? 99 : i; };
  return [...map.values()].filter(i => i.count > 0).sort((a, b) => rank(a.label) - rank(b.label));
}

/** Count tickets per A + Clarity value: largest first, "Not set" last. */
function clarityItems(projects) {
  const map = new Map();
  (projects || []).forEach(pr => {
    (pr.tickets || []).forEach(t => {
      const label = String(t.clarity || '').trim() || CLARITY_UNSET;
      map.set(label, (map.get(label) || 0) + 1);
    });
  });
  let rows = [...map.entries()].map(([label, count]) => ({ label, count }));
  const unset = rows.find(r => r.label === CLARITY_UNSET);
  rows = rows.filter(r => r.label !== CLARITY_UNSET).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (rows.length > MAX_CHART_BARS - 1) {
    const rest = rows.slice(MAX_CHART_BARS - 1);
    rows = rows.slice(0, MAX_CHART_BARS - 1);
    rows.push({ label: `Other (${rest.length} values)`, count: rest.reduce((s, r) => s + r.count, 0) });
  }
  rows.forEach((r, i) => { r.color = r.label.startsWith('Other (') ? 'D3D1C7' : CLARITY_PALETTE[i % CLARITY_PALETTE.length]; });
  if (unset) rows.push({ ...unset, color: CLARITY_UNSET_COLOR });
  return rows;
}

function totalOf(items) {
  return items.reduce((s, i) => s + i.count, 0);
}

/** White card holding a titled horizontal bar chart. */
function addChartPanel(pres, slide, o) {
  const { x, y, w, h, title, caption, items, emptyText } = o;
  slide.addShape('rect', {
    x, y, w, h,
    fill: { color: 'FFFFFF' }, line: { color: 'E4E2DC', width: 0.75 },
    shadow: makeShadow(),
  });
  slide.addShape('rect', {
    x, y, w, h: 0.06,
    fill: { color: THEME.accent }, line: { color: THEME.accent },
  });
  slide.addText(title, {
    x: x + 0.2, y: y + 0.16, w: w - 0.4, h: 0.3,
    fontFace: 'Calibri', fontSize: 15, bold: true, color: THEME.dark, margin: 0,
  });
  if (caption) {
    slide.addText(caption, {
      x: x + 0.2, y: y + 0.46, w: w - 0.4, h: 0.26,
      fontFace: 'Calibri', fontSize: 11, color: '5A5955', margin: 0,
    });
  }
  const total = totalOf(items || []);
  if (!total) {
    slide.addText(emptyText || 'No tickets to chart.', {
      x: x + 0.2, y: y + 0.9, w: w - 0.4, h: 0.5,
      fontFace: 'Calibri', fontSize: 12, color: '5A5955', margin: 0,
    });
    return;
  }
  const max = Math.max(...items.map(i => i.count));
  slide.addChart(pres.charts.BAR, [{
    name: 'Tickets',
    labels: items.map(i => `${clip(i.label, 26)}  (${pct(i.count, total)}%)`),
    values: items.map(i => i.count),
  }], {
    x: x + 0.1, y: y + 0.75, w: w - 0.2, h: h - 0.85,
    barDir: 'bar',
    barGapWidthPct: 45,
    chartColors: items.map(i => i.color || '185FA5'),
    catAxisOrientation: 'maxMin',
    catAxisLabelFontFace: 'Calibri',
    catAxisLabelFontSize: w >= 5 ? 12 : 11,
    catAxisLabelColor: '1A1A18',
    catAxisLineShow: false,
    valAxisHidden: true,
    valAxisMinVal: 0,
    valAxisMaxVal: Math.ceil(max * 1.18),
    valGridLine: { style: 'none' },
    catGridLine: { style: 'none' },
    showValue: true,
    dataLabelPosition: 'outEnd',
    dataLabelFontFace: 'Calibri',
    dataLabelFontSize: 12,
    dataLabelFontBold: true,
    dataLabelColor: '0B1F3A',
    dataLabelFormatCode: '#,##0',
    showLegend: false,
    showTitle: false,
    chartArea: { fill: { color: 'FFFFFF' } },
    plotArea: { fill: { color: 'FFFFFF' } },
  });
}

function topItem(items) {
  return items.reduce((best, i) => (!best || i.count > best.count ? i : best), null);
}

function clarityCaption(items) {
  const total = totalOf(items);
  const top = topItem(items.filter(i => i.label !== CLARITY_UNSET));
  if (!total) return '';
  return top
    ? `${total} tickets  ·  most common: ${clip(top.label, 24)} (${pct(top.count, total)}%)`
    : `${total} tickets  ·  A + Clarity is not set on any of them`;
}

function statusCaption(items) {
  const total = totalOf(items);
  const top = topItem(items);
  return total ? `${total} tickets  ·  largest group: ${top.label} (${pct(top.count, total)}%)` : '';
}

function addProgressSlide(pres, report, project, opts) {
  const sections = opts.sections;
  const showStatus = sections.statusChart;
  const showClarity = sections.clarityChart;
  const miles = sections.milestones ? (project.timeline?.items || []).slice(0, 6) : [];
  const wantMiles = sections.milestones;
  if (!showStatus && !showClarity && !wantMiles) return;

  const slide = pres.addSlide();
  slide.background = { color: 'F7F6F3' };
  addAccentBar(slide);
  const quality = project.insightKind === 'quality';
  const title = report.projects.length > 1
    ? `${project.projectName} — ${quality ? 'quality' : 'progress'}`
    : (quality ? 'Quality queue' : 'Release progress');
  const sub = quality
    ? `${project.progress.open} open · ${project.quality?.highPriority || 0} high/critical · ${project.quality?.stale || 0} stale · ${project.quality?.unassigned || 0} unassigned`
    : `${project.progress.delivered} delivered · ${project.progress.inQa} in QA · ${project.progress.inDev} in development · ${project.progress.open} open`;
  addTitleBlock(slide, title, sub);

  const charts = [];
  if (showStatus) {
    const items = statusItems([project]);
    charts.push({ title: 'Tickets by status', caption: statusCaption(items), items });
  }
  if (showClarity) {
    const items = clarityItems([project]);
    charts.push({ title: 'Tickets by A + Clarity', caption: clarityCaption(items), items });
  }

  const hasMilestoneStrip = wantMiles;
  const top = 1.05;
  const chartH = hasMilestoneStrip ? 2.95 : 4.15;
  if (charts.length) {
    const gap = 0.2;
    const w = (9.2 - gap * (charts.length - 1)) / charts.length;
    charts.forEach((c, i) => {
      addChartPanel(pres, slide, { x: 0.4 + i * (w + gap), y: top, w, h: chartH, ...c });
    });
  }

  if (hasMilestoneStrip) {
    const stripY = charts.length ? top + chartH + 0.15 : 1.3;
    const stripH = charts.length ? 1.0 : 1.4;
    if (!miles.length) {
      slide.addText('Add milestone dates in Config → Releases to show the plan against the calendar.', {
        x: 0.4, y: stripY, w: 9.2, h: 0.4,
        fontFace: 'Calibri', fontSize: 12, color: '5A5955', margin: 0,
      });
    } else {
      const nextIdx = miles.findIndex(m => !m.past);
      const gap = 0.1;
      const w = (9.2 - gap * (miles.length - 1)) / miles.length;
      miles.forEach((m, i) => {
        const x = 0.4 + i * (w + gap);
        const isNext = i === nextIdx;
        slide.addShape('rect', {
          x, y: stripY, w, h: stripH,
          fill: { color: isNext ? 'E6F1FB' : 'FFFFFF' },
          line: { color: isNext ? '185FA5' : 'E4E2DC', width: isNext ? 1.25 : 0.75 },
        });
        slide.addText(isNext ? 'NEXT' : (m.past ? 'DONE' : 'UPCOMING'), {
          x: x + 0.1, y: stripY + 0.08, w: w - 0.2, h: 0.2,
          fontFace: 'Calibri', fontSize: 9, bold: true, charSpacing: 1,
          color: isNext ? '185FA5' : '7A7974', margin: 0,
        });
        slide.addText(clip(m.label, 26), {
          x: x + 0.1, y: stripY + 0.3, w: w - 0.2, h: stripH - 0.65,
          fontFace: 'Calibri', fontSize: 12, bold: true, color: m.past ? '5A5955' : '0B1F3A', margin: 0, valign: 'top',
        });
        slide.addText(formatDate(m.date), {
          x: x + 0.1, y: stripY + stripH - 0.32, w: w - 0.2, h: 0.24,
          fontFace: 'Calibri', fontSize: 11, color: '5A5955', margin: 0,
        });
      });
    }
  }
  addFooter(slide, report, project.projectName);
}

/** One slide per chart, covering every selected project together. */
function addCumulativeChartSlide(pres, report, kind) {
  const projects = report.projects || [];
  const isClarity = kind === 'clarity';
  const items = isClarity ? clarityItems(projects) : statusItems(projects);
  const total = totalOf(items);
  const n = projects.length;
  const slide = pres.addSlide();
  slide.background = { color: 'F7F6F3' };
  addAccentBar(slide);
  addTitleBlock(
    slide,
    isClarity ? 'A + Clarity — all projects' : 'Status — all projects',
    `${total} tickets across ${n} project${n === 1 ? '' : 's'}`
  );

  addChartPanel(pres, slide, {
    x: 0.4, y: 1.05, w: 6.2, h: 4.15,
    title: isClarity ? 'Tickets by A + Clarity' : 'Tickets by status',
    caption: isClarity ? clarityCaption(items) : statusCaption(items),
    items,
  });

  const rx = 6.8;
  const rw = 2.8;
  if (isClarity) {
    const rated = items.filter(i => i.label !== CLARITY_UNSET);
    const top = topItem(rated);
    const unset = items.find(i => i.label === CLARITY_UNSET)?.count || 0;
    addKpi(slide, rx, 1.05, rw, 1.2,
      top ? `${pct(top.count, total)}%` : '—',
      top ? `rated ${clip(top.label, 22)}` : 'No clarity values set', '185FA5');
    addKpi(slide, rx, 2.4, rw, 1.2, String(unset), 'tickets with no A + Clarity', unset ? '7A4808' : '2D6A10');
    addKpi(slide, rx, 3.75, rw, 1.2, `${pct(total - unset, total)}%`, 'of tickets have A + Clarity set', '0F6E56');
  } else {
    const sum = fn => projects.reduce((s, p) => s + fn(p.progress || {}), 0);
    const delivered = sum(p => p.delivered || 0);
    const inQa = sum(p => p.inQa || 0);
    const open = sum(p => p.open || 0);
    addKpi(slide, rx, 1.05, rw, 1.2, `${pct(delivered, total)}%`, `delivered (${delivered} of ${total})`, '2D6A10');
    addKpi(slide, rx, 2.4, rw, 1.2, String(inQa), 'tickets in QA', '0F6E56');
    addKpi(slide, rx, 3.75, rw, 1.2, String(open), 'tickets still open', open ? '7A4808' : '2D6A10');
  }
  addFooter(slide, report, 'All projects');
}

// ---------------------------------------------------------------------------
// Quality bug report: overall, Pre Go-Live and Post Go-Live
// ---------------------------------------------------------------------------

const PRE_GOLIVE_RE = /pre[-\s]?go[-\s]?live/i;
const POST_GOLIVE_RE = /post[-\s]?go[-\s]?live/i;
const QUALITY_STALE_DAYS = 14;
const QUALITY_AGE_BANDS = ['0–7 days', '8–14 days', '15–30 days', '31–60 days', '60+ days'];

function priorityRank(priority) {
  const s = String(priority || '').toLowerCase();
  if (/blocker|highest|critical/.test(s)) return 0;
  if (/\bhigh\b|major/.test(s)) return 1;
  if (/medium|normal/.test(s)) return 2;
  if (/\blow\b|minor|lowest|trivial/.test(s)) return 3;
  return 4;
}

function priorityColor(priority) {
  return ['A32D2D', 'C47A0F', '533AB7', '3B6D11', '888780'][priorityRank(priority)];
}

function ageBand(days) {
  const n = Number(days) || 0;
  if (n <= 7) return QUALITY_AGE_BANDS[0];
  if (n <= 14) return QUALITY_AGE_BANDS[1];
  if (n <= 30) return QUALITY_AGE_BANDS[2];
  if (n <= 60) return QUALITY_AGE_BANDS[3];
  return QUALITY_AGE_BANDS[4];
}

/** Tickets for a quality slide set, de-duplicated by key. */
function qualityTickets(report, kind) {
  const seen = new Set();
  const out = [];
  (report.projects || []).forEach(pr => {
    if (pr.insightKind !== 'quality') return;
    (pr.tickets || []).forEach(t => {
      if (seen.has(t.key)) return;
      if (kind === 'pre' && !(PRE_GOLIVE_RE.test(t.type || '') || PRE_GOLIVE_RE.test(t.projectName || ''))) return;
      if (kind === 'post' && !(POST_GOLIVE_RE.test(t.type || '') || POST_GOLIVE_RE.test(t.projectName || ''))) return;
      seen.add(t.key);
      out.push(t);
    });
  });
  return out;
}

function countRows(items, keyFn) {
  const map = new Map();
  items.forEach(t => {
    const k = keyFn(t) || 'Unknown';
    map.set(k, (map.get(k) || 0) + 1);
  });
  return [...map.entries()].map(([label, count]) => ({ label, count }));
}

/**
 * The four Quality Insights breakdowns (priority, phase, age since last status
 * change, project) built from report tickets. The dashboard normally sends the
 * exact numbers from the Quality Insights page in `report.queue`; this is the
 * fallback when it does not.
 */
function queueFromTickets(tickets) {
  const noCommit = /^(no|n\/a|na|none|false|-)$/i;
  return {
    total: tickets.length,
    blockers: tickets.filter(t => priorityRank(t.priority) === 0).length,
    high: tickets.filter(t => priorityRank(t.priority) <= 1).length,
    customer: tickets.filter(t => t.customerCommitment && !noCommit.test(String(t.customerCommitment).trim())).length,
    unowned: tickets.filter(t => t.unassigned).length,
    stale: tickets.filter(t => (t.ageDays || 0) >= QUALITY_STALE_DAYS).length,
    byPriority: countRows(tickets, t => t.priority || 'None'),
    byPhase: countRows(tickets, t => t.phase || 'Other'),
    byAge: countRows(tickets, t => ageBand(t.ageDays)),
    byProject: countRows(tickets, t => (String(t.key || '').match(/^([A-Z][A-Z0-9]+)-\d+/i) || [])[1]?.toUpperCase() || 'Other'),
  };
}

function sortedDesc(rows, color) {
  return [...(rows || [])].filter(r => r.count > 0).sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)))
    .map(r => ({ label: r.label, count: r.count, color }));
}

/**
 * One Quality Insights "card": title, subtitle and a bar list (label, thin
 * rounded bar on a grey track, count) — the same look as the dashboard page.
 */
function addBarListCard(slide, o) {
  const { x, y, w, h, title, subtitle, items } = o;
  slide.addShape('roundRect', {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: 'FFFFFF' }, line: { color: 'E4E2DC', width: 0.75 },
  });
  slide.addText(title, {
    x: x + 0.2, y: y + 0.12, w: w - 0.4, h: 0.24,
    fontFace: 'Calibri', fontSize: 12, bold: true, color: '1A1A18', margin: 0,
  });
  slide.addText(subtitle, {
    x: x + 0.2, y: y + 0.36, w: w - 0.4, h: 0.2,
    fontFace: 'Calibri', fontSize: 9, color: '5A5955', margin: 0,
  });
  if (!items.length) {
    slide.addText('None', { x: x + 0.2, y: y + 0.7, w: 2, h: 0.2, fontFace: 'Calibri', fontSize: 10, color: '9B9A96', margin: 0 });
    return;
  }
  const top = y + 0.66;
  const avail = h - 0.76;
  const rowH = Math.min(0.27, avail / items.length);
  const labelW = 1.2;
  const barX = x + 0.2 + labelW + 0.1;
  const countW = 0.4;
  const barW = w - 0.2 - labelW - 0.1 - countW - 0.2;
  const trackH = 0.07;
  const max = Math.max(1, ...items.map(i => i.count));
  const fontSize = rowH >= 0.24 ? 10 : 9;
  items.forEach((item, i) => {
    const ry = top + i * rowH;
    const cy = ry + rowH / 2;
    slide.addText(clip(item.label, 22), {
      x: x + 0.2, y: ry, w: labelW, h: rowH,
      fontFace: 'Calibri', fontSize, color: '1A1A18', margin: 0, valign: 'middle',
    });
    slide.addShape('roundRect', {
      x: barX, y: cy - trackH / 2, w: barW, h: trackH, rectRadius: trackH / 2,
      fill: { color: 'EEEDE8' }, line: { color: 'EEEDE8', width: 0 },
    });
    slide.addShape('roundRect', {
      x: barX, y: cy - trackH / 2, w: Math.max(0.06, barW * item.count / max), h: trackH, rectRadius: trackH / 2,
      fill: { color: item.color }, line: { color: item.color, width: 0 },
    });
    slide.addText(String(item.count), {
      x: barX + barW + 0.08, y: ry, w: countW, h: rowH,
      fontFace: 'Calibri', fontSize, color: '5A5955', margin: 0, valign: 'middle',
    });
  });
}

/** One slide per quality set, laid out exactly like the Quality Insights "Queue" grid. */
function addQualitySlides(pres, report, kind) {
  const queue = (report.queue && report.queue[kind]) || queueFromTickets(qualityTickets(report, kind));
  if (!queue || !queue.total) return;
  const title = kind === 'pre' ? 'Pre Go-Live bugs'
    : (kind === 'post' ? 'Post Go-Live bugs' : 'Quality bug report');

  const priorityItems = [...(queue.byPriority || [])].filter(r => r.count > 0)
    .sort((a, b) => priorityRank(a.label) - priorityRank(b.label) || b.count - a.count)
    .map(r => ({ ...r, color: priorityColor(r.label) }));
  const phaseItems = sortedDesc(queue.byPhase, '185FA5');
  const ageItems = QUALITY_AGE_BANDS
    .map(label => ({ label, count: ((queue.byAge || []).find(r => r.label === label) || {}).count || 0, color: '7A4808' }))
    .filter(r => r.count > 0);
  const projectItems = sortedDesc(queue.byProject, '533AB7');

  const slide = pres.addSlide();
  slide.background = { color: 'F7F6F3' };
  addAccentBar(slide);
  addTitleBlock(slide, title, `Queue  ·  ${queue.total} ticket${queue.total === 1 ? '' : 's'}${queue.includeClosed === false ? '  ·  closed tickets excluded' : ''}`);
  const gap = 0.14;
  const w = (9.2 - gap) / 2;
  const h = 2.05;
  const y1 = 0.98;
  const y2 = y1 + h + gap;
  addBarListCard(slide, { x: 0.4, y: y1, w, h, title: 'By priority', subtitle: 'Open queue split by Jira priority', items: priorityItems });
  addBarListCard(slide, { x: 0.4 + w + gap, y: y1, w, h, title: 'By phase', subtitle: 'Product = untriaged. Rejected/Replied = bounced from QA.', items: phaseItems });
  addBarListCard(slide, { x: 0.4, y: y2, w, h, title: 'By age since last status change', subtitle: 'Changelog dwell, not last comment', items: ageItems });
  addBarListCard(slide, { x: 0.4 + w + gap, y: y2, w, h, title: 'By project', subtitle: `Jira project key from the Quality JQL${projectItems.length ? ` (${projectItems.map(p => p.label).join(', ')})` : ''}`, items: projectItems });
  addFooter(slide, report, title);
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out.length ? out : [[]];
}

function addHighValueSlides(pres, report) {
  const delivery = (report.projects || []).filter(p => p.insightKind !== 'quality');
  if (!delivery.length) return;
  const multi = isMultiProject(report) && delivery.length > 1;
  const items = (report.projects || []).some(p => p.insightKind === 'quality')
    ? (report.portfolio?.highValue || [])
    : (multi ? (report.portfolio?.highValue || []) : (delivery[0]?.highValue || []).slice(0, 8));
  const title = 'High-value deliverables';
  const baseSub = multi
    ? `Accounting portfolio · top items from each of ${report.portfolio.projectCount} projects`
    : 'Selected from ticket summary, description, commitment, priority, and size';

  if (!items.length) {
    const slide = pres.addSlide();
    slide.background = { color: 'F7F6F3' };
    addAccentBar(slide);
    addTitleBlock(slide, title, baseSub);
    slide.addText('No high-value deliverables were identified from ticket details.', {
      x: 0.4, y: 1.2, w: 9.2, h: 0.5,
      fontFace: 'Calibri', fontSize: 14, color: '5A5955', margin: 0,
    });
    addFooter(slide, report);
    return;
  }

  const pages = chunk(items, multi ? 10 : 6);
  pages.forEach((pageItems, page) => {
    const slide = pres.addSlide();
    slide.background = { color: 'F7F6F3' };
    addAccentBar(slide);
    const sub = pages.length > 1
      ? `${baseSub}  ·  ${page + 1} of ${pages.length}`
      : baseSub;
    addTitleBlock(slide, title, sub);

    if (multi) {
      const rows = [[
        tableHead('Project'),
        tableHead('Ticket'),
        tableHead('Deliverable'),
        tableHead('Status'),
        tableHead('Why it matters'),
      ]];
      pageItems.forEach(item => {
        rows.push([
          clip(item.projectName || '', 28),
          item.key,
          clip(item.summary, 56),
          item.delivered ? 'Delivered' : clip(item.status || 'Open', 16),
          clip(item.impact || item.whyItMatters || '', 48),
        ]);
      });
      slide.addTable(rows, {
        x: 0.4, y: 1.05, w: 9.2, h: Math.min(4.15, rows.length * 0.38),
        colW: [1.9, 1.15, 2.85, 1.15, 2.15],
        border: { pt: 0.5, color: 'E4E2DC' },
        fontFace: 'Calibri',
        fontSize: 11,
        color: '1A1A18',
        align: 'left',
        valign: 'middle',
      });
    } else {
      pageItems.forEach((item, i) => {
        const y = 1.05 + i * 0.68;
        slide.addShape('rect', {
          x: 0.4, y, w: 9.2, h: 0.62,
          fill: { color: 'FFFFFF' },
          line: { color: 'E4E2DC' },
        });
        slide.addText(item.key, {
          x: 0.52, y: y + 0.06, w: 1.35, h: 0.5,
          fontFace: 'Calibri', fontSize: 12, bold: true, color: '185FA5', margin: 0, valign: 'middle',
        });
        const statusNote = item.delivered ? 'Delivered' : clip(item.status || 'Open', 18);
        slide.addText(statusNote, {
          x: 8.15, y: y + 0.06, w: 1.3, h: 0.5,
          fontFace: 'Calibri', fontSize: 11, color: item.delivered ? '2D6A10' : '7A4808', margin: 0, valign: 'middle', align: 'right',
        });
        slide.addText(clip(item.summary, 90), {
          x: 1.9, y: y + 0.05, w: 6.1, h: 0.26,
          fontFace: 'Calibri', fontSize: 13, bold: true, color: '0B1F3A', margin: 0,
        });
        slide.addText(clip(item.impact || item.whyItMatters || '', 110), {
          x: 1.9, y: y + 0.32, w: 6.1, h: 0.24,
          fontFace: 'Calibri', fontSize: 11, color: '5A5955', margin: 0,
        });
      });
    }
    addFooter(slide, report, multi ? 'Accounting portfolio' : report.projects[0]?.projectName);
  });
}

function drawRiskCards(slide, risks) {
  const start = 1.05;
  const maxY = 5.22;
  const slot = Math.min(0.8, (maxY - start) / Math.max(risks.length, 1));
  const h = Math.max(0.52, slot - 0.08);
  risks.forEach((r, i) => {
    const y = start + i * slot;
    slide.addShape('rect', {
      x: 0.4, y, w: 9.2, h,
      fill: { color: 'FFFFFF' },
      line: { color: 'E4E2DC' },
    });
    slide.addShape('rect', {
      x: 0.4, y, w: 0.1, h,
      fill: { color: severityColor(r.severity) }, line: { color: severityColor(r.severity) },
    });
    slide.addText((r.severity || 'medium').toUpperCase(), {
      x: 0.65, y: y + 0.06, w: 1.2, h: Math.min(0.22, h * 0.35),
      fontFace: 'Calibri', fontSize: 10, bold: true, color: severityColor(r.severity), margin: 0,
    });
    slide.addText(clip(r.title, 96), {
      x: 1.9, y: y + 0.04, w: 7.5, h: h * 0.4,
      fontFace: 'Calibri', fontSize: 13, bold: true, color: '0B1F3A', margin: 0,
    });
    slide.addText(clip(r.detail, 150), {
      x: 1.9, y: y + h * 0.44, w: 7.5, h: h * 0.48,
      fontFace: 'Calibri', fontSize: 12, color: '5A5955', margin: 0,
    });
  });
}

function addMustFixSlides(pres, report) {
  const quality = (report.projects || []).filter(p => p.insightKind === 'quality');
  if (!quality.length) return;
  const multi = quality.length > 1 || isMultiProject(report);
  const items = multi
    ? (report.portfolio?.mustFix || [])
    : (quality[0]?.mustFix || []).slice(0, 8);
  const title = 'Must-fix defects and support tickets';
  const baseSub = 'Highest-severity open bugs and support tickets for this market release and its patches';

  if (!items.length) {
    const slide = pres.addSlide();
    slide.background = { color: 'F7F6F3' };
    addAccentBar(slide);
    addTitleBlock(slide, title, baseSub);
    slide.addText('No must-fix quality tickets were identified from current data.', {
      x: 0.4, y: 1.2, w: 9.2, h: 0.5,
      fontFace: 'Calibri', fontSize: 14, color: '5A5955', margin: 0,
    });
    addFooter(slide, report);
    return;
  }

  const pages = chunk(items, multi ? 10 : 6);
  pages.forEach((pageItems, page) => {
    const slide = pres.addSlide();
    slide.background = { color: 'F7F6F3' };
    addAccentBar(slide);
    const sub = pages.length > 1 ? `${baseSub}  ·  ${page + 1} of ${pages.length}` : baseSub;
    addTitleBlock(slide, title, sub);
    if (multi) {
      const rows = [[
        tableHead('Project'),
        tableHead('Ticket'),
        tableHead('Defect / support'),
        tableHead('Priority'),
        tableHead('Why it matters'),
      ]];
      pageItems.forEach(item => {
        rows.push([
          clip(item.projectName || '', 28),
          item.key,
          clip(item.summary, 56),
          clip(item.priority || 'None', 16),
          clip(item.impact || item.whyItMatters || '', 48),
        ]);
      });
      slide.addTable(rows, {
        x: 0.4, y: 1.05, w: 9.2, h: Math.min(4.15, rows.length * 0.38),
        colW: [1.9, 1.15, 2.85, 1.15, 2.15],
        border: { pt: 0.5, color: 'E4E2DC' },
        fontFace: 'Calibri',
        fontSize: 11,
        color: '1A1A18',
        align: 'left',
        valign: 'middle',
      });
    } else {
      pageItems.forEach((item, i) => {
        const y = 1.05 + i * 0.68;
        slide.addShape('rect', {
          x: 0.4, y, w: 9.2, h: 0.62,
          fill: { color: 'FFFFFF' },
          line: { color: 'E4E2DC' },
        });
        slide.addText(item.key, {
          x: 0.52, y: y + 0.06, w: 1.35, h: 0.5,
          fontFace: 'Calibri', fontSize: 12, bold: true, color: 'A32D2D', margin: 0, valign: 'middle',
        });
        slide.addText(clip(item.priority || item.status || 'Open', 18), {
          x: 8.15, y: y + 0.06, w: 1.3, h: 0.5,
          fontFace: 'Calibri', fontSize: 11, color: '7A4808', margin: 0, valign: 'middle', align: 'right',
        });
        slide.addText(clip(item.summary, 90), {
          x: 1.9, y: y + 0.05, w: 6.1, h: 0.26,
          fontFace: 'Calibri', fontSize: 13, bold: true, color: '0B1F3A', margin: 0,
        });
        slide.addText(clip(item.impact || item.whyItMatters || '', 110), {
          x: 1.9, y: y + 0.32, w: 6.1, h: 0.24,
          fontFace: 'Calibri', fontSize: 11, color: '5A5955', margin: 0,
        });
      });
    }
    addFooter(slide, report, 'Quality');
  });
}

function addRisksSlides(pres, report) {
  const multi = isMultiProject(report);
  const risks = multi
    ? (report.portfolio?.risks || [])
    : (report.projects[0]?.risks || []);
  const high = risks.filter(r => r.severity === 'high').length;
  const medium = risks.filter(r => r.severity === 'medium').length;
  const low = risks.filter(r => r.severity === 'low').length;
  const qualityOnly = (report.portfolio?.qualityProjectCount || 0) > 0 && !(report.portfolio?.deliveryProjectCount);
  const title = qualityOnly
    ? 'Quality risks'
    : (multi ? 'Accounting portfolio — risks' : 'Risks and issues');
  const baseSub = multi
    ? `Cumulative across ${report.portfolio.projectCount} projects  ·  ${high} high  ·  ${medium} medium  ·  ${low} low`
    : (risks.length
      ? `${risks.length} item${risks.length === 1 ? '' : 's'} identified from status, commitments, dates, and ticket detail`
      : 'No material risks identified from current data');

  if (!risks.length) {
    const slide = pres.addSlide();
    slide.background = { color: 'F7F6F3' };
    addAccentBar(slide);
    addTitleBlock(slide, title, baseSub);
    slide.addText(qualityOnly
      ? 'Nothing in the synced tickets currently flags as a quality risk (no open high-severity defects, stale support tickets, or unassigned queues).'
      : 'Nothing in the synced tickets currently flags as a release risk (no open high-priority work, customer commitments, freeze slips, or stale development).', {
      x: 0.4, y: 1.2, w: 9.2, h: 1,
      fontFace: 'Calibri', fontSize: 14, color: '2D6A10', margin: 0,
    });
    addFooter(slide, report, multi ? 'Accounting portfolio' : report.projects[0]?.projectName);
    return;
  }

  const pages = chunk(risks, risks.length <= 7 ? Math.max(risks.length, 1) : 5);
  pages.forEach((pageRisks, page) => {
    const slide = pres.addSlide();
    slide.background = { color: 'F7F6F3' };
    addAccentBar(slide);
    const sub = pages.length > 1 ? `${baseSub}  ·  ${page + 1} of ${pages.length}` : baseSub;
    addTitleBlock(slide, title, sub);
    drawRiskCards(slide, pageRisks);
    addFooter(slide, report, multi ? 'Accounting portfolio' : report.projects[0]?.projectName);
  });
}

function sanitizeFilename(name) {
  return String(name || 'release').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'release';
}

function loadPptxGenJS() {
  // pptxgenjs 4.x has no index.js — only dist/pptxgen.cjs.js via "exports".
  // vercel/pkg ignores "exports", so require('pptxgenjs') fails in the standalone
  // exe. A static relative require of the CJS file bypasses that and is bundled.
  try {
    return require('../node_modules/pptxgenjs/dist/pptxgen.cjs.js');
  } catch (directErr) {
    try {
      return require('pptxgenjs');
    } catch (pkgErr) {
      const err = new Error(
        "Cannot find module 'pptxgenjs'. From the Jira Dashboard folder run `npm install`, then restart the app."
      );
      err.cause = directErr;
      throw err;
    }
  }
}

const DECK_SECTIONS = ['portfolio', 'statusChart', 'clarityChart', 'milestones', 'qualityReport', 'preGoLive', 'postGoLive', 'highValue', 'mustFix', 'risks'];

/**
 * options.mode: 'by-project' (detailed slides per project) or 'cumulative'
 * (one A + Clarity slide and one status slide covering all projects).
 * options.sections: booleans per DECK_SECTIONS entry; missing keys default to on.
 */
function normalizeDeckOptions(options) {
  const mode = options && options.mode === 'cumulative' ? 'cumulative' : 'by-project';
  const given = (options && options.sections) || {};
  const sections = {};
  DECK_SECTIONS.forEach(k => { sections[k] = given[k] === undefined ? true : Boolean(given[k]); });
  if (mode === 'cumulative') sections.milestones = false;
  return { mode, sections };
}

/**
 * Delivery slides are built only from delivery projects and quality slides
 * only from quality projects — the two kinds of data are never mixed.
 * `qualityReport` (optional) is a separately generated report of quality
 * projects; when omitted, quality projects inside `report` are used.
 */
async function buildReleaseReportPptx(report, options, qualityReport) {
  const opts = normalizeDeckOptions(options);
  const { mode, sections } = opts;
  const split = splitReportByKind(report);
  const delivery = split.delivery;
  const quality = (qualityReport && splitReportByKind(qualityReport).quality) || split.quality;
  const lead = delivery || quality;
  if (!lead) throw new Error('Missing generated report');
  const PptxGenJS = loadPptxGenJS();
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  pres.title = `${lead.releaseName || 'Release'} briefing`;
  pres.author = 'Jira Dashboard';
  pres.subject = 'Company release briefing';

  addTitleSlide(pres, lead);

  const wantsDelivery = sections.portfolio || sections.clarityChart || sections.statusChart
    || (mode === 'by-project' && sections.milestones) || sections.highValue || sections.risks;
  const wantsQuality = sections.qualityReport || sections.preGoLive || sections.postGoLive
    || sections.mustFix || sections.risks;
  const showDividers = !!(delivery && quality && wantsDelivery && wantsQuality);

  // Delivery section: feature progress, charts, value and risks.
  if (delivery) {
    setTheme('delivery');
    if (showDividers) {
      const p = delivery.portfolio;
      addDividerSlide(pres, delivery, 'delivery', 'Delivery',
        'What we built this release: progress, status, A + Clarity, value delivered and risks.',
        [[`${p.deliveredPct || 0}%`, 'Delivered'], [String(p.total), 'Tickets in scope'], [String(p.open || 0), 'Still open'], [String(p.highRisks || 0), 'High risks']]);
    }
    if (sections.portfolio) addPortfolioSlide(pres, delivery);
    if (mode === 'cumulative') {
      if (sections.clarityChart) addCumulativeChartSlide(pres, delivery, 'clarity');
      if (sections.statusChart) addCumulativeChartSlide(pres, delivery, 'status');
    } else {
      delivery.projects.forEach(project => addProgressSlide(pres, delivery, project, opts));
    }
    if (sections.highValue) addHighValueSlides(pres, delivery);
    if (sections.risks) addRisksSlides(pres, delivery);
  }

  // Quality section: bugs and support tickets, from quality projects only.
  if (quality) {
    setTheme('quality');
    if (showDividers) {
      const q = (quality.queue && quality.queue.all) || queueFromTickets(qualityTickets(quality, 'all'));
      addDividerSlide(pres, quality, 'quality', 'Quality',
        'Bugs and support tickets: how many, how severe, how old, and where they sit.',
        [[String(q.total), 'Tickets'], [String(q.blockers || 0), 'Blocker / critical'], [String(q.customer || 0), 'Customer-impacting'], [String(q.stale || 0), `Stale ${QUALITY_STALE_DAYS}+ days`]]);
    }
    if (sections.qualityReport) addQualitySlides(pres, quality, 'all');
    if (sections.preGoLive) addQualitySlides(pres, quality, 'pre');
    if (sections.postGoLive) addQualitySlides(pres, quality, 'post');
    if (sections.mustFix) addMustFixSlides(pres, quality);
    if (sections.risks) addRisksSlides(pres, quality);
    setTheme('delivery');
  }

  const buf = await pres.write({ outputType: 'nodebuffer' });
  return buf;
}

module.exports = {
  buildReleaseReportPptx,
  normalizeDeckOptions,
  sanitizeFilename,
};
