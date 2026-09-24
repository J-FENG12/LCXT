"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const WebSocket = require("../runtime/openclaw/node_modules/ws");
const { TaskRepository } = require("../tourism/task-repository.cjs");
const Demo = require("../tourism/demo-data.js");
const Core = require("../tourism/travel-core.js");
const Schema = require("../tourism/task-schema.js");
const ModulePatch = require("../tourism/module-patch.js");

const proposalId = "desktop-restore-fixture-1";
const fixtureRoot = path.resolve(__dirname, "../.development/validation-temp");
function fixtureHome(value) {
  const home = path.resolve(String(value || ""));
  const relative = path.relative(fixtureRoot, home);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("桌面验收只能使用 V5 隔离测试目录的子目录。");
  return home;
}
function expected() {
  const task = Demo.scenario(), target = { type: "plan-item", planId: "A", itemId: "A3" };
  const proposed = ModulePatch.apply(task, target, [{ op: "replace-plan-item", planId: "A", itemId: "A3", replacementResourceId: "museum" }]);
  return { task, target, proposed, taskHash: Schema.hash(task) };
}
function seed(home) {
  const { task, target, proposed, taskHash } = expected(), repository = new TaskRepository({ home });
  if (repository.load()) throw new Error("隔离目录已有任务存档，拒绝覆盖。");
  repository.save({ task, evaluation: Core.evaluate(task), selectedPlanId: "A", pendingProposal: {
    proposalId, baseRevision: task.revision, baseTaskHash: taskHash, target,
    task: proposed, evaluation: Core.evaluate(proposed), diff: ModulePatch.diff(task, proposed, target),
    reason: "虚构行程跨重启验收", evidenceIds: [], questions: []
  } });
  console.log(JSON.stringify({ seeded: true, isolated: true, taskHash, proposalId }));
}
async function check(port, home) {
  assert.equal(path.resolve(process.env.USERPROFILE || ""), home, "检查进程的用户目录与隔离目录不一致。");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find(item => item.type === "page" && /^https?:\/\/tauri\.localhost\/$/.test(item.url));
  if (!target) throw new Error("未找到 V5 桌面页面。");
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let id = 0;
  socket.on("message", raw => {
    const message = JSON.parse(raw), item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
  });
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(new Error(`${method} 超时`)); }, 70000);
    pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  };
  const click = async point => {
    await call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
  };
  try {
    const { taskHash } = expected();
    let restored = false;
    for (let attempt = 0; attempt < 3 && !restored; attempt++) restored = await evaluate(`(async()=>{const end=Date.now()+45000;while(Date.now()<end){if(globalThis.TravelWorkbench?.metadata?.().taskHash===${JSON.stringify(taskHash)}&&globalThis.TravelWorkbench?.pendingProposal?.()?.proposalId===${JSON.stringify(proposalId)})return true;await new Promise(resolve=>setTimeout(resolve,250));}return false})()`);
    assert.equal(restored, true, "桌面没有从隔离用户目录恢复任务和待确认提案。");
    const findChatButton = `(async()=>{const end=Date.now()+60000;while(Date.now()<end){if(document.querySelector('[data-testid="composer-input-area"]'))return null;const node=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='新建对话');if(node){const box=node.getBoundingClientRect();return{x:box.left+box.width/2,y:box.top+box.height/2}}await new Promise(resolve=>setTimeout(resolve,250));}return null})()`;
    let chatButton = await evaluate(findChatButton);
    if (!chatButton && !(await evaluate(`!!document.querySelector('[data-testid="composer-input-area"]')`))) chatButton = await evaluate(findChatButton);
    if (chatButton) await click(chatButton);
    const mainButton = await evaluate(`(async()=>{const end=Date.now()+5000;while(Date.now()<end){if(document.querySelector('[data-testid="composer-input-area"]'))return null;const dialog=[...document.querySelectorAll('[role=dialog]')].find(node=>node.innerText.includes('新建会话'));const node=[...(dialog?.querySelectorAll('*')||[])].reverse().find(item=>item.textContent.trim()==='main');if(node){const box=node.getBoundingClientRect();return{x:box.left+box.width/2,y:box.top+box.height/2}}await new Promise(resolve=>setTimeout(resolve,100));}return null})()`);
    if (mainButton) await click(mainButton);
    const state = await evaluate(`(async()=>{const end=Date.now()+60000;while(Date.now()<end){const workbench=globalThis.TravelWorkbench,conversation=globalThis.TravelConversation;if(workbench?.metadata?.().taskHash===${JSON.stringify(taskHash)}&&conversation?.state?.().pending?.proposalId===${JSON.stringify(proposalId)}&&document.getElementById('tcv-panel'))return{restored:true,proposalVisible:!document.getElementById('tcv-panel').hidden,persistence:document.getElementById('tv-persistence')?.textContent||'',selectedPlanId:workbench.selectedPlanId?.(),resultBound:workbench.currentResult?.()?.taskHash===${JSON.stringify(taskHash)}};await new Promise(resolve=>setTimeout(resolve,250));}return{restored:false}})()`);
    assert.equal(state.restored, true, JSON.stringify({ chatButton: !!chatButton, mainButton: !!mainButton, state,
      ui: await evaluate(`({composer:!!document.querySelector('[data-testid="composer-input-area"]'),panel:!!document.getElementById('tcv-panel'),proposalId:globalThis.TravelWorkbench?.pendingProposal?.()?.proposalId||null,pendingId:globalThis.TravelConversation?.state?.().pending?.proposalId||null})`) }));
    assert.equal(state.proposalVisible, true);
    assert.match(state.persistence, /已保存/);
    assert.equal(state.selectedPlanId, "A");
    assert.equal(state.resultBound, true);
    const stored = new TaskRepository({ home }).load();
    assert.equal(stored.taskHash, taskHash);
    assert.equal(stored.pendingProposal?.proposalId, proposalId);
    console.log(JSON.stringify({ desktopRestored: true, proposalRestored: true, persistedRecordIntact: true, liveModelCalls: 0 }));
  } finally { socket.close(); }
}

const mode = process.argv[2], home = fixtureHome(process.argv[3]);
if (mode === "seed") seed(home);
else if (mode === "check") check(Number(process.argv[4]), home).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
else throw new Error("用法：node test/desktop-restore-check.cjs seed|check <V5隔离目录> [桌面调试端口]");
