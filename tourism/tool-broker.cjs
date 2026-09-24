"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const ToolConfig = require("./tool-config.cjs");
const { toolDataPaths } = require("../platform/tool-config-paths.cjs");
const { ObservationRepository } = require("./observation-repository.cjs");
const { TaskRepository } = require("./task-repository.cjs");
const { SafeToolHttpClient } = require("./safe-tool-http.cjs");
const SearchIntent = require("./search-intent.cjs");

const CACHE_TTL_MS = 5 * 60 * 1000, MAX_CONCURRENCY = 2, MAX_AUDIT_BYTES = 1024 * 1024;
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const isRealSearchProvider = provider => ["tavily", "searxng"].includes(provider);
const isLiveProvider = provider => isRealSearchProvider(provider) || provider === "amap";
const AMAP_BASE_URL = "https://restapi.amap.com";
const AMAP_SOURCES = Object.freeze({
  weather: "https://lbs.amap.com/api/webservice/guide/api/weatherinfo",
  route: "https://lbs.amap.com/api/webservice/guide/api/newroute",
  geocode: "https://lbs.amap.com/api/webservice/guide/api/georegeo"
});
// 高德低配额 Key 在连续地理编码时除了 QPS 系列状态码，偶尔也会返回
// ENGINE_RESPONSE_DATA_ERROR。它属于短时上游计算失败，允许同一只读请求有界重试。
const AMAP_TRANSIENT_CODES = new Set(["10014", "10015", "10016", "10019", "10020", "10021", "10022", "10023", "30001"]);
const cleanText = (value, label, max = 160) => {
  const text = String(value || "").trim();
  if (!text || text.length > max || /[\r\n\0]/.test(text)) throw new Error(`${label}无效。`);
  return text;
};

function cleanContext(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("基础工具调用必须绑定当前任务版本。");
  const taskId = cleanText(raw.taskId, "任务标识", 100), taskHash = String(raw.taskHash || "").trim(), revision = Number(raw.revision);
  if (!/^(?:[a-f0-9]{64}|task-v2-[a-f0-9]{16})$/i.test(taskHash) || !Number.isInteger(revision) || revision < 0) throw new Error("基础工具调用的任务版本无效。");
  return { taskId, taskHash: taskHash.toLowerCase(), revision };
}

