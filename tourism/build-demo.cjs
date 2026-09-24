"use strict";
const fs = require("node:fs");
const path = require("node:path");
const parts = [
  "skill-display-names.js", "task-schema.js", "module-patch.js", "travel-core.js", "knowledge-core.js", "plan-generator.js", "task-state.js",
  "deliverables.js", "demo-data.js", "request-editor.js", "travel-workbench.js", "agent-panel.js", "contest-ui.js", "travel-journey-view.js", "conversation-flow.js", "model-settings.js", "tool-settings.js", "brand-ui.js"
];
const brand = require("../build-travel-brand.cjs").brand();
const scripts = `globalThis.TravelBrand=${JSON.stringify(brand)};\n` + parts.map(name => fs.readFileSync(path.join(__dirname, name), "utf8")).join("\n");
const skillScripts = path.join(__dirname, "..", "runtime", "skills", "travel-demand-planner", "scripts");
fs.mkdirSync(skillScripts, { recursive: true });
for (const source of ["task-schema.js", "travel-core.js", "knowledge-core.js", "plan-generator.js", "deliverables.js", "demo-data.js", "travel-cli.cjs"]) fs.copyFileSync(path.join(__dirname, source), path.join(skillScripts, source));
const html = `<!doctype html>\n<html lang="zh-CN" data-travel="standalone"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>旅策协同 · 文旅智能辅助 ${brand.version}</title></head><body><script>${scripts.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
fs.writeFileSync(path.join(__dirname, "旅策协同-双击体验.html"), html);
const core = require("./travel-core.js"), demo = require("./demo-data.js"), examples = path.join(__dirname, "examples");
fs.mkdirSync(examples, { recursive: true });
const payload = demo.scenario();
fs.writeFileSync(path.join(examples, "two-day-family.json"), JSON.stringify(payload, null, 2));
fs.writeFileSync(path.join(examples, "two-day-family-report.md"), core.report(core.evaluate(payload)));
payload.request.weather = "rain";
payload.request.avoidOutdoorInRain = true;
fs.writeFileSync(path.join(examples, "two-day-family-rain-report.md"), core.report(core.evaluate(payload)));
console.log("Built offline tourism workbench, skill scripts and reproducible reports.");
