"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { root, releaseFiles } = require("./release-policy.cjs");
// Assemble retired identifiers so the scanner source is not itself a false product-brand hit.
const retiredPattern = new RegExp([
  ["cc", "law"].join(""),
  String.fromCharCode(20020, 37319, 26234, 36896),
  ["lin", "cai"].join(""),
  ["lc", "ai"].join("\\."),
  ["lc", "ai"].join("-")
].join("|"), "gi");
const evidenceFiles = new Set(["tourism/validation/brand-audit.json"]);
function matches(text) { return [...text.matchAll(new RegExp(retiredPattern.source, "gi"))]; }
function inspect(rel, bytes) {
  const raw = bytes.toString("utf8"), hits = matches(raw), wide = matches(bytes.toString("utf16le")), nameHits = matches(rel);
  if (!hits.length && !wide.length && !nameHits.length) return null;
  let exception = null;
  if (rel === "runtime/bin/node.exe" && hits.length === 1 && !wide.length && !nameHits.length &&
      crypto.createHash("sha256").update(bytes).digest("hex") === "bae898add4643fcf890a83ad8ae56e20dce7e781cab161a53991ceba70c99ffb") {
    exception = "One accidental substring inside Node's base64-encoded binary payload; verified third-party executable hash, not a brand label.";
  }
  return { file: rel, utf8Matches: hits.length, utf16Matches: wide.length, filenameMatches: nameHits.length,
    matchedTokenValuesRedacted: true, exception };
}
function audit(files = releaseFiles()) {
  const findings = [];
  let bytes = 0;
  for (const rel of files) {
    if (evidenceFiles.has(rel)) continue;
    const buffer = fs.readFileSync(path.join(root, rel));
    bytes += buffer.length;
    const finding = inspect(rel, buffer);
    if (finding) findings.push(finding);
  }
  return {
    checkedAt: new Date().toISOString(), product: "旅策协同 · 文旅智能辅助 Skill 系统",
    version: require("../package.json").version, filesScanned: files.length, bytesScanned: bytes,
    method: "Filename plus UTF-8/UTF-16 text scan of every release file; EXE resource/icon and running-window checks are separate.",
    unexpected: findings.filter(x => !x.exception), exceptions: findings.filter(x => x.exception),
    excluded: [".development: preserved development history and prior releases", "build-input: immutable licensed build inputs", "logs, browser profiles, user configuration, local dependencies, absolute shortcuts"],
    limits: ["Does not claim that compressed embedded native frontend data has been rewritten.", "Workspace directory names are fixed by the project scope; this report scans relative filenames.", "OpenClaw and other third-party names/licenses retain their original authorship."],
    runtimeSHA256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "runtime/旅策协同.exe"))).digest("hex")
  };
}
function main() {
  const report = audit();
  fs.mkdirSync(path.join(root, "tourism/validation"), { recursive: true });
  fs.writeFileSync(path.join(root, "tourism/validation/brand-audit.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ files: report.filesScanned, unexpected: report.unexpected, exceptions: report.exceptions }));
  if (report.unexpected.length) process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { retiredPattern, inspect, audit };
