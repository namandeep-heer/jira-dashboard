/**
 * Per-release milestone sets.
 *
 * The default catalog (id, label, fullName, color) is shared.
 * Each release stores milestoneIds: which of those milestones it uses, in order.
 * Dates stay on release.milestones as { id: 'YYYY-MM-DD' }.
 * A milestone that leaves the default catalog is copied onto releases that
 * still use it, under release.localMilestones.
 *
 * Browser: window.ReleaseMilestones. Node: module.exports.
 */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ReleaseMilestones = api;
})(function () {
  'use strict';

  function safeColor(color) {
    const value = String(color || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#888888';
  }

  function cleanId(id) {
    return String(id == null ? '' : id).trim();
  }

  function cloneDef(def) {
    const id = cleanId(def && def.id);
    const label = String((def && def.label) || id).trim() || id;
    return {
      id,
      label,
      fullName: String((def && def.fullName) || label).trim() || label,
      color: safeColor(def && def.color),
    };
  }

  function catalogIdsOf(catalog) {
    const ids = [];
    const seen = new Set();
    (catalog || []).forEach(item => {
      const id = cleanId(item && item.id);
      if (!id || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    });
    return ids;
  }

  function asMap(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function uniqueIds(ids) {
    const out = [];
    const seen = new Set();
    (ids || []).forEach(raw => {
      const id = cleanId(raw);
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    });
    return out;
  }

  /**
   * Give a release its own milestone id list.
   * Missing milestoneIds means "use the current default catalog", which matches
   * releases saved before per-release sets existed. An explicit list, including
   * an empty one, is left as the user saved it.
   */
  function normalizeMilestoneDate(raw) {
    const value = String(raw == null ? '' : raw).trim();
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsed = new Date(value + 'T12:00:00');
      return Number.isNaN(parsed.getTime()) ? '' : value;
    }
    // A date input can persist as 202702-02-05 when the year and month run together.
    const duplicatedMonth = value.match(/^(\d{4})(\d{2})-(\d{2})-(\d{2})$/);
    if (duplicatedMonth && duplicatedMonth[2] === duplicatedMonth[3]) {
      const repaired = duplicatedMonth[1] + '-' + duplicatedMonth[3] + '-' + duplicatedMonth[4];
      const parsed = new Date(repaired + 'T12:00:00');
      if (!Number.isNaN(parsed.getTime())) return repaired;
    }
    return value;
  }

  function ensureReleaseMilestoneSet(release, catalog) {
    if (!release || typeof release !== 'object') return release;
    release.milestones = asMap(release.milestones);
    release.localMilestones = asMap(release.localMilestones);
    Object.keys(release.milestones).forEach(id => {
      const normalized = normalizeMilestoneDate(release.milestones[id]);
      if (normalized && normalized !== release.milestones[id]) release.milestones[id] = normalized;
    });

    const catalogIds = catalogIdsOf(catalog);
    if (!Array.isArray(release.milestoneIds)) {
      const extras = Object.keys(release.milestones).filter(id => id && catalogIds.indexOf(id) === -1);
      release.milestoneIds = catalogIds.concat(extras);
    } else {
      release.milestoneIds = uniqueIds(release.milestoneIds);
    }

    const keep = new Set(release.milestoneIds);
    Object.keys(release.milestones).forEach(id => {
      if (!keep.has(id)) delete release.milestones[id];
    });
    Object.keys(release.localMilestones).forEach(id => {
      if (!keep.has(id)) delete release.localMilestones[id];
    });

    const onCatalog = new Set(catalogIds);
    release.milestoneIds.forEach(id => {
      if (onCatalog.has(id)) delete release.localMilestones[id];
    });
    return release;
  }

  function resolveMilestoneDef(release, catalog, id) {
    const key = cleanId(id);
    const master = (catalog || []).find(item => item && cleanId(item.id) === key);
    if (master) return cloneDef(master);
    const local = release && release.localMilestones && release.localMilestones[key];
    if (local) return cloneDef({ ...local, id: key });
    return cloneDef({ id: key, label: key, fullName: key, color: '#888888' });
  }

  function releaseMilestoneDefs(release, catalog) {
    ensureReleaseMilestoneSet(release, catalog);
    return release.milestoneIds.map(id => resolveMilestoneDef(release, catalog, id));
  }

  function newReleaseFromMaster(name, catalog) {
    return {
      name: name || '',
      milestoneIds: catalogIdsOf(catalog),
      milestones: {},
      localMilestones: {},
      patches: [],
    };
  }

  /**
   * Replace the target release's milestone list with sourceIds.
   * Dates already on the target are kept for milestones that remain.
   * Pass options.copyDates to take dates from options.sourceDates instead.
   * Local definitions are copied for milestones that are not on the catalog.
   */
  function applyMilestoneSet(target, sourceIds, sourceLocal, catalog, options) {
    ensureReleaseMilestoneSet(target, catalog);
    const nextIds = uniqueIds(sourceIds);
    const onCatalog = new Set(catalogIdsOf(catalog));
    const nextLocal = {};
    const locals = asMap(sourceLocal);
    nextIds.forEach(id => {
      if (onCatalog.has(id)) return;
      const def = locals[id] || target.localMilestones[id];
      if (def) nextLocal[id] = cloneDef({ ...def, id });
    });

    const copyDates = !!(options && options.copyDates);
    const sourceDates = asMap(options && options.sourceDates);
    const nextDates = {};
    nextIds.forEach(id => {
      if (copyDates) {
        if (sourceDates[id]) nextDates[id] = sourceDates[id];
      } else if (target.milestones[id]) {
        nextDates[id] = target.milestones[id];
      }
    });

    target.milestoneIds = nextIds;
    target.localMilestones = nextLocal;
    target.milestones = nextDates;
    return target;
  }

  function removeMilestoneFromRelease(release, id, catalog) {
    ensureReleaseMilestoneSet(release, catalog);
    const key = cleanId(id);
    release.milestoneIds = release.milestoneIds.filter(item => item !== key);
    delete release.milestones[key];
    delete release.localMilestones[key];
    return release;
  }

  function addMilestoneToRelease(release, id, catalog, localDef) {
    ensureReleaseMilestoneSet(release, catalog);
    const key = cleanId(id);
    if (!key) return release;
    if (release.milestoneIds.indexOf(key) === -1) release.milestoneIds.push(key);
    const onCatalog = catalogIdsOf(catalog).indexOf(key) !== -1;
    if (onCatalog) {
      delete release.localMilestones[key];
    } else if (localDef) {
      release.localMilestones[key] = cloneDef({ ...localDef, id: key });
    }
    return release;
  }

  function rememberMilestoneDef(releases, def) {
    if (!def || !cleanId(def.id)) return;
    const snapshot = cloneDef(def);
    (releases || []).forEach(release => {
      if (!release || !Array.isArray(release.milestoneIds)) return;
      if (release.milestoneIds.indexOf(snapshot.id) === -1) return;
      release.localMilestones = asMap(release.localMilestones);
      release.localMilestones[snapshot.id] = cloneDef(snapshot);
    });
  }

  function renameMilestoneId(releases, oldId, newId) {
    const from = cleanId(oldId);
    const to = cleanId(newId);
    if (!from || !to || from === to) return;
    (releases || []).forEach(release => {
      if (!release) return;
      if (Array.isArray(release.milestoneIds)) {
        release.milestoneIds = uniqueIds(release.milestoneIds.map(id => (id === from ? to : id)));
      }
      if (release.milestones && Object.prototype.hasOwnProperty.call(release.milestones, from)) {
        if (!Object.prototype.hasOwnProperty.call(release.milestones, to)) {
          release.milestones[to] = release.milestones[from];
        }
        delete release.milestones[from];
      }
      if (release.localMilestones && release.localMilestones[from]) {
        const def = cloneDef({ ...release.localMilestones[from], id: to });
        if (!release.localMilestones[to]) release.localMilestones[to] = def;
        delete release.localMilestones[from];
      }
    });
  }

  /**
   * Build a new default catalog from one release's milestone list.
   * Definitions for milestones that leave the catalog are copied onto any
   * release that still uses them. Caller replaces the catalog, then runs
   * ensureReleaseMilestoneSet so promoted milestones drop their local copy.
   */
  function catalogFromRelease(release, catalog, releases) {
    const next = releaseMilestoneDefs(release, catalog);
    const nextIds = new Set(next.map(item => item.id));
    (catalog || []).forEach(def => {
      if (!def || nextIds.has(cleanId(def.id))) return;
      rememberMilestoneDef(releases, def);
    });
    return next;
  }

  function moveId(ids, index, delta) {
    if (!Array.isArray(ids)) return ids;
    const next = index + delta;
    if (index < 0 || index >= ids.length || next < 0 || next >= ids.length) return ids;
    const copy = ids.slice();
    const item = copy[index];
    copy.splice(index, 1);
    copy.splice(next, 0, item);
    return copy;
  }

  return {
    safeColor,
    normalizeMilestoneDate,
    cleanId,
    cloneDef,
    ensureReleaseMilestoneSet,
    resolveMilestoneDef,
    releaseMilestoneDefs,
    newReleaseFromMaster,
    applyMilestoneSet,
    removeMilestoneFromRelease,
    addMilestoneToRelease,
    rememberMilestoneDef,
    renameMilestoneId,
    catalogFromRelease,
    moveId,
  };
});
