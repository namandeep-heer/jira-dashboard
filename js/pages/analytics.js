// ── Analytics Page ──────────────────────────────────────────────────────────

import { S, jiraId, getAllProjects } from '../state.js';
import { getPhaseForStatus } from '../utils.js';
import { PHASES } from '../config.js';

export function renderAnalytics() {
  const allProjects = getAllProjects();
  const body = document.getElementById('analytics-body');
  
  if (allProjects.length === 0) {
    body.innerHTML = '<div class="info-box">No projects configured. Please add projects in Config → Projects.</div>';
    return;
  }

  const loadedProjects = allProjects.filter(p => S.cache[p.id]);
  if (loadedProjects.length === 0) {
    body.innerHTML = '<div class="info-box">No data loaded. Please navigate to each project page to fetch data.</div>';
    return;
  }

  let html = '';

  // ── Developer Velocity Section ──────────────────────────────────────────────
  html += '<div class="section-h-row">';
  html += '<div class="section-h">Developer Velocity</div>';
  html += '<div style="display:flex;gap:8px;">';
  html += '<input type="text" id="velocity-search" class="section-control" placeholder="Search developer or ticket..." style="width:200px;">';
  html += '<select id="velocity-project-filter" class="section-control"><option value="">All Projects</option></select>';
  html += '<select id="velocity-dev-filter" class="section-control"><option value="">All Developers</option></select>';
  html += '<select id="velocity-release-filter" class="section-control"><option value="">All Releases</option></select>';
  html += '</div>';
  html += '</div>';
  html += '<div id="velocity-table-container">' + renderDeveloperVelocity(loadedProjects) + '</div>';

  // ── Status Breakdown ────────────────────────────────────────────────────────
  html += '<div class="section-h">Status Breakdown by Project</div>';
  html += '<div class="charts-grid">';
  
  for (const proj of loadedProjects) {
    const data = S.cache[proj.id];
    if (!data || !data.issues || data.issues.length === 0) continue;
    
    const statusCounts = {};
    for (const issue of data.issues) {
      const statusKey = issue.fields.status?.name || 'Unknown';
      statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1;
    }
    
    html += `
      <div class="chart-card">
        <h3><span class="proj-dot" style="background:${proj.color}"></span>${proj.name}</h3>
        <div class="chart-sub">${data.issues.length} issues</div>
        <canvas id="chart-status-${proj.id}" width="300" height="200"></canvas>
      </div>
    `;
  }
  
  html += '</div>';

  // ── Phase Distribution ──────────────────────────────────────────────────────
  html += '<div class="section-h">Phase Distribution</div>';
  html += '<div class="charts-grid">';
  
  for (const proj of loadedProjects) {
    const data = S.cache[proj.id];
    if (!data || !data.issues || data.issues.length === 0) continue;
    
    const phaseCounts = {};
    for (const issue of data.issues) {
      const statusName = issue.fields.status?.name || '';
      const phase = getPhaseForStatus(statusName);
      const phaseLabel = phase ? phase.label : 'Other';
      phaseCounts[phaseLabel] = (phaseCounts[phaseLabel] || 0) + 1;
    }
    
    html += `
      <div class="chart-card">
        <h3><span class="proj-dot" style="background:${proj.color}"></span>${proj.name}</h3>
        <div class="chart-sub">Workflow phases</div>
        <canvas id="chart-phase-${proj.id}" width="300" height="200"></canvas>
      </div>
    `;
  }
  
  html += '</div>';

  // ── Priority Distribution ───────────────────────────────────────────────────
  html += '<div class="section-h">Priority Distribution</div>';
  html += '<div class="charts-grid">';
  
  for (const proj of loadedProjects) {
    const data = S.cache[proj.id];
    if (!data || !data.issues || data.issues.length === 0) continue;
    
    const priorityCounts = {};
    for (const issue of data.issues) {
      const priority = issue.fields.priority?.name || 'None';
      priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
    }
    
    html += `
      <div class="chart-card">
        <h3><span class="proj-dot" style="background:${proj.color}"></span>${proj.name}</h3>
        <div class="chart-sub">By priority</div>
        <canvas id="chart-priority-${proj.id}" width="300" height="200"></canvas>
      </div>
    `;
  }
  
  html += '</div>';

  // ── Issue Type Distribution ─────────────────────────────────────────────────
  html += '<div class="section-h">Issue Type Distribution</div>';
  html += '<div class="charts-grid">';
  
  for (const proj of loadedProjects) {
    const data = S.cache[proj.id];
    if (!data || !data.issues || data.issues.length === 0) continue;
    
    const typeCounts = {};
    for (const issue of data.issues) {
      const type = issue.fields.issuetype?.name || 'Unknown';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }
    
    html += `
      <div class="chart-card">
        <h3><span class="proj-dot" style="background:${proj.color}"></span>${proj.name}</h3>
        <div class="chart-sub">Issue types</div>
        <canvas id="chart-type-${proj.id}" width="300" height="200"></canvas>
      </div>
    `;
  }
  
  html += '</div>';

  body.innerHTML = html;

  // Populate filter dropdowns
  populateVelocityFilters(loadedProjects);

  // Render all charts after DOM is updated
  setTimeout(() => {
    for (const proj of loadedProjects) {
      const data = S.cache[proj.id];
      if (!data || !data.issues || data.issues.length === 0) continue;
      
      renderStatusChart(proj);
      renderPhaseChart(proj);
      renderPriorityChart(proj);
      renderTypeChart(proj);
    }
  }, 0);
}

