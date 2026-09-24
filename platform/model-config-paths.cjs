"use strict";
const path = require("node:path"), os = require("node:os");

// The current path is written; the prior Travel.AI path is read-only migration fallback.
function modelConfigPaths(home = os.homedir()) {
  if (process.env.TRAVEL_SUBMISSION_MODE === "1") {
    return [path.join(home, ".tr-ai-review", "tr-ai-review.json")];
  }
  return [
    path.join(home, ".tr-ai-assist", "tr-ai-assist.json"),
    path.join(home, ".travel-ai-assist", "travel-ai-assist.json")
  ];
}
module.exports = { modelConfigPaths };
