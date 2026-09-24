"use strict";
const dns = require("node:dns"), net = require("node:net"), http = require("node:http"), https = require("node:https");
const ToolConfig = require("./tool-config.cjs");

const MAX_RESPONSE_BYTES = 1024 * 1024, DEFAULT_TIMEOUT_MS = 15000;
// Conservative subset of IANA special-purpose registries. Some blocks contain
// globally reachable exceptions; tool providers should use ordinary public IPs.
// https://www.iana.org/assignments/iana-ipv4-special-registry
// https://www.iana.org/assignments/iana-ipv6-special-registry
const blockedAddresses = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4]
]) blockedAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]
]) blockedAddresses.addSubnet(address, prefix, "ipv6");
function privateAddress(address) {
  const value = String(address || "").toLowerCase().replace(/^::ffff:/, "");
  if (net.isIPv4(value)) return blockedAddresses.check(value, "ipv4");
  if (net.isIPv6(value)) {
    const firstGroup = Number.parseInt(value.split(":", 1)[0], 16);
    return !(firstGroup >= 0x2000 && firstGroup <= 0x3fff) || blockedAddresses.check(value, "ipv6");
  }
  return true;
}

async function resolveEndpoint(url, provider, lookup = dns.promises.lookup) {
  if (provider === "selfhost") {
    if (!ToolConfig.isLoopback(url.hostname)) throw new Error("本机工具地址必须使用回环主机。");
    return [{ address: url.hostname === "[::1]" || url.hostname === "::1" ? "::1" : "127.0.0.1", family: url.hostname === "[::1]" || url.hostname === "::1" ? 6 : 4 }];
  }
  if (provider === "searxng" && ToolConfig.isAllowedSearxngLanLiteral(url.hostname)) {
    if (ToolConfig.isLoopback(url.hostname)) return [{ address: "127.0.0.1", family: 4 }];
    return [{ address: url.hostname, family: 4 }];
  }
  let addresses;
  try { addresses = await lookup(url.hostname, { all: true, verbatim: true }); } catch { throw new Error("工具服务域名解析失败。"); }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(item => !item || net.isIP(item.address) !== item.family || privateAddress(item.address))) throw new Error("工具服务域名解析到了本机、私网或非公网地址。");
  return addresses;
}

function pinnedLookup(hostname, address) {
  return (requestedHost, _options, callback) => {
    if (requestedHost !== hostname) return callback(new Error("工具连接主机与已核验域名不一致。"));
    if (_options?.all) callback(null, [{ address: address.address, family: address.family }]);
    else callback(null, address.address, address.family);
  };
}

function nativeTransport(target, body, signal, address, extraHeaders = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const client = target.protocol === "https:" ? https : http;
    const method = options.method === "GET" ? "GET" : "POST";
    const payloadHeaders = method === "POST" ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {};
    const request = client.request(target, {
      method, agent: false, signal,
      lookup: pinnedLookup(target.hostname, address),
      headers: { "Accept": "application/json", ...payloadHeaders, ...extraHeaders }
    }, incoming => resolve({
      status: incoming.statusCode,
      ok: incoming.statusCode >= 200 && incoming.statusCode < 300,
      headers: { get: name => incoming.headers[String(name).toLowerCase()] ?? null },
      body: {
        [Symbol.asyncIterator]: () => incoming[Symbol.asyncIterator](),
        cancel: () => { incoming.destroy(); return Promise.resolve(); }
      }
    }));
    request.once("error", reject);
    request.end(method === "POST" ? body : undefined);
  });
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function requestSignal(timeoutMs, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
  const abort = () => controller.abort(externalSignal.reason || new DOMException("Aborted", "AbortError"));
  if (externalSignal) {
    if (externalSignal.aborted) abort();
    else externalSignal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abort);
    }
  };
}

async function readLimitedJson(response, maxBytes = MAX_RESPONSE_BYTES) {
  const type = String(response.headers?.get?.("content-type") || "").toLowerCase();
  if (!type.startsWith("application/json")) throw new Error("工具服务响应类型必须是 application/json。");
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("工具服务响应超过大小上限。");
  const chunks = []; let total = 0;
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") throw new Error("工具服务响应正文不可读。");
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk); total += bytes.length;
    if (total > maxBytes) { await response.body.cancel?.().catch?.(() => {}); throw new Error("工具服务响应超过大小上限。"); }
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("工具服务响应不是有效 JSON。"); }
}

