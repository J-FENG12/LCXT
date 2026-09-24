"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const ToolConfig = require("../tourism/tool-config.cjs");
const { TravelToolBroker, TravelToolService } = require("../tourism/tool-broker.cjs");
const { SafeToolHttpClient, resolveEndpoint, privateAddress, pinnedLookup } = require("../tourism/safe-tool-http.cjs");
const { toolDataPaths } = require("../platform/tool-config-paths.cjs");
const Demo = require("../tourism/demo-data.js"), Schema = require("../tourism/task-schema.js");

const context = { taskId: "task-tool-test", revision: 3, taskHash: "a".repeat(64) };
function tempHome(t) { const home = fs.mkdtempSync(path.join(os.tmpdir(), "travel-tool-home-")); t.after(() => fs.rmSync(home, { recursive: true, force: true })); return home; }
function config(enabled = []) { return { capabilities: Object.fromEntries(Object.keys(ToolConfig.CAPABILITIES).map(id => [id, { enabled: enabled.includes(id), provider: "mock", baseUrl: "" }])) }; }

test("T01 基础工具默认全部关闭且配置只写用户目录", t => {
  const home = tempHome(t), status = ToolConfig.status(home);
  assert.equal(Object.values(status.capabilities).every(item => !item.enabled), true);
  assert.equal(fs.existsSync(toolDataPaths(home).config), false);
  ToolConfig.save(config(["search"]), home);
  assert.equal(fs.existsSync(toolDataPaths(home).config), true);
  assert.equal(toolDataPaths(home).config.startsWith(home), true);
});

test("T02 工具密钥不回传，远程 HTTP 与私网地址被拒绝", t => {
  const home = tempHome(t), values = config();
  values.capabilities.search = { enabled: true, provider: "custom", baseUrl: "https://travel-tools.example/v1", apiKey: "TEST-TOOL-SECRET" };
  const status = ToolConfig.save(values, home), serialized = JSON.stringify(status);
  assert.equal(status.capabilities.search.hasApiKey, true);
  assert.equal(serialized.includes("TEST-TOOL-SECRET"), false);
  assert.throws(() => ToolConfig.safeEndpoint("http://example.com/v1", "custom"), /HTTPS/);
  assert.throws(() => ToolConfig.safeEndpoint("https://192.168.1.8/v1", "custom"), /私网/);
  assert.throws(() => ToolConfig.safeEndpoint("http://192.168.1.8/v1", "selfhost"), /回环/);
  assert.equal(ToolConfig.safeEndpoint("http://127.0.0.1:8787/v1", "selfhost"), "http://127.0.0.1:8787/v1");
  assert.equal(ToolConfig.safeEndpoint("http://192.168.6.162:8888", "searxng"), "http://192.168.6.162:8888");
  assert.throws(() => ToolConfig.safeEndpoint("", "searxng"), /请填写 SearXNG 服务地址/);
  assert.equal(ToolConfig.safeEndpoint("https://search.example.com/searxng", "searxng"), "https://search.example.com/searxng");
  assert.throws(() => ToolConfig.safeEndpoint("http://search.example.com", "searxng"), /公网域名必须使用 HTTPS/);
  assert.throws(() => ToolConfig.safeEndpoint("http://169.254.169.254", "searxng"), /HTTP 地址只允许/);
  assert.equal(ToolConfig.safeEndpoint("", "amap"), "https://restapi.amap.com");
  assert.throws(() => ToolConfig.safeEndpoint("https://proxy.example/amap", "amap"), /官方 Web 服务地址/);
});

test("T03 N1 只执行本地模拟适配器且结果不自动进入任务", async t => {
  const home = tempHome(t), broker = new TravelToolBroker({ home });
  await assert.rejects(broker.execute({ capability: "search", context, input: { destination: "云水古城", query: "开放时间" } }), /尚未启用/);
  ToolConfig.save(config(["search", "weather", "route", "map"]), home);
  const search = await broker.execute({ capability: "search", context, input: { destination: "云水古城", query: "开放时间", limit: 2 } });
  assert.equal(search.requiresReview, true); assert.equal(search.result.simulation, true); assert.equal(search.result.candidate, true); assert.equal(search.result.observations.length, 2);
  const route = await broker.execute({ capability: "route", context, input: { origin: "甲", destination: "乙", mode: "walking" } });
  assert.equal(route.result.geometry, null); assert.equal(route.result.distanceMeters, null);
  const map = await broker.execute({ capability: "map", context, input: { resourceIds: ["a", "b"] } });
  assert.equal(map.result.geometry, null);
  assert.equal("task" in search, false);
  broker.close();
});

