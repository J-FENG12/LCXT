"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { root, releaseFiles } = require("../tools/release-policy.cjs");
const { modelConfigPaths } = require("../platform/model-config-paths.cjs");
const { audit } = require("../tools/brand-audit.cjs");
function main() {
  const files = releaseFiles();
  for (const rel of ["runtime/旅策协同.exe", "dist/index-v4.js", "启动旅策协同.vbs", "tourism/旅策协同-双击体验.html",
    ...["travel-demand-planner", "travel-service-coordinator", "travel-content-lab"].map(name => `runtime/skills/${name}/SKILL.md`)]) {
    if (!files.includes(rel)) throw new Error(`待打包文件缺失：${rel}`);
  }
  const brandReport = audit(files);
  if (brandReport.unexpected.length) throw new Error(`存在未处理的旧品牌残留，停止发布：${brandReport.unexpected.map(x => x.file).join(", ")}`);
  const brandRel = "tourism/validation/brand-audit.json";
  fs.writeFileSync(path.join(root, brandRel), JSON.stringify(brandReport, null, 2));
  if (!files.includes(brandRel)) files.push(brandRel);
  const keys = [];
  let knownKeyScan = false;
  for (const configPath of modelConfigPaths()) {
    if (!fs.existsSync(configPath)) continue;
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    for (const provider of Object.values(config.models?.providers || {})) {
      if (typeof provider.apiKey === "string" && provider.apiKey.length >= 8 && !/\$\{/.test(provider.apiKey)) keys.push(Buffer.from(provider.apiKey));
    }
    knownKeyScan = true;
  }
  let bytes = 0;
  for (const rel of files) {
    const buffer = fs.readFileSync(path.join(root, rel));
    bytes += buffer.length;
    if (keys.some(key => buffer.includes(key))) throw new Error("待打包文件中检出已配置密钥，已阻止打包；未输出内容。");
  }
  const digest = rel => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, rel))).digest("hex");
  const reportRel = "tourism/validation/package-audit.json";
  const report = { date: new Date().toISOString(), product: "旅策协同", version: require("../package.json").version,
    fileCount: files.length, bytes, knownConfiguredKeyScan: knownKeyScan, configuredKeyMatches: 0,
    personalFilesExcluded: true, historicalContentExcluded: true, unexpectedBrandFiles: 0,
    brandExceptions: brandReport.exceptions.map(x => ({ file: x.file, reason: x.exception })),
    scope: "Exact configured key byte scan, brand scan and explicit path exclusions; not a universal DLP guarantee.",
    sourceHashes: Object.fromEntries(["launcher.cjs", "build-native-runtime-host.cjs", "tools/native-runtime-host.cs", "platform/model-config-paths.cjs", "tourism/agent-runner.cjs", "tourism/travel-core.js", "runtime/skills/travel-demand-planner/SKILL.md", "dist/index-v4.js"].map(rel => [rel, digest(rel)])) };
  fs.writeFileSync(path.join(root, reportRel), JSON.stringify(report, null, 2));
  if (!files.includes(reportRel)) files.push(reportRel);
  fs.mkdirSync(path.join(root, "release"), { recursive: true });
  fs.writeFileSync(path.join(root, "release/package-files.txt"), files.sort().join("\n") + "\n");
  console.log(JSON.stringify({ files: files.length, bytes, configuredKeyMatches: 0, knownKeyScan, unexpectedBrandFiles: 0 }));
}
main();