// ── Populate Velocity Filters ───────────────────────────────────────────────

function populateVelocityFilters(projects) {
  const projectFilter = document.getElementById('velocity-project-filter');
  const devFilter = document.getElementById('velocity-dev-filter');
  const releaseFilter = document.getElementById('velocity-release-filter');
  const searchInput = document.getElementById('velocity-search');
  
  if (!projectFilter || !devFilter || !releaseFilter) return;

  // Collect unique projects, developers, and releases
  const projectsSet = new Set();
  const devsSet = new Set();
  const releasesSet = new Set();

  for (const proj of projects) {
    const data = S.cache[proj.id];
    if (!data || !data.issues) continue;

    projectsSet.add(proj.name);

    for (const issue of data.issues) {
      const devField = issue.fields[jiraId({ id: 'cf_dev', jira: 'customfield_10206' })];
      const devName = devField?.displayName || devField?.name;
      if (devName && devName !== 'Unassigned') {
        devsSet.add(devName);
      }
      
      // Collect fix versions (releases)
      const fixVersions = issue.fields.fixVersions || [];
      fixVersions.forEach(fv => {
        if (fv.name) releasesSet.add(fv.name);
      });
    }
  }

  // Populate project filter
  [...projectsSet].sort().forEach(projName => {
    const opt = document.createElement('option');
    opt.value = projName;
    opt.textContent = projName;
    projectFilter.appendChild(opt);
  });

  // Populate developer filter
  [...devsSet].sort().forEach(devName => {
    const opt = document.createElement('option');
    opt.value = devName;
    opt.textContent = devName;
    devFilter.appendChild(opt);
  });

  // Populate release filter
  [...releasesSet].sort().forEach(releaseName => {
    const opt = document.createElement('option');
    opt.value = releaseName;
    opt.textContent = releaseName;
    releaseFilter.appendChild(opt);
  });

  // Add event listeners to filters
  projectFilter.addEventListener('change', () => applyVelocityFilters(projects));
  devFilter.addEventListener('change', () => applyVelocityFilters(projects));
  releaseFilter.addEventListener('change', () => applyVelocityFilters(projects));
  
  if (searchInput) {
    searchInput.addEventListener('input', () => applyVelocityFilters(projects));
  }
}

// ── Apply Velocity Filters ──────────────────────────────────────────────────

function applyVelocityFilters(projects) {
  const projectFilter = document.getElementById('velocity-project-filter');
  const devFilter = document.getElementById('velocity-dev-filter');
  const releaseFilter = document.getElementById('velocity-release-filter');
  const searchInput = document.getElementById('velocity-search');
  const container = document.getElementById('velocity-table-container');
  
  if (!projectFilter || !devFilter || !releaseFilter || !container) return;

  const selectedProject = projectFilter.value;
  const selectedDev = devFilter.value;
  const selectedRelease = releaseFilter.value;
  const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

  container.innerHTML = renderDeveloperVelocity(projects, selectedProject, selectedDev, selectedRelease, searchTerm);
}

