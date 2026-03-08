export function applyIncidentFilter(incidents, filterKey) {
  if (filterKey === "open") {
    return incidents.filter((incident) => incident.status === "open");
  }

  if (filterKey === "critical") {
    return incidents.filter((incident) => incident.severity === "sev1");
  }

  if (filterKey === "payments") {
    return incidents.filter((incident) => incident.surface === "payments");
  }

  return incidents;
}

export function countOpenIncidents(incidents) {
  return incidents.filter((incident) => incident.status === "open").length;
}

export function buildIncidentSummary(incidents, filterKey) {
  if (filterKey === "open") {
    return `${incidents.length} active incidents`;
  }

  if (filterKey === "critical") {
    return `${incidents.length} critical incidents`;
  }

  if (filterKey === "payments") {
    return `${incidents.length} payments incidents`;
  }

  return `${incidents.length} incidents in the current queue`;
}

export function severityChip(severity) {
  if (severity === "sev1") {
    return "SEV1";
  }
  if (severity === "sev2") {
    return "SEV2";
  }
  return "SEV3";
}
