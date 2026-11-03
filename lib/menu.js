/**
 * Sidebar menu groups. Each group is a collapsible main item with projects, then insights.
 * Browser: window.Menu. Node: module.exports.
 */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Menu = api;
})(function () {
  'use strict';

  const INSIGHT_PAGES = [
    { id: 'velocity', label: 'Developer Velocity' },
    { id: 'data-gaps', label: 'Data Gaps' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'release-report', label: 'Release Report' },
    { id: 'team', label: 'Team View' },
    { id: 'release-plan', label: 'Release plan' },
    { id: 'phase-timeline', label: 'Project Phase' },
    { id: 'log', label: 'Daily Progress' },
    { id: 'quality-insights', label: 'Quality Insights' },
    { id: 'quality-phase', label: 'Quality Phase' },
    { id: 'quality-progress', label: 'Quality Progress' },
  ];

  const DEFAULT_GROUPS = [
    {
      id: 'delivery',
      label: 'Delivery',
      categories: [],
      catchAll: true,
      pages: ['velocity', 'data-gaps', 'analytics', 'release-report', 'team', 'release-plan', 'phase-timeline', 'log'],
    },
    {
      id: 'quality',
      label: 'Quality',
      categories: ['Quality'],
      catchAll: false,
      pages: ['quality-insights', 'quality-phase', 'quality-progress'],
    },
  ];

  const MAX_GROUPS = 8;
  const MAX_CATEGORIES = 24;
  const MAX_LABEL = 40;
  const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
  const KNOWN_PAGES = new Set(INSIGHT_PAGES.map(page => page.id));

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function categoryKey(value) {
    const text = String(value || '').trim().toLowerCase();
    return text || 'uncategorized';
  }

  function categoryLabel(value) {
    const text = String(value || '').trim();
    return text || 'Uncategorized';
  }

  function uniqueCategories(list) {
    const seen = new Set();
    const out = [];
    (Array.isArray(list) ? list : []).forEach(item => {
      const label = String(item || '').trim().slice(0, MAX_LABEL);
      if (!label) return;
      const key = label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(label);
    });
    return out.slice(0, MAX_CATEGORIES);
  }

  function slugId(label, used) {
    let base = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
    if (!base || !/^[a-z]/.test(base)) base = 'group';
    let id = base.slice(0, 32);
    let n = 2;
    while (used.has(id)) {
      const suffix = '-' + n;
      id = base.slice(0, 32 - suffix.length) + suffix;
      n += 1;
    }
    used.add(id);
    return id;
  }

  function groupsFrom(input) {
    if (Array.isArray(input)) return input;
    if (input && typeof input === 'object' && Array.isArray(input.groups)) return input.groups;
    return null;
  }

  function normalizeMenuGroups(input) {
    const source = groupsFrom(input);
    if (!source || !source.length) return clone(DEFAULT_GROUPS);
    const used = new Set();
    const seenPages = new Set();
    const groups = [];
    source.slice(0, MAX_GROUPS).forEach(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      const label = String(raw.label || '').trim().slice(0, MAX_LABEL);
      if (!label) return;
      const requested = String(raw.id || '').trim().toLowerCase();
      const id = ID_RE.test(requested) && !used.has(requested) ? requested : slugId(label, used);
      used.add(id);
      const pages = [];
      (Array.isArray(raw.pages) ? raw.pages : []).forEach(pageId => {
        const idValue = String(pageId || '').trim();
        if (!KNOWN_PAGES.has(idValue) || seenPages.has(idValue)) return;
        seenPages.add(idValue);
        pages.push(idValue);
      });
      groups.push({
        id,
        label,
        categories: uniqueCategories(raw.categories),
        catchAll: !!raw.catchAll,
        pages,
      });
    });
    if (!groups.length) return clone(DEFAULT_GROUPS);
    return groups;
  }

  function assignProjects(groups, projects) {
    const menu = normalizeMenuGroups(groups);
    const list = Array.isArray(projects) ? projects : [];
    const claimedCategories = new Set();
    menu.forEach(group => {
      (group.categories || []).forEach(category => claimedCategories.add(categoryKey(category)));
    });
    const buckets = menu.map(() => []);
    const claimedKeys = new Set();
    menu.forEach((group, index) => {
      const wanted = new Set((group.categories || []).map(categoryKey));
      if (!wanted.size) return;
      list.forEach(proj => {
        if (!proj || claimedKeys.has(proj.key)) return;
        if (!wanted.has(categoryKey(proj.category))) return;
        buckets[index].push(proj);
        claimedKeys.add(proj.key);
      });
    });
    const hostIndex = menu.findIndex(group => group.catchAll);
    const host = hostIndex >= 0 ? hostIndex : 0;
    list.forEach(proj => {
      if (!proj || claimedKeys.has(proj.key)) return;
      if (claimedCategories.has(categoryKey(proj.category)) && hostIndex < 0) return;
      buckets[host].push(proj);
      claimedKeys.add(proj.key);
    });
    return buckets;
  }

  function insightPage(id) {
    return INSIGHT_PAGES.find(page => page.id === id) || null;
  }

  return {
    INSIGHT_PAGES,
    DEFAULT_GROUPS,
    categoryKey,
    categoryLabel,
    normalizeMenuGroups,
    assignProjects,
    insightPage,
    defaultMenuGroups() {
      return clone(DEFAULT_GROUPS);
    },
  };
});
