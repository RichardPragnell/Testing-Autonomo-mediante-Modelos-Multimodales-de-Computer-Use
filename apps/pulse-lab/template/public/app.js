import {
  defaultPreferences,
  incidentSeed,
  releaseSeed,
  scenarioMatrix
} from "./modules/data/demo-data.js";
import { applyIncidentFilter, buildIncidentSummary, countOpenIncidents } from "./modules/domain/incidents.js";
import { buildReleaseSummary } from "./modules/domain/releases.js";
import {
  createInitialPreferences,
  formatPreferenceSummary,
  savePreferences
} from "./modules/state/preferences.js";
import {
  renderScenarioMatrix,
  renderToastRegion,
  renderView,
  viewMeta
} from "./modules/ui/render.js";

const state = {
  route: "overview",
  incidentFilter: "all",
  incidents: incidentSeed,
  releases: releaseSeed,
  preferences: createInitialPreferences(defaultPreferences),
  notifications: []
};

const elements = {
  title: document.getElementById("view-title"),
  description: document.getElementById("view-description"),
  primaryPanel: document.getElementById("primary-panel"),
  scenarioMatrix: document.getElementById("scenario-matrix"),
  toastRegion: document.getElementById("toast-region"),
  navButtons: [...document.querySelectorAll("[data-route]")]
};

let notificationTimer;

function readRouteFromLocation() {
  const hashRoute = window.location.hash.replace("#", "").trim();
  return Object.prototype.hasOwnProperty.call(viewMeta, hashRoute) ? hashRoute : "overview";
}

function setRoute(route) {
  state.route = route;
  elements.navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.route === route);
  });
  render();
}

function scheduleNotificationReset() {
  window.clearTimeout(notificationTimer);
  notificationTimer = window.setTimeout(() => {
    state.notifications = [];
    renderToastRegion(elements.toastRegion, state.notifications);
  }, 3200);
}

function readPreferencesFromForm() {
  const form = document.getElementById("preferences-form");
  const formData = new FormData(form);
  return {
    executionMode: String(formData.get("executionMode") ?? "guided"),
    attachTrace: formData.get("attachTrace") === "on",
    autoHeal: formData.get("autoHeal") === "on"
  };
}

function render() {
  const filteredIncidents = applyIncidentFilter(state.incidents, state.incidentFilter);
  const incidentSummary = buildIncidentSummary(filteredIncidents, state.incidentFilter);
  const releaseSummary = buildReleaseSummary(state.releases);

  elements.title.textContent = viewMeta[state.route].title;
  elements.description.textContent = viewMeta[state.route].description;

  renderView(elements.primaryPanel, {
    route: state.route,
    filterKey: state.incidentFilter,
    incidents: filteredIncidents,
    incidentSummary,
    openIncidentCount: countOpenIncidents(state.incidents),
    releases: state.releases,
    releaseSummary,
    preferences: state.preferences,
    preferenceSummary: formatPreferenceSummary(state.preferences)
  });
  renderScenarioMatrix(elements.scenarioMatrix, scenarioMatrix);
  renderToastRegion(elements.toastRegion, state.notifications);
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const routeButton = target.closest("[data-route]");
  if (routeButton instanceof HTMLElement) {
    window.location.hash = routeButton.dataset.route ?? "overview";
    return;
  }

  const filterButton = target.closest("[data-filter]");
  if (filterButton instanceof HTMLElement) {
    state.incidentFilter = filterButton.dataset.filter ?? "all";
    render();
    return;
  }

  const saveButton = target.closest("[data-action='save-preferences']");
  if (saveButton instanceof HTMLElement) {
    const result = savePreferences(readPreferencesFromForm());
    state.preferences = result.nextPreferences;
    state.notifications = [result.notification];
    render();
    scheduleNotificationReset();
  }
});

window.addEventListener("hashchange", () => {
  setRoute(readRouteFromLocation());
});

setRoute(readRouteFromLocation());
