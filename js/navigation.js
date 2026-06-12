// ── Navigation ──────────────────────────────────────────────────────────────

import { S, getAllProjects } from './state.js';
import { checkProxy } from './api.js';

export function nav(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  const page = document.getElementById('page-' + id);
  const navBtn = document.getElementById('nav-' + id);
  
  if (page) page.classList.add('active');
  if (navBtn) navBtn.classList.add('active');
  
  S.page = id;

  const proj = getAllProjects().find(p => p.id === id);
  if (proj) {
    document.getElementById('topbar-title').textContent = proj.name;
    // Dynamic import for project view
    import('./pages/project-view.js').then(module => {
      module.renderProject(proj);
    });
  } else {
    // Handle special pages
    switch (id) {
      case 'analytics':
        document.getElementById('topbar-title').textContent = 'Analytics';
        import('./pages/analytics.js').then(module => module.renderAnalytics());
        break;
      case 'dev-planning':
        document.getElementById('topbar-title').textContent = 'Dev Planning';
        import('./pages/dev-planning.js')
          .then(module => {
            console.log('Dev Planning module loaded:', module);
            module.renderDevPlanning();
          })
          .catch(err => {
            console.error('Failed to load dev-planning module:', err);
            document.getElementById('dev-planning-content').innerHTML = `
              <div class="err-box">Failed to load Dev Planning module: ${err.message}</div>
            `;
          });
        break;
      case 'team':
        document.getElementById('topbar-title').textContent = 'Team View';
        import('./pages/team.js').then(module => module.renderTeam());
        break;
      case 'phase-timeline':
        document.getElementById('topbar-title').textContent = 'Project Phase Timeline';
        import('./pages/phase-timeline.js').then(module => module.renderPhaseTimeline());
        break;
      case 'log':
        document.getElementById('topbar-title').textContent = 'Daily Progress';
        import('./pages/daily-progress.js').then(module => module.renderDailyProgress());
        break;
      case 'projects-config':
        document.getElementById('topbar-title').textContent = 'Projects';
        import('./pages/projects-config.js').then(module => module.renderProjectsConfig());
        break;
      case 'releases-config':
        document.getElementById('topbar-title').textContent = 'Releases';
        import('./pages/releases-config.js').then(module => module.renderReleasesConfig());
        break;
      case 'fields':
        document.getElementById('topbar-title').textContent = 'Field Configuration';
        import('./pages/fields.js').then(module => module.renderFields());
        break;
      case 'setup':
        document.getElementById('topbar-title').textContent = 'Jira Setup';
        document.getElementById('inp-url').value = S.creds.url;
        document.getElementById('inp-email').value = S.creds.email;
        document.getElementById('inp-token').value = S.creds.token;
        checkProxy().then(isOnline => updateProxyIndicator(isOnline));
        break;
    }
  }
}

function updateProxyIndicator(isOnline) {
  const dot = document.getElementById('proxy-dot');
  const text = document.getElementById('proxy-status-text');
  const ind = document.getElementById('proxy-indicator');
  
  if (isOnline) {
    if (dot) dot.className = 'dot-ok';
    if (text) text.textContent = 'Proxy running on port 3131';
    if (ind) ind.innerHTML = '<span style="font-size:12px;color:var(--green);display:flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block"></span>Proxy online</span>';
  } else {
    if (dot) dot.className = 'dot-err';
    if (text) text.textContent = 'Proxy not running — start it with: node proxy.js';
    if (ind) ind.innerHTML = '<span style="font-size:12px;color:var(--red);display:flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:50%;background:var(--red);display:inline-block"></span>Proxy offline</span>';
  }
}

export function initNavigation() {
  // Render sidebar projects
  renderSidebarProjects();
}

function renderSidebarProjects() {
  const container = document.getElementById('projects-container');
  if (!container) return;

  const projects = getAllProjects();
  const categories = {};

  projects.forEach(proj => {
    const cat = proj.category || 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(proj);
  });

  let html = '';
  Object.keys(categories).sort().forEach(cat => {
    html += `<div class="category-label">${cat}</div>`;
    categories[cat].forEach(proj => {
      html += `<button class="nav-item" onclick="window.app.nav('${proj.id}')" id="nav-${proj.id}">
        <span class="proj-dot" style="background:${proj.color}"></span>
        ${escapeHtml(proj.name)}
      </button>`;
    });
  });

  container.innerHTML = html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