// ── Developer Velocity Calculation ──────────────────────────────────────────

function renderDeveloperVelocity(projects, filterProject = '', filterDev = '', filterRelease = '', searchTerm = '') {
  const devVelocity = {};
  const missingDataTickets = []; // Track tickets with missing estimate/actual

  // Aggregate data across all projects
  for (const proj of projects) {
    const data = S.cache[proj.id];
    if (!data || !data.issues) continue;

    // Apply project filter
    if (filterProject && proj.name !== filterProject) continue;

    for (const issue of data.issues) {
      const devField = issue.fields[jiraId({ id: 'cf_dev', jira: 'customfield_10206' })];
      const devName = devField?.displayName || devField?.name || 'Unassigned';
      
      if (devName === 'Unassigned') continue;

      // Apply developer filter
      if (filterDev && devName !== filterDev) continue;

      // Get release info
      const fixVersions = issue.fields.fixVersions || [];
      const releases = fixVersions.map(fv => fv.name).join(', ');
      
      // Apply release filter
      if (filterRelease && !fixVersions.some(fv => fv.name === filterRelease)) continue;

      const status = issue.fields.status?.name || '';
      const phase = getPhaseForStatus(status);
      const isCompleted = phase?.label === 'Closed';

      const estimateField = issue.fields[jiraId({ id: 'cf_devest', jira: 'customfield_10204' })];
      const actualField = issue.fields[jiraId({ id: 'cf_devact', jira: 'customfield_10203' })];
      
      const estimate = parseFloat(estimateField) || 0;
      const actual = parseFloat(actualField) || 0;

      // Flag tickets with missing estimate (all tickets need estimate)
      if (estimate === 0) {
        missingDataTickets.push({
          key: issue.key,
          summary: issue.fields.summary,
          devName,
          project: proj.name,
          projectColor: proj.color,
          phase: phase?.label || 'Other',
          releases,
          missingEstimate: true,
          missingActual: false,
          isCompleted
        });
        continue; // Skip this ticket from velocity calculation
      }

      // Flag completed tickets with missing actual
      if (isCompleted && actual === 0) {
        missingDataTickets.push({
          key: issue.key,
          summary: issue.fields.summary,
          devName,
          project: proj.name,
          projectColor: proj.color,
          phase: phase?.label || 'Other',
          releases,
          missingEstimate: false,
          missingActual: true,
          isCompleted
        });
        continue; // Skip this ticket from velocity calculation
      }

      if (!devVelocity[devName]) {
        devVelocity[devName] = {
          name: devName,
          totalEstimate: 0,
          totalActual: 0,
          completedEstimate: 0,
          tickets: [],
          completedTickets: 0,
          inProgressTickets: 0,
          todoTickets: 0,
          releases: new Set()
        };
      }

      // Add estimate to total (all tickets)
      devVelocity[devName].totalEstimate += estimate;

      // Track releases
      fixVersions.forEach(fv => {
        if (fv.name) devVelocity[devName].releases.add(fv.name);
      });

      // For completed tickets: add actual and track completed estimate
      // For incomplete tickets: actual stays 0 (we'll use estimate later)
      if (isCompleted) {
        devVelocity[devName].totalActual += actual;
        devVelocity[devName].completedEstimate += estimate;
        devVelocity[devName].completedTickets++;
      } else if (phase?.label === 'Developing') {
        devVelocity[devName].inProgressTickets++;
      } else {
        devVelocity[devName].todoTickets++;
      }

      devVelocity[devName].tickets.push({
        key: issue.key,
        summary: issue.fields.summary,
        estimate,
        actual: isCompleted ? actual : 0,
        status,
        phase: phase?.label || 'Other',
        project: proj.name,
        projectColor: proj.color,
        releases,
        isCompleted
      });
    }
  }

  // Calculate velocity metrics
  const devMetrics = Object.values(devVelocity).map(dev => {
    // Completed work: actual time spent
    // Incomplete work: estimate (planned time)
    // Total capacity needed = actuals from completed + estimates from incomplete
    const totalCapacityNeeded = dev.totalActual + (dev.totalEstimate - dev.completedEstimate);
    
    // Variance = Total capacity needed - Original total estimate
    // Positive variance = need more time than estimated (behind)
    // Negative variance = need less time than estimated (has capacity)
    const variance = totalCapacityNeeded - dev.totalEstimate;
    const variancePercent = dev.totalEstimate > 0 
      ? ((variance / dev.totalEstimate) * 100).toFixed(1)
      : 0;
    
    // Determine status based on variance
    let velocityStatus = 'on-track';
    let velocityLabel = 'On Track';
    
    if (variance > dev.totalEstimate * 0.15) {
      // Need more than 15% extra capacity (behind)
      velocityStatus = 'behind';
      velocityLabel = 'Behind Schedule';
    } else if (variance < -dev.totalEstimate * 0.15) {
      // Need less than 85% of estimated capacity (has room)
      velocityStatus = 'capacity';
      velocityLabel = 'Has Capacity';
    } else {
      // Within ±15% of estimated capacity (on track)
      velocityStatus = 'on-track';
      velocityLabel = 'On Track';
    }

    return {
      ...dev,
      totalCapacityNeeded,
      variance,
      variancePercent,
      velocityStatus,
      velocityLabel,
      efficiency: dev.completedEstimate > 0 
        ? ((dev.completedEstimate / Math.max(dev.totalActual, 0.1)) * 100).toFixed(0)
        : 100
    };
  });

  // Sort by variance (most behind first)
  devMetrics.sort((a, b) => b.variance - a.variance);

  // Apply search filter
  let filteredMetrics = devMetrics;
  if (searchTerm) {
    filteredMetrics = devMetrics.filter(dev => {
      const nameMatch = dev.name.toLowerCase().includes(searchTerm);
      const ticketMatch = dev.tickets.some(t => 
        t.key.toLowerCase().includes(searchTerm) ||
        t.summary.toLowerCase().includes(searchTerm)
      );
      return nameMatch || ticketMatch;
    });
  }

  // Render table
  let html = '';

  // Show missing data warning if applicable
  if (missingDataTickets.length > 0) {
    html += `
      <div class="velocity-warning-card">
        <div class="velocity-warning-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span class="velocity-warning-title">Data Quality Issues: ${missingDataTickets.length} Ticket${missingDataTickets.length > 1 ? 's' : ''} Excluded</span>
        </div>
        <div class="velocity-warning-message">
          The following tickets are missing required data and were excluded from velocity calculations:
        </div>
        <details class="velocity-warning-details">
          <summary class="velocity-warning-summary">View ${missingDataTickets.length} ticket${missingDataTickets.length > 1 ? 's' : ''} with missing data</summary>
          <div class="velocity-warning-tickets">
            ${missingDataTickets.map(ticket => `
              <div class="velocity-warning-ticket">
                <div class="velocity-ticket-header">
                  <a href="https://jira.atlassian.com/browse/${ticket.key}" target="_blank" class="key-link">${ticket.key}</a>
                  <span class="velocity-ticket-project" style="color:${ticket.projectColor}">${ticket.project}</span>
                  <span class="velocity-ticket-phase">${ticket.phase}</span>
                  <span class="velocity-warning-dev">${ticket.devName}</span>
                  ${ticket.releases ? `<span class="velocity-ticket-release">${ticket.releases}</span>` : ''}
                </div>
                <div class="velocity-ticket-summary">${ticket.summary}</div>
                <div class="velocity-warning-missing">
                  ${ticket.missingEstimate ? '<span class="velocity-missing-badge">Missing Estimate</span>' : ''}
                  ${ticket.missingActual ? '<span class="velocity-missing-badge">Missing Actual</span>' : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </details>
      </div>
    `;
  }
  
  if (filteredMetrics.length === 0) {
    const message = filterProject || filterDev || filterRelease || searchTerm
      ? 'No tickets found for the selected filters/search. Try adjusting your criteria.'
      : 'No developer assignments with valid estimate data found.';
    return html + `<div class="info-box">${message}</div>`;
  }

  // Render as table
  html += `
    <div class="velocity-table-wrap">
      <table class="velocity-table">
        <thead>
          <tr>
            <th>Developer</th>
            <th>Status</th>
            <th>Release(s)</th>
            <th>Est Days</th>
            <th>Cap Needed</th>
            <th>Variance</th>
            <th>Efficiency</th>
            <th>Completed</th>
            <th>In Progress</th>
            <th>To Do</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
  `;

  for (const dev of filteredMetrics) {
    const statusClass = dev.velocityStatus === 'behind' ? 'velocity-behind' 
      : dev.velocityStatus === 'capacity' ? 'velocity-capacity' 
      : 'velocity-on-track';
    
    const statusIcon = dev.velocityStatus === 'behind' ? '⚠️' 
      : dev.velocityStatus === 'capacity' ? '✓' 
      : '●';

    const releases = [...dev.releases].sort().join(', ') || '-';

    html += `
      <tr class="velocity-row ${statusClass}">
        <td class="velocity-dev-name">${dev.name}</td>
        <td>
          <span class="velocity-status-badge ${statusClass}">
            ${statusIcon} ${dev.velocityLabel}
          </span>
        </td>
        <td class="velocity-releases">${releases}</td>
        <td>${dev.totalEstimate.toFixed(1)}d</td>
        <td>${dev.totalCapacityNeeded.toFixed(1)}d</td>
        <td class="${dev.variance > 0 ? 'variance-neg' : 'variance-pos'}">
          ${dev.variance > 0 ? '+' : ''}${dev.variance.toFixed(1)}d
          <span class="variance-percent">(${dev.variancePercent > 0 ? '+' : ''}${dev.variancePercent}%)</span>
        </td>
        <td>${dev.efficiency}%</td>
        <td><span class="count-badge count-done">${dev.completedTickets}</span></td>
        <td><span class="count-badge count-ip">${dev.inProgressTickets}</span></td>
        <td><span class="count-badge count-todo">${dev.todoTickets}</span></td>
        <td>
          <button class="btn btn-sm" onclick="toggleVelocityDetails('${dev.name.replace(/'/g, "\\'")}')">
            View Tickets
          </button>
        </td>
      </tr>
      <tr class="velocity-details-row" id="velocity-details-${dev.name.replace(/[^a-zA-Z0-9]/g, '_')}" style="display:none;">
        <td colspan="11">
          <div class="velocity-tickets-details">
            ${dev.tickets.map(ticket => `
              <div class="velocity-ticket">
                <div class="velocity-ticket-header">
                  <a href="https://jira.atlassian.com/browse/${ticket.key}" target="_blank" class="key-link">${ticket.key}</a>
                  <span class="velocity-ticket-project" style="color:${ticket.projectColor}">${ticket.project}</span>
                  <span class="velocity-ticket-phase">${ticket.phase}</span>
                  ${ticket.releases ? `<span class="velocity-ticket-release">${ticket.releases}</span>` : ''}
                </div>
                <div class="velocity-ticket-summary">${ticket.summary}</div>
                <div class="velocity-ticket-time">
                  Est: ${ticket.estimate.toFixed(1)}d
                  ${ticket.isCompleted ? `| Act: ${ticket.actual.toFixed(1)}d
                  <span class="${ticket.actual > ticket.estimate ? 'variance-neg' : 'variance-pos'}">
                    (${ticket.actual > ticket.estimate ? '+' : ''}${(ticket.actual - ticket.estimate).toFixed(1)}d)
                  </span>` : '| <span style="color:var(--text3)">Incomplete</span>'}
                </div>
              </div>
            `).join('')}
          </div>
        </td>
      </tr>
    `;
  }

  html += `
        </tbody>
      </table>
    </div>
  `;

  // Add toggle function to window
  if (!window.toggleVelocityDetails) {
    window.toggleVelocityDetails = function(devName) {
      const id = 'velocity-details-' + devName.replace(/[^a-zA-Z0-9]/g, '_');
      const row = document.getElementById(id);
      if (row) {
        row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
      }
    };
  }

  return html;
}

  // Show missing data warning if applicable
  if (missingDataTickets.length > 0) {
    html += `
      <div class="velocity-warning-card">
        <div class="velocity-warning-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span class="velocity-warning-title">Data Quality Issues: ${missingDataTickets.length} Ticket${missingDataTickets.length > 1 ? 's' : ''} Excluded</span>
        </div>
        <div class="velocity-warning-message">
          The following tickets are missing required data and were excluded from velocity calculations:
        </div>
        <details class="velocity-warning-details">
          <summary class="velocity-warning-summary">View ${missingDataTickets.length} ticket${missingDataTickets.length > 1 ? 's' : ''} with missing data</summary>
          <div class="velocity-warning-tickets">
            ${missingDataTickets.map(ticket => `
              <div class="velocity-warning-ticket">
                <div class="velocity-ticket-header">
                  <a href="https://jira.atlassian.com/browse/${ticket.key}" target="_blank" class="key-link">${ticket.key}</a>
                  <span class="velocity-ticket-project" style="color:${ticket.projectColor}">${ticket.project}</span>
                  <span class="velocity-ticket-phase">${ticket.phase}</span>
                  <span class="velocity-warning-dev">${ticket.devName}</span>
                </div>
                <div class="velocity-ticket-summary">${ticket.summary}</div>
                <div class="velocity-warning-missing">
                  ${ticket.missingEstimate ? '<span class="velocity-missing-badge">Missing Estimate</span>' : ''}
                  ${ticket.missingActual ? '<span class="velocity-missing-badge">Missing Actual</span>' : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </details>
      </div>
    `;
  }
  
  if (devMetrics.length === 0) {
    const message = filterProject || filterDev 
      ? 'No tickets found for the selected filters with valid data. Try adjusting your filter criteria.'
      : 'No developer assignments with valid estimate data found.';
    return html + `<div class="info-box">${message}</div>`;
  }

  for (const dev of devMetrics) {
    const statusClass = dev.velocityStatus === 'behind' ? 'velocity-behind' 
      : dev.velocityStatus === 'capacity' ? 'velocity-capacity' 
      : 'velocity-on-track';
    
    const statusIcon = dev.velocityStatus === 'behind' ? '⚠️' 
      : dev.velocityStatus === 'capacity' ? '✓' 
      : '●';

    html += `
      <div class="velocity-card ${statusClass}">
        <div class="velocity-header">
          <div class="velocity-name">${dev.name}</div>
          <div class="velocity-status-badge ${statusClass}">
            ${statusIcon} ${dev.velocityLabel}
          </div>
        </div>
        
        <div class="velocity-stats">
          <div class="velocity-stat">
            <div class="velocity-stat-label">Estimated Days</div>
            <div class="velocity-stat-value">${dev.totalEstimate.toFixed(1)}d</div>
          </div>
          <div class="velocity-stat">
            <div class="velocity-stat-label">Capacity Needed</div>
            <div class="velocity-stat-value">${dev.totalCapacityNeeded.toFixed(1)}d</div>
          </div>
          <div class="velocity-stat">
            <div class="velocity-stat-label">Variance</div>
            <div class="velocity-stat-value ${dev.variance > 0 ? 'variance-neg' : 'variance-pos'}">
              ${dev.variance > 0 ? '+' : ''}${dev.variance.toFixed(1)} days
              <span class="variance-percent">(${dev.variancePercent > 0 ? '+' : ''}${dev.variancePercent}%)</span>
            </div>
          </div>
          <div class="velocity-stat">
            <div class="velocity-stat-label">Efficiency</div>
            <div class="velocity-stat-value">${dev.efficiency}%</div>
          </div>
        </div>

        <div class="velocity-tickets-summary">
          <div class="velocity-ticket-count">
            <span class="count-badge count-done">${dev.completedTickets}</span> Completed
          </div>
          <div class="velocity-ticket-count">
            <span class="count-badge count-ip">${dev.inProgressTickets}</span> In Progress
          </div>
          <div class="velocity-ticket-count">
            <span class="count-badge count-todo">${dev.todoTickets}</span> To Do
          </div>
        </div>

        <details class="velocity-details">
          <summary class="velocity-details-summary">View ${dev.tickets.length} ticket${dev.tickets.length > 1 ? 's' : ''}</summary>
          <div class="velocity-tickets">
            ${dev.tickets.map(ticket => `
              <div class="velocity-ticket">
                <div class="velocity-ticket-header">
                  <a href="https://jira.atlassian.com/browse/${ticket.key}" target="_blank" class="key-link">${ticket.key}</a>
                  <span class="velocity-ticket-project" style="color:${ticket.projectColor}">${ticket.project}</span>
                  <span class="velocity-ticket-phase">${ticket.phase}</span>
                </div>
                <div class="velocity-ticket-summary">${ticket.summary}</div>
                <div class="velocity-ticket-time">
                  Est: ${ticket.estimate.toFixed(1)}d
                  ${ticket.isCompleted ? `| Act: ${ticket.actual.toFixed(1)}d
                  <span class="${ticket.actual > ticket.estimate ? 'variance-neg' : 'variance-pos'}">
                    (${ticket.actual > ticket.estimate ? '+' : ''}${(ticket.actual - ticket.estimate).toFixed(1)}d)
                  </span>` : '| <span style="color:var(--text3)">Incomplete</span>'}
                </div>
              </div>
            `).join('')}
          </div>
        </details>
      </div>
    `;
  }

  return html;
}

// ── Chart Rendering Functions ───────────────────────────────────────────────

function renderStatusChart(proj) {
  const data = S.cache[proj.id];
  if (!data || !data.issues) return;
  
  const statusCounts = {};
  for (const issue of data.issues) {
    const statusKey = issue.fields.status?.name || 'Unknown';
    statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1;
  }
  
  const ctx = document.getElementById(`chart-status-${proj.id}`);
  if (!ctx) return;
  
  if (S.charts[`status-${proj.id}`]) {
    S.charts[`status-${proj.id}`].destroy();
  }
  
  S.charts[`status-${proj.id}`] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(statusCounts),
      datasets: [{
        label: 'Issues',
        data: Object.values(statusCounts),
        backgroundColor: proj.color,
        borderColor: proj.color,
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}

function renderPhaseChart(proj) {
  const data = S.cache[proj.id];
  if (!data || !data.issues) return;
  
  const phaseCounts = {};
  const phaseColors = {};
  
  for (const issue of data.issues) {
    const statusName = issue.fields.status?.name || '';
    const phase = getPhaseForStatus(statusName);
    const phaseLabel = phase ? phase.label : 'Other';
    phaseCounts[phaseLabel] = (phaseCounts[phaseLabel] || 0) + 1;
    if (phase) phaseColors[phaseLabel] = phase.color;
  }
  
  const ctx = document.getElementById(`chart-phase-${proj.id}`);
  if (!ctx) return;
  
  if (S.charts[`phase-${proj.id}`]) {
    S.charts[`phase-${proj.id}`].destroy();
  }
  
  const labels = Object.keys(phaseCounts);
  const colors = labels.map(label => phaseColors[label] || '#999999');
  
  S.charts[`phase-${proj.id}`] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: Object.values(phaseCounts),
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } }
      }
    }
  });
}

