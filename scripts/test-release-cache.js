/**
 * Unit tests for per-release cache isolation.
 * A previous bug assigned S.cache onto whichever release was active during
 * persist, so a multi-release connector sync aliased N2027.R1 and N2026.R2
 * to the same object and the last-fetched release overwrote the other.
 * Run: node scripts/test-release-cache.js
 */

'use strict';

const assert = require('assert');

function createState(activeRelease) {
  return {
    activeRelease: activeRelease || '',
    cache: {},
    releaseCache: {},
  };
}

function ensureReleaseCacheBucket(state, releaseName) {
  if (!state.releaseCache || typeof state.releaseCache !== 'object') state.releaseCache = {};
  const key = releaseName || '';
  if (!state.releaseCache[key] || typeof state.releaseCache[key] !== 'object') {
    state.releaseCache[key] = {};
  }
  return state.releaseCache[key];
}

function releaseCacheOwnerOf(state, obj) {
  if (!obj || !state.releaseCache) return '';
  for (const name of Object.keys(state.releaseCache)) {
    if (state.releaseCache[name] === obj) return name;
  }
  return '';
}

function bindCacheToActiveRelease(state) {
  state.cache = ensureReleaseCacheBucket(state, state.activeRelease);
}

function adoptCacheAsActiveReleaseBucket(state) {
  if (!state.releaseCache || typeof state.releaseCache !== 'object') state.releaseCache = {};
  if (!state.cache || typeof state.cache !== 'object') state.cache = {};
  const key = state.activeRelease || '';
  const owner = releaseCacheOwnerOf(state, state.cache);
  if (!owner) {
    state.releaseCache[key] = state.cache;
    return;
  }
  if (owner === key) return;
  const bucket = ensureReleaseCacheBucket(state, key);
  Object.keys(state.cache).forEach(projectKey => {
    bucket[projectKey] = state.cache[projectKey];
  });
  state.cache = bucket;
}

function writeReleaseProjectCache(state, releaseName, projectKey, data) {
  const bucket = ensureReleaseCacheBucket(state, releaseName);
  bucket[projectKey] = data;
  if ((releaseName || '') === (state.activeRelease || '') && state.cache !== bucket) {
    if (!state.cache || typeof state.cache !== 'object') state.cache = {};
    state.cache[projectKey] = data;
  }
}

function isolateReleaseCacheBuckets(state) {
  if (!state.releaseCache || typeof state.releaseCache !== 'object') state.releaseCache = {};
  Object.keys(state.releaseCache).forEach(name => {
    const bucket = state.releaseCache[name];
    state.releaseCache[name] = bucket && typeof bucket === 'object' ? Object.assign({}, bucket) : {};
  });
  bindCacheToActiveRelease(state);
}

const nfs2026 = { issues: [{ key: 'NFS-1', fields: { fixVersions: [{ name: 'N2026.R2' }] } }] };
const nfs2027 = { issues: [{ key: 'NFS-9', fields: { fixVersions: [{ name: 'N2027.R1' }] } }] };

// Switching releases must not alias buckets
const state = createState('N2027.R1');
bindCacheToActiveRelease(state);
writeReleaseProjectCache(state, 'N2027.R1', 'NFS', nfs2027);
state.activeRelease = 'N2026.R2';
bindCacheToActiveRelease(state);
writeReleaseProjectCache(state, 'N2026.R2', 'NFS', nfs2026);
assert.notStrictEqual(state.releaseCache['N2027.R1'], state.releaseCache['N2026.R2']);
assert.strictEqual(state.releaseCache['N2027.R1'].NFS.issues[0].key, 'NFS-9');
assert.strictEqual(state.releaseCache['N2026.R2'].NFS.issues[0].key, 'NFS-1');

// Persist must not steal another release's bucket when activeRelease is temporarily wrong
const aliased = createState('N2027.R1');
bindCacheToActiveRelease(aliased);
writeReleaseProjectCache(aliased, 'N2027.R1', 'NFS', nfs2027);
writeReleaseProjectCache(aliased, 'N2026.R2', 'NFS', nfs2026);
aliased.activeRelease = 'N2026.R2';
aliased.cache = aliased.releaseCache['N2027.R1'];
adoptCacheAsActiveReleaseBucket(aliased);
assert.notStrictEqual(aliased.releaseCache['N2027.R1'], aliased.releaseCache['N2026.R2']);
assert.strictEqual(aliased.releaseCache['N2027.R1'].NFS.issues[0].key, 'NFS-9');
assert.strictEqual(aliased.cache, aliased.releaseCache['N2026.R2']);

// Connector-style dual write while staying on N2027.R1
const sync = createState('N2027.R1');
bindCacheToActiveRelease(sync);
writeReleaseProjectCache(sync, 'N2027.R1', 'NFS', nfs2027);
writeReleaseProjectCache(sync, 'N2026.R2', 'NFS', nfs2026);
adoptCacheAsActiveReleaseBucket(sync);
assert.strictEqual(sync.cache.NFS.issues[0].key, 'NFS-9');
assert.strictEqual(sync.releaseCache['N2026.R2'].NFS.issues[0].key, 'NFS-1');
assert.notStrictEqual(sync.releaseCache['N2027.R1'], sync.releaseCache['N2026.R2']);

// The old persist assignment aliases both releases to the last write
const buggy = createState('N2027.R1');
buggy.cache = {};
buggy.releaseCache['N2027.R1'] = buggy.cache;
buggy.cache.NFS = nfs2027;
buggy.activeRelease = 'N2026.R2';
buggy.releaseCache[buggy.activeRelease] = buggy.cache;
buggy.cache.NFS = nfs2026;
assert.strictEqual(buggy.releaseCache['N2027.R1'], buggy.releaseCache['N2026.R2']);
assert.strictEqual(buggy.releaseCache['N2027.R1'].NFS.issues[0].key, 'NFS-1');

// isolateReleaseCacheBuckets splits a shared object into independent copies
isolateReleaseCacheBuckets(buggy);
assert.notStrictEqual(buggy.releaseCache['N2027.R1'], buggy.releaseCache['N2026.R2']);
buggy.releaseCache['N2026.R2'].NFS = nfs2026;
buggy.releaseCache['N2027.R1'].NFS = nfs2027;
assert.strictEqual(buggy.releaseCache['N2027.R1'].NFS.issues[0].key, 'NFS-9');

console.log('release-cache: ok');
