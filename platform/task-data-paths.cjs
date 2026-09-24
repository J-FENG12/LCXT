"use strict";
const path = require("node:path"), os = require("node:os");

function taskDataPaths(home = os.homedir()) {
  const root = process.env.TRAVEL_SUBMISSION_MODE === "1"
    ? path.join(home, ".tr-ai-review", "tasks")
    : path.join(home, ".tr-ai-assist", "tasks");
  return {
    root,
    current: path.join(root, "current-task.json")
  };
}

module.exports = { taskDataPaths };
