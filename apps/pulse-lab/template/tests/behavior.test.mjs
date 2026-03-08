import test from "node:test";
import assert from "node:assert/strict";
import { applyIncidentFilter } from "../public/modules/domain/incidents.js";
import { incidentSeed } from "../public/modules/data/demo-data.js";
import { savePreferences } from "../public/modules/state/preferences.js";

test("critical incident filter returns the sev1 incidents", () => {
  const critical = applyIncidentFilter(incidentSeed, "critical");
  assert.equal(critical.length, 2);
  assert.deepEqual(
    critical.map((incident) => incident.id),
    ["INC-341", "INC-346"]
  );
});

test("saving preferences emits a visible message for the UI toast", () => {
  const result = savePreferences({
    executionMode: "explorer",
    attachTrace: true,
    autoHeal: true
  });

  assert.equal(result.notification.level, "success");
  assert.equal(result.notification.message, "Preferences saved");
});
