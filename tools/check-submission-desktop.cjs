"use strict";
const fs = require("node:fs");
const path = require("node:path");
const WebSocket = require("../runtime/openclaw/node_modules/ws");

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Provide the local debugging port.");
const root = path.resolve(__dirname, "..");
let socket, sequence = 0;
const pending = new Map();
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find(item => item.type === "page" && /^https?:\/\/tauri\.localhost\/?/.test(item.url));
  if (!target) throw new Error("Desktop page unavailable.");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.on("message", raw => {
    const packet = JSON.parse(raw);
    const item = pending.get(packet.id);
    if (!item) return;
    pending.delete(packet.id);
    packet.error ? item.reject(new Error(packet.error.message)) : item.resolve(packet.result);
  });
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const expression = `(async()=>{
    const nativePath = await window.__TAURI_INTERNALS__.invoke("config_detect_local_path");
    const agent = await window.TravelAgentRequest({action:"status"});
    return {
      nativeReviewPath: typeof nativePath==="string" && nativePath.includes(".tr-ai-review"),
      nativePersonalPath: typeof nativePath==="string" && nativePath.includes(".tr-ai-assist"),
      agentModelAvailable: agent.available===true,
      agentInterfaceVisible: document.body.innerText.includes("旅策协同")
    };
  })()`;
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  const state = result.result?.value;
  if (!state) throw new Error("Desktop state unavailable.");
  console.log(JSON.stringify(state));
  if (process.argv.includes("--probe")) {
    const probe = await call("Runtime.evaluate", { expression: 'document.body.innerText.slice(0,500)', returnByValue: true });
    console.log(JSON.stringify({pageText:probe.result?.value||""}));
    return;
  }
  if (state.nativeReviewPath && !state.agentModelAvailable) {
    await call("Runtime.evaluate", { expression: 'document.querySelector("#travel-model-modal .travel-close")?.click(); [...document.querySelectorAll("h1")].find(e=>e.textContent.includes("连接你的 IM 平台"))?.parentElement?.parentElement?.querySelector("button")?.click()' });
    await call("Runtime.evaluate", { expression: '([...[...document.querySelectorAll("button,a")].filter(e=>e.textContent.trim()==="主对话"), ...[...document.querySelectorAll("button,a")].filter(e=>e.textContent.trim()==="新建对话")][0])?.click()' });
    await new Promise(resolve => setTimeout(resolve, 1200));
    const image = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const folder = path.join(root, ".development", "validation");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "submission-agent-empty.png"), Buffer.from(image.data, "base64"));
    await call("Runtime.evaluate", { expression: '[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="技能")?.click()' });
    await new Promise(resolve => setTimeout(resolve, 800));
    const skillPage = await call("Runtime.evaluate", { expression: '({skills:["文旅需求规划","文旅服务协同","文旅内容创意"].map(name=>document.body.innerText.includes(name)),pageText:document.body.innerText.slice(0,300)})', returnByValue: true });
    console.log(JSON.stringify({skillNamesVisible:skillPage.result?.value?.skills||[]}));
    if (skillPage.result?.value?.skills?.some(value => !value)) throw new Error("One or more Chinese Skill names are not visible.");
    const skillImage = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(folder, "submission-skills.png"), Buffer.from(skillImage.data, "base64"));
  }
  if (!state.nativeReviewPath || state.nativePersonalPath || state.agentModelAvailable) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => socket?.close());
