"use strict";
const fs = require("node:fs"), path = require("node:path");
const { toolDataPaths } = require("../platform/tool-config-paths.cjs");

const FORMAT_VERSION = 1;
const CAPABILITIES = Object.freeze({
  search: { label: "联网搜索", maxRequests: 3 },
  weather: { label: "天气查询", maxRequests: 1 },
  route: { label: "路线规划", maxRequests: 12 },
  map: { label: "地理地图", maxRequests: 1 }
});
const PROVIDERS = Object.freeze({
  mock: { label: "本地模拟适配器", mode: "simulation" },
  tavily: { label: "Tavily 网页搜索（自备密钥）", mode: "remote" },
  searxng: { label: "SearXNG 搜索（局域网或 HTTPS 域名）", mode: "remote" },
  amap: { label: "高德地图 Web 服务（自备 Key）", mode: "remote" },
  custom: { label: "自定义远程服务（预配置）", mode: "remote" },
  selfhost: { label: "本机自托管服务（预配置）", mode: "local" }
});

function isLoopback(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("127.");
}

function isPrivateLiteral(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopback(host)) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return host === "0.0.0.0" || host === "::" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd");
}

function isAllowedSearxngLanLiteral(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopback(host)) return true;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.split(".").some(part => Number(part) > 255)) return false;
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function safeEndpoint(value, provider) {
  if (provider === "mock") return null;
  if (provider === "tavily") {
    if (value && String(value).trim().replace(/\/+$/, "") !== "https://api.tavily.com") throw new Error("Tavily 仅允许官方 API 地址。");
    return "https://api.tavily.com";
  }
  if (provider === "amap") {
    if (value && String(value).trim().replace(/\/+$/, "") !== "https://restapi.amap.com") throw new Error("高德地图仅允许官方 Web 服务地址。");
    return "https://restapi.amap.com";
  }
  if (provider === "searxng" && !String(value || "").trim()) throw new Error("请填写 SearXNG 服务地址，例如 http://192.168.6.162:8888。");
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw new Error("工具服务地址无效。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("工具地址应为无凭据、无查询参数的 HTTP(S) Base URL。");
  if (provider === "selfhost") {
    if (!isLoopback(url.hostname)) throw new Error("本机自托管工具只允许回环地址。");
  } else if (provider === "searxng") {
    const lanLiteral = isAllowedSearxngLanLiteral(url.hostname);
    if (url.protocol === "http:" && !lanLiteral) throw new Error("SearXNG 的 HTTP 地址只允许明确的局域网 IPv4 或回环地址；公网域名必须使用 HTTPS。");
    if (url.protocol === "https:" && isPrivateLiteral(url.hostname) && !lanLiteral) throw new Error("SearXNG 地址不是允许的局域网 IP 或公网域名。");
  } else {
    if (url.protocol !== "https:") throw new Error("远程工具服务必须使用 HTTPS。");
    if (isPrivateLiteral(url.hostname)) throw new Error("远程工具服务不能指向本机或私网地址。");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href.replace(/\/$/, "");
}

function defaults() {
  return { formatVersion: FORMAT_VERSION, capabilities: Object.fromEntries(Object.keys(CAPABILITIES).map(id => [id, { enabled: false, provider: "mock", baseUrl: null }])) };
}

function validate(input, previous = defaults()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("基础工具配置无效。");
  const source = input.capabilities && typeof input.capabilities === "object" ? input.capabilities : input;
  const next = defaults();
  for (const id of Object.keys(CAPABILITIES)) {
    const raw = source[id] ?? previous.capabilities?.[id] ?? {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${CAPABILITIES[id].label}配置无效。`);
    const provider = String(raw.provider || "mock").toLowerCase();
    if (!PROVIDERS[provider]) throw new Error(`${CAPABILITIES[id].label}服务商不受支持。`);
    if (["tavily", "searxng"].includes(provider) && id !== "search") throw new Error(`${PROVIDERS[provider].label}仅支持联网搜索。`);
    if (provider === "amap" && !["weather", "route", "map"].includes(id)) throw new Error("高德地图适配器仅支持天气、路线和地理坐标能力。");
    const apiKey = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
    if (apiKey.length > 4096 || /[\r\n]|\$\{/.test(apiKey)) throw new Error(`${CAPABILITIES[id].label}密钥格式无效。`);
    if (provider === "amap" && apiKey && !/^[A-Za-z0-9_-]{8,128}$/.test(apiKey)) throw new Error("高德 Web 服务 Key 格式无效。");
    const prior = previous.capabilities?.[id] || {};
    let baseUrl;
    try { baseUrl = safeEndpoint(raw.baseUrl, provider); }
    catch (error) { throw new Error(`${CAPABILITIES[id].label}：${error.message}`); }
    const item = { enabled: raw.enabled === true, provider, baseUrl };
    if (provider !== "mock") {
      if (apiKey) item.apiKey = apiKey;
      else if (raw.clearKey !== true && prior.provider === provider && typeof prior.apiKey === "string") item.apiKey = prior.apiKey;
    }
    next.capabilities[id] = item;
  }
  return next;
}

function read(home) {
  const file = toolDataPaths(home).config;
  if (!fs.existsSync(file)) return defaults();
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("基础工具配置文件损坏；为避免覆盖，当前保持只读。请备份后修复。 "); }
  if (raw.formatVersion !== FORMAT_VERSION) throw new Error("基础工具配置版本不受支持。");
  return validate(raw, defaults());
}

function status(home) {
  const config = read(home);
  const executable = (id, item) => item.provider === "mock" || (id === "search" && ((item.provider === "tavily" && Boolean(item.apiKey)) || (item.provider === "searxng" && Boolean(item.baseUrl)))) || (["weather", "route", "map"].includes(id) && item.provider === "amap" && Boolean(item.apiKey));
  return {
    formatVersion: FORMAT_VERSION,
    phase: "N4-amap-tools-opt-in",
    realNetworkEnabled: Object.entries(config.capabilities).some(([id, item]) => item.enabled && item.provider !== "mock" && executable(id, item)),
    capabilities: Object.fromEntries(Object.entries(config.capabilities).map(([id, item]) => [id, {
      label: CAPABILITIES[id].label,
      enabled: item.enabled,
      provider: item.provider,
      providerLabel: PROVIDERS[item.provider].label,
      baseUrl: item.baseUrl,
      hasApiKey: typeof item.apiKey === "string" && item.apiKey.length > 0,
      maxRequests: CAPABILITIES[id].maxRequests,
      executable: executable(id, item)
    }]))
  };
}

function save(input, home) {
  const paths = toolDataPaths(home), previous = read(home), config = validate(input, previous);
  fs.mkdirSync(paths.root, { recursive: true });
  const temporary = `${paths.config}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, paths.config);
  return status(home);
}

module.exports = { FORMAT_VERSION, CAPABILITIES, PROVIDERS, defaults, validate, read, status, save, safeEndpoint, isLoopback, isPrivateLiteral, isAllowedSearxngLanLiteral };