test("T03b Broker 接受工作台实际 task-v2 哈希与 revision 0", async t => {
  const home=tempHome(t),broker=new TravelToolBroker({home}),task=Demo.empty();ToolConfig.save(config(["search"]),home);
  const out=await broker.execute({capability:"search",context:{taskId:task.taskId,revision:task.revision,taskHash:Schema.hash(task)},input:{destination:"待规划目的地",query:"文旅资料",limit:1}});
  assert.equal(out.result.taskHash,Schema.hash(task));assert.equal(out.result.revision,0);broker.close();
});

test("T04 模拟工具缓存不重复计费并执行硬上限", async t => {
  const home = tempHome(t), broker = new TravelToolBroker({ home }); ToolConfig.save(config(["search", "weather"]), home);
  const one = await broker.execute({ requestId: "s1", capability: "search", context, input: { destination: "甲", query: "主题一", limit: 1 } });
  const cached = await broker.execute({ requestId: "s2", capability: "search", context, input: { destination: "甲", query: "主题一", limit: 1 } });
  assert.equal(one.cacheHit, false); assert.equal(cached.cacheHit, true); assert.equal(cached.requestId, "s2");
  await broker.execute({ capability: "search", context, input: { destination: "甲", query: "主题二", limit: 1 } });
  await broker.execute({ capability: "search", context, input: { destination: "甲", query: "主题三", limit: 1 } });
  await assert.rejects(broker.execute({ capability: "search", context, input: { destination: "甲", query: "主题四", limit: 1 } }), /3 次上限/);
  await broker.execute({ capability: "weather", context, input: { location: "甲", date: "2026-09-12" } });
  await assert.rejects(broker.execute({ capability: "weather", context, input: { location: "乙", date: "2026-09-12" } }), /1 次上限/);
  broker.close();
});

