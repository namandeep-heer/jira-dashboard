// ── Releases Configuration Page ────────────────────────────────────────────

import { S, persist } from '../state.js';
import { escapeHtml } from '../utils.js';

// Default milestone definitions based on N2026.R2 structure
const DEFAULT_MILESTONES = [
  { id: 'DA', label: 'Discovery Alignment', fullName: 'DISCOVERY ALIGNMENT', color: '#185FA5' },
  { id: 'KO', label: 'Release Kickoff', fullName: 'RELEASE KICKOFF', color: '#185FA5' },
  { id: 'SC', label: 'Scope Close', fullName: 'SCOPE CLOSE', color: '#5b9fd6' },
  { id: 'SC2', label: 'Scope Commitment', fullName: 'SCOPE COMMITMENT', color: '#5b9fd6' },
  { id: 'FF', label: 'Feature Freeze', fullName: 'FEATURE FREEZE', color: '#e0a040' },
  { id: 'VR', label: 'Validation Results', fullName: 'VALIDATION RESULTS', color: '#c47a0f' },
  { id: 'PF', label: 'Preview Freeze', fullName: 'PREVIEW FREEZE', color: '#7cb842' },
  { id: 'GA', label: 'General Availability', fullName: 'GENERAL AVAILABILITY', color: '#7cb842' },
  { id: 'GE', label: 'Globally Enabled (Nakisa)', fullName: 'GLOBALLY ENABLED Nakisa', color: '#7cb842' },
  { id: 'GE2', label: 'Globally Enabled (Customer)', fullName: 'GLOBALLY ENABLED Customer', color: '#7cb842' },
  { id: 'GL', label: 'Globally Live', fullName: 'GLOBALLY LIVE', color: '#533AB7' },
  { id: 'EOS', label: 'End of Support', fullName: 'END OF SUPPORT', color: '#e07070' }
];

export function renderReleasesConfig() {
  const container = document.getElementById('page-releases-config');
  if (!container) return;

  // Initialize releases in state if not present
  if (!S.releases) {
    S.releases = [];
  }

  container.innerHTML = `
    <div class="setup-wrap" style="max-width: 900px;">
      <div class="card">
        <h2>Release Configuration</h2>
        <p class="desc">
          Configure releases and their milestone dates. Each release tracks key dates for 
          milestones like Discovery Alignment, Feature Freeze, General Availability, etc.
        </p>
        
        <div style="margin-bottom: 20px;">
          <button class="btn primary" onclick="window.app.addRelease()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add New Release
          </button>
        </div>

        <div id="releases-list"></div>
      </div>

      <div class="card">
        <h2>Milestone Definitions</h2>
        <p class="desc">
          These are the standard milestones tracked for each release. You can customize 
          the labels and colors for your organization.
        </p>
        <div id="milestones-list"></div>
        <div style="margin-top: 16px;">
          <button class="btn" onclick="window.app.resetMilestones()">Reset to Defaults</button>
        </div>
      </div>
    </div>
  `;

  renderReleasesList();
  renderMilestonesList();
}

