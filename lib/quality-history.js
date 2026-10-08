/**
 * Weekly or monthly history counts from status changelogs.
 * Stages follow the Jira workflow: Grooming, then Developing, then Testing.
 * Optional groupAt(issue, statusName, info) adds open-ticket series such as
 * phase, project, and scope. Scope is whatever the caller reads now; this
 * file does not reconstruct field history.
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
      issue,
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
    return { info: classifyQualityStatus(status), entered, status };
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
      groups: {},
    };
  }

  function emptyMemberStage() {
    return { totalWork: [], toCome: [], handled: [], open: [], pendingActive: [] };
  }

  function emptyMemberBucket() {
    return {
      open: [],
      active: [],
      stages: {
        grooming: emptyMemberStage(),
        developing: emptyMemberStage(),
        testing: emptyMemberStage(),
      },
      flow: {
        groomingIn: [], groomingOut: [],
        developingIn: [], developingOut: [],
        testingIn: [], testingOut: [],
      },
      priority: { Critical: [], High: [], Medium: [], Low: [], None: [] },
      type: {},
      groups: {},
    };
  }

  function ticketRef(timeline, status, move) {
    const issue = timeline.issue || {};
    const fields = issue.fields || {};
    const key = issue.key || '';
    const dash = key.indexOf('-');
    const ref = {
      key,
      summary: fields.summary || '',
      status: status || '',
      type: timeline.type,
      priority: issuePriorityName(issue),
      project: issue._releaseProject || (dash > 0 ? key.slice(0, dash) : ''),
    };
    if (move) ref.move = move;
    return ref;
  }

  function groupLabel(raw) {
    return String(raw == null || String(raw).trim() === '' ? 'Other' : raw).trim() || 'Other';
  }

  function addSnapshot(bucket, timeline, at, groupAt, members) {
    const reduced = reduceAt(timeline, at);
    if (!reduced) return;
    const info = reduced.info;
    const open = !info.closed;
    const ref = members ? ticketRef(timeline, reduced.status) : null;
    let named = null;
    if (open && typeof groupAt === 'function') {
      try {
        named = groupAt(timeline.issue, reduced.status, info);
      } catch (err) {
        named = null;
      }
    }
    if (open) {
      bucket.open += 1;
      bucket.priority[timeline.priority] += 1;
      bucket.type[timeline.type] = (bucket.type[timeline.type] || 0) + 1;
      if (info.role === 'active' && info.lane) bucket.active += 1;
      if (named && typeof named === 'object') {
        Object.keys(named).forEach(groupId => {
          const label = groupLabel(named[groupId]);
          if (!bucket.groups[groupId]) bucket.groups[groupId] = {};
          bucket.groups[groupId][label] = (bucket.groups[groupId][label] || 0) + 1;
          if (members) {
            if (!members.groups[groupId]) members.groups[groupId] = {};
            if (!members.groups[groupId][label]) members.groups[groupId][label] = [];
            members.groups[groupId][label].push(ref);
          }
        });
      }
      if (members) {
        members.open.push(ref);
        members.priority[timeline.priority].push(ref);
        if (!members.type[timeline.type]) members.type[timeline.type] = [];
        members.type[timeline.type].push(ref);
        if (info.role === 'active' && info.lane) members.active.push(ref);
      }
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
      if (members) {
        const slot = members.stages[lane];
        if (reached) slot.totalWork.push(ref);
        if (reached && passed) slot.handled.push(ref);
        if (upstream) slot.toCome.push(ref);
        if (info.lane === lane) slot.pendingActive.push(ref);
        if (open) slot.open.push(ref);
      }
    });
  }

  function addMove(flow, fromStatus, toStatus, members, timeline) {
    const fromLane = fromStatus ? classifyQualityStatus(fromStatus).lane : null;
    const toLane = toStatus ? classifyQualityStatus(toStatus).lane : null;
    const move = (fromStatus || 'Created') + ' → ' + (toStatus || '');
    if (fromLane && fromLane !== toLane) {
      flow[fromLane + 'Out'] += 1;
      if (members) members.flow[fromLane + 'Out'].push(ticketRef(timeline, toStatus || fromStatus, move));
    }
    if (toLane && toLane !== fromLane) {
      flow[toLane + 'In'] += 1;
      if (members) members.flow[toLane + 'In'].push(ticketRef(timeline, toStatus || '', move));
    }
  }

  function addFlow(bucket, timeline, startExclusive, endInclusive, members) {
    if (timeline.createdMs > startExclusive && timeline.createdMs <= endInclusive) {
      addMove(bucket.flow, null, timeline.points[0].status, members, timeline);
    }
    for (let i = 1; i < timeline.points.length; i++) {
      const point = timeline.points[i];
      if (point.time <= startExclusive || point.time > endInclusive) continue;
      if (point.time < timeline.createdMs) continue;
      addMove(bucket.flow, timeline.points[i - 1].status, point.status, members, timeline);
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
    // Cap the walk so a bad date cannot loop forever. The caller keeps the
    // latest 180 periods, so this ceiling must sit past that window.
    let steps = 0;
    while (cursor.getTime() <= endMs && steps < 600) {
      steps += 1;
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
    const groupMaps = {};
    const groupIds = [];
    const withMembers = !!opts.includeMembers;
    const stageMembers = withMembers ? {
      grooming: emptyMemberStage(),
      developing: emptyMemberStage(),
      testing: emptyMemberStage(),
    } : null;
    const flowMembers = withMembers ? {
      groomingIn: [], groomingOut: [],
      developingIn: [], developingOut: [],
      testingIn: [], testingOut: [],
      active: [],
      open: [],
    } : null;
    const typeMembers = {};
    const priorityMembers = withMembers ? { Critical: [], High: [], Medium: [], Low: [], None: [] } : null;
    const groupMemberMaps = {};
    let previousEnd = 0;

    function noteSeries(map, label, value, blank) {
      if (!map[label]) map[label] = [];
      while (map[label].length < labels.length - 1) map[label].push(blank);
      map[label].push(value);
    }

    function noteGroups(bucketGroups, future, memberGroups) {
      const ids = new Set(groupIds);
      Object.keys(bucketGroups || {}).forEach(id => ids.add(id));
      Object.keys(memberGroups || {}).forEach(id => ids.add(id));
      ids.forEach(id => {
        if (!groupMaps[id]) {
          groupMaps[id] = {};
          groupIds.push(id);
        }
        if (withMembers && !groupMemberMaps[id]) groupMemberMaps[id] = {};
        const counts = (bucketGroups && bucketGroups[id]) || {};
        const listed = (memberGroups && memberGroups[id]) || {};
        Object.keys(counts).forEach(label => {
          if (!groupMaps[id][label]) groupMaps[id][label] = [];
        });
        Object.keys(listed).forEach(label => {
          if (withMembers && !groupMemberMaps[id][label]) groupMemberMaps[id][label] = [];
        });
        Object.keys(groupMaps[id]).forEach(label => {
          while (groupMaps[id][label].length < labels.length - 1) groupMaps[id][label].push(future ? null : 0);
          groupMaps[id][label].push(future ? null : (counts[label] || 0));
          if (!withMembers) return;
          if (!groupMemberMaps[id][label]) groupMemberMaps[id][label] = [];
          while (groupMemberMaps[id][label].length < labels.length - 1) groupMemberMaps[id][label].push(future ? null : []);
          groupMemberMaps[id][label].push(future ? null : (listed[label] || []));
        });
      });
    }

    periods.forEach(periodEnd => {
      labels.push(formatPeriodLabel(periodEnd, period));
      const future = periodEnd > nowMs && startOfPeriod(periodEnd, period).getTime() > nowMs;
      const at = Math.min(periodEnd, nowMs);
      const bucket = emptyBucket();
      const counted = withMembers && !future ? emptyMemberBucket() : null;
      if (!future) {
        timelines.forEach(timeline => addSnapshot(bucket, timeline, at, opts.groupAt, counted));
        timelines.forEach(timeline => addFlow(bucket, timeline, previousEnd, at, counted));
      }
      noteGroups(future ? {} : bucket.groups, future, counted && counted.groups);
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
        if (priorityMembers) priorityMembers[band].push(future || !counted ? null : counted.priority[band]);
      });
      if (withMembers) {
        LANES.forEach(lane => {
          const slot = stageMembers[lane];
          const listed = counted ? counted.stages[lane] : null;
          Object.keys(slot).forEach(key => {
            slot[key].push(future || !listed ? null : listed[key]);
          });
        });
        Object.keys(flowMembers).forEach(key => {
          if (key === 'active') flowMembers.active.push(future || !counted ? null : counted.active);
          else if (key === 'open') flowMembers.open.push(future || !counted ? null : counted.open);
          else flowMembers[key].push(future || !counted ? null : counted.flow[key]);
        });
        const typeLists = counted ? counted.type : {};
        Object.keys(typeLists).forEach(label => noteSeries(typeMembers, label, future ? null : typeLists[label], []));
        Object.keys(typeMembers).forEach(label => {
          if (typeMembers[label].length < labels.length) noteSeries(typeMembers, label, future ? null : [], []);
        });
      }
      previousEnd = at;
    });

    const typeLabels = Object.keys(typeMap).sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a);
      const bi = TYPE_ORDER.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.localeCompare(b);
    });
    const types = typeLabels.map(label => {
      const entry = { label, data: typeMap[label] };
      if (withMembers) entry.tickets = typeMembers[label] || [];
      return entry;
    });
    const priorities = PRIORITY_BANDS.concat('None')
      .filter(label => priorityMap[label].some(value => value))
      .map(label => {
        const entry = { label, data: priorityMap[label] };
        if (withMembers) entry.tickets = priorityMembers[label];
        return entry;
      });

    function sumSeries(data) {
      return (data || []).reduce((sum, value) => sum + (value || 0), 0);
    }

    function mergeTicketSlot(lists, index) {
      let any = false;
      const out = [];
      lists.forEach(list => {
        const slot = list && list[index];
        if (slot == null) return;
        any = true;
        slot.forEach(row => out.push(row));
      });
      if (!any) {
        const allNull = lists.every(list => !list || list[index] == null);
        return allNull ? null : [];
      }
      return out;
    }

    function finalizeGroup(map, order, limit, memberMap) {
      const ordered = Array.isArray(order) ? order : [];
      let seriesLabels = Object.keys(map).filter(label => (map[label] || []).some(value => value));
      seriesLabels.sort((a, b) => {
        const ai = ordered.indexOf(a);
        const bi = ordered.indexOf(b);
        const aRank = ai === -1 ? 1000 : ai;
        const bRank = bi === -1 ? 1000 : bi;
        if (aRank !== bRank) return aRank - bRank;
        const delta = sumSeries(map[b]) - sumSeries(map[a]);
        if (delta) return delta;
        return a.localeCompare(b);
      });
      const cap = Number(limit);
      if (Number.isFinite(cap) && cap >= 1 && seriesLabels.length > cap) {
        const keep = seriesLabels.slice(0, Math.max(cap - 1, 0));
        const rest = seriesLabels.slice(keep.length);
        const length = (map[seriesLabels[0]] || []).length;
        const merged = [];
        const mergedTickets = memberMap ? [] : null;
        for (let i = 0; i < length; i++) {
          let any = false;
          let sum = 0;
          rest.forEach(label => {
            const value = map[label][i];
            if (value == null) return;
            any = true;
            sum += value;
          });
          if (keep.indexOf('Other') !== -1) {
            const kept = map.Other[i];
            merged.push(kept == null && !any ? null : (kept || 0) + sum);
          } else {
            merged.push(any ? sum : (rest.every(label => map[label][i] == null) ? null : sum));
          }
          if (memberMap) {
            const lists = rest.map(label => memberMap[label]);
            if (keep.indexOf('Other') !== -1) lists.unshift(memberMap.Other);
            mergedTickets.push(mergeTicketSlot(lists, i));
          }
        }
        map.Other = merged;
        if (memberMap) memberMap.Other = mergedTickets;
        seriesLabels = keep.indexOf('Other') === -1 ? keep.concat('Other') : keep.slice();
      }
      return seriesLabels
        .filter(label => (map[label] || []).some(value => value))
        .map(label => {
          const entry = { label, data: map[label] };
          if (memberMap) entry.tickets = memberMap[label];
          return entry;
        });
    }

    const limitOpt = opts.groupLimit;
    const orderOpt = opts.groupOrder || {};
    const groups = {};
    Object.keys(groupMaps).forEach(id => {
      const limit = limitOpt && typeof limitOpt === 'object' ? limitOpt[id] : limitOpt;
      groups[id] = finalizeGroup(groupMaps[id], orderOpt[id], limit, withMembers ? groupMemberMaps[id] : null);
    });

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
      groups,
      members: withMembers ? { stages: stageMembers, flow: flowMembers } : null,
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
