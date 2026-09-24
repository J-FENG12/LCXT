"use strict";
if (process.argv.includes("--submission")) process.env.TRAVEL_SUBMISSION_MODE = "1";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { TravelAgent } = require("./agent-runner.cjs");
const ModelConfig = require("./model-config.cjs");
const { TravelToolService } = require("./tool-broker.cjs");

async function startServer(options = {}) {
  const agent = options.agent || new TravelAgent({ home: options.home, enablePersistence: true });
  const tools = options.tools || new TravelToolService({ home: options.home });
  const token = crypto.randomBytes(32).toString("hex");
  const home = options.home;
  let origin;
  const localCall = `async function(endpoint,payload){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Travel-Token':${JSON.stringify(token)}},body:JSON.stringify(payload||{})});const data=await r.json();if(!r.ok)throw new Error(data.error||'本机服务请求失败');return data;}`;
  const bridge = `const TravelLocalCall=${localCall};globalThis.TravelAgentRequest=p=>TravelLocalCall('/api/agent',p);globalThis.TravelModelRequest=p=>TravelLocalCall('/api/model',p);globalThis.TravelToolRequest=p=>TravelLocalCall('/api/tools',p);globalThis.TravelAgentShutdown=async function(){await TravelLocalCall('/api/shutdown',{});document.body.textContent='旅策协同已退出，可以关闭此标签页。';};`;
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const send = (code, data) => { res.writeHead(code, { "Content-Type": "application/json;charset=utf-8" }); res.end(JSON.stringify(data)); };
    if (!origin || req.headers.host !== new URL(origin).host) return send(403, { error: "主机不允许" });
    if (req.method === "GET" && req.url === "/") {
      const html = fs.readFileSync(path.join(__dirname, "旅策协同-双击体验.html"), "utf8").replace("connect-src 'none'", "connect-src 'self'").replace("<script>", `<script>${bridge}\n`);
      res.writeHead(200, { "Content-Type": "text/html;charset=utf-8", "Content-Security-Policy": "frame-ancestors 'none'" });
      return res.end(html);
    }
    if (req.method !== "POST" || !["/api/agent", "/api/model", "/api/tools", "/api/shutdown"].includes(req.url)) return send(404, { error: "不存在的接口" });
    if (req.headers["x-travel-token"] !== token || (req.headers.origin && req.headers.origin !== origin) || (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(req.headers["sec-fetch-site"]))) return send(403, { error: "请求来源不允许" });
    if (req.url === "/api/shutdown") { send(200, { closed: true }); return setImmediate(() => close()); }
    req.setEncoding("utf8");
    let raw = "";
    try {
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error("请求过大"); }
      let request;
      try { request = JSON.parse(raw); } catch { throw new Error("请求不是有效 JSON"); }
      if (req.url === "/api/model") {
        if (request.action === "status") return send(200, ModelConfig.status(home));
        if (request.action === "save") return send(200, ModelConfig.save(request, home));
        return send(400, { error: "不支持的模型配置操作" });
      }
      if (req.url === "/api/tools") return send(200, await tools.run(request));
      return send(200, await agent.run(request));
    } catch (error) { return send(400, { error: error.message }); }
  });
  const close = async () => { agent.close(); tools.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(options.port || 0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close, agent, tools, server };
}

if (require.main === module) startServer().then(app => {
  console.log(`旅策协同文旅 Agent 已启动：${app.origin}`);
  console.log("在页面右上角点击“退出文旅 Agent”可停止本机服务。");
  if (!process.argv.includes("--no-browser")) spawn("rundll32.exe", ["url.dll,FileProtocolHandler", app.origin], { windowsHide: true, stdio: "ignore" }).unref();
  process.once("SIGINT", () => app.close());
  process.once("SIGTERM", () => app.close());
}).catch(() => { console.error("文旅 Agent 启动失败，请检查文件与本机端口。"); process.exitCode = 1; });

module.exports = { startServer };
