export const incidentSeed = [
  {
    id: "INC-341",
    title: "Checkout confirmation banner overlaps the action tray",
    severity: "sev1",
    status: "open",
    squad: "Storefront",
    surface: "checkout"
  },
  {
    id: "INC-342",
    title: "Session timeout toast keeps focus trapped after re-auth",
    severity: "sev2",
    status: "open",
    squad: "Identity",
    surface: "auth"
  },
  {
    id: "INC-346",
    title: "Catalog compare drawer flashes stale recommendation copy",
    severity: "sev1",
    status: "open",
    squad: "Growth",
    surface: "catalog"
  },
  {
    id: "INC-348",
    title: "Refund receipt card renders an outdated helper caption",
    severity: "sev3",
    status: "resolved",
    squad: "Payments",
    surface: "billing"
  },
  {
    id: "INC-351",
    title: "Search suggestions swallow the final keyboard shortcut hint",
    severity: "sev2",
    status: "open",
    squad: "Discovery",
    surface: "search"
  },
  {
    id: "INC-355",
    title: "Payments retry banner does not collapse after manual refresh",
    severity: "sev2",
    status: "open",
    squad: "Payments",
    surface: "payments"
  }
];

export const releaseSeed = [
  {
    id: "REL-91",
    title: "Checkout rollout",
    state: "blocked",
    blocker: "Blocked by data-contract mismatch"
  },
  {
    id: "REL-92",
    title: "Identity polish sweep",
    state: "monitoring",
    blocker: "Observing post-login focus behaviour"
  },
  {
    id: "REL-93",
    title: "Search relevance tweak",
    state: "live",
    blocker: "Healthy in canary"
  }
];

export const defaultPreferences = {
  executionMode: "guided",
  attachTrace: true,
  autoHeal: false
};

export const scenarioMatrix = [
  {
    label: "Smoke",
    title: "Navigation baseline",
    summary: "Landing shell plus direct route changes across the benchmark workspace."
  },
  {
    label: "Guided",
    title: "Critical incident filter",
    summary: "Prompt-driven navigation that exercises shared incident filtering logic."
  },
  {
    label: "Diagnosis",
    title: "Preference save feedback",
    summary: "UI feedback path that depends on state factories rather than direct view code."
  }
];