class SafeToolHttpClient {
  constructor(options = {}) { this.transport = options.transport || nativeTransport; this.lookup = options.lookup || dns.promises.lookup; this.maxBytes = options.maxBytes || MAX_RESPONSE_BYTES; this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS; }
  async postJson(baseUrl, provider, route, payload, externalSignal, authKey = "") {
    const safeBase = ToolConfig.safeEndpoint(baseUrl, provider), base = new URL(`${safeBase}/`), target = new URL(String(route || "").replace(/^\/+/, ""), base);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname) || target.username || target.password || target.search || target.hash) throw new Error("工具请求路径越出已配置服务地址。");
    const body = JSON.stringify(payload ?? {});
    if (Buffer.byteLength(body) > 64 * 1024) throw new Error("工具请求超过大小上限。");
    const request = requestSignal(this.timeoutMs, externalSignal), signal = request.signal;
    let addresses;
    try { addresses = await abortable(resolveEndpoint(target, provider, this.lookup), signal); }
    catch (error) { request.close(); throw new Error(signal.aborted ? "工具请求已取消或超时。" : error.message); }
    let response;
    const extraHeaders = authKey ? { Authorization: `Bearer ${authKey}` } : {};
    try { response = await this.transport(target, body, signal, addresses[0], extraHeaders); }
    catch (error) { request.close(); throw new Error(["AbortError", "TimeoutError"].includes(error.name) ? "工具请求已取消或超时。" : "工具服务连接失败。"); }
    if (response.status >= 300 && response.status < 400) { request.close(); await response.body?.cancel?.(); throw new Error("工具服务重定向已被拒绝。"); }
    if (!response.ok) { request.close(); await response.body?.cancel?.(); throw new Error(`工具服务返回 HTTP ${response.status}。`); }
    try { return await readLimitedJson(response, this.maxBytes); }
    catch (error) { if (signal.aborted || ["AbortError", "TimeoutError"].includes(error.name)) throw new Error("工具请求已取消或超时。"); throw error; }
    finally { request.close(); }
  }
  async getJson(baseUrl, provider, route, parameters, externalSignal, authKey = "") {
    const safeBase = ToolConfig.safeEndpoint(baseUrl, provider), base = new URL(`${safeBase}/`), target = new URL(String(route || "").replace(/^\/+/, ""), base);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname) || target.username || target.password || target.search || target.hash) throw new Error("工具请求路径越出已配置服务地址。");
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) throw new Error("工具查询参数无效。");
    for (const [key, value] of Object.entries(parameters)) {
      if (!/^[a-z][a-z0-9_]{0,31}$/i.test(key) || !["string", "number", "boolean"].includes(typeof value)) throw new Error("工具查询参数无效。");
      target.searchParams.set(key, String(value));
    }
    if (target.href.length > 4096) throw new Error("工具请求地址超过大小上限。");
    const request = requestSignal(this.timeoutMs, externalSignal), signal = request.signal;
    let addresses;
    try { addresses = await abortable(resolveEndpoint(target, provider, this.lookup), signal); }
    catch (error) { request.close(); throw new Error(signal.aborted ? "工具请求已取消或超时。" : error.message); }
    let response;
    const extraHeaders = authKey ? { Authorization: `Bearer ${authKey}` } : {};
    try { response = await this.transport(target, "", signal, addresses[0], extraHeaders, { method: "GET" }); }
    catch (error) { request.close(); throw new Error(["AbortError", "TimeoutError"].includes(error.name) ? "工具请求已取消或超时。" : "工具服务连接失败。"); }
    if (response.status >= 300 && response.status < 400) { request.close(); await response.body?.cancel?.(); throw new Error("工具服务重定向已被拒绝。"); }
    if (!response.ok) { request.close(); await response.body?.cancel?.(); throw new Error(`工具服务返回 HTTP ${response.status}。`); }
    try { return await readLimitedJson(response, this.maxBytes); }
    catch (error) { if (signal.aborted || ["AbortError", "TimeoutError"].includes(error.name)) throw new Error("工具请求已取消或超时。"); throw error; }
    finally { request.close(); }
  }
}

module.exports = { SafeToolHttpClient, resolveEndpoint, privateAddress, readLimitedJson, pinnedLookup, MAX_RESPONSE_BYTES, DEFAULT_TIMEOUT_MS };
