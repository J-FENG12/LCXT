const fs = require("node:fs");
const path = require("node:path");

const sourcePath = path.resolve(__dirname, "assets", "desktop-base.js");
const outputPath = path.resolve(__dirname, "dist", "index-v4.js");
const modelSettingsPath = path.resolve(__dirname, "internal-model-settings.js");
const brand = require("./build-travel-brand.cjs").brand();
const skillDisplayNames = require("./tourism/skill-display-names.js");

function assertContains(source, marker) {
  if (!source.includes(marker)) throw new Error(`Required standalone frontend marker was not found: ${marker}`);
}

let bundle = fs.readFileSync(sourcePath, "utf8");
for (const marker of [
  'appName:"旅策协同"',
  'homeDir:".tr-ai-assist"',
  'configFileName:"tr-ai-assist.json"',
  'authMode:"standalone"',
  'oauth2AllowManualConfig:!0',
  'heartbeatUrl:""',
  'skillHubEndpoint:""',
  'doctor:!0',
  'skillFilterTags:[]',
  'name:"通义千问（Qwen / DashScope）"',
  'name:"LM Studio"',
  'getCustomProviderModels()',
  'me.openDoctorWindow()',
  'async function M8(){return null}',
  'async function f2(){return{...eB}}',
  'checkForUpdate:async e=>{return'
]) assertContains(bundle, marker);

bundle = bundle.replace(
  'logo:{light:"/travel-symbol.svg",dark:"/travel-symbol.svg"}',
  `logo:${JSON.stringify({light:brand.symbol,dark:brand.symbol})}`
);
bundle = bundle.replace("doctor:!0", "doctor:!1");
const skillNameResolver = 'function zd(t,e){const n=t.slug||t.key||"";return e==="zh-TW"?t.nameZhTw||t.nameZhCn||t.name||t.nameEn||n:e.startsWith("zh")?t.nameZhCn||t.name||t.nameEn||n:e==="ja"?t.nameJa||t.nameEn||t.name||n:t.nameEn||t.name||t.nameZhCn||n}';
assertContains(bundle, skillNameResolver);
bundle = bundle.replace(skillNameResolver, `function zd(t,e){const n=t.slug||t.key||"",s=${JSON.stringify(skillDisplayNames)}[n];return s??(e==="zh-TW"?t.nameZhTw||t.nameZhCn||t.name||t.nameEn||n:e.startsWith("zh")?t.nameZhCn||t.name||t.nameEn||n:e==="ja"?t.nameJa||t.nameEn||t.name||n:t.nameEn||t.name||t.nameZhCn||n)}`);
const nativeDoctorCall = 'me.openDoctorWindow()';
const nativeDoctorCallCount = bundle.split(nativeDoctorCall).length - 1;
if (nativeDoctorCallCount !== 3) throw new Error(`Unexpected native Doctor entry count: ${nativeDoctorCallCount}`);
bundle = bundle.replaceAll(nativeDoctorCall, 'globalThis.dispatchEvent(new Event("travel-open-local-check"))');
const composerSubmit = 'Se=rI(T);if(!Se&&!it&&!Ce&&Ue.files.length===0)return;let Fe,gt,Rt,Ot;';
assertContains(bundle, composerSubmit);
bundle = bundle.replace(composerSubmit, 'Se=rI(T);if(!Se&&!it&&!Ce&&Ue.files.length===0)return;if(await globalThis.TravelConversationSubmit?.({text:Se,sessionKey:t,skills:Te})){ee(""),r(t,""),P.close(),R.close();return}let Fe,gt,Rt,Ot;');
for (const [source, replacement] of [
  ['"sidebar.doctor":"Diagnose & Report"', '"sidebar.doctor":"Local Check"'],
  ['"startup.runDiagnostics":"Run diagnostics"', '"startup.runDiagnostics":"Local check"'],
  ['"sidebar.doctor":"診断とレポート"', '"sidebar.doctor":"ローカル確認"'],
  ['"startup.runDiagnostics":"診断"', '"startup.runDiagnostics":"ローカル確認"'],
  ['"sidebar.doctor":"诊断与上报"', '"sidebar.doctor":"本机检查"'],
  ['"startup.runDiagnostics":"诊断"', '"startup.runDiagnostics":"本机检查"'],
  ['"sidebar.doctor":"診斷與回報"', '"sidebar.doctor":"本機檢查"'],
  ['"startup.runDiagnostics":"診斷"', '"startup.runDiagnostics":"本機檢查"']
]) {
  if (!bundle.includes(source)) throw new Error(`Required Doctor label was not found: ${source}`);
  bundle = bundle.replace(source, replacement);
}
bundle += `\nglobalThis.TravelBrand=${JSON.stringify(brand)};\n${fs.readFileSync(modelSettingsPath, "utf8")}\n`;
for (const file of ["skill-display-names.js", "task-schema.js", "module-patch.js", "travel-core.js", "knowledge-core.js", "plan-generator.js", "task-state.js", "deliverables.js", "demo-data.js", "request-editor.js", "travel-workbench.js", "agent-panel.js", "contest-ui.js", "travel-journey-view.js", "conversation-flow.js", "tool-settings.js", "brand-ui.js"]) {
  bundle += `\n${fs.readFileSync(path.join(__dirname, "tourism", file), "utf8")}\n`;
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, bundle);
console.log(`Built ${outputPath} (${Buffer.byteLength(bundle)} bytes)`);
require("./tourism/build-demo.cjs");
