export function createInitialPreferences(defaults) {
  return {
    executionMode: defaults.executionMode,
    attachTrace: defaults.attachTrace,
    autoHeal: defaults.autoHeal
  };
}

export function formatPreferenceSummary(preferences) {
  return `Mode: ${preferences.executionMode} | Trace attachments: ${
    preferences.attachTrace ? "on" : "off"
  } | Auto-heal ready: ${preferences.autoHeal ? "on" : "off"}`;
}

export function savePreferences(nextPreferences) {
  return {
    nextPreferences,
    notification: {
      level: "success",
      message: "Preferences saved"
    }
  };
}
