/**
 * Weekly or monthly bug-history counts for Quality Insights.
 * Stages follow the Jira workflow: Grooming, then Developing, then Testing.
 *
 * Browser: window.QualityHistory. Node: module.exports.
 */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.QualityHistory = api;
})(function () {
  'use strict';

  const LANES = ['grooming', 'developing', 'testing'];
  const LANE_RANK = { grooming: 1, developing: 2, testing: 3 };
  const PRIORITY_BANDS = ['Critical', 'High', 'Medium', 'Low'];
  const TYPE_ORDER = [
    'Continuous Sanity Bug',
    'Continuous Sanity Bugs',
    'Bug',
    'Bugs',
    'R&D Pre-GoLive Bug',
    'R&D Pre-GoLive Bugs',
    'R&D Post-GoLive Bug',
    'R&D Post-GoLive Bugs',
  ];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function classifyQualityStatus(status) {
    const s = String(status || '').trim();
    const empty = { closed: false, hold: false, lane: null, role: null, rank: null };
    if (!s) return empty;
    if (/^(closed|done|resolved|cancelled|fixed|dropped|drop)$/i.test(s)
      || /^done\b/i.test(s)
      || /won't\s*fix|all[\s-]*fixed/i.test(s)) {
      return { closed: true, hold: false, lane: null, role: null, rank: 4 };
    }
    if (/^on[\s-]*hold\b/i.test(s)) {
      return { closed: false, hold: true, lane: null, role: null, rank: null };
    }
    if (/creating/i.test(s) && !/test/i.test(s)) {
      return laneState('grooming', 'pending');
    }
    if (/^(qa|pqa|eo|eoa)\b/i.test(s)
      || /pending deployment/i.test(s)
      || /\btesting\b/i.test(s)
      || /accept (reject|reply)/i.test(s)
      || /^(rejected|replied)$/i.test(s)
      || /test planning/i.test(s)) {
      const pending = /pending|draft|planning|preview|creating/i.test(s) && !/testing/i.test(s);
      return laneState('testing', pending ? 'pending' : 'active');
    }
    if (/^dev[\s-]*pending$/i.test(s) || /^dev[\s-]*groomed\b/i.test(s)) {
      return laneState('developing', 'pending');
    }
    if (/groom|design|triage|overview|assess|discover|backlog|unplanned|roadmap/i.test(s) || /^prod\b/i.test(s)) {
      const pending = /pending|backlog|created|discovered|submitted|unplanned|roadmap|not started|^new$|^to do$/i.test(s);
      return laneState('grooming', pending ? 'pending' : 'active');
    }
    if (/^dev[\s-]*(developing|reopened|cr|demo|merged)/i.test(s)
      || /^in progress$/i.test(s)
      || /in development/i.test(s)) {
      return laneState('developing', 'active');
    }
    return empty;
  }

  function laneState(lane, role) {
    return { closed: false, hold: false, lane, role, rank: LANE_RANK[lane] };
  }

  function parseTime(value) {
    if (value instanceof Date) return value.getTime();
    const text = String(value || '').trim();
    const day = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (day) return new Date(+day[1], +day[2] - 1, +day[3], 12, 0, 0, 0).getTime();
    if (/^\d+$/.test(text)) {
      const n = Number(text);
      return n < 1e12 ? n * 1000 : n;
    }
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? NaN : parsed;
  }

  function issueTypeName(issue) {
    const type = issue && issue.fields && issue.fields.issuetype;
    if (!type) return 'Unknown';
    if (typeof type === 'string') return type || 'Unknown';
    return type.name || 'Unknown';
  }

  function issuePriorityName(issue) {
    const priority = issue && issue.fields && issue.fields.priority;
    if (!priority) return 'None';
    if (typeof priority === 'string') return priority || 'None';
    return priority.name || 'None';
  }

  function priorityBand(name) {
    const s = String(name || '').toLowerCase();
    if (/blocker|highest|critical/.test(s)) return 'Critical';
    if (/\bhigh\b|major/.test(s)) return 'High';
    if (/medium|normal/.test(s)) return 'Medium';
    if (/\blow\b|minor|lowest|trivial/.test(s)) return 'Low';
    return 'None';
  }

  function statusTimeline(issue) {
    const fields = (issue && issue.fields) || {};
    const current = (fields.status && (fields.status.name || fields.status)) || '';
    const currentName = typeof current === 'string' ? current : (current.name || '');
    const changes = [];
    (((issue && issue.changelog && issue.changelog.histories) || [])).forEach(history => {
      const time = parseTime(history && history.created);
      (history && history.items || []).forEach(item => {
        if (!item || (item.field !== 'status' && item.fieldId !== 'status')) return;
        changes.push({
          time,
          from: item.fromString || '',
          to: item.toString || '',
        });
      });
    });
    changes.sort((a, b) => (a.time || 0) - (b.time || 0));
    let createdMs = parseTime(fields.created);
    const initial = (changes.length && changes[0].from) ? changes[0].from : currentName;
    if (!Number.isFinite(createdMs)) createdMs = changes.length && Number.isFinite(changes[0].time) ? changes[0].time : NaN;
    if (!Number.isFinite(createdMs)) return null;
    const points = [{ time: createdMs, status: initial }];
    changes.forEach(change => {
      if (!Number.isFinite(change.time)) return;
      points.push({ time: change.time, status: change.to || points[points.length - 1].status });
    });
    return {
      createdMs,
      points,
      type: issueTypeName(issue),
      priority: priorityBand(issuePriorityName(issue)),
    };
  }

  function reduceAt(timeline, t) {
    if (!timeline || t < timeline.createdMs) return null;
    const entered = { grooming: false, developing: false, testing: false };
    let status = timeline.points[0].status;
    function mark(name) {
      const info = classifyQualityStatus(name);
      if (info.lane) entered[info.lane] = true;
    }
    mark(status);
    for (let i = 1; i < timeline.points.length; i++) {
      const point = timeline.points[i];
      if (point.time < timeline.createdMs) continue;
      if (point.time > t) break;
      status = point.status;
      mark(status);
    }
    return { info: classifyQualityStatus(status), entered };
  }

  function emptyStage() {
    return { totalWork: 0, toCome: 0, handled: 0, open: 0, pendingActive: 0 };
  }

  function emptyBucket() {
    return {
      grooming: emptyStage(),
      developing: emptyStage(),
      testing: emptyStage(),
      open: 0,
      active: 0,
      flow: {
        groomingIn: 0, groomingOut: 0,
        developingIn: 0, developingOut: 0,
        testingIn: 0, testingOut: 0,
      },
      priority: { Critical: 0, High: 0, Medium: 0, Low: 0, None: 0 },
      type: {},
    };
  }

  function addSnapshot(bucket, timeline, at) {
    const reduced = reduceAt(timeline, at);
    if (!reduced) return;
    const info = reduced.info;
    const open = !info.closed;
    if (open) {
      bucket.open += 1;
      bucket.priority[timeline.priority] += 1;
      bucket.type[timeline.type] = (bucket.type[timeline.type] || 0) + 1;
      if (info.role === 'active' && info.lane) bucket.active += 1;
    }
    LANES.forEach(lane => {
      const rank = LANE_RANK[lane];
      const stage = bucket[lane];
      const reached = reduced.entered[lane];
      if (reached) stage.totalWork += 1;
      const passed = info.closed || (info.rank != null && info.rank > rank);
      if (reached && passed) stage.handled += 1;
      const upstream = !reached && open && (info.rank == null || info.rank < rank);
      if (upstream) stage.toCome += 1;
      if (info.lane === lane) stage.pendingActive += 1;
      if (open) stage.open += 1;
    });
  }

  function addMove(flow, fromStatus, toStatus) {
    const fromLane = fromStatus ? classifyQualityStatus(fromStatus).lane : null;
    const toLane = toStatus ? classifyQualityStatus(toStatus).lane : null;
    if (fromLane && fromLane !== toLane) flow[fromLane + 'Out'] += 1;
    if (toLane && toLane !== fromLane) flow[toLane + 'In'] += 1;
  }

  function addFlow(bucket, timeline, startExclusive, endInclusive) {
    if (timeline.createdMs > startExclusive && timeline.createdMs <= endInclusive) {
      addMove(bucket.flow, null, timeline.points[0].status);
    }
    for (let i = 1; i < timeline.points.length; i++) {
      const point = timeline.points[i];
      if (point.time <= startExclusive || point.time > endInclusive) continue;
      if (point.time < timeline.createdMs) continue;
      addMove(bucket.flow, timeline.points[i - 1].status, point.status);
    }
  }

  function startOfPeriod(ms, period) {
    const cursor = new Date(ms);
    cursor.setHours(0, 0, 0, 0);
    if (period === 'month') cursor.setDate(1);
    else cursor.setDate(cursor.getDate() - cursor.getDay());
    return cursor;
  }

  function enumeratePeriods(startMs, endMs, period) {
    const periods = [];
    const cursor = startOfPeriod(startMs, period);
    const guard = cursor.getTime() + (366 * 4 * 24 * 60 * 60 * 1000);
    while (cursor.getTime() <= endMs && cursor.getTime() < guard) {
      if (period === 'month') {
        periods.push(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999).getTime());
        cursor.setMonth(cursor.getMonth() + 1);
      } else {
        const end = new Date(cursor);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        periods.push(end.getTime());
        cursor.setDate(cursor.getDate() + 7);
      }
    }
    return periods;
  }

  function formatPeriodLabel(endMs, period) {
    const date = new Date(endMs);
    const month = MONTHS[date.getMonth()];
    if (period === 'month') return month + ' ' + date.getFullYear();
    return month + ' ' + date.getDate();
  }

  function normalizeMilestones(milestones) {
    return (milestones || []).map(item => {
      const time = item && item.date instanceof Date ? item.date.getTime() : parseTime(item && (item.date || item.time));
      if (!Number.isFinite(time)) return null;
      return {
        id: String(item.id || item.label || '').trim(),
        label: String(item.label || item.id || '').trim(),
        color: item.color || '#888888',
        time,
      };
    }).filter(Boolean).sort((a, b) => a.time - b.time);
  }

  function pushSeries(target, key, value) {
    target[key].push(value);
  }

  function buildQualityHistory(issues, options) {
    const opts = options || {};
    const period = opts.period === 'month' ? 'month' : 'week';
    const nowMs = parseTime(opts.now || new Date());
    const timelines = (issues || []).map(statusTimeline).filter(Boolean);
    const milestones = normalizeMilestones(opts.milestones);
    let startMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    timelines.forEach(timeline => {
      if (timeline.createdMs < startMs) startMs = timeline.createdMs;
    });
    milestones.forEach(marker => {
      if (marker.time < startMs) startMs = marker.time;
    });
    let endMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    milestones.forEach(marker => {
      if (marker.time > endMs) endMs = marker.time;
    });
    let periods = enumeratePeriods(startMs, endMs, period);
    let truncated = false;
    if (periods.length > 180) {
      periods = periods.slice(periods.length - 180);
      truncated = true;
    }
    const labels = [];
    const stages = {
      grooming: { totalWork: [], toCome: [], handled: [], open: [], pendingActive: [] },
      developing: { totalWork: [], toCome: [], handled: [], open: [], pendingActive: [] },
      testing: { totalWork: [], toCome: [], handled: [], open: [], pendingActive: [] },
    };
    const flow = {
      groomingIn: [], groomingOut: [],
      developingIn: [], developingOut: [],
      testingIn: [], testingOut: [],
      active: [],
      open: [],
    };
    const typeMap = {};
    const priorityMap = { Critical: [], High: [], Medium: [], Low: [], None: [] };
    let previousEnd = 0;

    periods.forEach(periodEnd => {
      labels.push(formatPeriodLabel(periodEnd, period));
      const future = periodEnd > nowMs && startOfPeriod(periodEnd, period).getTime() > nowMs;
      const at = Math.min(periodEnd, nowMs);
      const bucket = emptyBucket();
      if (!future) {
        timelines.forEach(timeline => addSnapshot(bucket, timeline, at));
        timelines.forEach(timeline => addFlow(bucket, timeline, previousEnd, at));
      }
      LANES.forEach(lane => {
        const stage = stages[lane];
        const counts = bucket[lane];
        pushSeries(stage, 'totalWork', future ? null : counts.totalWork);
        pushSeries(stage, 'toCome', future ? null : counts.toCome);
        pushSeries(stage, 'handled', future ? null : counts.handled);
        pushSeries(stage, 'open', future ? null : counts.open);
        pushSeries(stage, 'pendingActive', future ? null : counts.pendingActive);
      });
      Object.keys(flow).forEach(key => {
        if (key === 'active') flow.active.push(future ? null : bucket.active);
        else if (key === 'open') flow.open.push(future ? null : bucket.open);
        else flow[key].push(future ? null : bucket.flow[key]);
      });
      Object.keys(bucket.type).forEach(label => {
        if (!typeMap[label]) typeMap[label] = [];
      });
      Object.keys(typeMap).forEach(label => {
        while (typeMap[label].length < labels.length - 1) typeMap[label].push(future ? null : 0);
        typeMap[label].push(future ? null : (bucket.type[label] || 0));
      });
      PRIORITY_BANDS.concat('None').forEach(band => {
        priorityMap[band].push(future ? null : bucket.priority[band]);
      });
      previousEnd = at;
    });

    const typeLabels = Object.keys(typeMap).sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a);
      const bi = TYPE_ORDER.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.localeCompare(b);
    });
    const types = typeLabels.map(label => ({ label, data: typeMap[label] }));
    const priorities = PRIORITY_BANDS.concat('None')
      .filter(label => priorityMap[label].some(value => value))
      .map(label => ({ label, data: priorityMap[label] }));

    const markerAt = {};
    milestones.forEach((marker, index) => {
      let idx = -1;
      for (let i = 0; i < periods.length; i++) {
        if (periods[i] >= marker.time) { idx = i; break; }
      }
      if (idx < 0) return;
      const role = index === 0 ? 'start' : (index === milestones.length - 1 ? 'end' : 'mid');
      if (markerAt[idx]) {
        markerAt[idx].label += ' / ' + marker.label;
        markerAt[idx].id += '/' + marker.id;
        if (role === 'start' || role === 'end') markerAt[idx].role = role;
      } else {
        markerAt[idx] = {
          idx,
          id: marker.id,
          label: marker.label,
          color: marker.color,
          role,
        };
      }
    });
    const markers = Object.keys(markerAt).map(key => markerAt[key]).sort((a, b) => a.idx - b.idx);

    return {
      period,
      labels,
      periods,
      truncated,
      stages,
      flow,
      types,
      priorities,
      markers,
    };
  }

  return {
    classifyQualityStatus,
    priorityBand,
    statusTimeline,
    buildQualityHistory,
  };
});
