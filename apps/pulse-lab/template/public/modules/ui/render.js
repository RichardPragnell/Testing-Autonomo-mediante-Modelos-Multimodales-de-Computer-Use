import { severityChip } from "../domain/incidents.js";

export const viewMeta = {
  overview: {
    title: "Overview",
    description: "Single-page benchmark shell for local Stagehand runs, failure diagnosis, and later self-heal loops."
  },
  incidents: {
    title: "Incidents",
    description: "State-rich board with filters and routed interactions intended for navigation and failure localization."
  },
  releases: {
    title: "Releases",
    description: "Reference workflow with mixed deployment states so prompt-guided runs can validate route changes and blockers."
  },
  settings: {
    title: "Settings",
    description: "Preference flow used to test UI feedback, toast delivery, and future repair validation."
  }
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function renderOverview(container, data) {
  container.innerHTML = `
    <div class="stat-grid">
      <article class="stat-card">
        <p class="eyebrow">Open Incidents</p>
        <p class="stat-value">${data.openIncidentCount}</p>
        <p class="muted">Current queue still needs regression coverage.</p>
      </article>
      <article class="stat-card">
        <p class="eyebrow">Release Trains</p>
        <p class="stat-value">${data.releaseSummary.total}</p>
        <p class="muted">Blocked, monitoring, and live states remain visible.</p>
      </article>
      <article class="stat-card">
        <p class="eyebrow">Prompt Mode</p>
        <p class="stat-value">${escapeHtml(data.preferences.executionMode)}</p>
        <p class="muted">Current agent posture for benchmark exercises.</p>
      </article>
    </div>

    <article class="settings-card">
      <p class="eyebrow">Experiment Notes</p>
      <h3>Local benchmark AUT</h3>
      <p class="muted">
        This app is intentionally compact, but the behaviour under test is spread across route rendering,
        state factories, and shared domain helpers.
      </p>
    </article>
  `;
}

function renderIncidents(container, data) {
  container.innerHTML = `
    <p class="eyebrow">Ops Surface</p>
    <h3>Incident board</h3>
    <p class="incident-summary">${escapeHtml(data.incidentSummary)}</p>

    <div class="filters">
      <button type="button" class="filter-button ${
        data.filterKey === "all" ? "is-active" : ""
      }" data-filter="all">All incidents</button>
      <button type="button" class="filter-button ${
        data.filterKey === "open" ? "is-active" : ""
      }" data-filter="open">Open only</button>
      <button type="button" class="filter-button ${
        data.filterKey === "critical" ? "is-active" : ""
      }" data-filter="critical">Critical only</button>
      <button type="button" class="filter-button ${
        data.filterKey === "payments" ? "is-active" : ""
      }" data-filter="payments">Payments</button>
    </div>

    <div class="incident-list">
      ${data.incidents
        .map(
          (incident) => `
            <article class="incident-card">
              <header>
                <div>
                  <p class="eyebrow">${escapeHtml(incident.id)}</p>
                  <h4>${escapeHtml(incident.title)}</h4>
                </div>
                <span class="chip chip-${escapeHtml(incident.severity)}">${escapeHtml(
              severityChip(incident.severity)
            )}</span>
              </header>
              <div class="meta-row">
                <span>${escapeHtml(incident.squad)}</span>
                <span>${escapeHtml(incident.surface)}</span>
                <span>${escapeHtml(incident.status)}</span>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderReleases(container, data) {
  container.innerHTML = `
    <p class="eyebrow">Delivery Surface</p>
    <h3>Release checklist</h3>

    <div class="release-grid">
      <article class="release-card">
        <header>
          <h4>Blocked train</h4>
          <span class="chip chip-blocked">${data.releaseSummary.blocked}</span>
        </header>
        <p class="muted">Deployments waiting for a fix before promotion.</p>
      </article>
      <article class="release-card">
        <header>
          <h4>Monitoring</h4>
          <span class="chip chip-monitoring">${data.releaseSummary.monitoring}</span>
        </header>
        <p class="muted">Canary traffic is active and still under observation.</p>
      </article>
      <article class="release-card">
        <header>
          <h4>Live</h4>
          <span class="chip chip-live">${data.releaseSummary.live}</span>
        </header>
        <p class="muted">Ready for baseline verification after benchmark runs.</p>
      </article>
      ${data.releases
        .map(
          (release) => `
            <article class="release-card">
              <header>
                <div>
                  <p class="eyebrow">${escapeHtml(release.id)}</p>
                  <h4>${escapeHtml(release.title)}</h4>
                </div>
                <span class="chip chip-${escapeHtml(release.state)}">${escapeHtml(release.state)}</span>
              </header>
              <p>${escapeHtml(release.blocker)}</p>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSettings(container, data) {
  const guidedSelected = data.preferences.executionMode === "guided" ? "selected" : "";
  const explorerSelected = data.preferences.executionMode === "explorer" ? "selected" : "";
  const repairSelected = data.preferences.executionMode === "repair" ? "selected" : "";

  container.innerHTML = `
    <p class="eyebrow">Execution Controls</p>
    <h3>Model routing preferences</h3>
    <p class="settings-summary">${escapeHtml(data.preferenceSummary)}</p>

    <article class="settings-card">
      <form id="preferences-form" class="settings-form">
        <label class="settings-field">
          <span>Execution mode</span>
          <select name="executionMode">
            <option value="guided" ${guidedSelected}>Guided</option>
            <option value="explorer" ${explorerSelected}>Explorer</option>
            <option value="repair" ${repairSelected}>Repair</option>
          </select>
        </label>

        <label class="checkbox-row">
          <input type="checkbox" name="attachTrace" ${data.preferences.attachTrace ? "checked" : ""} />
          <span>Attach DOM and trace evidence to findings</span>
        </label>

        <label class="checkbox-row">
          <input type="checkbox" name="autoHeal" ${data.preferences.autoHeal ? "checked" : ""} />
          <span>Prepare automatic repair patch when a finding is reproducible</span>
        </label>

        <button type="button" class="action-button" data-action="save-preferences">Save preferences</button>
      </form>
    </article>
  `;
}

export function renderView(container, data) {
  if (data.route === "incidents") {
    renderIncidents(container, data);
    return;
  }

  if (data.route === "releases") {
    renderReleases(container, data);
    return;
  }

  if (data.route === "settings") {
    renderSettings(container, data);
    return;
  }

  renderOverview(container, data);
}

export function renderScenarioMatrix(container, scenarios) {
  container.innerHTML = scenarios
    .map(
      (scenario) => `
        <article class="matrix-card">
          <header>
            <span class="eyebrow">${escapeHtml(scenario.label)}</span>
          </header>
          <h4>${escapeHtml(scenario.title)}</h4>
          <p class="muted">${escapeHtml(scenario.summary)}</p>
        </article>
      `
    )
    .join("");
}

export function renderToastRegion(container, notifications) {
  const visibleNotifications = notifications.filter(
    (item) => typeof item.message === "string" && item.message.trim().length > 0
  );

  container.innerHTML = visibleNotifications
    .map(
      (item) => `
        <article class="toast">
          <strong>${escapeHtml(item.level ?? "info")}</strong>
          <p>${escapeHtml(item.message)}</p>
        </article>
      `
    )
    .join("");
}
