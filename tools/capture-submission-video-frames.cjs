"use strict";
const fs=require("node:fs"),path=require("node:path"),WebSocket=require("../runtime/openclaw/node_modules/ws");
const port=Number(process.argv[2]),root=path.resolve(__dirname,".."),out=path.join(root,".development","video-build","frames");
if(!port)throw new Error("Provide the V5 desktop debugging port.");
fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let socket,id=0;const pending=new Map();
const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
const run=async expression=>{const result=await call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value;};
async function shot(name){await sleep(350);const image=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,`${name}.png`),Buffer.from(image.data,"base64"));}
async function waitFor(expression,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){if(await run(expression))return;await sleep(150);}throw new Error(`Timed out: ${expression}`);}
async function main(){
 const targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json(),target=targets.find(item=>item.type==="page"&&/^https?:\/\/tauri\.localhost\/?/.test(item.url));
 if(!target)throw new Error("V5 desktop page not found.");
 socket=new WebSocket(target.webSocketDebuggerUrl);socket.on("message",raw=>{const message=JSON.parse(raw),item=pending.get(message.id);if(!item)return;pending.delete(message.id);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);});
 await new Promise((resolve,reject)=>{socket.once("open",resolve);socket.once("error",reject);});await call("Page.enable");await call("Runtime.enable");await call("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await waitFor('!!document.getElementById("tv-launch")&&!!document.getElementById("tj-root")',30000);
 await run('document.getElementById("tv-launch").click();document.documentElement.style.background="#f3f8f7";document.getElementById("tv-root").style.scrollBehavior="auto";document.getElementById("tv-root").scrollTo(0,0)');
 await shot("01-blank-workbench");
 await run('window.confirm=()=>true;TravelWorkbench.loadDemo();TravelWorkbench.analyze();document.getElementById("tv-root").scrollTo(0,0)');
 await waitFor('document.querySelectorAll(".tj-plan-card").length===3');await shot("02-demo-overview");
 await run('document.querySelector(".tj-grid").scrollIntoView({block:"start"})');await shot("03-itinerary-route");
 await run('document.querySelector(".tj-tab[data-tab=consult]").click();document.getElementById("tv-query-resource").value="localmeal";document.getElementById("tv-question").value="亲子融合餐厅是否支持花生排除与交叉接触控制？";document.getElementById("tv-consult").click();document.querySelector(".tj-pane[data-pane=consult]").scrollIntoView({block:"start"})');
 await waitFor('document.querySelectorAll(".tv-fact-card").length>0');await shot("04-evidence-consultation");
 await run('document.querySelector(".tj-tab[data-tab=service]").click();document.getElementById("ta-evaluate").click();document.querySelector(".tj-pane[data-pane=service]").scrollIntoView({block:"start"})');
 await waitFor('document.getElementById("ta-status").textContent.includes("完成本地评估")');
 await run('document.getElementById("ta-ack").checked=true;document.getElementById("ta-confirm").click()');
 await waitFor('document.getElementById("ta-status").textContent.includes("建立服务端确认")');
 await run('document.getElementById("ta-service").click()');
 await waitFor('document.getElementById("ta-status").textContent.includes("草稿已生成")');await shot("05-service-deliverable");
 await run('document.getElementById("ta-preview-button").click();document.getElementById("ta-marketing").click()');
 await waitFor('document.getElementById("ta-status").textContent.includes("营销草稿已生成")');
 await run('document.getElementById("ta-preview-box").open=true;document.getElementById("ta-preview-box").scrollIntoView({block:"start"})');await shot("06-public-projection-marketing");
 await run('document.querySelector(".tj-tab[data-tab=resources]").click();document.querySelector(".tj-pane[data-pane=resources]").scrollIntoView({block:"start"})');await shot("07-resource-management");
 await run('document.getElementById("travel-diagnostics-button").click()');await waitFor('getComputedStyle(document.getElementById("travel-diagnostics-modal")).display!=="none"');await shot("08-local-check");
 await run('document.querySelector("#travel-diagnostics-modal [data-close]").click();document.getElementById("travel-model-button").click()');await waitFor('getComputedStyle(document.getElementById("travel-model-modal")).display!=="none"');await shot("09-model-settings-empty");
 const summary={capturedAt:new Date().toISOString(),port,frames:fs.readdirSync(out).filter(name=>name.endsWith(".png")).sort(),demo:true,liveModelCalls:0};fs.writeFileSync(path.join(out,"capture.json"),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;}).finally(()=>socket?.close());
