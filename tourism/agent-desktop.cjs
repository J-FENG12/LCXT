"use strict";
const { TravelAgent: BaseTravelAgent } = require("./agent-runner.cjs");
const { TravelToolService } = require("./tool-broker.cjs");

class TravelAgent extends BaseTravelAgent {
  constructor() { super({ enablePersistence: true }); }
}

async function attachAgent(cdp) {
  const agent = new TravelAgent(), tools = new TravelToolService();
  await cdp.call("Runtime.enable");
  await cdp.call("Runtime.addBinding", { name: "__travel_request" });
  await cdp.call("Runtime.addBinding", { name: "__travel_tool_request" });
  const source = `(()=>{
    if(window!==window.top)return;
    const makeBridge=(binding,eventName,timeout,label)=>{
      const pending=new Map();let seq=0;
      window.addEventListener(eventName,e=>{const p=pending.get(e.detail.id);if(!p)return;pending.delete(e.detail.id);clearTimeout(p.timer);e.detail.error?p.reject(new Error(e.detail.error)):p.resolve(e.detail.data);});
      return payload=>new Promise((resolve,reject)=>{const id=String(++seq),timer=setTimeout(()=>{pending.delete(id);reject(new Error(label+'响应超时'));},timeout);pending.set(id,{resolve,reject,timer});window[binding](JSON.stringify({id,payload}));});
    };
    window.TravelAgentRequest=makeBridge('__travel_request','travel-agent-response',210000,'文旅Agent');
    window.TravelToolRequest=makeBridge('__travel_tool_request','travel-tool-response',90000,'基础工具');
  })();`;
  await cdp.call("Page.addScriptToEvaluateOnNewDocument", { source });
  const unsubscribe = cdp.onEvent(async message => {
    if (message.method !== "Runtime.bindingCalled" || !["__travel_request", "__travel_tool_request"].includes(message.params.name)) return;
    const { payload: raw, executionContextId, name } = message.params;
    if (raw.length > 1024 * 1024) return;
    let packet;
    try { packet = JSON.parse(raw); } catch { return; }
    if (typeof packet.id !== "string" || packet.id.length > 50) return;
    const response = { id: packet.id }, eventName = name === "__travel_request" ? "travel-agent-response" : "travel-tool-response";
    try {
      const context = await cdp.call("Runtime.evaluate", { expression: "window===window.top && (location.origin==='http://tauri.localhost' || location.origin==='https://tauri.localhost' || location.protocol==='tauri:')", contextId: executionContextId, returnByValue: true });
      if (context.result?.value !== true) return;
      response.data = name === "__travel_request" ? await agent.run(packet.payload) : await tools.run(packet.payload);
    } catch (error) { response.error = error.message; }
    await cdp.call("Runtime.evaluate", { expression: `window.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)},{detail:${JSON.stringify(response)}}))`, contextId: executionContextId }).catch(() => {});
  });
  return () => { unsubscribe(); agent.close(); tools.close(); };
}

module.exports = { attachAgent };
