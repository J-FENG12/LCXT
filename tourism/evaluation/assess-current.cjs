"use strict";

// Reproducible local probes using fictional fixtures. No model or network calls.
const fs = require("node:fs");
const path = require("node:path");
const core = require("../travel-core.js");
const demo = require("../demo-data.js");

const codes = row => row.issues.map(issue => issue.code);
const allergyConflict = demo.scenario();
allergyConflict.resources.find(resource => resource.id === "localmeal").allergenFree.花生 = "no";

const allergyUnknown = demo.scenario();
delete allergyUnknown.resources.find(resource => resource.id === "localmeal").allergenFree.花生;

const threeDays = demo.scenario();
threeDays.request.days = 3;
threeDays.request.dayWindows.push({ day: 3, start: "09:00", end: "17:00", minActivities: 1, requiredMeals: [] });
threeDays.request.requiredNights = [1, 2];
threeDays.request.selfArrangedNights = [];
for (const plan of threeDays.plans) {
  if (plan.stays[0]) plan.stays[0].checkoutDay = 3;
}

const conflictRow = core.evaluate(allergyConflict).rows[0];
const unknownRow = core.evaluate(allergyUnknown).rows[0];
const coverageRows = core.evaluate(threeDays).rows;
const report = {
  checkedAt: new Date().toISOString(),
  version: require("../../package.json").version,
  source: "Only the contest description provided by the user; no complete official scoring rubric supplied.",
  liveModelCalls: 0,
  demoData: true,
  findings: [
    {
      id: "TOUR-01",
      severity: "resolved-and-tested",
      finding: "Structured allergen requirements distinguish a known conflict from missing evidence.",
      evidence: {
        knownConflictStatus: conflictRow.status,
        knownConflictCode: codes(conflictRow).includes("ALLERGEN_CONFLICT"),
        missingEvidenceStatus: unknownRow.status,
        missingEvidenceCode: codes(unknownRow).includes("ALLERGEN_UNKNOWN")
      },
      implication: "Missing allergen data is pending and is never treated as a safety guarantee."
    },
    {
      id: "TOUR-02",
      severity: "resolved-and-tested",
      finding: "Extending a two-day task to three days exposes the uncovered third day.",
      evidence: {
        eligiblePlans: coverageRows.filter(row => row.status === "eligible").map(row => row.id),
        plansWithDayThreeGap: coverageRows.filter(row => row.issues.some(issue => issue.code === "DAY_ACTIVITY_GAP" && issue.day === 3)).map(row => row.id)
      },
      implication: "A shorter itinerary cannot pass a longer daily-coverage requirement."
    },
    {
      id: "TOUR-03",
      severity: "evidence-gap",
      finding: "Service, marketing and product flows are covered by deterministic and simulated-transport tests, but no live travel-domain model evaluation was authorized.",
      implication: "Do not claim verified model answer accuracy, content quality or conversion improvement."
    },
    {
      id: "TOUR-04",
      severity: "implemented-with-boundary",
      finding: "Planning now supports deterministic bounded candidate generation over the local resource graph.",
      evidence: { bounded: true, defaultMaxCandidates: 12, defaultMaxVisited: 5000 },
      implication: "Truncated searches explicitly avoid claims of global optimality or proof of no solution."
    }
  ]
};

fs.mkdirSync(path.join(__dirname, "../validation"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "../validation/requirements-probes.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
