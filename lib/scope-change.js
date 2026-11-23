/**
 * Scope added to or removed from a release, from fix version history.
 * Effort uses Dev Actual when that value is present, including 0.
 * When actual is missing, effort uses Dev Estimate.
 *
 * Browser: window.ScopeChange. Node: module.exports.
 */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ScopeChange = api;
})(function () {
  'use strict';

  function isKeptChangelogItem(item) {
    if (!item) return false;
    const id = String(item.fieldId || '');
    const field = String(item.field || '');
    if (id === 'status' || field === 'status') return true;
    if (id === 'fixVersions' || /fix\s*version/i.test(field)) return true;
    return false;
  }

  function slimChangelogItem(item) {
    return {
      field: item.field || (item.fieldId === 'fixVersions' ? 'Fix Version' : item.fieldId === 'status' ? 'status' : ''),
      fieldId: item.fieldId || (item.field === 'status' ? 'status' : /fix\s*version/i.test(item.field || '') ? 'fixVersions' : ''),
      fromString: item.fromString || '',
      toString: item.toString || '',
    };
  }

  function hasFixVersionHistory(issue) {
    return !!(issue && issue.changelog && issue.changelog._includesFixVersions);
  }

  function parseTime(value) {
    if (value instanceof Date) return value.getTime();
    const text = String(value || '').trim();
    if (!text) return NaN;
    if (/^\d+$/.test(text)) {
      const n = Number(text);
      return n < 1e12 ? n * 1000 : n;
    }
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? NaN : parsed;
  }

  function parseVersionList(value) {
    if (value == null) return [];
    return String(value).split(',').map(part => part.trim()).filter(Boolean);
  }

  function currentVersionNames(issue) {
    const versions = issue && issue.fields && issue.fields.fixVersions;
    if (!Array.isArray(versions)) return [];
    return versions.map(version => {
      if (typeof version === 'string') return version.trim();
      return String((version && version.name) || '').trim();
    }).filter(Boolean);
  }

  function versionKey(name) {
    return String(name || '').trim().toLowerCase();
  }

  function inScope(names, scopeNames, blank) {
    if ((!names || !names.length) && blank) return true;
    const wanted = new Set((scopeNames || []).map(versionKey).filter(Boolean));
    return (names || []).some(name => wanted.has(versionKey(name)));
  }

  function presentNumber(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const raw = value.trim().replace(',', '.');
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function resolveEffort(actual, estimate) {
    const actualDays = presentNumber(actual);
    if (actualDays != null) return { days: actualDays, source: 'actual' };
    const estimateDays = presentNumber(estimate);
    if (estimateDays != null) return { days: estimateDays, source: 'estimate' };
    return { days: 0, source: 'missing' };
  }

  function isFixVersionItem(item) {
    if (!item) return false;
    if (String(item.fieldId || '') === 'fixVersions') return true;
    return /fix\s*version/i.test(String(item.field || ''));
  }

  function fixVersionChanges(issue) {
    const changes = [];
    (((issue && issue.changelog && issue.changelog.histories) || [])).forEach(history => {
      const time = parseTime(history && history.created);
      ((history && history.items) || []).forEach(item => {
        if (!isFixVersionItem(item)) return;
        changes.push({
          time,
          from: parseVersionList(item.fromString),
          to: parseVersionList(item.toString),
        });
      });
    });
    changes.sort((a, b) => (a.time || 0) - (b.time || 0));
    return changes;
  }

  function collectScopeEvents(issue, options) {
    const opts = options || {};
    const scopeNames = opts.scopeNames || [];
    const blank = !!opts.blank;
    const effort = resolveEffort(
      opts.effort && Object.prototype.hasOwnProperty.call(opts.effort, 'actual') ? opts.effort.actual : null,
      opts.effort && Object.prototype.hasOwnProperty.call(opts.effort, 'estimate') ? opts.effort.estimate : null
    );
    const historyReady = hasFixVersionHistory(issue);
    const changes = fixVersionChanges(issue);
    const events = [];

    function push(kind, time, from, to, initial) {
      if (!Number.isFinite(time)) return;
      events.push({
        kind,
        time,
        from: (from || []).slice(),
        to: (to || []).slice(),
        initial: !!initial,
        days: effort.days,
        source: effort.source,
      });
    }

    function apply(from, to, time) {
      const was = inScope(from, scopeNames, blank);
      const now = inScope(to, scopeNames, blank);
      if (!was && now) push('added', time, from, to, false);
      else if (was && !now) push('removed', time, from, to, false);
    }

    if (!changes.length) {
      if (!historyReady) return [];
      const current = currentVersionNames(issue);
      if (inScope(current, scopeNames, blank)) {
        push('added', parseTime(issue && issue.fields && issue.fields.created), [], current, true);
      }
      return events;
    }

    let names = changes[0].from.slice();
    if (historyReady && inScope(names, scopeNames, blank)) {
      const created = parseTime(issue && issue.fields && issue.fields.created);
      if (!Number.isFinite(changes[0].time) || !Number.isFinite(created) || created < changes[0].time) {
        push('added', created, [], names.slice(), true);
      }
    }
    changes.forEach(change => {
      apply(names, change.to, change.time);
      names = change.to.slice();
    });
    return events;
  }

  function periodKey(date, period) {
    const x = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(x.getTime())) return '';
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const d = String(x.getDate()).padStart(2, '0');
    if (period === 'day') return y + '-' + m + '-' + d;
    if (period === 'month') return y + '-' + m;
    const weekStart = new Date(y, x.getMonth(), x.getDate());
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const wy = weekStart.getFullYear();
    const wm = String(weekStart.getMonth() + 1).padStart(2, '0');
    const wd = String(weekStart.getDate()).padStart(2, '0');
    return wy + '-' + wm + '-' + wd;
  }

  function emptyScopeBucket(key, time) {
    return {
      key,
      time,
      addedCount: 0,
      removedCount: 0,
      addedDays: 0,
      removedDays: 0,
      events: [],
    };
  }

  function addScopeEvent(bucket, event) {
    const days = Number(event.days) || 0;
    if (event.kind === 'removed') {
      bucket.removedCount += 1;
      bucket.removedDays += days;
    } else {
      bucket.addedCount += 1;
      bucket.addedDays += days;
    }
    bucket.events.push(event);
  }

  function periodStartMs(key, period) {
    const text = String(key || '');
    if (period === 'month') {
      const month = text.match(/^(\d{4})-(\d{2})/);
      if (!month) return NaN;
      return new Date(+month[1], +month[2] - 1, 1).getTime();
    }
    const day = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!day) return NaN;
    return new Date(+day[1], +day[2] - 1, +day[3]).getTime();
  }

  function nextPeriodStart(date, period) {
    const x = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (period === 'month') x.setMonth(x.getMonth() + 1, 1);
    else if (period === 'day') x.setDate(x.getDate() + 1);
    else x.setDate(x.getDate() + 7);
    return x;
  }

  function summarizeScopeChange(events, options) {
    const opts = options || {};
    const period = opts.period === 'day' || opts.period === 'month' ? opts.period : 'week';
    const from = opts.from;
    const to = opts.to;
    const map = new Map();
    (events || []).forEach(event => {
      if (!event || !Number.isFinite(event.time)) return;
      if (from != null && event.time < from) return;
      if (to != null && event.time > to) return;
      const key = periodKey(event.time, period);
      if (!key) return;
      if (!map.has(key)) map.set(key, emptyScopeBucket(key, event.time));
      const bucket = map.get(key);
      if (event.time < bucket.time) bucket.time = event.time;
      addScopeEvent(bucket, event);
    });
    const list = [...map.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    if (!opts.fill || from == null || to == null || !(to >= from)) return list;
    const startKey = periodKey(from, period);
    const endKey = periodKey(to, period);
    const startMs = periodStartMs(startKey, period);
    const endMs = periodStartMs(endKey, period);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return list;
    const filled = [];
    let cursor = new Date(startMs);
    let guard = 0;
    while (cursor.getTime() <= endMs && guard < 400) {
      const key = periodKey(cursor, period);
      filled.push(map.get(key) || emptyScopeBucket(key, cursor.getTime()));
      cursor = nextPeriodStart(cursor, period);
      guard += 1;
    }
    return filled.length ? filled : list;
  }

  /**
   * Spans run from the start of one milestone day until the next milestone day.
   * A change on a milestone's date belongs to the span that starts that day.
   */
  function summarizeBetweenMilestones(events, milestones) {
    const marks = (milestones || [])
      .filter(mark => mark && Number.isFinite(mark.time))
      .map(mark => ({
        id: mark.id || mark.label || '',
        label: mark.label || mark.id || '',
        time: mark.time,
      }))
      .sort((a, b) => a.time - b.time);
    if (!marks.length) return [];
    const spans = [];
    const first = marks[0];
    const last = marks[marks.length - 1];
    spans.push(Object.assign(emptyScopeBucket('before', first.time), {
      label: 'Before ' + (first.label || first.id),
      from: null,
      to: first.time,
    }));
    for (let i = 0; i < marks.length - 1; i++) {
      const fromMark = marks[i];
      const toMark = marks[i + 1];
      spans.push(Object.assign(emptyScopeBucket('span-' + i, fromMark.time), {
        label: (fromMark.label || fromMark.id) + ' → ' + (toMark.label || toMark.id),
        from: fromMark.time,
        to: toMark.time,
      }));
    }
    spans.push(Object.assign(emptyScopeBucket('after', last.time), {
      label: 'After ' + (last.label || last.id),
      from: last.time,
      to: null,
    }));

    (events || []).forEach(event => {
      if (!event || !Number.isFinite(event.time)) return;
      let span = spans[spans.length - 1];
      if (event.time < first.time) span = spans[0];
      else if (event.time < last.time) {
        for (let i = 0; i < marks.length - 1; i++) {
          if (event.time >= marks[i].time && event.time < marks[i + 1].time) {
            span = spans[i + 1];
            break;
          }
        }
      }
      addScopeEvent(span, event);
    });
    return spans;
  }

  return {
    isKeptChangelogItem,
    slimChangelogItem,
    hasFixVersionHistory,
    parseVersionList,
    resolveEffort,
    collectScopeEvents,
    periodKey,
    periodStartMs,
    nextPeriodStart,
    summarizeScopeChange,
    summarizeBetweenMilestones,
  };
});