function renderPriorityChart(proj) {
  const data = S.cache[proj.id];
  if (!data || !data.issues) return;
  
  const priorityCounts = {};
  for (const issue of data.issues) {
    const priority = issue.fields.priority?.name || 'None';
    priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
  }
  
  const ctx = document.getElementById(`chart-priority-${proj.id}`);
  if (!ctx) return;
  
  if (S.charts[`priority-${proj.id}`]) {
    S.charts[`priority-${proj.id}`].destroy();
  }
  
  const priorityColors = {
    'Critical': '#D32F2F',
    'High': '#F57C00',
    'Medium': '#FBC02D',
    'Low': '#388E3C',
    'Lowest': '#1976D2',
    'None': '#757575'
  };
  
  const labels = Object.keys(priorityCounts);
  const colors = labels.map(label => priorityColors[label] || '#999999');
  
  S.charts[`priority-${proj.id}`] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: Object.values(priorityCounts),
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } }
      }
    }
  });
}

function renderTypeChart(proj) {
  const data = S.cache[proj.id];
  if (!data || !data.issues) return;
  
  const typeCounts = {};
  for (const issue of data.issues) {
    const type = issue.fields.issuetype?.name || 'Unknown';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }
  
  const ctx = document.getElementById(`chart-type-${proj.id}`);
  if (!ctx) return;
  
  if (S.charts[`type-${proj.id}`]) {
    S.charts[`type-${proj.id}`].destroy();
  }
  
  const typeColors = {
    'Epic': '#533AB7',
    'Enhancement': '#185FA5',
    'Story': '#0F6E56',
    'Bug': '#D32F2F',
    'Task': '#F57C00'
  };
  
  const labels = Object.keys(typeCounts);
  const colors = labels.map(label => typeColors[label] || '#999999');
  
  S.charts[`type-${proj.id}`] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Issues',
        data: Object.values(typeCounts),
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}
