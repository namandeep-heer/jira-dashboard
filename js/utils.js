// ── Utility Functions ───────────────────────────────────────────────────────

import { PHASES } from './config.js';
import { S } from './state.js';

export function getPhaseForStatus(statusName) {
  return PHASES.find(p => p.re.test((statusName || '').trim())) || null;
}

export function getPreferredTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString();
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString();
}

export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function getReleases() {
  return S.releases || [];
}

export function getCurrentRelease() {
  if (!S.releases || S.releases.length === 0) return null;
  // Return the first release or the one marked as current
  return S.releases.find(r => r.current) || S.releases[0];
}
