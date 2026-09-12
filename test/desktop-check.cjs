"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const WebSocket = require("../runtime/openclaw/node_modules/ws");
const { retiredPattern } = require("../tools/brand-audit.cjs");
async function main() {
  const port = Number(process.argv[2]);
  if (!port) throw new Error("Provide the observed local desktop debug port.");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find(t => t.type === "page" && /^https?:\/\/tauri\.localhost\/$/.test(t.url));
  if (!target) throw new Error("Local desktop page not found.");
  const ws = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let id = 0;
  ws.on("message", raw => {
    const message = JSON.parse(raw), task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  });
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(new Error(`${method} timeout`)); }, 25000);
    pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  };
  try {
    const report = { date: new Date().toISOString(), version: require("../package.json").version, liveModelCalls: 0 };
    report.page = await evaluate(`({title:document.title,workbench:!!document.getElementById('tv-root'),agentBridge:typeof window.TravelAgentRequest,agentPanel:!!document.getElementById('ta-panel'),faviconBranded:document.querySelector('link[rel="icon"]')?.href===globalThis.TravelBrand?.symbol})`);
    assert.equal(report.page.title, "旅策协同 · 文旅智能辅助");
    assert.equal(report.page.workbench, true); assert.equal(report.page.agentBridge, "function");
    assert.equal(report.page.agentPanel, true); assert.equal(report.page.faviconBranded, true);
    report.gateway = await evaluate("(async()=>{const end=Date.now()+60000;let state;do{state=await window.__TAURI_INTERNALS__.invoke('sidecar_gateway_info');if(state.ready||state.exited)return {ready:!!state.ready,exited:!!state.exited,status:state.status||null,error:state.error||null,port:state.port||null};await new Promise(r=>setTimeout(r,250));}while(Date.now()<end);return {ready:false,exited:!!state?.exited,status:state?.status||null,error:state.error||null,port:state?.port||null};})()");
    assert.equal(report.gateway.ready, true, `OpenClaw gateway readiness: ${JSON.stringify(report.gateway)}`);
    report.modelConfigPathMatches = await evaluate("window.__TAURI_INTERNALS__.invoke('config_detect_local_path').then(p=>typeof p==='string'&&/[\\\\/]\\.tr-ai-assist[\\\\/]tr-ai-assist\\.json$/.test(p))");
    assert.equal(report.modelConfigPathMatches, true, "Native and Agent config paths must agree");
    await evaluate("document.getElementById('travel-diagnostics-button').click()");
    await evaluate("new Promise(resolve=>setTimeout(resolve,700))");
    report.diagnostics = await evaluate(`(()=>{const button=document.getElementById('travel-diagnostics-button'),modal=document.getElementById('travel-diagnostics-modal'),text=modal?.innerText||'';const legacyVisible=[...document.querySelectorAll('button')].filter(item=>item.id!=='travel-diagnostics-button'&&item.textContent.includes('诊断')&&getComputedStyle(item).display!=='none').length;return {buttonText:button?.textContent,visible:modal&&!modal.hidden&&getComputedStyle(modal).display!=='none',title:modal?.querySelector('h2')?.textContent,text,legacyVisible};})()`);
    assert.equal(report.diagnostics.buttonText, "✓ 本机检查");assert.equal(report.diagnostics.visible, true);
    assert.equal(report.diagnostics.title, "旅策协同 本机检查");assert.match(report.diagnostics.text, /本机网关：/);
    assert.doesNotMatch(report.diagnostics.text, /Sign in is required|Doctor/i);assert.equal(report.diagnostics.legacyVisible, 0);
    await evaluate("document.querySelector('#travel-diagnostics-modal [data-close]').click()");
    report.sidebarLocalCheck = await evaluate(`(async()=>{const button=document.querySelector('button[aria-label="本机检查"]');button?.click();await new Promise(resolve=>setTimeout(resolve,500));const modal=document.getElementById('travel-diagnostics-modal');return {buttonFound:!!button,visible:!!modal&&!modal.hidden&&getComputedStyle(modal).display!=='none',title:modal?.querySelector('h2')?.textContent,text:modal?.innerText||''};})()`);
    assert.equal(report.sidebarLocalCheck.buttonFound,true);assert.equal(report.sidebarLocalCheck.visible,true);
    assert.equal(report.sidebarLocalCheck.title,"旅策协同 本机检查");assert.doesNotMatch(report.sidebarLocalCheck.text,/Sign in is required|Doctor/i);
    await evaluate("document.querySelector('#travel-diagnostics-modal [data-close]').click()");
    report.skillMarketPolicy = await evaluate(`(()=>{const retired=String.fromCharCode(30021,25463,36890),policy=globalThis.TravelSkillMarketPolicy,host=document.createElement('div');host.innerHTML='<div data-testid="market-skill-card-retired"><span>'+retired+'-TC</span></div><div data-testid="market-skill-card-kept"><span>independent</span></div>';const removed=policy?.filterSkillMarketCards(host);return {available:!!policy,retiredBlocked:policy?.isRetiredDeveloper({author:retired+'-TC'}),independentBlocked:policy?.isRetiredDeveloper({author:'independent'}),removed,slugs:[...host.children].map(item=>item.dataset.testid)};})()`);
    assert.equal(report.skillMarketPolicy.available,true);assert.equal(report.skillMarketPolicy.retiredBlocked,true);
    assert.equal(report.skillMarketPolicy.independentBlocked,false);assert.equal(report.skillMarketPolicy.removed,1);
    assert.deepEqual(report.skillMarketPolicy.slugs,["market-skill-card-kept"]);
    report.skillMarketCategories = await evaluate(`(()=>{const retired=String.fromCharCode(30021,25463,36890),policy=globalThis.TravelSkillMarketPolicy,host=document.createElement('div'),hidden=['智能供应链','智能制造',retired+'服务','电商采集','私域运营'],kept=['效率工具','数据分析','市场研究','基本技能'];host.innerHTML=[...hidden,...kept].map(text=>'<button>'+text+'</button>').join('');const removed=policy?.filterSkillMarketCategories(host);return {removed,remaining:[...host.querySelectorAll('button')].map(item=>item.textContent)};})()`);
    assert.equal(report.skillMarketCategories.removed,5);
    assert.deepEqual(report.skillMarketCategories.remaining,["效率工具","数据分析","市场研究","基本技能"]);
    report.skillMarketView = await evaluate(`(async()=>{const find=text=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===text),click=text=>find(text)?.click(),waitFor=async(text,timeout=10000)=>{const end=Date.now()+timeout;while(Date.now()<end&&!find(text))await new Promise(resolve=>setTimeout(resolve,250));return find(text)};click('技能');await waitFor('技能市场');click('技能市场');await waitFor('效率工具');const retired=String.fromCharCode(30021,25463,36890),buttons=[...document.querySelectorAll('button')].map(item=>item.textContent.trim()),cards=[...document.querySelectorAll('[data-testid^="market-skill-card-"]')],hidden=['智能供应链','智能制造',retired+'服务','电商采集','私域运营'],kept=['效率工具','数据分析','市场研究','基本技能'];return {hiddenVisible:hidden.filter(text=>buttons.includes(text)),keptVisible:kept.filter(text=>buttons.includes(text)),retiredCards:cards.filter(card=>[...card.querySelectorAll('span')].some(node=>node.textContent.trim().startsWith(retired))).length,independentCards:cards.filter(card=>![...card.querySelectorAll('span')].some(node=>node.textContent.trim().startsWith(retired))).length};})()`);
    assert.deepEqual(report.skillMarketView.hiddenVisible,[]);
    assert.deepEqual(report.skillMarketView.keptVisible,["效率工具","数据分析","市场研究","基本技能"]);
    assert.equal(report.skillMarketView.retiredCards,0);assert.ok(report.skillMarketView.independentCards>0);
    await evaluate("document.getElementById('travel-model-button').click()");
    await evaluate("new Promise(resolve=>setTimeout(resolve,300))");
    report.modelSettings = await evaluate("({visible:getComputedStyle(document.getElementById('travel-model-modal')).display!=='none',title:document.querySelector('#travel-model-modal h2')?.textContent,passwordType:document.getElementById('travel-api-key')?.type,credentialValueEmpty:document.getElementById('travel-api-key')?.value===''})");
    assert.equal(report.modelSettings.visible, true); assert.equal(report.modelSettings.passwordType, "password");
    assert.equal(report.modelSettings.credentialValueEmpty, true); assert.match(report.modelSettings.title, /旅策协同/);
    await evaluate("document.querySelector('#travel-model-modal .travel-close').click();document.getElementById('tv-launch').click()");
    report.workbenchVisible = await evaluate("!document.getElementById('tv-root').hidden");
    report.retiredTextCount = await evaluate(`(document.body.innerText.match(new RegExp(${JSON.stringify(retiredPattern.source)},'gi'))||[]).length`);
    assert.equal(report.workbenchVisible, true); assert.equal(report.retiredTextCount, 0);
    await evaluate("new Promise(resolve=>setTimeout(resolve,250))");
    const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(__dirname, "../tourism/validation/文旅工作台-桌面验证.png"), Buffer.from(shot.data, "base64"));
    fs.writeFileSync(path.join(__dirname, "../tourism/validation/desktop-results.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { ws.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
