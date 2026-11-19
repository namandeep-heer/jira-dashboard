/**
 * A + Clarity breakdown for the selected market release.
 * Ratings stay as they are stored on the Jira field (🟢, 🟡, 🔴, ⚪).
 * Empty values are "Not set".
 *
 * Browser: window.ClarityDashboard. Node: module.exports.
 */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ClarityDashboard = api;
})(function () {
  'use strict';

  const UNSET = 'Not set';
  const CLARITY_ORDER = ['🟢', '🟡', '🔴', '⚪', UNSET];
  const TRACK_ORDER = ['🔴', UNSET, '⚪', '🟡', '🟢'];
  const SCOPE_ORDER = ['Committed', 'Request To Commit', 'Commit CarryOver', 'Commit Creep', 'Opportunistic', UNSET];
  const COLORS = {
    '🟢': '#3B6D11',
    '🟡': '#C47A0F',
    '🔴': '#A32D2D',
    '⚪': '#A8A29E',
  };
  COLORS[UNSET] = '#D6D3D1';
  const EXTRA_COLORS = ['#185FA5', '#533AB7', '#0F6E56', '#993556', '#854F0B'];

  const FILTERS = [
    { id: 'project', field: 'projectKey', all: 'All projects', some: 'Projects' },
    { id: 'scope', field: 'scope', all: 'All scope types', some: 'Scope type' },
    { id: 'scopeAtSc', field: 'scopeAtSc', all: 'All scope at SC', some: 'Scope at SC' },
    { id: 'phase', field: 'phase', all: 'All phases', some: 'Phase' },
    { id: 'priority', field: 'priority', all: 'All priorities', some: 'Priority' },
    { id: 'type', field: 'type', all: 'All issue types', some: 'Issue type' },
    { id: 'clarity', field: 'clarity', all: 'All A + Clarity', some: 'A + Clarity' },
  ];

  function optionText(val) {
    if (val == null || val === '') return '';
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'number') return String(val);
    if (Array.isArray(val)) return val.map(optionText).filter(Boolean).join(', ');
    if (typeof val === 'object') return optionText(val.value || val.name || val.displayName || '');
    return String(val).trim();
  }

  function clarityLabel(value) {
    return optionText(value) || UNSET;
  }

  const CAPTIONS = {
    '🟢': 'Green',
    '🟡': 'Yellow',
    '🔴': 'Red',
    '⚪': 'White',
  };

  function clarityKey(label) {
    return String(label || UNSET).replace(/\uFE0F/g, '');
  }

  function clarityColor(label) {
    const text = String(label || UNSET);
    if (COLORS[text]) return COLORS[text];
    const bare = clarityKey(text);
    if (COLORS[bare]) return COLORS[bare];
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return EXTRA_COLORS[hash % EXTRA_COLORS.length];
  }

  function clarityCaption(label) {
    const text = String(label || UNSET);
    if (text === UNSET) return UNSET;
    if (CAPTIONS[text]) return CAPTIONS[text];
    const bare = clarityKey(text);
    if (CAPTIONS[bare]) return CAPTIONS[bare];
    return text;
  }

  function trackRank(label) {
    const index = TRACK_ORDER.indexOf(String(label || UNSET));
    return index === -1 ? TRACK_ORDER.length : index;
  }

  function orderLabels(labels, preferred) {
    const list = [];
    const seen = new Set();
    (labels || []).forEach(label => {
      const text = String(label || UNSET);
      if (seen.has(text)) return;
      seen.add(text);
      list.push(text);
    });
    const rank = new Map((preferred || []).map((label, index) => [label, index]));
    list.sort((a, b) => {
      const ar = rank.has(a) ? rank.get(a) : 1000;
      const br = rank.has(b) ? rank.get(b) : 1000;
      if (ar !== br) return ar - br;
      if (a === UNSET) return 1;
      if (b === UNSET) return -1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
    return list;
  }

  function activeSet(value) {
    if (!value) return null;
    const list = value instanceof Set ? [...value] : (Array.isArray(value) ? value : []);
    const clean = list.map(item => String(item)).filter(item => item !== '');
    return clean.length ? new Set(clean) : null;
  }

  function applyFilters(rows, filters) {
    const src = Array.isArray(rows) ? rows : [];
    const f = filters || {};
    const sets = {};
    FILTERS.forEach(spec => { sets[spec.id] = activeSet(f[spec.id]); });
    const q = String(f.q || '').trim().toLowerCase();
    const openOnly = !!f.openOnly;
    return src.filter(row => {
      if (!row) return false;
      if (openOnly && row.closed) return false;
      if (q) {
        const hay = [row.key, row.summary, row.projectName, row.projectKey, row.scope, row.scopeAtSc, row.phase, row.status, row.priority, row.type, row.clarity]
          .map(part => String(part || ''))
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return FILTERS.every(spec => {
        const set = sets[spec.id];
        if (!set) return true;
        return set.has(String(row[spec.field] || UNSET));
      });
    });
  }

  function valuesOf(row, options) {
    const opts = options || {};
    if (opts.valuesKey) {
      const list = row && row[opts.valuesKey];
      if (Array.isArray(list) && list.length) {
        const clean = list.map(item => String(item || UNSET).trim()).filter(Boolean);
        if (clean.length) return clean;
      }
      return [UNSET];
    }
    return [String((row && row.clarity) || UNSET)];
  }

  function groupBy(rows, keyName, labelName, preferred, valueOf) {
    const read = typeof valueOf === 'function' ? valueOf : (row => [row.clarity || UNSET]);
    const map = new Map();
    rows.forEach(row => {
      const key = String(row[keyName] || UNSET);
      let group = map.get(key);
      if (!group) {
        group = { key, label: String(row[labelName] || key), counts: {}, total: 0 };
        map.set(key, group);
      }
      read(row).forEach(value => {
        const label = value || UNSET;
        group.counts[label] = (group.counts[label] || 0) + 1;
      });
      group.total += 1;
    });
    return orderLabels([...map.keys()], preferred).map(key => map.get(key));
  }

  function summarize(rows, options) {
    const list = Array.isArray(rows) ? rows : [];
    const opts = options || {};
    const valueOf = row => valuesOf(row, opts);
    const clarityLabels = orderLabels(list.flatMap(valueOf), opts.valueOrder || CLARITY_ORDER);
    const byClarity = clarityLabels.map(label => ({
      label,
      color: label === 'Other' ? '#44403C' : clarityColor(label),
      count: list.reduce((sum, row) => sum + (valueOf(row).indexOf(label) !== -1 ? 1 : 0), 0),
    }));
    return {
      total: list.length,
      clarityLabels,
      byClarity,
      byProject: groupBy(list, 'projectKey', 'projectName', opts.projectOrder, valueOf),
      byScope: groupBy(list, 'scope', 'scope', SCOPE_ORDER, valueOf),
    };
  }

  function crossTab(rows, options) {
    const opts = options || {};
    const rowKey = opts.rowKey || 'projectKey';
    const rowLabel = opts.rowLabel || 'projectName';
    const colKey = opts.colKey || 'scope';
    const list = Array.isArray(rows) ? rows : [];
    const columns = orderLabels(list.map(row => row[colKey] || UNSET), opts.columnOrder || SCOPE_ORDER);
    const clarityLabels = orderLabels(list.map(row => row.clarity || UNSET), CLARITY_ORDER);
    const map = new Map();
    list.forEach(row => {
      const key = String(row[rowKey] || UNSET);
      let group = map.get(key);
      if (!group) {
        group = { key, label: String(row[rowLabel] || key), cells: {} };
        map.set(key, group);
      }
      const col = String(row[colKey] || UNSET);
      if (!group.cells[col]) group.cells[col] = { total: 0, counts: {} };
      const clarity = row.clarity || UNSET;
      group.cells[col].counts[clarity] = (group.cells[col].counts[clarity] || 0) + 1;
      group.cells[col].total += 1;
    });
    return {
      columns,
      clarityLabels,
      rows: orderLabels([...map.keys()], opts.rowOrder || []).map(key => map.get(key)),
    };
  }

  function stacked(groups, clarityLabels) {
    const labels = clarityLabels && clarityLabels.length
      ? clarityLabels.slice()
      : orderLabels((groups || []).flatMap(group => Object.keys(group.counts || {})), CLARITY_ORDER);
    return labels.map(label => ({
      label,
      color: clarityColor(label),
      data: (groups || []).map(group => (group.counts && group.counts[label]) || 0),
    }));
  }

  return {
    UNSET,
    CLARITY_ORDER,
    SCOPE_ORDER,
    FILTERS,
    optionText,
    valuesOf,
    clarityLabel,
    clarityColor,
    clarityCaption,
    trackRank,
    orderLabels,
    applyFilters,
    summarize,
    crossTab,
    stacked,
  };
});