function cleanInput(capability, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("基础工具参数无效。");
  if (capability === "search") {
    if (raw.theme !== undefined) return { theme: cleanText(raw.theme, "检索主题", 30), resourceId: raw.resourceId == null ? null : cleanText(raw.resourceId, "资源标识", 100), limit: Math.min(3, Math.max(1, Number.isInteger(raw.limit) ? raw.limit : 3)) };
    return { destination: cleanText(raw.destination, "目的地"), query: cleanText(raw.query, "搜索主题", 300), limit: Math.min(3, Math.max(1, Number.isInteger(raw.limit) ? raw.limit : 3)) };
  }
  if (capability === "weather") {
    const date = cleanText(raw.date, "日期", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("天气日期必须为 YYYY-MM-DD。");
    return { location: cleanText(raw.location, "天气地点"), date };
  }
  if (capability === "route") {
    const mode = String(raw.mode || "walking");
    if (!["walking", "driving", "transit"].includes(mode)) throw new Error("路线方式不受支持。");
    return { origin: cleanText(raw.origin, "路线起点"), destination: cleanText(raw.destination, "路线终点"), mode };
  }
  if (capability === "map") {
    const resourceIds = Array.isArray(raw.resourceIds) ? [...new Set(raw.resourceIds.map(value => cleanText(value, "资源标识", 100)))].slice(0, 10) : [];
    if (!resourceIds.length) throw new Error("地图模拟检查至少需要一个资源标识。");
    return { resourceIds };
  }
  throw new Error("基础工具能力不在白名单中。");
}

function mockAdapter(capability, input, context, now) {
  const common = { provider: "mock", simulation: true, candidate: true, taskId: context.taskId, taskHash: context.taskHash, revision: context.revision, retrievedAt: now, sourceLabel: "本地模拟适配器（非真实数据）" };
  if (capability === "search") return { ...common, observations: Array.from({ length: input.limit }, (_, index) => ({ observationId: `MOCK-SEARCH-${hash([input, index]).slice(0, 12)}`, title: `${input.destination} · ${input.query} · 模拟结果 ${index + 1}`, summary: "仅用于验证搜索流程、来源标记和人工采纳步骤，不代表真实联网资料。", url: null })) };
  if (capability === "weather") return { ...common, observationId: `MOCK-WEATHER-${hash(input).slice(0, 12)}`, location: input.location, date: input.date, condition: "模拟天气（无预报含义）", validUntil: null };
  if (capability === "route") return { ...common, observationId: `MOCK-ROUTE-${hash(input).slice(0, 12)}`, origin: input.origin, destination: input.destination, mode: input.mode, distanceMeters: null, durationMinutes: null, geometry: null, note: "模拟适配器不生成道路距离或路线几何。" };
  return { ...common, observationId: `MOCK-MAP-${hash(input).slice(0, 12)}`, resourceIds: input.resourceIds, geometry: null, note: "没有真实坐标，不显示地理地图；继续使用路线拓扑。" };
}

function currentTask(repository, context) {
  const record = repository.load();
  if (!record || record.task.taskId !== context.taskId || record.task.revision !== context.revision || record.taskHash !== context.taskHash) throw new Error("已保存任务版本已变化，联网检索已取消。");
  return record.task;
}
async function tavilyAdapter(input, context, now, config, client, repository, signal) {
  const task = currentTask(repository, context);
  const query = SearchIntent.publicSearchQuery(task, input);
  if (!config.apiKey) throw new Error("请先配置 Tavily API Key。");
  const response = await client.postJson(config.baseUrl, "tavily", "search", {
    query, search_depth: "basic", max_results: input.limit, topic: "general", include_answer: false,
    include_raw_content: false, include_images: false, include_published_date: true,
    auto_parameters: false, safe_search: true
  }, signal, config.apiKey);
  currentTask(repository, context);
  return searchResult(input, context, now, response, query, "tavily", "Tavily 网页检索（摘要待人工核实）");
}

function searchResult(input, context, now, response, query, provider, sourceLabel) {
  if (!response || !Array.isArray(response.results)) throw new Error("搜索服务返回的结果格式无效。");
  const reviewBy = new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const observations = [];
  for (const [index, row] of response.results.entries()) {
    if (observations.length >= input.limit) break;
    let url; try { url = new URL(String(row?.url || "")); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || url.hash || !url.hostname || url.hostname === "localhost" || require("node:net").isIP(url.hostname)) continue;
    const title = String(row.title || "").trim().slice(0, 300), summary = String(row.content || "").trim().slice(0, 1500);
    if (!title || !summary) continue;
    observations.push({ observationId: `WEB-${hash([context, query, url.href, index]).slice(0, 20)}`, title, summary, url: url.href,
      sourceLabel: url.hostname, retrievedAt: now, validUntil: reviewBy, provider, simulation: false });
  }
  if (!observations.length) throw new Error("搜索服务没有返回可核验的公开 HTTPS 网页。");
  return { provider, simulation: false, candidate: true, taskId: context.taskId, taskHash: context.taskHash,
    revision: context.revision, retrievedAt: now, sourceLabel, observations };
}

async function searxngAdapter(input, context, now, config, client, repository, signal) {
  const task = currentTask(repository, context), query = SearchIntent.publicSearchQuery(task, input);
  const response = await client.getJson(config.baseUrl, "searxng", "search", {
    q: query, format: "json", categories: "general", language: "zh-CN", safesearch: 1, pageno: 1
  }, signal, config.apiKey || "");
  currentTask(repository, context);
  return searchResult(input, context, now, response, query, "searxng", "SearXNG 网页检索（摘要待人工核实）");
}

function amapResponse(response, label) {
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error(`高德${label}响应格式无效。`);
  if (String(response.status) !== "1") {
    const info = String(response.info || "服务返回失败").trim().slice(0, 120), code = String(response.infocode || "未知代码").trim().slice(0, 40);
    throw new Error(`高德${label}失败：${info}（${code}）。`);
  }
  return response;
}
function coordinate(value, label) {
  const match = String(value || "").trim().match(/^(-?\d{1,3}(?:\.\d{1,6})?),(-?\d{1,2}(?:\.\d{1,6})?)$/);
  if (!match) throw new Error(`高德${label}没有返回有效坐标。`);
  const longitude = Number(match[1]), latitude = Number(match[2]);
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new Error(`高德${label}坐标超出范围。`);
  return { location: `${longitude},${latitude}`, longitude, latitude };
}
function abortableDelay(ms, signal) {
  if (signal?.aborted) return Promise.reject(new DOMException("基础工具调用已取消。", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() { signal?.removeEventListener("abort", cancelled); resolve(); }
    function cancelled() { clearTimeout(timer); signal?.removeEventListener("abort", cancelled); reject(new DOMException("基础工具调用已取消。", "AbortError")); }
    signal?.addEventListener("abort", cancelled, { once: true });
  });
}
async function amapGet(client, route, parameters, key, signal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await client.getJson(AMAP_BASE_URL, "amap", route, { ...parameters, output: "JSON", key }, signal);
    if (String(response?.status) === "1" || !AMAP_TRANSIENT_CODES.has(String(response?.infocode || "")) || attempt === 2) return response;
    await abortableDelay(1100 * (attempt + 1), signal);
  }
  throw new Error("高德服务重试未完成。");
}
async function amapDistrict(client, keyword, key, signal) {
  const response = amapResponse(await amapGet(client, "v3/config/district", { keywords: keyword, subdistrict: 0, extensions: "base" }, key, signal), "行政区域查询");
  const row = Array.isArray(response.districts) ? response.districts[0] : null, adcode = String(row?.adcode || ""), citycode = Array.isArray(row?.citycode) ? "" : String(row?.citycode || "");
  if (!row || !/^\d{6}$/.test(adcode)) throw new Error("高德没有找到可用于天气查询的行政区域，请使用明确的城市或区县名称。");
  return { name: String(row.name || keyword).slice(0, 100), adcode, citycode, ...coordinate(row.center, "行政区域查询") };
}
function addressFor(task, value) {
  const text = String(value || "").trim(), resource = task.resources.find(item => item.name === text || item.id === text);
  const detail = resource ? `${resource.location || ""} ${resource.name}`.trim() : text;
  return `${task.request.destination} ${detail}`.trim().slice(0, 300);
}
async function amapGeocode(client, task, value, key, signal) {
  const address = addressFor(task, value), city = String(task.request.destination || "").trim();
  try {
    const response = amapResponse(await amapGet(client, "v3/geocode/geo", { address, city }, key, signal), "地理编码");
    const row = Array.isArray(response.geocodes) ? response.geocodes[0] : null;
    if (row) {
      const citycode = Array.isArray(row.citycode) ? "" : String(row.citycode || ""), adcode = String(row.adcode || "");
      return { query: address, formattedAddress: String(row.formatted_address || address).slice(0, 300), adcode, citycode, level: String(row.level || "").slice(0, 40), ...coordinate(row.location, "地理编码") };
    }
  } catch (error) {
    // 景区、车站、酒店等名称并不是标准门牌地址，高德地理编码有时会以
    // 30001 拒绝；只对这一类数据错误退回官方 POI 文本搜索。
    if (!String(error.message).includes("（30001）")) throw error;
  }
  const poiResponse = amapResponse(await amapGet(client, "v3/place/text", {
    keywords: String(value).trim(), city, citylimit: city ? "true" : "false", offset: 1, page: 1, extensions: "base"
  }, key, signal), "地点搜索");
  const poi = Array.isArray(poiResponse.pois) ? poiResponse.pois[0] : null;
  if (!poi) throw new Error(`高德没有找到“${String(value).slice(0, 80)}”的坐标，请补充更详细的地址或地点名称。`);
  const citycode = Array.isArray(poi.citycode) ? "" : String(poi.citycode || ""), adcode = String(poi.adcode || "");
  const parts = [poi.pname, poi.cityname, poi.adname, poi.address, poi.name].filter(item => typeof item === "string" && item.trim());
  return { query: address, formattedAddress: parts.join("").slice(0, 300) || address, adcode, citycode, level: String(poi.type || "POI").slice(0, 80), ...coordinate(poi.location, "地点搜索") };
}
function boundedPolyline(value, target) {
  for (const pair of String(value || "").split(";").slice(0, 300)) {
    if (target.length >= 300) break;
    try { const point = coordinate(pair, "路线"); target.push([point.longitude, point.latitude]); } catch {}
  }
}
function routeGeometry(value) {
  const points = [];
  const visit = (node, depth = 0) => {
    if (depth > 7 || points.length >= 300 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.slice(0, 100).forEach(item => visit(item, depth + 1));
    for (const [key, child] of Object.entries(node)) {
      if (key === "polyline" && typeof child === "string") boundedPolyline(child, points);
      else if (child && typeof child === "object") visit(child, depth + 1);
      if (points.length >= 300) break;
    }
  };
  visit(value);
  return points.length ? { type: "LineString", coordinates: points } : null;
}
function positiveNumber(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
function nestedDuration(value) {
  let seconds = 0;
  const visit = (node, depth = 0) => {
    if (depth > 7 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.slice(0, 100).forEach(item => visit(item, depth + 1));
    for (const [key, child] of Object.entries(node)) {
      if (key === "walking" && child && typeof child === "object") seconds += positiveNumber(child.duration ?? child.cost?.duration) || 0;
      else if (child && typeof child === "object") visit(child, depth + 1);
    }
  };
  visit(value);
  return seconds;
}
async function amapWeatherAdapter(input, context, now, config, client, repository, signal) {
  currentTask(repository, context);
  if (!config.apiKey) throw new Error("请先填写高德 Web 服务 API Key。");
  const district = await amapDistrict(client, input.location, config.apiKey, signal);
  const response = amapResponse(await amapGet(client, "v3/weather/weatherInfo", { city: district.adcode, extensions: "all" }, config.apiKey, signal), "天气查询");
  currentTask(repository, context);
  const forecast = Array.isArray(response.forecasts) ? response.forecasts[0] : null, casts = Array.isArray(forecast?.casts) ? forecast.casts : [], cast = casts.find(row => row?.date === input.date);
  if (!cast) {
    const covered = casts.map(row => row?.date).filter(Boolean).join("、") || "无";
    throw new Error(`高德常规天气接口未覆盖 ${input.date}；当前返回日期：${covered}。请改查临近日期或人工核实。`);
  }
  const condition = `${input.date} 白天${cast.dayweather || "未知"}，${cast.daytemp || "?"}℃；夜间${cast.nightweather || "未知"}，${cast.nighttemp || "?"}℃；白天${cast.daywind || "未知"}风 ${cast.daypower || "?"}级。`;
  return { provider: "amap", simulation: false, candidate: true, taskId: context.taskId, taskHash: context.taskHash, revision: context.revision,
    observationId: `AMAP-WEATHER-${hash([context, district.adcode, input.date, condition]).slice(0, 20)}`, title: `${district.name} ${input.date} 天气预报`, summary: `${condition} 高德报告时间：${forecast?.reporttime || "未提供"}。`, condition,
    location: district.name, date: input.date, retrievedAt: now, validUntil: input.date, sourceLabel: "高德开放平台天气服务（实时返回，待人工核实）", sourceUrl: AMAP_SOURCES.weather, url: AMAP_SOURCES.weather };
}
async function amapRouteAdapter(input, context, now, config, client, repository, signal) {
  const task = currentTask(repository, context);
  if (!config.apiKey) throw new Error("请先填写高德 Web 服务 API Key。");
  // Basic AMap keys can have a low per-interface QPS quota. Resolve the two
  // endpoints serially; amapGet also performs bounded backoff for transient
  // QPS responses instead of making a valid key appear unusable.
  const origin = await amapGeocode(client, task, input.origin, config.apiKey, signal);
  const destination = await amapGeocode(client, task, input.destination, config.apiKey, signal);
  const route = input.mode === "transit" ? "v5/direction/transit/integrated" : `v5/direction/${input.mode}`;
  const parameters = { origin: origin.location, destination: destination.location, show_fields: "cost,navi,polyline" };
  if (input.mode === "driving") parameters.strategy = 32;
  if (input.mode === "transit") {
    let fallbackCity = "";
    if ((!origin.citycode && !origin.adcode) || (!destination.citycode && !destination.adcode)) {
      const district = await amapDistrict(client, task.request.destination, config.apiKey, signal);
      fallbackCity = district.citycode || district.adcode;
    }
    const city1 = origin.citycode || origin.adcode || fallbackCity, city2 = destination.citycode || destination.adcode || fallbackCity;
    if (!city1 || !city2) throw new Error("高德公交路线需要起终点城市编码；请补充更明确的城市与详细位置。");
    parameters.city1 = city1; parameters.city2 = city2; parameters.strategy = 0;
  }
  const response = amapResponse(await amapGet(client, route, parameters, config.apiKey, signal), "路线规划");
  currentTask(repository, context);
  const choices = input.mode === "transit" ? response.route?.transits : response.route?.paths, selected = Array.isArray(choices) ? choices[0] : null;
  if (!selected) throw new Error("高德没有返回可用路线，请检查地点名称或出行方式。");
  const durationSeconds = positiveNumber(selected.cost?.duration ?? selected.duration), distanceMeters = positiveNumber(selected.distance), durationMinutes = durationSeconds === null ? null : Math.ceil(durationSeconds / 60);
  const walkingSeconds = input.mode === "walking" ? durationSeconds : input.mode === "transit" ? nestedDuration(selected) : 0;
  return { provider: "amap", simulation: false, candidate: true, taskId: context.taskId, taskHash: context.taskHash, revision: context.revision,
    observationId: `AMAP-ROUTE-${hash([context, input, origin.location, destination.location, distanceMeters, durationSeconds]).slice(0, 20)}`,
    origin: input.origin, destination: input.destination, mode: input.mode, originCoordinate: origin.location, destinationCoordinate: destination.location,
    distanceMeters, durationMinutes, walkingMinutes: walkingSeconds === null ? null : Math.ceil(walkingSeconds / 60), estimatedCost: positiveNumber(selected.cost?.transit_fee ?? selected.cost?.tolls), geometry: routeGeometry(selected),
    retrievedAt: now, sourceLabel: "高德开放平台路径规划（实时返回，待人工确认）", sourceUrl: AMAP_SOURCES.route, note: "路线结果不会自动覆盖任务中的交通分钟、费用或步行值。" };
}
async function amapMapAdapter(input, context, now, config, client, repository, signal) {
  const task = currentTask(repository, context);
  if (!config.apiKey) throw new Error("请先填写高德 Web 服务 API Key。");
  const resources = input.resourceIds.map(id => task.resources.find(item => item.id === id));
  if (resources.some(item => !item)) throw new Error("地图核对包含不属于当前任务的资源。");
  const points = [];
  for (const resource of resources) {
    const point = await amapGeocode(client, task, resource.id, config.apiKey, signal);
    points.push({ resourceId: resource.id, name: resource.name, address: point.formattedAddress, longitude: point.longitude, latitude: point.latitude, adcode: point.adcode, level: point.level });
  }
  currentTask(repository, context);
  return { provider: "amap", simulation: false, candidate: true, taskId: context.taskId, taskHash: context.taskHash, revision: context.revision,
    observationId: `AMAP-MAP-${hash([context, points]).slice(0, 20)}`, resourceIds: input.resourceIds, points, geometry: { type: "MultiPoint", coordinates: points.map(item => [item.longitude, item.latitude]) },
    retrievedAt: now, sourceLabel: "高德开放平台地理编码（实时返回，待人工确认）", sourceUrl: AMAP_SOURCES.geocode, note: "已解析真实坐标；当前不加载第三方地图底图，也不会自动改写资源。" };
}
function amapAdapter(capability, input, context, now, config, client, repository, signal) {
  if (capability === "weather") return amapWeatherAdapter(input, context, now, config, client, repository, signal);
  if (capability === "route") return amapRouteAdapter(input, context, now, config, client, repository, signal);
  if (capability === "map") return amapMapAdapter(input, context, now, config, client, repository, signal);
  throw new Error("高德地图适配器不支持该能力。");
}

function shanghaiDate(now) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function cleanAgentInput(capability, raw, now) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("高德工具参数无效。");
  if (capability === "weather") {
    const date = raw.date == null || String(raw.date).trim() === "" ? shanghaiDate(now) : cleanText(raw.date, "天气日期", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("天气日期必须为 YYYY-MM-DD。");
    return { location: cleanText(raw.location, "天气地点", 120), date };
  }
  if (capability === "route") {
    const mode = String(raw.mode || "walking").trim().toLowerCase();
    if (!["walking", "driving", "transit"].includes(mode)) throw new Error("路线方式仅支持 walking、driving 或 transit。");
    return { city: raw.city == null ? "" : cleanText(raw.city, "路线城市", 80), origin: cleanText(raw.origin, "路线起点", 160), destination: cleanText(raw.destination, "路线终点", 160), mode };
  }
  if (capability === "map") return { city: raw.city == null ? "" : cleanText(raw.city, "地点城市", 80), address: cleanText(raw.address, "地点名称或地址", 200) };
  throw new Error("Agent 只可调用高德天气、路线和地点坐标工具。");
}
async function amapAgentAdapter(capability, input, now, config, client, signal) {
  if (!config.apiKey) throw new Error("请先在“基础工具与联网服务”中填写高德 Web 服务 API Key。");
  if (capability === "weather") {
    const district = await amapDistrict(client, input.location, config.apiKey, signal);
    const response = amapResponse(await amapGet(client, "v3/weather/weatherInfo", { city: district.adcode, extensions: "all" }, config.apiKey, signal), "天气查询");
    const forecast = Array.isArray(response.forecasts) ? response.forecasts[0] : null, casts = Array.isArray(forecast?.casts) ? forecast.casts : [], cast = casts.find(row => row?.date === input.date);
    if (!cast) throw new Error(`高德常规天气接口未覆盖 ${input.date}；当前返回日期：${casts.map(row => row?.date).filter(Boolean).join("、") || "无"}。`);
    return { provider: "amap", simulation: false, capability, location: district.name, date: input.date,
      condition: `${input.date} 白天${cast.dayweather || "未知"}，${cast.daytemp || "?"}℃；夜间${cast.nightweather || "未知"}，${cast.nighttemp || "?"}℃；白天${cast.daywind || "未知"}风 ${cast.daypower || "?"}级。`,
      reportTime: String(forecast?.reporttime || ""), retrievedAt: now, sourceLabel: "高德开放平台天气服务（实时返回，待人工核实）", sourceUrl: AMAP_SOURCES.weather };
  }
  const task = { request: { destination: input.city }, resources: [] };
  if (capability === "map") {
    const point = await amapGeocode(client, task, input.address, config.apiKey, signal);
    return { provider: "amap", simulation: false, capability, query: point.query, formattedAddress: point.formattedAddress,
      longitude: point.longitude, latitude: point.latitude, adcode: point.adcode, level: point.level, retrievedAt: now,
      sourceLabel: "高德开放平台地理编码（实时返回，待人工确认）", sourceUrl: AMAP_SOURCES.geocode };
  }
  const origin = await amapGeocode(client, task, input.origin, config.apiKey, signal), destination = await amapGeocode(client, task, input.destination, config.apiKey, signal);
  const route = input.mode === "transit" ? "v5/direction/transit/integrated" : `v5/direction/${input.mode}`;
  const parameters = { origin: origin.location, destination: destination.location, show_fields: "cost,navi,polyline" };
  if (input.mode === "driving") parameters.strategy = 32;
  if (input.mode === "transit") {
    let fallbackCity = "";
    if (((!origin.citycode && !origin.adcode) || (!destination.citycode && !destination.adcode)) && input.city) {
      const district = await amapDistrict(client, input.city, config.apiKey, signal);
      fallbackCity = district.citycode || district.adcode;
    }
    const city1 = origin.citycode || origin.adcode || fallbackCity, city2 = destination.citycode || destination.adcode || fallbackCity;
    if (!city1 || !city2) throw new Error("高德公交路线需要明确城市，请补充起终点所在城市。");
    parameters.city1 = city1; parameters.city2 = city2; parameters.strategy = 0;
  }
  const response = amapResponse(await amapGet(client, route, parameters, config.apiKey, signal), "路线规划");
  const choices = input.mode === "transit" ? response.route?.transits : response.route?.paths, selected = Array.isArray(choices) ? choices[0] : null;
  if (!selected) throw new Error("高德没有返回可用路线，请补充更明确的起点和终点。");
  const durationSeconds = positiveNumber(selected.cost?.duration ?? selected.duration), distanceMeters = positiveNumber(selected.distance);
  return { provider: "amap", simulation: false, capability, mode: input.mode, origin: input.origin, destination: input.destination,
    originAddress: origin.formattedAddress, destinationAddress: destination.formattedAddress, originCoordinate: origin.location, destinationCoordinate: destination.location,
    distanceMeters, durationMinutes: durationSeconds === null ? null : Math.ceil(durationSeconds / 60), walkingMinutes: input.mode === "walking" && durationSeconds !== null ? Math.ceil(durationSeconds / 60) : input.mode === "transit" ? Math.ceil(nestedDuration(selected) / 60) : 0,
    estimatedCost: positiveNumber(selected.cost?.transit_fee ?? selected.cost?.tolls), hasGeometry: Boolean(routeGeometry(selected)), retrievedAt: now,
    sourceLabel: "高德开放平台路径规划（实时返回，待人工确认）", sourceUrl: AMAP_SOURCES.route };
}

async function connectionProbe(capability, item, client, now, signal) {
  if (item.provider === "amap") {
    if (!item.apiKey) throw new Error("请先填写高德 Web 服务 API Key。");
    // Fixed public examples keep connection tests independent from fictional
    // training tasks and verify the exact API used by each capability.
    if (capability === "weather") {
      const response = amapResponse(await amapGet(client, "v3/weather/weatherInfo", { city: "330100", extensions: "base" }, item.apiKey, signal), "天气连通性测试");
      const live = Array.isArray(response.lives) ? response.lives[0] : null;
      if (!live) throw new Error("高德天气接口已响应，但未返回杭州市实时天气数据。");
      return {
        connected: true, provider: "amap", capability, service: "高德 Web 服务天气接口",
        testCase: "杭州市（行政区划编码 330100）", checkedAt: now,
        responseSummary: `${live.province || "浙江省"}${live.city || "杭州市"}：${live.weather || "天气状态已返回"}${live.temperature ? `，${live.temperature}℃` : ""}`
      };
    }
    if (capability === "map") {
      const response = amapResponse(await amapGet(client, "v3/geocode/geo", { address: "杭州西湖风景名胜区", city: "杭州" }, item.apiKey, signal), "地理编码连通性测试");
      const row = Array.isArray(response.geocodes) ? response.geocodes[0] : null;
      if (!row) throw new Error("高德地理编码接口已响应，但未返回测试地点坐标。");
      const point = coordinate(row.location, "地理编码测试");
      return {
        connected: true, provider: "amap", capability, service: "高德 Web 服务地理编码接口",
        testCase: "杭州西湖风景名胜区", checkedAt: now,
        responseSummary: `已解析：${String(row.formatted_address || "杭州西湖风景名胜区").slice(0, 120)}（${point.location}）`
      };
    }
    if (capability === "route") {
      const origin = "120.155070,30.274085", destination = "120.148820,30.242780";
      const response = amapResponse(await amapGet(client, "v5/direction/walking", { origin, destination, show_fields: "cost,navi,polyline" }, item.apiKey, signal), "步行路线连通性测试");
      const path = Array.isArray(response.route?.paths) ? response.route.paths[0] : null;
      if (!path) throw new Error("高德步行路线接口已响应，但未返回可用路线。");
      const distance = positiveNumber(path.distance), duration = positiveNumber(path.cost?.duration ?? path.duration);
      if (distance === null || duration === null) throw new Error("高德步行路线接口返回的数据不完整。");
      return {
        connected: true, provider: "amap", capability, service: "高德 Web 服务步行路线接口",
        testCase: "杭州市中心固定公开坐标步行路线", checkedAt: now,
        responseSummary: `已返回路线：约 ${Math.round(distance)} 米，${Math.ceil(duration / 60)} 分钟。`
      };
    }
    throw new Error("高德 Web 服务不支持当前能力的连通性测试。");
  }
  if (item.provider === "searxng" && capability === "search") {
    const response = await client.getJson(item.baseUrl, "searxng", "search", {
      q: "杭州 文旅", format: "json", categories: "general", language: "zh-CN", safesearch: 1, pageno: 1
    }, signal, item.apiKey || "");
    if (!response || !Array.isArray(response.results)) throw new Error("SearXNG 未返回标准 JSON 搜索结果；请确认服务开启 JSON 输出并检查地址。");
    return {
      connected: true, provider: "searxng", capability, service: "SearXNG JSON 搜索接口",
      testCase: "公开测试检索：杭州 文旅", checkedAt: now, resultCount: response.results.length,
      responseSummary: `已返回 ${response.results.length} 条结果；实际业务检索仍须在对话中确认主题。`
    };
  }
  throw new Error("当前适配器暂不支持在此进行连通性测试。");
}

class TravelToolBroker {
  constructor(options = {}) {
    this.home = options.home;
    this.clock = options.clock || (() => new Date());
    this.adapters = { mock: options.mockAdapter || mockAdapter };
    this.httpClient = options.httpClient || new SafeToolHttpClient();
    this.tasks = options.tasks || new TaskRepository(options);
    this.timeoutMs = Math.min(15000, Math.max(10, Number(options.timeoutMs) || 15000));
    this.cache = new Map();
    this.usage = new Map();
    this.controllers = new Map();
    this.active = 0;
  }
  status() { return ToolConfig.status(this.home); }
  saveConfig(input) { const saved = ToolConfig.save(input, this.home); this.cache.clear(); return saved; }
  audit(entry) {
    const target = toolDataPaths(this.home).audit;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try { if (fs.statSync(target).size > MAX_AUDIT_BYTES) fs.renameSync(target, `${target}.${Date.now()}.previous`); } catch {}
    fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  consumeRemoteQuota(context, capability, provider, limit) {
    const file = toolDataPaths(this.home).usage, lock = `${file}.lock`, quotaKey = hash([context, capability, provider]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let handle;
    try { handle = fs.openSync(lock, "wx", 0o600); } catch { throw new Error("另一个 Agent 正在核对联网调用上限，请稍后再试。"); }
    try {
      let data = { formatVersion: 1, counts: {} };
      if (fs.existsSync(file)) {
        if (fs.statSync(file).size > 256 * 1024) throw new Error("联网用量记录超过大小上限，请人工检查。");
        try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("联网用量记录损坏，已停止外部调用。"); }
      }
      if (data.formatVersion !== 1 || !data.counts || typeof data.counts !== "object" || Array.isArray(data.counts)) throw new Error("联网用量记录格式无效，已停止外部调用。");
      const used = data.counts[quotaKey] || 0;
      if (!Number.isInteger(used) || used < 0) throw new Error("联网用量记录无效，已停止外部调用。");
      if (used >= limit) throw new Error(`${ToolConfig.CAPABILITIES[capability].label}已达到当前任务版本的 ${limit} 次上限。`);
      data.counts[quotaKey] = used + 1;
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
      try { fs.writeFileSync(temporary, `${JSON.stringify(data)}\n`, { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, file); }
      finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
    } finally { fs.closeSync(handle); fs.rmSync(lock, { force: true }); }
  }
  cancel(requestId) {
    const controller = this.controllers.get(String(requestId || ""));
    if (!controller) return { cancelled: false };
    controller.abort();
    return { cancelled: true };
  }
  async testConnection(request, externalSignal) {
    const capability = String(request?.capability || "").toLowerCase();
    if (!ToolConfig.CAPABILITIES[capability]) throw new Error("基础工具能力不在白名单中。");
    const config = ToolConfig.read(this.home), item = config.capabilities[capability];
    if (!item.enabled) throw new Error(`${ToolConfig.CAPABILITIES[capability].label}尚未启用。`);
    if (!(item.provider === "amap" || (item.provider === "searxng" && capability === "search"))) throw new Error("请选择高德 Web 服务或 SearXNG 后再测试连通性。");
    if (this.active >= MAX_CONCURRENCY) throw new Error("基础工具并发已达到上限，请等待当前调用完成。");
    const requestId = String(request.requestId || crypto.randomUUID());
    if (requestId.length > 100 || this.controllers.has(requestId)) throw new Error("基础工具请求标识无效或重复。");
    const controller = new AbortController(), timeout = AbortSignal.timeout(this.timeoutMs), signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal, timeout]) : AbortSignal.any([controller.signal, timeout]);
    const now = new Date(this.clock().getTime()).toISOString();
    this.controllers.set(requestId, controller); this.active++;
    const auditBase = { time: now, purpose: "connection-test", requestIdHash: hash(requestId).slice(0, 16), capability, provider: item.provider };
    try {
      const result = await Promise.race([connectionProbe(capability, item, this.httpClient, now, signal), new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("基础工具调用已取消或超时。", "AbortError")), { once: true }))]);
      if (signal.aborted) throw new DOMException("基础工具调用已取消。", "AbortError");
      this.audit({ ...auditBase, status: "connected" });
      return { requestId, capability, connected: true, result };
    } catch (error) {
      this.audit({ ...auditBase, status: error?.name === "AbortError" ? "cancelled" : "failed" });
      throw new Error(error?.name === "AbortError" ? (timeout.aborted ? "基础工具连接测试已超时。" : "基础工具连接测试已取消。") : error.message);
    } finally { this.controllers.delete(requestId); this.active--; }
  }
  async agentQuery(request, externalSignal) {
    const capability = String(request?.capability || "").toLowerCase();
    if (!["weather", "route", "map"].includes(capability)) throw new Error("Agent 只可调用高德天气、路线和地点坐标工具。");
    const config = ToolConfig.read(this.home), item = config.capabilities[capability];
    if (!item.enabled || item.provider !== "amap" || !item.apiKey) throw new Error(`${ToolConfig.CAPABILITIES[capability].label}尚未接入高德 Web 服务。`);
    if (this.active >= MAX_CONCURRENCY) throw new Error("基础工具并发已达到上限，请等待当前调用完成。");
    const requestId = String(request.requestId || crypto.randomUUID());
    if (requestId.length > 100 || this.controllers.has(requestId)) throw new Error("基础工具请求标识无效或重复。");
    const controller = new AbortController(), timeout = AbortSignal.timeout(this.timeoutMs), signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal, timeout]) : AbortSignal.any([controller.signal, timeout]);
    const instant = new Date(this.clock().getTime()), now = instant.toISOString(), input = cleanAgentInput(capability, request.input, instant);
    this.controllers.set(requestId, controller); this.active++;
    const auditBase = { time: now, purpose: "agent-readonly-query", requestIdHash: hash(requestId).slice(0, 16), capability, provider: "amap", requestHash: hash(input).slice(0, 16) };
    try {
      const result = await Promise.race([amapAgentAdapter(capability, input, now, item, this.httpClient, signal), new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("基础工具调用已取消或超时。", "AbortError")), { once: true }))]);
      if (signal.aborted) throw new DOMException("基础工具调用已取消。", "AbortError");
      this.audit({ ...auditBase, status: "returned", simulation: false });
      return { requestId, capability, connected: true, requiresReview: true, result };
    } catch (error) {
      this.audit({ ...auditBase, status: error?.name === "AbortError" ? "cancelled" : "failed", simulation: false });
      throw new Error(error?.name === "AbortError" ? (timeout.aborted ? "高德工具调用已超时。" : "高德工具调用已取消。") : error.message);
    } finally { this.controllers.delete(requestId); this.active--; }
  }
  close() { for (const controller of this.controllers.values()) controller.abort(); this.controllers.clear(); this.cache.clear(); }
  async execute(request, externalSignal) {
    const capability = String(request?.capability || "").toLowerCase();
    if (!ToolConfig.CAPABILITIES[capability]) throw new Error("基础工具能力不在白名单中。");
    const context = cleanContext(request.context), input = cleanInput(capability, request.input), config = ToolConfig.read(this.home), item = config.capabilities[capability];
    if (!item.enabled) throw new Error(`${ToolConfig.CAPABILITIES[capability].label}尚未启用。`);
    if (item.provider !== "mock" && !(capability === "search" && isRealSearchProvider(item.provider)) && !(item.provider === "amap" && ["weather", "route", "map"].includes(capability))) throw new Error("该能力的远程适配器尚未实现。");
    if (isRealSearchProvider(item.provider) && input.theme === undefined) throw new Error("真实搜索只接受结构化检索主题，不接受任意查询文本。");
    if (item.provider === "amap" && !item.apiKey) throw new Error("请先填写高德 Web 服务 API Key。");
    const requestId = String(request.requestId || crypto.randomUUID());
    if (requestId.length > 100 || this.controllers.has(requestId)) throw new Error("基础工具请求标识无效或重复。");
    const key = hash({ capability, input, context, provider: item.provider, baseUrl: item.baseUrl }), cached = this.cache.get(key), nowMs = this.clock().getTime();
    if (cached && nowMs - cached.time <= CACHE_TTL_MS) {
      if (isLiveProvider(item.provider)) currentTask(this.tasks, context);
      return { ...structuredClone(cached.value), requestId, cacheHit: true };
    }
    const usageKey = `${context.taskId}:${context.revision}:${capability}`, used = this.usage.get(usageKey) || 0, limit = ToolConfig.CAPABILITIES[capability].maxRequests;
    if (used >= limit) throw new Error(`${ToolConfig.CAPABILITIES[capability].label}已达到当前任务版本的 ${limit} 次上限。`);
    if (this.active >= MAX_CONCURRENCY) throw new Error("基础工具并发已达到上限，请等待当前调用完成。");
    if (isLiveProvider(item.provider)) {
      currentTask(this.tasks, context);
      if (isRealSearchProvider(item.provider)) SearchIntent.publicSearchQuery(currentTask(this.tasks, context), input);
      this.consumeRemoteQuota(context, capability, item.provider, limit);
    }
    const controller = new AbortController(), timeout = AbortSignal.timeout(this.timeoutMs), signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal, timeout]) : AbortSignal.any([controller.signal, timeout]);
    this.controllers.set(requestId, controller); this.active++; this.usage.set(usageKey, used + 1);
    const auditBase = { time: new Date(nowMs).toISOString(), requestIdHash: hash(requestId).slice(0, 16), capability, provider: item.provider, taskHashPrefix: context.taskHash.slice(0, 12), revision: context.revision, requestHash: key.slice(0, 16) };
    try {
      if (signal.aborted) throw new DOMException("基础工具调用已取消。", "AbortError");
      const adapter = item.provider === "tavily" ? tavilyAdapter(input, context, new Date(nowMs).toISOString(), item, this.httpClient, this.tasks, signal) : item.provider === "searxng" ? searxngAdapter(input, context, new Date(nowMs).toISOString(), item, this.httpClient, this.tasks, signal) : item.provider === "amap" ? amapAdapter(capability, input, context, new Date(nowMs).toISOString(), item, this.httpClient, this.tasks, signal) : this.adapters.mock(capability, input, context, new Date(nowMs).toISOString(), signal);
      const value = await Promise.race([adapter, new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("基础工具调用已取消或超时。", "AbortError")), { once: true }))]);
      if (signal.aborted) throw new DOMException("基础工具调用已取消。", "AbortError");
      const result = { requestId, capability, cacheHit: false, requiresReview: true, result: value };
      this.cache.set(key, { time: nowMs, value: result });
      this.audit({ ...auditBase, status: "candidate", simulation: value.simulation === true });
      return structuredClone(result);
    } catch (error) {
      this.audit({ ...auditBase, status: error?.name === "AbortError" ? "cancelled" : "failed", simulation: item.provider === "mock" });
      throw new Error(error?.name === "AbortError" ? (timeout.aborted ? "基础工具调用已超时。" : "基础工具调用已取消。") : error.message);
    } finally { this.controllers.delete(requestId); this.active--; }
  }
}

