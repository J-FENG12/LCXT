"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const root=path.resolve(__dirname,".."),PluginConfig=require("../platform/openclaw-travel-tools.cjs");

test("OpenClaw 文旅工具插件使用严格清单并保留原配置",()=>{
  const config={plugins:{enabled:true,allow:["memory-core"],load:{paths:["C:/existing-plugin"]},entries:{"memory-core":{enabled:true}}}};
  const plugin=path.join(root,"runtime","plugins","travel-tools"),out=PluginConfig.decorate(config,plugin);
  assert.deepEqual(out.plugins.allow,["memory-core","travel-tools"]);assert.equal(out.plugins.load.paths[0],"C:/existing-plugin");assert.equal(out.plugins.load.paths[1],plugin);assert.deepEqual(out.plugins.entries["travel-tools"],{enabled:true});
  assert.doesNotThrow(()=>PluginConfig.decorate(out,plugin));assert.equal(out.plugins.load.paths.filter(value=>value===plugin).length,1);
  const manifest=JSON.parse(fs.readFileSync(path.join(plugin,"openclaw.plugin.json"),"utf8"));assert.equal(manifest.id,"travel-tools");assert.equal(manifest.activation.onStartup,true);assert.equal(manifest.configSchema.additionalProperties,false);
});

test("桌面启动同时覆盖运行时实际配置与评审隔离配置",t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"travel-plugin-home-"));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  for(const rel of [[".tr-ai-assist","tr-ai-assist.json"],[".tr-ai-review","tr-ai-review.json"]]){const file=path.join(home,...rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({gateway:{auth:{token:"LOCAL-ONLY"}}}));}
  const results=PluginConfig.ensureDesktopProfiles(home,path.join(root,"runtime","plugins","travel-tools"));assert.equal(results.length,2);
  for(const rel of [[".tr-ai-assist","tr-ai-assist.json"],[".tr-ai-review","tr-ai-review.json"]]){const config=JSON.parse(fs.readFileSync(path.join(home,...rel),"utf8"));assert.equal(config.gateway.auth.token,"LOCAL-ONLY");assert.equal(config.plugins.entries["travel-tools"].enabled,true);}
});

test("OpenClaw 插件向模型注册三个只读高德工具",async()=>{
  const module=await import(`${require("node:url").pathToFileURL(path.join(root,"runtime","plugins","travel-tools","index.js")).href}?test=${Date.now()}`),tools=module.buildTravelTools();
  assert.deepEqual(tools.map(tool=>tool.name),["travel_weather_lookup","travel_route_lookup","travel_place_lookup"]);
  for(const tool of tools){assert.equal(typeof tool.execute,"function");assert.equal(tool.parameters.type,"object");assert.equal(tool.parameters.additionalProperties,false);assert.match(tool.description,/高德/);assert.match(tool.description,/不要.*(?:Key|脚本)/);}
});

test("启动器和模型保存链路都会写入插件路径",()=>{
  const launcher=fs.readFileSync(path.join(root,"launcher.cjs"),"utf8"),model=fs.readFileSync(path.join(root,"tourism","model-config.cjs"),"utf8"),skill=fs.readFileSync(path.join(root,"runtime","skills","travel-demand-planner","SKILL.md"),"utf8");
  assert.match(launcher,/OpenClawTravelTools\.ensureDesktopProfiles/);assert.match(model,/OpenClawTravelTools\.decorate/);for(const name of ["travel_weather_lookup","travel_route_lookup","travel_place_lookup"]){assert.match(skill,new RegExp(name));}
});