function renderReleasesList() {
  const container = document.getElementById('releases-list');
  if (!container) return;

  if (S.releases.length === 0) {
    container.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; color: var(--text3); font-size: 13px;">
        No releases configured yet. Click "Add New Release" to get started.
      </div>
    `;
    return;
  }

  let html = '';
  S.releases.forEach((release, index) => {
    html += `
      <div class="release-card" style="
        border: 0.5px solid var(--border);
        border-radius: var(--radius);
        padding: 16px;
        margin-bottom: 12px;
        background: var(--bg2);
      ">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
          <input 
            type="text" 
            value="${escapeHtml(release.name || '')}"
            placeholder="Release name (e.g., N2026.R2)"
            onchange="window.app.updateReleaseName(${index}, this.value)"
            style="
              flex: 1;
              padding: 8px 12px;
              border: 0.5px solid var(--border2);
              border-radius: var(--radius);
              background: var(--bg);
              color: var(--text);
              font-size: 14px;
              font-weight: 600;
              font-family: inherit;
            "
          />
          <button 
            class="btn btn-sm" 
            onclick="window.app.duplicateRelease(${index})"
            title="Duplicate this release"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Duplicate
          </button>
          <button 
            class="btn btn-sm" 
            onclick="window.app.deleteRelease(${index})"
            style="color: var(--red);"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Delete
          </button>
        </div>
        
        <div class="milestones-grid" style="
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 10px;
        ">
          ${getMilestones().map(milestone => `
            <div class="milestone-field">
              <label style="
                display: block;
                font-size: 11px;
                font-weight: 600;
                color: var(--text3);
                margin-bottom: 4px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
              ">
                <span style="
                  display: inline-block;
                  width: 10px;
                  height: 10px;
                  border-radius: 3px;
                  background: ${milestone.color};
                  margin-right: 5px;
                "></span>
                ${escapeHtml(milestone.id)} - ${escapeHtml(milestone.label)}
              </label>
              <input 
                type="date"
                value="${release.milestones?.[milestone.id] || ''}"
                onchange="window.app.updateMilestone(${index}, '${milestone.id}', this.value)"
                style="
                  width: 100%;
                  padding: 6px 8px;
                  border: 0.5px solid var(--border2);
                  border-radius: var(--radius);
                  background: var(--bg);
                  color: var(--text);
                  font-size: 12px;
                  font-family: inherit;
                "
              />
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderMilestonesList() {
  const container = document.getElementById('milestones-list');
  if (!container) return;

  const milestones = getMilestones();
  
  let html = '<div style="display: flex; flex-direction: column; gap: 8px;">';
  milestones.forEach((milestone, index) => {
    html += `
      <div style="
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        border: 0.5px solid var(--border);
        border-radius: var(--radius);
        background: var(--bg2);
      ">
        <input 
          type="color"
          value="${milestone.color}"
          onchange="window.app.updateMilestoneColor(${index}, this.value)"
          style="
            width: 32px;
            height: 32px;
            border: 0.5px solid var(--border2);
            border-radius: var(--radius);
            cursor: pointer;
          "
        />
        <input 
          type="text"
          value="${escapeHtml(milestone.id)}"
          onchange="window.app.updateMilestoneId(${index}, this.value)"
          placeholder="ID (e.g., DA)"
          style="
            width: 60px;
            padding: 6px 8px;
            border: 0.5px solid var(--border2);
            border-radius: var(--radius);
            background: var(--bg);
            color: var(--text);
            font-size: 12px;
            font-weight: 600;
            font-family: monospace;
          "
        />
        <input 
          type="text"
          value="${escapeHtml(milestone.label)}"
          onchange="window.app.updateMilestoneLabel(${index}, this.value)"
          placeholder="Short label"
          style="
            flex: 1;
            padding: 6px 8px;
            border: 0.5px solid var(--border2);
            border-radius: var(--radius);
            background: var(--bg);
            color: var(--text);
            font-size: 12px;
            font-family: inherit;
          "
        />
        <input 
          type="text"
          value="${escapeHtml(milestone.fullName || milestone.label)}"
          onchange="window.app.updateMilestoneFullName(${index}, this.value)"
          placeholder="Full name"
          style="
            flex: 1;
            padding: 6px 8px;
            border: 0.5px solid var(--border2);
            border-radius: var(--radius);
            background: var(--bg);
            color: var(--text);
            font-size: 12px;
            font-family: inherit;
          "
        />
      </div>
    `;
  });
  html += '</div>';

  container.innerHTML = html;
}

// ── Helper functions ────────────────────────────────────────────────────────

function getMilestones() {
  if (!S.milestones || S.milestones.length === 0) {
    S.milestones = JSON.parse(JSON.stringify(DEFAULT_MILESTONES));
  }
  return S.milestones;
}

// ── Global actions (exposed via window.app) ─────────────────────────────────

export function addRelease() {
  if (!S.releases) S.releases = [];
  
  S.releases.push({
    name: `N${new Date().getFullYear()}.R${S.releases.length + 1}`,
    milestones: {}
  });
  
  persist();
  renderReleasesList();
}

export function duplicateRelease(index) {
  if (!S.releases || !S.releases[index]) return;
  
  const original = S.releases[index];
  const duplicate = JSON.parse(JSON.stringify(original));
  duplicate.name = `${duplicate.name} (Copy)`;
  
  S.releases.splice(index + 1, 0, duplicate);
  persist();
  renderReleasesList();
}

export function deleteRelease(index) {
  if (!S.releases || !S.releases[index]) return;
  
  const releaseName = S.releases[index].name || 'this release';
  if (!confirm(`Delete ${releaseName}? This cannot be undone.`)) return;
  
  S.releases.splice(index, 1);
  persist();
  renderReleasesList();
}

export function updateReleaseName(index, value) {
  if (!S.releases || !S.releases[index]) return;
  S.releases[index].name = value;
  persist();
}

export function updateMilestone(releaseIndex, milestoneId, value) {
  if (!S.releases || !S.releases[releaseIndex]) return;
  if (!S.releases[releaseIndex].milestones) {
    S.releases[releaseIndex].milestones = {};
  }
  S.releases[releaseIndex].milestones[milestoneId] = value;
  persist();
}

export function updateMilestoneColor(index, value) {
  const milestones = getMilestones();
  if (!milestones[index]) return;
  milestones[index].color = value;
  persist();
  renderMilestonesList();
  renderReleasesList();
}

export function updateMilestoneId(index, value) {
  const milestones = getMilestones();
  if (!milestones[index]) return;
  const oldId = milestones[index].id;
  milestones[index].id = value;
  
  // Update all releases to use new ID
  if (S.releases) {
    S.releases.forEach(release => {
      if (release.milestones && release.milestones[oldId] !== undefined) {
        release.milestones[value] = release.milestones[oldId];
        delete release.milestones[oldId];
      }
    });
  }
  
  persist();
  renderMilestonesList();
  renderReleasesList();
}

export function updateMilestoneLabel(index, value) {
  const milestones = getMilestones();
  if (!milestones[index]) return;
  milestones[index].label = value;
  persist();
  renderMilestonesList();
  renderReleasesList();
}

export function updateMilestoneFullName(index, value) {
  const milestones = getMilestones();
  if (!milestones[index]) return;
  milestones[index].fullName = value;
  persist();
}

export function resetMilestones() {
  if (!confirm('Reset milestones to default configuration? This will not affect your release dates.')) return;
  S.milestones = JSON.parse(JSON.stringify(DEFAULT_MILESTONES));
  persist();
  renderMilestonesList();
  renderReleasesList();
}

// Export all functions to window.app
if (!window.app) window.app = {};
Object.assign(window.app, {
  addRelease,
  duplicateRelease,
  deleteRelease,
  updateReleaseName,
  updateMilestone,
  updateMilestoneColor,
  updateMilestoneId,
  updateMilestoneLabel,
  updateMilestoneFullName,
  resetMilestones
});
