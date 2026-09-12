"use strict";
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
function excluded(rel) {
  if (/^(?:\.development|release|logs|node_modules|build-input)\//.test(rel)) return true;
  if (rel === "runtime/bin/openclaw.cmd") return true;
  if (/(^|\/)(?:browser-profile-[^/]*|portable-check[^/]*|\.git|__pycache__)(\/|$)/.test(rel)) return true;
  if (/(^|\/)(?:\.env(?:\..*)?|auth-profiles\.json|auth\.json|[^/]*assist\.json|[^/]*\.log)$/.test(rel)) return true;
  return /\.lnk$/i.test(rel);
}
function releaseFiles(base = root) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name), rel = path.relative(base, abs).replaceAll("\\", "/");
      if (excluded(rel + (entry.isDirectory() ? "/" : ""))) continue;
      if (entry.isSymbolicLink()) throw new Error("Release contains a filesystem link; resolve its intended contents first.");
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) files.push(rel);
    }
  }
  walk(base);
  return files.sort();
}
module.exports = { root, excluded, releaseFiles };