class TravelToolService {
  constructor(options = {}) { this.broker = options.broker || new TravelToolBroker(options); this.observations = options.observations || new ObservationRepository(options); this.tasks = options.tasks || new TaskRepository(options); }
  async run(request) {
    if (request?.action === "status") return this.broker.status();
    if (request?.action === "save") return this.broker.saveConfig(request);
    if (request?.action === "test_connection") return this.broker.testConnection(request);
    if (request?.action === "agent_query") return this.broker.agentQuery(request);
    if (request?.action === "execute") { const result = await this.broker.execute(request); return { ...result, candidates: this.observations.capture(result) }; }
    if (request?.action === "cancel") return this.broker.cancel(request.requestId);
    if (request?.action === "list_candidates") return { candidates: this.observations.list(request.context) };
    if (request?.action === "dismiss_candidate") return { candidate: this.observations.dismiss(request.candidateId, request.context) };
    if (request?.action === "adopt_candidate") {
      const current = this.tasks.load();
      if (!current) throw new Error("请先保存当前任务，再采纳候选资料。");
      const context = cleanContext(request.context);
      if (current.task.taskId !== context.taskId || current.task.revision !== context.revision || current.taskHash !== context.taskHash) throw new Error("已保存任务版本已变化，请重新载入候选资料。");
      const prepared = this.observations.prepareAdoption(request.candidateId, context, current.task, request.resourceId ?? null);
      const record = this.tasks.save({ task: prepared.task, evaluation: null, selectedPlanId: current.selectedPlanId, pendingProposal: null, baseStoredTaskHash: current.taskHash });
      this.observations.commitAdoption(request.candidateId, context, record.taskHash);
      return { record, fact: prepared.fact };
    }
    throw new Error("不支持的基础工具操作。");
  }
  close() { this.broker.close(); }
}

module.exports = { TravelToolBroker, TravelToolService, cleanContext, cleanInput, cleanAgentInput, mockAdapter, CACHE_TTL_MS, MAX_CONCURRENCY };
