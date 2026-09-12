"use strict";
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const os = require("node:os");
const required = ["package.json", "tourism/agent-server.cjs", "tourism/build-demo.cjs", "tourism/task-schema.js", "runtime/skills/travel-demand-planner/SKILL.md", "runtime/skills/travel-service-coordinator/SKILL.md", "runtime/skills/travel-content-lab/SKILL.md"];
async function run() {
  const checks = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "Node.js 版本", ok: major >= 18, detail: process.versions.node });
  for (const rel of required) checks.push({ name: `文件 ${rel}`, ok: fs.existsSync(path.join(__dirname, "..", rel)), detail: fs.existsSync(path.join(__dirname, "..", rel)) ? "存在" : "缺失" });
  const probe = path.join(os.tmpdir(), `travel-ai-env-${process.pid}.tmp`);
  try { fs.writeFileSync(probe, "ok"); fs.unlinkSync(probe); checks.push({ name: "临时目录写入", ok: true, detail: "可用" }); } catch { checks.push({ name: "临时目录写入", ok: false, detail: "不可用" }); }
  const port = await new Promise(resolve => { const server = net.createServer(); server.once("error", () => resolve(false)); server.listen(0, "127.0.0.1", () => server.close(() => resolve(true))); });
  checks.push({ name: "本机回环端口", ok: port, detail: port ? "可绑定" : "不可绑定" });
  const result = { product: "旅策协同", version: require("../package.json").version, ready: checks.every(x => x.ok), checks };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) process.exitCode = 1;
  return result;
}
if (require.main === module) run().catch(error => { console.error(JSON.stringify({ ready: false, error: error.message })); process.exitCode = 1; });
module.exports = { run };
