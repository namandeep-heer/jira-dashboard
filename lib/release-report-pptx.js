/**
 * Company all-hands PowerPoint for a release delivery report.
 * Uses PptxGenJS. Colors are 6-char hex without '#'.
 */

function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

function kindLabel(kind) {
  return kind === 'end-of-release' ? 'End of release' : 'Release snapshot';
}

function kindSubtitle(kind) {
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

function addFooter(slide, report, extra) {
  slide.addShape('rect', {
    x: 0, y: 5.35, w: 10, h: 0.275,
    fill: { color: '0B1F3A' }, line: { color: '0B1F3A' },
  });
  slide.addText(clip(`${report.releaseName || 'Release'}  ·  Internal company briefing${extra ? '  ·  ' + extra : ''}`, 90), {
    x: 0.35, y: 5.36, w: 8.2, h: 0.24,
    fontFace: 'Calibri', fontSize: 10, color: 'C5D4E8', margin: 0, valign: 'middle',
  });
}

function addAccentBar(slide) {
  slide.addShape('rect', {
    x: 0, y: 0, w: 0.1, h: 5.625,
    fill: { color: '185FA5' }, line: { color: '185FA5' },
  });
}

function addTitleBlock(slide, title, subtitle) {
  slide.addText(title, {
    x: 0.4, y: 0.22, w: 9.2, h: 0.42,
    fontFace: 'Calibri', fontSize: 22, bold: true, color: '0B1F3A', margin: 0,
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
    options: { fill: { color: '0B1F3A' }, color: 'FFFFFF', bold: true, align: 'left', valign: 'middle' },
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
    fontFace: 'Calibri', fontSize: 26, bold: true, color: '0B1F3A', margin: 0,
  });
  slide.addText(label, {
    x: x + 0.18, y: y + 0.6, w: w - 0.28, h: 0.32,
    fontFace: 'Calibri', fontSize: 11, color: '5A5955', margin: 0,
  });
}

function addTitleSlide(pres, report) {
  const slide = pres.addSlide();
  slide.background = { color: '0B1F3A' };
  slide.addShape('rect', {
    x: 0, y: 0, w: 0.18, h: 5.625,
    fill: { color: '185FA5' }, line: { color: '185FA5' },
  });
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
  slide.addText(kindSubtitle(report.reportKind), {
    x: 0.7, y: 2.85, w: 8.6, h: 0.5,
    fontFace: 'Calibri', fontSize: 14, color: '9BB3CC', margin: 0,
  });
  slide.addText(`Generated ${formatDate(report.generatedAt)}  ·  For internal company presentation`, {
    x: 0.7, y: 4.85, w: 8.6, h: 0.28,
    fontFace: 'Calibri', fontSize: 12, color: '7A8EA3', margin: 0,
  });
}

function addPortfolioSlide(pres, report) {
  const p = report.portfolio;
  if (!p || (report.projects || []).length < 2) return;
  const slide = pres.addSlide();
  slide.background = { color: 'F7F6F3' };
  addAccentBar(slide);
  addTitleBlock(slide, 'Release at a glance', `${report.releaseName} across ${p.projectCount} projects`);
  addKpi(slide, 0.4, 1.05, 2.2, 1.05, `${p.deliveredPct}%`, 'Delivered', '2D6A10');
  addKpi(slide, 2.75, 1.05, 2.2, 1.05, String(p.delivered), 'Tickets closed', '185FA5');
  addKpi(slide, 5.1, 1.05, 2.2, 1.05, String(p.open), 'Still open', '7A4808');
  addKpi(slide, 7.45, 1.05, 2.15, 1.05, String(p.highRisks), 'High risks', p.highRisks ? 'A32D2D' : '2D6A10');

  const rows = [[
    tableHead('Project'),
    tableHead('Delivered'),
    tableHead('Open'),
    tableHead('Health'),
    tableHead('High-value shipped'),
  ]];
  report.projects.forEach(pr => {
    const hv = (pr.highValue || []).filter(t => t.delivered).length;
    rows.push([
      pr.projectName,
      `${pr.progress.delivered}/${pr.progress.total} (${pr.progress.deliveredPct}%)`,
      String(pr.progress.open),
      String(pr.health),
      String(hv),
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

function addProgressSlide(pres, report, project) {
  const slide = pres.addSlide();
  slide.background = { color: 'F7F6F3' };
  addAccentBar(slide);
  addTitleBlock(slide, report.projects.length > 1 ? `${project.projectName} — progress` : 'Release progress', `${project.progress.delivered} delivered · ${project.progress.inQa} in QA · ${project.progress.inDev} in development · ${project.progress.open} open`);

  const phases = project.progress.byPhase || [];
  if (phases.length) {
    slide.addChart(pres.charts.BAR, [{
      name: 'Tickets',
      labels: phases.map(p => p.label),
      values: phases.map(p => p.count),
    }], {
      x: 0.35, y: 1.05, w: 5.3, h: 3.9,
      barDir: 'bar',
      chartColors: phases.map(p => p.color || '185FA5'),
      chartArea: { fill: { color: 'F7F6F3' } },
      catAxisLabelColor: '5A5955',
      valAxisLabelColor: '5A5955',
      valGridLine: { color: 'E4E2DC', size: 0.5 },
      catGridLine: { style: 'none' },
      showValue: true,
      dataLabelColor: '1A1A18',
      showLegend: false,
      showTitle: false,
    });
  }

  const miles = (project.timeline?.items || []).slice(0, 8);
  slide.addText('Milestone dates', {
    x: 5.8, y: 1.1, w: 3.8, h: 0.3,
    fontFace: 'Calibri', fontSize: 13, bold: true, color: '0B1F3A', margin: 0,
  });
  if (!miles.length) {
    slide.addText('Add milestone dates in Config → Releases to show the plan against the calendar.', {
      x: 5.8, y: 1.5, w: 3.8, h: 1.2,
      fontFace: 'Calibri', fontSize: 12, color: '5A5955', margin: 0,
    });
  } else {
    const lines = miles.map((m, i) => ({
      text: `${m.label}  ·  ${formatDate(m.date)}${m.past ? '  (passed)' : ''}`,
      options: { bullet: false, breakLine: i < miles.length - 1, color: m.past ? '5A5955' : '0B1F3A', bold: !m.past },
    }));
    slide.addText(lines, {
      x: 5.8, y: 1.45, w: 3.8, h: 3.4,
      fontFace: 'Calibri', fontSize: 12, paraSpaceAfter: 8, margin: 0,
    });
  }
  addFooter(slide, report, project.projectName);
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out.length ? out : [[]];
}

function addHighValueSlides(pres, report) {
  const multi = isMultiProject(report);
  const items = multi
    ? (report.portfolio?.highValue || [])
    : (report.projects[0]?.highValue || []).slice(0, 8);
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

function addRisksSlides(pres, report) {
  const multi = isMultiProject(report);
  const risks = multi
    ? (report.portfolio?.risks || [])
    : (report.projects[0]?.risks || []);
  const high = risks.filter(r => r.severity === 'high').length;
  const medium = risks.filter(r => r.severity === 'medium').length;
  const low = risks.filter(r => r.severity === 'low').length;
  const title = multi ? 'Accounting portfolio — risks' : 'Risks and issues';
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
    slide.addText('Nothing in the synced tickets currently flags as a release risk (no open high-priority work, customer commitments, freeze slips, or stale development).', {
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

async function buildReleaseReportPptx(report) {
  const PptxGenJS = loadPptxGenJS();
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  pres.title = `${report.releaseName || 'Release'} delivery report`;
  pres.author = 'Jira Dashboard';
  pres.subject = 'Company release briefing';

  addTitleSlide(pres, report);
  (report.projects || []).forEach(project => {
    addProgressSlide(pres, report, project);
  });
  addPortfolioSlide(pres, report);
  addHighValueSlides(pres, report);
  addRisksSlides(pres, report);

  const buf = await pres.write({ outputType: 'nodebuffer' });
  return buf;
}

module.exports = {
  buildReleaseReportPptx,
  sanitizeFilename,
};
