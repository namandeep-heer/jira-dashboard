/**
 * Release-plan schedule: working-day bars from dev estimates.
 * Browser: window.ReleasePlan. Node: module.exports.
 *
 * Active work sits across today. Further tickets pack after it until the
 * horizon (feature freeze when that date is still ahead). The rest is
 * unscheduled load ("to distribute"). A pinned start replaces the auto date.
 */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ReleasePlan = api;
})(function () {
  'use strict';

  const DAY = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const PERSON_TINTS = ['#F6D5D8', '#DCEAD4', '#D5E4F7', '#F6E6C4', '#E6DDF8', '#D4EDE6', '#F6DCC8', '#E7E5E0'];
  const COMMITMENT_COLORS = {
    committed: '#185FA5',
    stretch: '#7EAFD4',
    opportunistic: '#C4C1B8',
    'customer committed': '#0F6E56',
  };
  const EXTRA_COLORS = ['#6E4B9E', '#8A5A2A', '#3E6B4F', '#8E3D55', '#3D6E8A', '#A15C38', '#2F6F6A', '#7A4E8A'];
  const LANE_COLORS = {
    active: '#185FA5',
    queue: '#9EC3E6',
    finishing: '#3D7A9A',
    hold: '#C4A46A',
    closed: '#B7B5AE',
  };
  const LANE_LABELS = {
    active: 'In development',
    queue: 'Queued',
    finishing: 'In QA',
    hold: 'On hold',
    closed: 'Closed',
  };
  const SIZE = {
    S: { row: 28, day: 22, week: 14, month: 7 },
    M: { row: 32, day: 28, week: 18, month: 9 },
    L: { row: 38, day: 34, week: 22, month: 11 },
    XL: { row: 46, day: 42, week: 28, month: 14 },
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseISO(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!match) return null;
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    if (date.getUTCFullYear() !== +match[1] || date.getUTCMonth() !== +match[2] - 1 || date.getUTCDate() !== +match[3]) return null;
    return date;
  }

  function formatISO(date) {
    if (!date) return '';
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return date.getUTCFullYear() + '-' + month + '-' + day;
  }

  function addDays(date, count) {
    return new Date(date.getTime() + count * DAY);
  }

  function isWeekend(date) {
    const day = date.getUTCDay();
    return day === 0 || day === 6;
  }

  function snapWeekdayForward(date) {
    let cursor = date;
    while (isWeekend(cursor)) cursor = addDays(cursor, 1);
    return cursor;
  }

  function snapWeekdayBack(date) {
    let cursor = date;
    while (isWeekend(cursor)) cursor = addDays(cursor, -1);
    return cursor;
  }

  function countWeekdays(startIso, endIso) {
    let cursor = parseISO(startIso);
    const end = parseISO(endIso);
    if (!cursor || !end || cursor > end) return 0;
    let count = 0;
    while (cursor <= end) {
      if (!isWeekend(cursor)) count += 1;
      cursor = addDays(cursor, 1);
    }
    return count;
  }

  function formatDays(value) {
    if (!Number.isFinite(value)) return '0';
    const rounded = Math.round(value * 10) / 10;
    return String(rounded);
  }

  function positiveDays(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function shiftISO(iso, calendarDays) {
    const parsed = parseISO(iso);
    if (!parsed || !calendarDays) return iso || '';
    let cursor = addDays(parsed, calendarDays);
    if (isWeekend(cursor)) cursor = calendarDays < 0 ? snapWeekdayBack(cursor) : snapWeekdayForward(cursor);
    return formatISO(cursor);
  }

  function moveWorkingDays(iso, count) {
    const parsed = parseISO(iso);
    if (!parsed || !count) return iso || '';
    let cursor = parsed;
    let left = Math.abs(count);
    const dir = count < 0 ? -1 : 1;
    while (left > 0) {
      cursor = addDays(cursor, dir);
      if (!isWeekend(cursor)) left -= 1;
    }
    return formatISO(cursor);
  }

  function spanFrom(startDate, workingDays) {
    let days = Number(workingDays);
    if (!Number.isFinite(days) || days <= 0) days = 1;
    let cursor = snapWeekdayForward(startDate);
    const start = cursor;
    let remaining = days;
    while (remaining > 1) {
      cursor = addDays(cursor, 1);
      if (!isWeekend(cursor)) remaining -= 1;
    }
    const fraction = remaining > 1 ? 1 : Math.max(0.35, remaining);
    return { start, end: cursor, endFraction: fraction >= 0.99 ? 1 : fraction };
  }

  function spanEnding(endDate, workingDays) {
    let days = Number(workingDays);
    if (!Number.isFinite(days) || days <= 0) days = 1;
    let cursor = snapWeekdayBack(endDate);
    const end = cursor;
    let remaining = days;
    while (remaining > 1) {
      cursor = addDays(cursor, -1);
      if (!isWeekend(cursor)) remaining -= 1;
    }
    return { start: cursor, end, endFraction: 1 };
  }

  function nextStart(endDate) {
    return snapWeekdayForward(addDays(endDate, 1));
  }

  function statusLane(status) {
    const name = String(status || '').trim();
    if (/^(closed|done|resolved|cancelled|fixed|all[\s-]*fixed|won't\s*fix)/i.test(name)) return 'closed';
    if (/^(qa|pqa|pending[\s-]*dep|eoa[\s-]*pending|rejected|replied)/i.test(name)) return 'finishing';
    if (/^dev[\s-]*(developing|testing|test|cr|merge|reopened)/i.test(name)) return 'active';
    if (/^(COE\/SEN-Pending|PS-Testing|L2Sup-NeedInfo)$/i.test(name)) return 'active';
    if (/^on[\s-]*hold/i.test(name)) return 'hold';
    return 'queue';
  }

  function priorityRank(name) {
    const text = String(name || '').toLowerCase();
    if (/blocker|highest/.test(text)) return 1;
    if (/critical/.test(text)) return 2;
    if (/\bhigh\b|major/.test(text)) return 3;
    if (/medium|normal/.test(text)) return 4;
    if (/\blow\b|minor/.test(text)) return 5;
    if (/lowest|trivial/.test(text)) return 6;
    return 4;
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length || /^unassigned$/i.test(parts[0])) return '';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function tintFor(name) {
    const text = String(name || '');
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return PERSON_TINTS[hash % PERSON_TINTS.length];
  }

  function commitmentColor(label) {
    const key = String(label || '').trim().toLowerCase();
    if (!key) return '#B7B5AE';
    if (COMMITMENT_COLORS[key]) return COMMITMENT_COLORS[key];
    let hash = 2166136261;
    for (let i = 0; i < key.length; i += 1) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
    return EXTRA_COLORS[(hash >>> 0) % EXTRA_COLORS.length];
  }

  function laneColor(lane) {
    return LANE_COLORS[lane] || LANE_COLORS.queue;
  }

  function devWindow(issue) {
    const fields = (issue && issue.fields) || {};
    const rawStatus = fields.status && (fields.status.name || fields.status);
    const status = typeof rawStatus === 'string' ? rawStatus : '';
    const lane = statusLane(status);
    const events = [];
    const histories = (issue && issue.changelog && issue.changelog.histories) || [];
    histories.forEach(history => {
      const day = String((history && history.created) || '').slice(0, 10);
      if (!parseISO(day)) return;
      (history.items || []).forEach(item => {
        if (!item || (item.field !== 'status' && item.fieldId !== 'status')) return;
        events.push({ day, from: item.fromString || '', to: item.toString || '' });
      });
    });
    events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    let devStarted = '';
    let leftDev = '';
    events.forEach(event => {
      if (statusLane(event.to) === 'active' && !devStarted) devStarted = event.day;
      if (statusLane(event.from) === 'active' && statusLane(event.to) !== 'active') leftDev = event.day;
    });
    if (lane === 'active') leftDev = '';
    return { devStarted, leftDev, lane };
  }

  function resolveHorizon(today, capacityThrough) {
    if (capacityThrough && parseISO(capacityThrough) && capacityThrough >= today) return capacityThrough;
    return formatISO(addDays(parseISO(today), 84));
  }

  function barColor(ticket, colour) {
    if (colour === 'status') return laneColor(ticket.lane);
    return commitmentColor(ticket.commitment);
  }

  function matches(ticket, phases, query) {
    if (Array.isArray(phases) && phases.indexOf(ticket.phase || 'Other') === -1) return false;
    if (query) {
      const hay = (ticket.key + ' ' + (ticket.summary || '') + ' ' + (ticket.developer || '') + ' ' + (ticket.status || '')).toLowerCase();
      if (hay.indexOf(query) === -1) return false;
    }
    return true;
  }

  function placeSpan(startDate, workingDays) {
    const span = spanFrom(startDate, workingDays);
    return {
      start: formatISO(span.start),
      end: formatISO(span.end),
      endFraction: span.endFraction,
      startDate: span.start,
      endDate: span.end,
    };
  }

  function activeSpan(ticket, todayDate, todayIso) {
    const estimate = positiveDays(ticket.estimate) || 1;
    const spentFromClock = ticket.devStarted && ticket.devStarted <= todayIso
      ? countWeekdays(ticket.devStarted, todayIso)
      : 0;
    const spent = Math.max(positiveDays(ticket.actual), spentFromClock);
    const remaining = Math.max(estimate - spent, 0);
    let end = todayDate;
    if (remaining > 0) {
      let left = remaining - 1;
      while (left > 0) {
        end = addDays(end, 1);
        if (!isWeekend(end)) left -= 1;
      }
    }
    const length = remaining > 0 ? estimate : Math.min(Math.max(spent, estimate, 1), estimate + 8);
    const span = spanEnding(end, length);
    return placeSpan(span.start, length);
  }

  function schedulePerson(tickets, todayIso, horizonIso, overrides) {
    const todayDate = parseISO(todayIso);
    const horizonDate = parseISO(horizonIso);
    const pinned = overrides || {};
    const active = [];
    const finishing = [];
    const queue = [];
    tickets.forEach(ticket => {
      const lane = statusLane(ticket.status);
      const copy = Object.assign({}, ticket, { lane });
      if (lane === 'active') active.push(copy);
      else if (lane === 'finishing') finishing.push(copy);
      else if (lane === 'closed') queue.push(copy);
      else queue.push(copy);
    });
    active.sort((a, b) => {
      const as = a.devStarted || '9999-99-99';
      const bs = b.devStarted || '9999-99-99';
      if (as !== bs) return as < bs ? -1 : 1;
      return String(a.key).localeCompare(String(b.key));
    });
    queue.sort((a, b) => {
      const holdA = a.lane === 'hold' ? 1 : 0;
      const holdB = b.lane === 'hold' ? 1 : 0;
      if (holdA !== holdB) return holdA - holdB;
      if (a.lane === 'closed' && b.lane !== 'closed') return 1;
      if (b.lane === 'closed' && a.lane !== 'closed') return -1;
      const rank = priorityRank(a.priority) - priorityRank(b.priority);
      if (rank) return rank;
      return String(a.key).localeCompare(String(b.key));
    });

    const placed = new Map();
    let cursor = todayDate;

    function assign(ticket, span, pinnedStart) {
      placed.set(ticket.key, {
        start: span.start,
        end: span.end,
        endFraction: span.endFraction,
        pinned: !!pinnedStart,
      });
      const after = nextStart(span.endDate);
      if (after > cursor) cursor = after;
    }

    active.forEach((ticket, index) => {
      const pin = pinned[ticket.key];
      if (pin && parseISO(pin)) {
        const length = positiveDays(ticket.estimate) || 1;
        assign(ticket, placeSpan(snapWeekdayForward(parseISO(pin)), length), true);
        return;
      }
      if (index === 0) {
        const span = activeSpan(ticket, todayDate, todayIso);
        assign(ticket, span, false);
        return;
      }
      const length = positiveDays(ticket.estimate) || 1;
      const start = cursor > horizonDate ? null : cursor;
      if (!start) return;
      assign(ticket, placeSpan(start, length), false);
    });

    finishing.forEach(ticket => {
      const pin = pinned[ticket.key];
      const length = Math.min(positiveDays(ticket.estimate) || positiveDays(ticket.actual) || 3, 15);
      if (pin && parseISO(pin)) {
        const span = placeSpan(snapWeekdayForward(parseISO(pin)), length);
        placed.set(ticket.key, { start: span.start, end: span.end, endFraction: span.endFraction, pinned: true });
        return;
      }
      let end = todayDate;
      if (ticket.leftDev && ticket.leftDev <= todayIso && parseISO(ticket.leftDev)) end = parseISO(ticket.leftDev);
      const recent = formatISO(addDays(todayDate, -21));
      if (formatISO(end) < recent) return;
      const span = spanEnding(end, length);
      placed.set(ticket.key, {
        start: formatISO(span.start),
        end: formatISO(span.end),
        endFraction: 1,
        pinned: false,
      });
    });

    queue.forEach(ticket => {
      if (ticket.lane === 'closed') return;
      const estimate = positiveDays(ticket.estimate);
      const pin = pinned[ticket.key];
      if (pin && parseISO(pin)) {
        const span = placeSpan(snapWeekdayForward(parseISO(pin)), estimate || 1);
        placed.set(ticket.key, { start: span.start, end: span.end, endFraction: span.endFraction, pinned: true });
        const after = nextStart(span.endDate);
        if (after > cursor) cursor = after;
        return;
      }
      if (!estimate) return;
      if (formatISO(cursor) > horizonIso) return;
      const span = placeSpan(cursor, estimate);
      placed.set(ticket.key, { start: span.start, end: span.end, endFraction: span.endFraction, pinned: false });
      cursor = nextStart(span.endDate);
    });

    return tickets.map(ticket => {
      const lane = statusLane(ticket.status);
      const bar = placed.get(ticket.key) || null;
      const estimate = positiveDays(ticket.estimate);
      const forward = lane !== 'closed' && lane !== 'finishing';
      const unscheduled = forward && !bar && estimate > 0;
      return Object.assign({}, ticket, {
        lane,
        estimate: estimate || 0,
        hasEstimate: estimate > 0,
        bar,
        forward,
        unscheduled,
      });
    });
  }

  function buildReleasePlan(options) {
    const opts = options || {};
    const today = parseISO(opts.today) ? opts.today : formatISO(new Date());
    const horizonEnd = resolveHorizon(today, opts.capacityThrough || '');
    const zoom = opts.zoom === 'week' || opts.zoom === 'month' ? opts.zoom : 'day';
    const size = SIZE[opts.size] ? opts.size : 'L';
    const colour = opts.colour === 'status' ? 'status' : 'commitment';
    const rows = opts.rows === 'ticket' ? 'ticket' : 'person';
    const phases = Array.isArray(opts.phases) ? opts.phases : null;
    const query = String(opts.query || '').trim().toLowerCase();
    const overrides = opts.overrides && typeof opts.overrides === 'object' ? opts.overrides : {};
    const source = Array.isArray(opts.tickets) ? opts.tickets : [];
    const visible = source.filter(ticket => matches(ticket, phases, query));

    const byPerson = new Map();
    visible.forEach(ticket => {
      const name = String(ticket.developer || '').trim() || 'Unassigned';
      if (!byPerson.has(name)) byPerson.set(name, []);
      byPerson.get(name).push(ticket);
    });

    const names = [...byPerson.keys()].sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });

    const scheduled = [];
    names.forEach(name => {
      schedulePerson(byPerson.get(name), today, horizonEnd, overrides).forEach(ticket => {
        scheduled.push(Object.assign({}, ticket, { developer: name }));
      });
    });

    const capacityDays = countWeekdays(today, horizonEnd);
    let rangeStart = addDays(parseISO(today), zoom === 'month' ? -70 : zoom === 'week' ? -35 : -16);
    let rangeEnd = addDays(parseISO(today), zoom === 'month' ? 140 : zoom === 'week' ? 120 : 36);
    if (zoom === 'month' && parseISO(opts.viewThrough) && opts.viewThrough > formatISO(rangeEnd)) {
      rangeEnd = parseISO(opts.viewThrough);
    }
    scheduled.forEach(ticket => {
      if (!ticket.bar) return;
      const start = parseISO(ticket.bar.start);
      const end = parseISO(ticket.bar.end);
      if (start && start < rangeStart) rangeStart = addDays(start, -2);
      if (end && end > rangeEnd) rangeEnd = addDays(end, 2);
    });

    const milestoneByDay = new Map();
    (opts.milestones || []).forEach(item => {
      if (!item || !parseISO(item.date)) return;
      if (!milestoneByDay.has(item.date)) milestoneByDay.set(item.date, item);
    });

    const days = [];
    for (let cursor = rangeStart; cursor <= rangeEnd; cursor = addDays(cursor, 1)) {
      const iso = formatISO(cursor);
      const mark = milestoneByDay.get(iso);
      days.push({
        iso,
        dow: DOW[cursor.getUTCDay()],
        date: cursor.getUTCDate(),
        weekend: isWeekend(cursor),
        today: iso === today,
        month: MONTHS[cursor.getUTCMonth()],
        year: cursor.getUTCFullYear(),
        milestone: mark ? { id: mark.id, label: mark.label || mark.id, color: mark.color || '#185FA5' } : null,
      });
    }

    function decorate(ticket) {
      return Object.assign({}, ticket, { color: barColor(ticket, colour) });
    }

    function sum(list, pred) {
      return list.reduce((total, ticket) => total + (pred(ticket) ? ticket.estimate : 0), 0);
    }

    const people = names.map(name => {
      let list = scheduled.filter(ticket => ticket.developer === name).map(decorate);
      list.sort((a, b) => {
        const as = a.bar ? a.bar.start : '9999-99-99';
        const bs = b.bar ? b.bar.start : '9999-99-99';
        if (as !== bs) return as < bs ? -1 : 1;
        return String(a.key).localeCompare(String(b.key));
      });
      const load = sum(list, ticket => ticket.forward);
      const unscheduledDays = sum(list, ticket => ticket.unscheduled);
      if (opts.hideUnused) list = list.filter(ticket => ticket.bar);
      return {
        name,
        initials: initials(name),
        tint: tintFor(name),
        load,
        capacity: capacityDays,
        unscheduledDays,
        tickets: list,
      };
    }).filter(group => group.tickets.length);

    let groups;
    if (rows === 'ticket') {
      let flat = people.flatMap(group => group.tickets);
      flat.sort((a, b) => {
        const as = a.bar ? a.bar.start : '9999-99-99';
        const bs = b.bar ? b.bar.start : '9999-99-99';
        if (as !== bs) return as < bs ? -1 : 1;
        return String(a.key).localeCompare(String(b.key));
      });
      groups = flat.length ? [{
        name: '',
        initials: '',
        tint: '',
        load: sum(flat, ticket => ticket.forward),
        capacity: capacityDays * Math.max(people.length, 1),
        unscheduledDays: sum(flat, ticket => ticket.unscheduled),
        tickets: flat,
        flat: true,
      }] : [];
    } else {
      groups = people;
    }

    const legendMap = new Map();
    scheduled.forEach(ticket => {
      if (colour === 'status') {
        if (!legendMap.has(ticket.lane)) legendMap.set(ticket.lane, { label: LANE_LABELS[ticket.lane] || ticket.lane, color: laneColor(ticket.lane) });
      } else {
        const label = String(ticket.commitment || '').trim() || 'No commitment';
        if (!legendMap.has(label)) legendMap.set(label, { label, color: commitmentColor(ticket.commitment) });
      }
    });
    const legendOrder = colour === 'status'
      ? ['active', 'queue', 'finishing', 'hold', 'closed']
      : ['Committed', 'Stretch', 'Opportunistic', 'No commitment'];
    const legend = [...legendMap.entries()].sort((a, b) => {
      const ai = legendOrder.indexOf(colour === 'status' ? a[0] : a[1].label);
      const bi = legendOrder.indexOf(colour === 'status' ? b[0] : b[1].label);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a[1].label.localeCompare(b[1].label);
    }).map(entry => entry[1]);

    const pxPerDay = SIZE[size][zoom];
    const shown = groups.reduce((total, group) => total + group.tickets.length, 0);
    const sectionLoad = people.reduce((total, group) => total + group.load, 0);
    const sectionCapacity = capacityDays * people.length;
    const sectionOpen = people.reduce((total, group) => total + group.unscheduledDays, 0);

    return {
      today,
      horizonEnd,
      capacityDays,
      zoom,
      size,
      colour,
      rows,
      pxPerDay,
      rowHeight: SIZE[size].row,
      days,
      groups,
      people,
      legend,
      shown,
      total: source.length,
      section: {
        load: sectionLoad,
        capacity: sectionCapacity,
        unscheduledDays: sectionOpen,
      },
    };
  }

  function layoutColumns(columns, freezeThrough) {
    const cols = columns || {};
    const estimateInDays = !cols.est;
    const spec = [
      { id: 'name', label: 'Owner / ticket', width: 300 },
      { id: 'days', label: 'Days', width: estimateInDays ? 84 : 52 },
      { id: 'prd', label: 'PRD', width: 48, optional: true },
      { id: 'dev', label: 'DEV', width: 48, optional: true },
      { id: 'qa', label: 'QA', width: 48, optional: true, title: 'Assignee when they are not the developer' },
      { id: 'est', label: 'Dev est', width: 88, optional: true },
      { id: 'developer', label: 'Developer', width: 148, optional: true },
      { id: 'status', label: 'Status', width: 136, optional: true },
    ].filter(col => !col.optional || cols[col.id]);
    const order = spec.map(col => col.id);
    let cut = -1;
    if (freezeThrough === 'all') cut = spec.length - 1;
    else if (freezeThrough && freezeThrough !== 'none') {
      cut = order.indexOf(freezeThrough);
      if (cut < 0) {
        const full = ['name', 'days', 'prd', 'dev', 'qa', 'est', 'developer', 'status'];
        const wanted = full.indexOf(freezeThrough);
        for (let i = spec.length - 1; i >= 0; i -= 1) {
          if (full.indexOf(spec[i].id) < wanted) { cut = i; break; }
        }
      }
    }
    let left = 0;
    const laid = spec.map((col, index) => {
      const frozen = index <= cut;
      const item = {
        id: col.id,
        label: col.label,
        title: col.title || '',
        width: col.width,
        frozen,
        left,
        lastFrozen: false,
      };
      if (frozen) left += col.width;
      return item;
    });
    const lastFrozen = laid.filter(col => col.frozen).pop();
    if (lastFrozen) lastFrozen.lastFrozen = true;
    const metaWidth = laid.reduce((sum, col) => sum + col.width, 0);
    return { cols: laid, frozenWidth: left, metaWidth };
  }

  function headerBands(days, zoom) {
    const bands = [];
    days.forEach(day => {
      const date = parseISO(day.iso);
      let key;
      let label;
      if (zoom === 'month') {
        key = day.year + '-' + day.month;
        label = day.month + ' ' + day.year;
      } else if (zoom === 'week') {
        const weekday = date.getUTCDay();
        const delta = weekday === 0 ? -6 : 1 - weekday;
        const monday = addDays(date, delta);
        key = formatISO(monday);
        label = MONTHS[monday.getUTCMonth()] + ' ' + monday.getUTCDate();
      } else {
        key = day.year + '-' + day.month;
        label = day.month + ' ' + day.year;
      }
      const last = bands[bands.length - 1];
      if (!last || last.key !== key) bands.push({ key, label, span: 1 });
      else last.span += 1;
    });
    return bands;
  }

  function dayOffset(days, iso) {
    const start = parseISO(days[0].iso);
    const date = parseISO(iso);
    if (!start || !date) return 0;
    return Math.round((date.getTime() - start.getTime()) / DAY);
  }

  function chip(load, capacity, unscheduled) {
    const over = load > capacity + 0.01;
    const ratio = '<span class="plan-cap' + (over ? ' is-over' : ' is-ok') + '">' + (over ? '▲ ' : '') + esc(formatDays(load)) + '/' + esc(formatDays(capacity)) + 'd</span>';
    if (unscheduled > 0 && load === unscheduled) {
      return '<span class="plan-cap is-open">→ ' + esc(formatDays(unscheduled)) + 'd to distribute</span>';
    }
    if (unscheduled > 0) {
      return ratio + '<span class="plan-cap is-open">→ ' + esc(formatDays(unscheduled)) + 'd</span>';
    }
    return ratio;
  }

  function initialsHtml(name) {
    const text = initials(name);
    if (!text) return '';
    return '<span class="plan-init" style="background:' + tintFor(name) + '">' + esc(text) + '</span>';
  }

  function editButton(key, field, label, inner, className) {
    return '<button type="button" class="plan-edit' + (className ? ' ' + className : '') + '" data-plan-edit="' + esc(field) + '" data-key="' + esc(key) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + inner + '</button>';
  }

  function daysInput(ticket) {
    const shown = ticket.hasEstimate ? formatDays(ticket.estimate) : '';
    const missing = shown === '' ? ' is-missing' : '';
    return '<input class="jw-days plan-days-input' + missing + '" type="number" min="0" max="100000" step="0.5" inputmode="decimal"'
      + ' aria-label="' + esc('Dev estimate for ' + ticket.key) + '" placeholder="Add" value="' + esc(shown) + '"'
      + ' data-key="' + esc(ticket.key) + '" data-field="cf_devest" data-original="' + esc(shown) + '"'
      + ' onkeydown="JiraWrite.onDaysKey(event)" onblur="JiraWrite.onDaysBlur(event)">';
  }

  function renderReleasePlanBoard(model, view) {
    const plan = model || buildReleasePlan();
    const columns = (view && view.columns) || {};
    const linkBase = String((view && view.linkBase) || '').replace(/\/+$/, '');
    const freezeThrough = (view && view.freezeThrough) || 'all';
    const layout = layoutColumns(columns, freezeThrough);
    const editable = !view || view.editable !== false;
    const px = plan.pxPerDay || 28;
    const rowH = plan.rowHeight || 36;
    const trackW = plan.days.length * px;
    const canvasW = layout.metaWidth + trackW;
    if (!plan.days.length) {
      return '<div class="plan-empty">No release window to draw.</div>';
    }
    if (!plan.shown) {
      return '<div class="plan-empty">' + (plan.total ? 'Nothing matches these filters.' : 'No tickets in this release yet. Sync a market release to fill the plan.') + '</div>';
    }

    const bands = headerBands(plan.days, plan.zoom);
    const showDayCells = plan.zoom === 'day';
    const head2 = showDayCells
      ? plan.days.map(day => {
        const cls = 'plan-date' + (day.weekend ? ' is-weekend' : '') + (day.today ? ' is-today' : '');
        const mark = day.milestone
          ? '<span class="plan-ms" style="color:' + esc(day.milestone.color) + '" title="' + esc(day.milestone.label) + '">' + esc(day.milestone.id) + '</span>'
          : '<span class="plan-ms plan-ms-spacer"></span>';
        return '<div class="' + cls + '" style="width:' + px + 'px">' + mark + '<span class="plan-dow">' + day.dow + '</span><span class="plan-num">' + day.date + '</span></div>';
      }).join('')
      : bands.map(band => {
        return '<div class="plan-band-label" style="width:' + (band.span * px) + 'px">' + esc(band.label) + '</div>';
      }).join('');

    const monthRow = (showDayCells ? bands : headerBands(plan.days, 'month')).map(band => {
      return '<div class="plan-band" style="width:' + (band.span * px) + 'px">' + esc(band.label) + '</div>';
    }).join('');

    const shades = plan.days.map((day, index) => {
      if (!day.weekend && !day.today && !day.milestone) return '';
      const cls = 'plan-shade' + (day.weekend ? ' is-weekend' : '') + (day.today ? ' is-today' : '') + (day.milestone ? ' is-milestone' : '');
      const color = day.milestone ? day.milestone.color : '';
      const style = 'left:' + (index * px) + 'px;width:' + px + 'px' + (color ? ';--plan-mark:' + color : '');
      return '<div class="' + cls + '" style="' + style + '"></div>';
    }).join('');

    const todayIndex = plan.days.findIndex(day => day.today);
    const todayX = layout.metaWidth + Math.max(todayIndex, 0) * px;

    function cellOpen(col, head) {
      const cls = 'plan-cell'
        + (head ? ' plan-h' : '')
        + (col.frozen ? ' is-frozen' : '')
        + (col.lastFrozen ? ' is-frozen-end' : '');
      const title = !head && col.title ? '' : (col.title ? ' title="' + esc(col.title) + '"' : '');
      const headTitle = head && col.title ? ' title="' + esc(col.title) + '"' : title;
      return '<div class="' + cls + '" style="width:' + col.width + 'px;' + (col.frozen ? 'left:' + col.left + 'px;' : '') + '"' + (head ? headTitle : '') + '>';
    }

    function ticketCell(ticket, col) {
      const daysLabel = ticket.hasEstimate ? formatDays(ticket.estimate) + 'd' : '–';
      if (col.id === 'name') {
        const href = linkBase ? linkBase + '/browse/' + encodeURIComponent(ticket.key) : '';
        const key = href
          ? '<a class="plan-key" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(ticket.key) + '</a>'
          : '<span class="plan-key">' + esc(ticket.key) + '</span>';
        const summary = editable
          ? editButton(ticket.key, 'summary', 'Edit summary for ' + ticket.key, esc(ticket.summary || 'Add summary'), 'plan-sum')
          : '<span class="plan-sum">' + esc(ticket.summary || '') + '</span>';
        return '<div class="plan-name-cell">' + key + summary + '</div>';
      }
      if (col.id === 'days') {
        if (editable && !columns.est) return daysInput(ticket);
        return '<span class="plan-days">' + esc(daysLabel) + '</span>';
      }
      if (col.id === 'prd') {
        const inner = initialsHtml(ticket.product) || '<span class="plan-init plan-init-empty">+</span>';
        return editable ? editButton(ticket.key, 'cf_product', 'Edit product for ' + ticket.key, inner, 'plan-who-btn') : inner;
      }
      if (col.id === 'dev') {
        const inner = initialsHtml(ticket.developer) || '<span class="plan-init plan-init-empty">+</span>';
        return editable ? editButton(ticket.key, 'cf_dev', 'Edit developer for ' + ticket.key, inner, 'plan-who-btn') : inner;
      }
      if (col.id === 'qa') {
        const qa = ticket.assignee && ticket.assignee !== ticket.developer ? ticket.assignee : '';
        const inner = initialsHtml(qa) || '<span class="plan-init plan-init-empty">+</span>';
        return editable ? editButton(ticket.key, 'assignee', 'Edit assignee for ' + ticket.key, inner, 'plan-who-btn') : inner;
      }
      if (col.id === 'est') {
        return editable ? daysInput(ticket) : '<span class="plan-est">' + esc(daysLabel) + '</span>';
      }
      if (col.id === 'developer') {
        const name = ticket.developer || 'Unassigned';
        return editable
          ? editButton(ticket.key, 'cf_dev', 'Edit developer for ' + ticket.key, esc(name), 'plan-field-btn')
          : '<span class="plan-dev">' + esc(name) + '</span>';
      }
      if (col.id === 'status') {
        const status = ticket.status || '–';
        return editable
          ? editButton(ticket.key, 'status', 'Edit status for ' + ticket.key, esc(status), 'plan-field-btn')
          : '<span class="plan-status">' + esc(status) + '</span>';
      }
      return '';
    }

    function cells(ticket) {
      return layout.cols.map(col => cellOpen(col, false) + ticketCell(ticket, col) + '</div>').join('');
    }

    function barHtml(ticket) {
      if (!ticket.bar) return '';
      const left = dayOffset(plan.days, ticket.bar.start) * px;
      const endIndex = dayOffset(plan.days, ticket.bar.end);
      const startIndex = dayOffset(plan.days, ticket.bar.start);
      const width = Math.max(px * 0.45, (endIndex - startIndex + (ticket.bar.endFraction || 1)) * px - 3);
      const label = ticket.key + ', ' + ticket.bar.start + ' to ' + ticket.bar.end + (ticket.bar.pinned ? ', pinned' : '');
      return '<div class="plan-bar' + (ticket.bar.pinned ? ' is-pin' : '') + '" role="slider" tabindex="0" data-key="' + esc(ticket.key) + '" data-start="' + esc(ticket.bar.start) + '" data-px="' + px + '" data-lane="' + esc(ticket.lane) + '" aria-label="' + esc(label) + '" aria-valuetext="' + esc(ticket.bar.start + ' to ' + ticket.bar.end) + '" style="left:' + left + 'px;width:' + width + 'px;background:' + esc(ticket.color) + '" title="' + esc(label + '. Drag to pin the start. Double-click to reset.') + '"></div>';
    }

    function row(ticket) {
      return '<div class="plan-line" style="height:' + rowH + 'px">'
        + cells(ticket)
        + '<div class="plan-track" style="width:' + trackW + 'px">' + barHtml(ticket) + '</div></div>';
    }

    function spanCells(inner) {
      if (layout.frozenWidth > 0) {
        const rest = layout.metaWidth - layout.frozenWidth;
        return '<div class="plan-cell plan-group-cell is-frozen is-frozen-end" style="width:' + layout.frozenWidth + 'px;left:0">' + inner + '</div>'
          + (rest > 0 ? '<div class="plan-cell" style="width:' + rest + 'px"></div>' : '');
      }
      return '<div class="plan-cell plan-group-cell" style="width:' + layout.metaWidth + 'px">' + inner + '</div>';
    }

    const headCells = layout.cols.map(col => cellOpen(col, true) + esc(col.label) + '</div>').join('');
    const sectionHtml = '<span class="plan-section-label">Development</span>' + chip(plan.section.load, plan.section.capacity, plan.section.unscheduledDays);

    let body = '<div class="plan-line plan-section" style="height:' + Math.max(32, rowH - 4) + 'px">'
      + spanCells(sectionHtml)
      + '<div class="plan-track" style="width:' + trackW + 'px"></div></div>';

    plan.groups.forEach(group => {
      if (!group.flat && group.name) {
        body += '<div class="plan-line plan-group" style="height:' + rowH + 'px">'
          + spanCells('<span class="plan-person">' + esc(group.name) + '</span>' + chip(group.load, group.capacity, group.unscheduledDays))
          + '<div class="plan-track" style="width:' + trackW + 'px"></div></div>';
      }
      group.tickets.forEach(ticket => { body += row(ticket); });
    });

    return '<div class="plan-canvas" style="width:' + canvasW + 'px" data-today-x="' + todayX + '">'
      + '<div class="plan-shades" style="left:' + layout.metaWidth + 'px;width:' + trackW + 'px">' + shades + '</div>'
      + '<div class="plan-head">'
      + headCells
      + '<div class="plan-timehead" style="width:' + trackW + 'px"><div class="plan-months">' + monthRow + '</div><div class="plan-dates">' + head2 + '</div></div>'
      + '</div>' + body + '</div>';
  }

  return {
    esc,
    parseISO,
    formatISO,
    addDays,
    countWeekdays,
    shiftISO,
    moveWorkingDays,
    statusLane,
    initials,
    commitmentColor,
    devWindow,
    buildReleasePlan,
    renderReleasePlanBoard,
    layoutColumns,
    formatDays,
  };
});
