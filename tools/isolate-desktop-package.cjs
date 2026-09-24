"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const stage = path.resolve(String(process.argv[2] || ""));
const relative = path.relative(path.join(root, ".development"), stage);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !/^desktop-demo-[^\\/]+$/.test(relative)) {
  throw new Error("Only a V5 desktop-demo staging directory can be transformed.");
}

function replaceFixed(bytes, oldText, newText, expected) {
  const oldBytes = Buffer.from(oldText), newBytes = Buffer.from(newText);
  if (oldBytes.length !== newBytes.length) throw new Error("Desktop profile markers must have equal byte lengths.");
  let count = 0;
  for (let offset = 0; (offset = bytes.indexOf(oldBytes, offset)) !== -1; offset += newBytes.length) {
    newBytes.copy(bytes, offset);
    count++;
  }
  if (count !== expected) throw new Error(`Unexpected desktop profile marker count: ${oldText} (${count}, expected ${expected})`);
  return bytes;
}

const binaryPath = path.join(stage, "runtime", "旅策协同.exe");
const frontendPath = path.join(stage, "dist", "index-v4.js");
const binary = fs.readFileSync(binaryPath);
replaceFixed(binary, ".tr-ai-assist", ".tr-ai-review", 4);
replaceFixed(binary, "tr-ai-assist.json", "tr-ai-review.json", 4);
fs.writeFileSync(binaryPath, binary);

let frontend = fs.readFileSync(frontendPath, "utf8");
for (const [from, to] of [
  ['homeDir:".tr-ai-assist"', 'homeDir:".tr-ai-review"'],
  ['configFileName:"tr-ai-assist.json"', 'configFileName:"tr-ai-review.json"']
]) {
  if (frontend.split(from).length !== 2) throw new Error(`Unexpected frontend profile marker count: ${from}`);
  frontend = frontend.replace(from, to);
}
fs.writeFileSync(frontendPath, frontend);
console.log(JSON.stringify({ reviewProfileIsolated: true, nativeMarkers: 8, frontendMarkers: 2 }));
