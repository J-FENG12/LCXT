"use strict";
const path = require("node:path"), os = require("node:os");

function toolDataPaths(home = os.homedir()) {
  const root = process.env.TRAVEL_SUBMISSION_MODE === "1"
    ? path.join(home, ".tr-ai-review", "tools")
    : path.join(home, ".tr-ai-assist", "tools");
  return {
    root,
    config: path.join(root, "tool-config.json"),
    audit: path.join(root, "tool-audit.jsonl"),
    usage: path.join(root, "tool-usage.json"),
    observations: path.join(root, "observations.json")
  };
}

module.exports = { toolDataPaths };