test("T05 模拟工具支持取消、并发限制和脱敏审计", async t => {
  const home = tempHome(t), pending = new Map(), slow = (capability, input, bound, now, signal) => new Promise((resolve, reject) => { const done = () => reject(new DOMException("cancelled", "AbortError")); signal.addEventListener("abort", done, { once: true }); pending.set(input.query, () => { signal.removeEventListener("abort", done); resolve({ provider: "mock", simulation: true, candidate: true, retrievedAt: now }); }); }), broker = new TravelToolBroker({ home, mockAdapter: slow });
  ToolConfig.save(config(["search"]), home);
  const first = broker.execute({ requestId: "cancel-me", capability: "search", context, input: { destination: "秘密目的地", query: "秘密主题", limit: 1 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(broker.cancel("cancel-me"), { cancelled: true });
  await assert.rejects(first, /已取消/);
  const a = broker.execute({ requestId: "a", capability: "search", context: { ...context, revision: 4 }, input: { destination: "甲", query: "A", limit: 1 } }), b = broker.execute({ requestId: "b", capability: "search", context: { ...context, revision: 4 }, input: { destination: "甲", query: "B", limit: 1 } });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(broker.execute({ requestId: "c", capability: "search", context: { ...context, revision: 4 }, input: { destination: "甲", query: "C", limit: 1 } }), /并发/);
  pending.get("A")(); pending.get("B")(); await Promise.all([a, b]);
  const audit = fs.readFileSync(toolDataPaths(home).audit, "utf8");
  assert.equal(audit.includes("秘密目的地"), false); assert.equal(audit.includes("秘密主题"), false); assert.match(audit, /requestHash/);
  broker.close();
});

test("T06 工具服务拒绝未知操作和远程提供方执行", async t => {
  const home = tempHome(t), values = config(); values.capabilities.search = { enabled: true, provider: "custom", baseUrl: "https://travel-tools.example/v1", apiKey: "SECRET" }; ToolConfig.save(values, home);
  const service = new TravelToolService({ home });
  await assert.rejects(service.run({ action: "execute", capability: "search", context, input: { destination: "甲", query: "开放" } }), /远程适配器尚未实现/);
  await assert.rejects(service.run({ action: "unknown" }), /不支持/);
  service.close();
});

test("T07 远程传输门复核 DNS 并拒绝重定向、错误类型、超限和坏 JSON", async () => {
  assert.equal(privateAddress("127.0.0.1"), true);assert.equal(privateAddress("10.0.0.3"), true);assert.equal(privateAddress("8.8.8.8"), false);assert.equal(privateAddress("fe80::1"), true);
  await assert.rejects(resolveEndpoint(new URL("https://tools.example/v1"), "custom", async()=>[{address:"192.168.1.2",family:4}]), /非公网/);
  const lookup=async()=>[{address:"8.8.8.8",family:4}], make=transport=>new SafeToolHttpClient({transport,lookup,maxBytes:20});
  await assert.rejects(make(async()=>new Response(null,{status:302,headers:{location:"https://other.example"}})).postJson("https://tools.example/v1","custom","query",{}),/重定向/);
  await assert.rejects(make(async()=>new Response("plain",{status:200,headers:{"content-type":"text/plain"}})).postJson("https://tools.example/v1","custom","query",{}),/application\/json/);
  await assert.rejects(make(async()=>new Response("{}",{status:200,headers:{"content-type":"application/json","content-length":"99"}})).postJson("https://tools.example/v1","custom","query",{}),/大小上限/);
  await assert.rejects(make(async()=>new Response("not-json",{status:200,headers:{"content-type":"application/json"}})).postJson("https://tools.example/v1","custom","query",{}),/有效 JSON/);
  await assert.rejects(make(async()=>new Response("{}",{status:200,headers:{"content-type":"application/json"}})).postJson("https://tools.example/v1/base","custom","../escape",{}),/越出/);
  assert.deepEqual(await make(async()=>new Response('{"ok":true}',{status:200,headers:{"content-type":"application/json"}})).postJson("https://tools.example/v1","custom","query",{}),{ok:true});
});
test("T07b 远程连接使用已核验的固定解析地址，本机请求只访问回环",async t=>{
  const lookup=pinnedLookup("tools.example",{address:"8.8.8.8",family:4});
  assert.deepEqual(await new Promise((resolve,reject)=>lookup("tools.example",{},(error,address,family)=>error?reject(error):resolve({address,family}))),{address:"8.8.8.8",family:4});
  assert.deepEqual(await new Promise((resolve,reject)=>lookup("tools.example",{all:true},(error,addresses)=>error?reject(error):resolve(addresses))),[{address:"8.8.8.8",family:4}]);
  await assert.rejects(new Promise((resolve,reject)=>lookup("other.example",{},error=>error?reject(error):resolve())),/不一致/);
  let pinned;
  const client=new SafeToolHttpClient({lookup:async()=>[{address:"8.8.8.8",family:4}],transport:async(_target,_body,_signal,address)=>{pinned=address;return new Response("{}",{headers:{"content-type":"application/json"}});}});
  await client.postJson("https://tools.example/v1","custom","query",{});
  assert.deepEqual(pinned,{address:"8.8.8.8",family:4});
  const server=http.createServer((request,response)=>{response.writeHead(200,{"content-type":"application/json"});response.end(JSON.stringify({host:request.headers.host,method:request.method}));});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>server.close());
  const local=new SafeToolHttpClient({timeoutMs:2000});
  const result=await local.postJson(`http://localhost:${server.address().port}/api`,"selfhost","query",{});
  assert.deepEqual(result,{host:`localhost:${server.address().port}`,method:"POST"});
  const searched=await local.getJson(`http://127.0.0.1:${server.address().port}`,"searxng","search",{q:"杭州文旅",format:"json"});
  assert.deepEqual(searched,{host:`127.0.0.1:${server.address().port}`,method:"GET"});
});
test("T07c DNS 卡住和正文迟到都会被同一超时门切断",async t=>{
  const unresolved=new SafeToolHttpClient({lookup:()=>new Promise(()=>{}),timeoutMs:30,transport:()=>{throw new Error("不应连接");}});
  await assert.rejects(unresolved.postJson("https://tools.example/v1","custom","query",{}),/取消或超时/);
  const server=http.createServer((_request,response)=>{response.writeHead(200,{"content-type":"application/json"});response.flushHeaders();setTimeout(()=>response.end("{}"),120);});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>server.close());
  const client=new SafeToolHttpClient({timeoutMs:40});
  await assert.rejects(client.postJson(`http://localhost:${server.address().port}/v1`,"selfhost","query",{}),/取消或超时/);
});
test("T07d IANA 特殊用途和混合 DNS 地址不能穿过公网工具门",async()=>{
  for(const address of ["0.1.2.3","100.64.1.2","169.254.169.254","192.0.2.1","192.88.99.1","198.18.0.1","198.51.100.7","203.0.113.5","224.0.0.1","255.255.255.255","2001:db8::1","2002:c0a8:101::1","3fff::1","fc00::1","fe80::1","::ffff:127.0.0.1"])
    assert.equal(privateAddress(address),true,`${address} 应被拒绝`);
  for(const address of ["1.1.1.1","8.8.8.8","2001:4860:4860::8888","2606:4700:4700::1111"])
    assert.equal(privateAddress(address),false,`${address} 应可通过公网分类`);
  await assert.rejects(resolveEndpoint(new URL("https://tools.example/v1"),"custom",async()=>[{address:"8.8.8.8",family:4},{address:"100.64.0.2",family:4}]),/非公网/);
  await assert.rejects(resolveEndpoint(new URL("https://tools.example/v1"),"custom",async()=>[{address:"8.8.8.8",family:6}]),/非公网/);
});
test("T08 不响应取消信号的模拟适配器也会被 Broker 超时切断",async t=>{const home=tempHome(t),broker=new TravelToolBroker({home,timeoutMs:25,mockAdapter:()=>new Promise(()=>{})});ToolConfig.save(config(["search"]),home);await assert.rejects(broker.execute({capability:"search",context,input:{destination:"甲",query:"超时测试"}}),/超时/);assert.equal(broker.active,0);broker.close();});
test("T09 Tavily 搜索默认关闭，启用后只发送结构化公开检索词且候选不自动采纳",async t=>{
  const home=tempHome(t),task=Demo.scenario(),bound={taskId:task.taskId,revision:task.revision,taskHash:Schema.hash(task)};
  new (require("../tourism/task-repository.cjs").TaskRepository)({home}).save({task});
  const values=config();values.capabilities.search={enabled:true,provider:"tavily",apiKey:"TEST-PRIVATE-KEY"};
  const status=ToolConfig.save(values,home);assert.equal(status.realNetworkEnabled,true);assert.equal(JSON.stringify(status).includes("TEST-PRIVATE-KEY"),false);
  assert.throws(()=>ToolConfig.safeEndpoint("https://evil.example","tavily"),/官方/);
  let sent;const client={postJson:async(...args)=>{sent=args;return{results:[{title:"景区开放公告",url:"https://official.example/notice",content:"请以景区正式公告为准。"}]};}};
  const service=new TravelToolService({home,broker:new TravelToolBroker({home,httpClient:client,clock:()=>new Date("2026-09-12T08:00:00Z")})});
  await assert.rejects(service.run({action:"execute",capability:"search",context:bound,input:{destination:"游客手机号13812345678",query:"开放"}}),/结构化/);
  const out=await service.run({action:"execute",capability:"search",context:bound,input:{theme:"opening",resourceId:null,limit:1}});
  assert.equal(sent[0],"https://api.tavily.com");assert.equal(sent[2],"search");assert.equal(sent[3].include_answer,false);assert.equal(sent[3].include_raw_content,false);assert.equal(sent[3].query.includes("手机号"),false);assert.equal(sent[5],"TEST-PRIVATE-KEY");
  assert.equal(out.candidates.length,1);assert.equal(out.candidates[0].simulation,false);assert.equal(out.candidates[0].state,"pending");
  assert.equal(new (require("../tourism/task-repository.cjs").TaskRepository)({home}).load().task.facts.length,task.facts.length);
  assert.equal(fs.readFileSync(toolDataPaths(home).audit,"utf8").includes("TEST-PRIVATE-KEY"),false);
  service.close();
});
test("T09b SearXNG 支持局域网与公网域名配置且无需预置密钥",async t=>{
  const home=tempHome(t),task=Demo.scenario(),bound={taskId:task.taskId,revision:task.revision,taskHash:Schema.hash(task)};
  new (require("../tourism/task-repository.cjs").TaskRepository)({home}).save({task});
  const values=config();values.capabilities.search={enabled:true,provider:"searxng",baseUrl:"http://192.168.6.162:8888"};
  const status=ToolConfig.save(values,home);assert.equal(status.realNetworkEnabled,true);assert.equal(status.capabilities.search.executable,true);assert.equal(status.capabilities.search.hasApiKey,false);
  let sent;const client={getJson:async(...args)=>{sent=args;return{results:[{title:"景区开放公告",url:"https://official.example/notice",content:"请以景区正式公告为准。"}]};}};
  const service=new TravelToolService({home,broker:new TravelToolBroker({home,httpClient:client,clock:()=>new Date("2026-09-16T08:00:00Z")})});
  const out=await service.run({action:"execute",capability:"search",context:bound,input:{theme:"opening",resourceId:null,limit:1}});
  assert.equal(sent[0],"http://192.168.6.162:8888");assert.equal(sent[1],"searxng");assert.equal(sent[2],"search");assert.equal(sent[3].format,"json");assert.equal(sent[3].q.includes("手机号"),false);assert.equal(sent[5],"");
  assert.equal(out.result.provider,"searxng");assert.equal(out.candidates.length,1);assert.equal(out.candidates[0].state,"pending");
  service.close();
});
test("T09b-connection 高德与 SearXNG 连通性测试使用固定公开样例且不绑定虚构任务",async t=>{
  const home=tempHome(t), calls=[];
  const values=config();
  values.capabilities.search={enabled:true,provider:"searxng",baseUrl:"http://192.168.6.162:8888"};
  for(const id of ["weather","route","map"])values.capabilities[id]={enabled:true,provider:"amap",apiKey:"AMAP_TEST_KEY_123456"};
  ToolConfig.save(values,home);
  const client={getJson:async(...args)=>{calls.push(args);const route=args[2];if(route==="v3/weather/weatherInfo")return{status:"1",lives:[{province:"浙江省",city:"杭州市",weather:"晴",temperature:"26"}]};if(route==="v3/geocode/geo")return{status:"1",geocodes:[{formatted_address:"浙江省杭州市西湖风景名胜区",location:"120.148820,30.242780"}]};if(route==="v5/direction/walking")return{status:"1",route:{paths:[{distance:"4100",cost:{duration:"3600"}}]}};return{results:[]};}};
  const broker=new TravelToolBroker({home,httpClient:client,clock:()=>new Date("2026-09-16T08:00:00Z")});
  const weather=await broker.testConnection({capability:"weather"}), map=await broker.testConnection({capability:"map"}), route=await broker.testConnection({capability:"route"}), search=await broker.testConnection({capability:"search"});
  assert.equal(weather.connected,true);assert.equal(weather.result.testCase,"杭州市（行政区划编码 330100）");assert.match(weather.result.responseSummary,/26℃/);
  assert.equal(map.connected,true);assert.equal(map.result.testCase,"杭州西湖风景名胜区");assert.match(map.result.responseSummary,/120\.14882,30\.24278/);
  assert.equal(route.connected,true);assert.equal(route.result.testCase,"杭州市中心固定公开坐标步行路线");assert.match(route.result.responseSummary,/4100 米，60 分钟/);
  assert.equal(search.connected,true);assert.equal(search.result.resultCount,0);assert.equal(search.result.testCase,"公开测试检索：杭州 文旅");
  assert.deepEqual(calls[0].slice(0,4),["https://restapi.amap.com","amap","v3/weather/weatherInfo",{city:"330100",extensions:"base",output:"JSON",key:"AMAP_TEST_KEY_123456"}]);
  assert.equal(calls[1][2],"v3/geocode/geo");assert.equal(calls[1][3].address,"杭州西湖风景名胜区");
  assert.equal(calls[2][2],"v5/direction/walking");assert.equal(calls[2][3].show_fields,"cost,navi,polyline");
  assert.equal(calls[3][0],"http://192.168.6.162:8888");assert.equal(calls[3][1],"searxng");assert.equal(calls[3][2],"search");assert.equal(calls[3][3].q,"杭州 文旅");
  assert.equal(fs.readFileSync(toolDataPaths(home).audit,"utf8").includes("AMAP_TEST_KEY_123456"),false);broker.close();
});
test("T09c 高德天气自动解析 adcode、Key 不回传且结果进入候选箱",async t=>{
  const home=tempHome(t),task=Demo.scenario(),bound={taskId:task.taskId,revision:task.revision,taskHash:Schema.hash(task)},secret="AMAP_TEST_KEY_123456";
  new (require("../tourism/task-repository.cjs").TaskRepository)({home}).save({task});
  const values=config();values.capabilities.weather={enabled:true,provider:"amap",apiKey:secret};
  const status=ToolConfig.save(values,home);assert.equal(status.realNetworkEnabled,true);assert.equal(status.capabilities.weather.baseUrl,"https://restapi.amap.com");assert.equal(status.capabilities.weather.executable,true);assert.equal(JSON.stringify(status).includes(secret),false);
  const sent=[],client={getJson:async(base,provider,route,params)=>{sent.push({base,provider,route,params});if(route==="v3/config/district")return{status:"1",districts:[{name:"杭州市",adcode:"330100",citycode:"0571",center:"120.15507,30.274085"}]};return{status:"1",forecasts:[{reporttime:"2026-09-16 11:00:00",casts:[{date:"2026-09-16",dayweather:"晴",nightweather:"多云",daytemp:"29",nighttemp:"21",daywind:"东",daypower:"≤3"}]}]};}};
  const service=new TravelToolService({home,broker:new TravelToolBroker({home,httpClient:client,clock:()=>new Date("2026-09-16T08:00:00Z")})});
  const out=await service.run({action:"execute",capability:"weather",context:bound,input:{location:"杭州",date:"2026-09-16"}});
  assert.deepEqual(sent.map(item=>item.route),["v3/config/district","v3/weather/weatherInfo"]);assert.equal(sent.every(item=>item.base==="https://restapi.amap.com"&&item.provider==="amap"&&item.params.key===secret),true);
  assert.equal(out.result.simulation,false);assert.equal(out.result.condition.includes("晴"),true);assert.equal(out.candidates.length,1);assert.equal(out.candidates[0].state,"pending");assert.equal(fs.readFileSync(toolDataPaths(home).audit,"utf8").includes(secret),false);service.close();
});
test("T09d 高德路线与地理坐标自动地理编码且不覆盖任务",async t=>{
  const home=tempHome(t),task=Demo.scenario(),bound={taskId:task.taskId,revision:task.revision,taskHash:Schema.hash(task)},repo=new (require("../tourism/task-repository.cjs").TaskRepository)({home});repo.save({task});
  const values=config();for(const id of ["route","map"])values.capabilities[id]={enabled:true,provider:"amap",apiKey:"AMAP_TEST_KEY_123456"};ToolConfig.save(values,home);
  let geocodeIndex=0;const client={getJson:async(_base,_provider,route)=>{if(route==="v3/geocode/geo"){const location=[["120.100001,30.100001","330100","0571"],["120.200002,30.200002","330100","0571"],["120.300003,30.300003","330100","0571"]][geocodeIndex++%3];return{status:"1",geocodes:[{formatted_address:"杭州市测试地点",location:location[0],adcode:location[1],citycode:location[2],level:"兴趣点"}]};}return{status:"1",route:{paths:[{distance:"1500",cost:{duration:"900"},steps:[{polyline:"120.100001,30.100001;120.200002,30.200002"}]}]}};}};
  const broker=new TravelToolBroker({home,httpClient:client,clock:()=>new Date("2026-09-16T08:00:00Z")});
  const route=await broker.execute({capability:"route",context:bound,input:{origin:task.resources[0].name,destination:task.resources[1].name,mode:"walking"}});
  assert.equal(route.result.distanceMeters,1500);assert.equal(route.result.durationMinutes,15);assert.equal(route.result.walkingMinutes,15);assert.equal(route.result.geometry.coordinates.length,2);
  const map=await broker.execute({capability:"map",context:bound,input:{resourceIds:task.resources.slice(0,2).map(item=>item.id)}});
  assert.equal(map.result.points.length,2);assert.equal(map.result.geometry.type,"MultiPoint");assert.deepEqual(repo.load().task,Schema.parse(task));broker.close();
});
test("T09e 高德短时 QPS 限流会有界退避重试且不泄露 Key",async t=>{
  const home=tempHome(t),task=Demo.scenario(),bound={taskId:task.taskId,revision:task.revision,taskHash:Schema.hash(task)},secret="AMAP_TEST_KEY_123456";
  new (require("../tourism/task-repository.cjs").TaskRepository)({home}).save({task});
  const values=config();values.capabilities.map={enabled:true,provider:"amap",apiKey:secret};ToolConfig.save(values,home);
  let calls=0;const client={getJson:async()=>{calls++;if(calls===1)return{status:"0",info:"CUQPS_HAS_EXCEEDED_THE_LIMIT",infocode:"10021"};return{status:"1",geocodes:[{formatted_address:"杭州市测试地点",location:"120.100001,30.100001",adcode:"330100",citycode:"0571",level:"兴趣点"}]};}};
  const broker=new TravelToolBroker({home,httpClient:client,timeoutMs:5000});
  const out=await broker.execute({capability:"map",context:bound,input:{resourceIds:[task.resources[0].id]}});
  assert.equal(calls,2);assert.equal(out.result.points.length,1);assert.equal(JSON.stringify(out).includes(secret),false);assert.equal(fs.readFileSync(toolDataPaths(home).audit,"utf8").includes(secret),false);broker.close();
});
test("T09f Agent 可直接调用高德天气、路线和坐标且无需任务上下文",async t=>{
  const home=tempHome(t),secret="AMAP_TEST_KEY_123456",values=config();
  for(const id of ["weather","route","map"])values.capabilities[id]={enabled:true,provider:"amap",apiKey:secret};ToolConfig.save(values,home);
  let geocode=0;const calls=[],client={getJson:async(_base,_provider,route,params)=>{calls.push({route,params});if(route==="v3/config/district")return{status:"1",districts:[{name:"杭州市",adcode:"330100",citycode:"0571",center:"120.15507,30.274085"}]};if(route==="v3/weather/weatherInfo")return{status:"1",forecasts:[{reporttime:"2026-09-17 10:00:00",casts:[{date:"2026-09-17",dayweather:"多云",nightweather:"多云",daytemp:"31",nighttemp:"22",daywind:"东",daypower:"1-3"}]}]};if(route==="v3/geocode/geo"){geocode++;return{status:"1",geocodes:[{formatted_address:geocode===1?"浙江省杭州市西湖风景名胜区":"浙江省杭州市灵隐寺",location:geocode===1?"120.158108,30.241651":"120.102352,30.239963",adcode:"330100",citycode:"0571",level:"兴趣点"}]};}return{status:"1",route:{paths:[{distance:"7848",cost:{duration:"6300"},steps:[{polyline:"120.158108,30.241651;120.102352,30.239963"}]}]}};}};
  const broker=new TravelToolBroker({home,httpClient:client,clock:()=>new Date("2026-09-17T02:00:00Z")});
  const weather=await broker.agentQuery({capability:"weather",input:{location:"杭州",date:"2026-09-17"}}), map=await broker.agentQuery({capability:"map",input:{city:"杭州",address:"西湖风景名胜区"}}), route=await broker.agentQuery({capability:"route",input:{city:"杭州",origin:"西湖风景名胜区",destination:"灵隐寺",mode:"walking"}});
  assert.equal(weather.result.location,"杭州市");assert.match(weather.result.condition,/31℃/);assert.equal(map.result.longitude,120.158108);assert.equal(route.result.distanceMeters,7848);assert.equal(route.result.durationMinutes,105);assert.equal(route.requiresReview,true);assert.equal(JSON.stringify({weather,map,route}).includes(secret),false);assert.equal(calls.every(call=>call.params.key===secret),true);assert.equal(fs.readFileSync(toolDataPaths(home).audit,"utf8").includes(secret),false);broker.close();
});
test("T09g Agent 路线对车站等 POI 使用地点搜索回退并补齐公交城市编码",async t=>{
  const home=tempHome(t),values=config();values.capabilities.route={enabled:true,provider:"amap",apiKey:"AMAP_TEST_KEY_123456"};ToolConfig.save(values,home);
  let geocode=0;const calls=[],client={getJson:async(_base,_provider,route,params)=>{calls.push(route);if(route==="v3/geocode/geo"){geocode++;return geocode===1?{status:"1",geocodes:[]}:{status:"1",geocodes:[{formatted_address:"杭州市西湖风景名胜区",location:"120.158108,30.241651",adcode:"330102",citycode:[],level:"兴趣点"}]};}if(route==="v3/place/text")return{status:"1",pois:[{pname:"浙江省",cityname:"杭州市",adname:"上城区",address:"天城路1号",name:"杭州东站",location:"120.212001,30.290001",adcode:[],citycode:[],type:"交通设施服务"}]};if(route==="v3/config/district")return{status:"1",districts:[{name:"杭州市",adcode:"330100",citycode:"0571",center:"120.15507,30.274085"}]};return{status:"1",route:{transits:[{distance:"10669",cost:{duration:"2760",transit_fee:"5"}}]}};}};
  const broker=new TravelToolBroker({home,httpClient:client,clock:()=>new Date("2026-09-17T02:00:00Z")});
  const out=await broker.agentQuery({capability:"route",input:{city:"杭州",origin:"杭州东站",destination:"西湖风景名胜区",mode:"transit"}});
  assert.equal(out.result.distanceMeters,10669);assert.equal(out.result.durationMinutes,46);assert.match(out.result.originAddress,/杭州东站/);assert.deepEqual(calls,["v3/geocode/geo","v3/place/text","v3/geocode/geo","v3/config/district","v5/direction/transit/integrated"]);broker.close();
});
test("T10 真实搜索次数跨 Broker 重启保持上限，任务变化和坏来源均拒绝",async t=>{
  const home=tempHome(t),task=Demo.scenario(),bound={taskId:task.taskId,revision:task.revision,taskHash:Schema.hash(task)},repo=new (require("../tourism/task-repository.cjs").TaskRepository)({home});repo.save({task});
  const values=config();values.capabilities.search={enabled:true,provider:"tavily",apiKey:"TEST-KEY"};ToolConfig.save(values,home);
  const client={postJson:async()=>({results:[{title:"标题",url:"https://official.example/page",content:"内容"}]})},input={theme:"opening",resourceId:null,limit:1};
  for(let index=0;index<3;index++){const broker=new TravelToolBroker({home,httpClient:client});await broker.execute({capability:"search",context:bound,input:{...input,theme:["opening","tickets","access"][index]}});broker.close();}
  const broker=new TravelToolBroker({home,httpClient:client});await assert.rejects(broker.execute({capability:"search",context:bound,input}),/3 次上限/);broker.close();
  const changed={...task,revision:task.revision+1};repo.save({task:changed,baseStoredTaskHash:bound.taskHash});
  await assert.rejects(new TravelToolBroker({home,httpClient:client}).execute({capability:"search",context:bound,input}),/版本已变化/);
  const next={taskId:changed.taskId,revision:changed.revision,taskHash:Schema.hash(changed)};
  const bad=new TravelToolBroker({home,httpClient:{postJson:async()=>({results:[{title:"标题",url:"http://private.example",content:"内容"}]})}});
  await assert.rejects(bad.execute({capability:"search",context:next,input}),/公开 HTTPS/);bad.close();
});
test("T11 迟到的真实搜索响应在任务变化后被丢弃",async t=>{
  const home=tempHome(t),task=Demo.scenario(),bound={taskId:task.taskId,revision:task.revision,taskHash:Schema.hash(task)},repo=new (require("../tourism/task-repository.cjs").TaskRepository)({home});repo.save({task});
  const values=config();values.capabilities.search={enabled:true,provider:"tavily",apiKey:"TEST-KEY"};ToolConfig.save(values,home);
  let release;const client={postJson:()=>new Promise(resolve=>{release=resolve;})},service=new TravelToolService({home,broker:new TravelToolBroker({home,httpClient:client})});
  const running=service.run({action:"execute",capability:"search",context:bound,input:{theme:"opening",resourceId:null}});
  await new Promise(resolve=>setImmediate(resolve));const changed={...task,revision:task.revision+1};repo.save({task:changed,baseStoredTaskHash:bound.taskHash});
  release({results:[{title:"迟到网页",url:"https://official.example/late",content:"迟到内容"}]});
  await assert.rejects(running,/版本已变化/);assert.equal(service.observations.list(bound).length,0);service.close();
});
test("T12 远程请求将密钥放在 Authorization 头且仅发送到固定主机",async()=>{
  let observed;const client=new SafeToolHttpClient({lookup:async()=>[{address:"8.8.8.8",family:4}],transport:async(target,body,_signal,address,headers)=>{observed={target:target.href,body,address,headers};return new Response("{}",{headers:{"content-type":"application/json"}});}});
  await client.postJson("https://api.tavily.com","tavily","search",{query:"公开目的地 开放时间"},undefined,"TEST-KEY");
  assert.equal(observed.target,"https://api.tavily.com/search");assert.deepEqual(observed.address,{address:"8.8.8.8",family:4});assert.equal(observed.headers.Authorization,"Bearer TEST-KEY");assert.equal(observed.body.includes("TEST-KEY"),false);
  await assert.rejects(client.postJson("https://elsewhere.example","tavily","search",{},undefined,"TEST-KEY"),/官方/);
});
test("T12b SearXNG GET 固定查询路径并对公网域名继续执行 DNS 安全核验",async()=>{
  let observed;const client=new SafeToolHttpClient({lookup:async()=>[{address:"8.8.8.8",family:4}],transport:async(target,body,_signal,address,headers,options)=>{observed={target:target.href,body,address,headers,options};return new Response("{}",{headers:{"content-type":"application/json"}});}});
  await client.getJson("https://search.example.com/searxng","searxng","search",{q:"公开目的地 开放时间",format:"json"},undefined,"ACCESS-TOKEN");
  assert.equal(observed.target,"https://search.example.com/searxng/search?q=%E5%85%AC%E5%BC%80%E7%9B%AE%E7%9A%84%E5%9C%B0+%E5%BC%80%E6%94%BE%E6%97%B6%E9%97%B4&format=json");assert.equal(observed.body,"");assert.deepEqual(observed.address,{address:"8.8.8.8",family:4});assert.equal(observed.headers.Authorization,"Bearer ACCESS-TOKEN");assert.equal(observed.options.method,"GET");
  await assert.rejects(client.getJson("https://search.example.com/base","searxng","../search",{q:"x"}),/越出/);
});
test("T12c 高德 Key 仅作为官方主机的查询参数发送",async()=>{
  let observed;const client=new SafeToolHttpClient({lookup:async()=>[{address:"8.8.8.8",family:4}],transport:async(target,body,_signal,address,headers,options)=>{observed={target:target.href,body,address,headers,options};return new Response('{"status":"1"}',{headers:{"content-type":"application/json"}});}});
  await client.getJson("https://restapi.amap.com","amap","v3/weather/weatherInfo",{city:"330100",extensions:"all",output:"JSON",key:"AMAP_TEST_KEY_123456"});
  assert.equal(observed.target.startsWith("https://restapi.amap.com/v3/weather/weatherInfo?"),true);assert.equal(new URL(observed.target).searchParams.get("key"),"AMAP_TEST_KEY_123456");assert.equal(observed.headers.Authorization,undefined);assert.equal(observed.options.method,"GET");
  await assert.rejects(client.getJson("https://proxy.example","amap","v3/weather/weatherInfo",{key:"AMAP_TEST_KEY_123456"}),/官方 Web 服务地址/);
});
