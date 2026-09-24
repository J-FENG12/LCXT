"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const Schema = require("./task-schema.js");
const { toolDataPaths } = require("../platform/tool-config-paths.cjs");

const FORMAT_VERSION = 1, MAX_ITEMS = 100, MAX_BYTES = 4 * 1024 * 1024;
const clean = (value, max = 1000) => String(value || "").trim().replace(/[\0]/g, "").slice(0, max);
function contextOf(raw) {
  const taskId = clean(raw?.taskId, 100), taskHash = clean(raw?.taskHash, 100), revision = Number(raw?.revision);
  if (!taskId || !/^(?:[a-f0-9]{64}|task-v2-[a-f0-9]{16})$/i.test(taskHash) || !Number.isInteger(revision) || revision < 0) throw new Error("候选资料的任务版本无效。");
  return { taskId, taskHash, revision };
}
function safeSourceUrl(value, simulation) {
  if (value == null || value === "") return null;
  let url; try { url = new URL(String(value)); } catch { throw new Error("候选资料来源地址无效。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("候选资料来源必须是无凭据的 HTTPS 地址。");
  if (!simulation && !url.hostname) throw new Error("真实候选资料缺少来源主机。");
  return url.href;
}
function candidate(raw, capability, fallback) {
  const simulation = raw?.simulation === true || fallback.simulation === true, id = clean(raw?.observationId || crypto.randomUUID(), 100);
  if (!id) throw new Error("候选资料标识无效。");
  const title = clean(raw?.title || (capability === "weather" ? `${raw?.location || "目的地"}天气` : `${capability} 候选`), 300), text = clean(raw?.summary || raw?.condition || raw?.note, 2000);
  if (!title || !text) throw new Error("候选资料缺少标题或正文。");
  const sourceUrl = safeSourceUrl(raw?.url || raw?.sourceUrl, simulation);
  if (!simulation && !sourceUrl) throw new Error("真实候选资料缺少可追溯来源地址。");
  const retrievedAt = clean(raw?.retrievedAt || fallback.retrievedAt, 40), validUntil = raw?.validUntil ? clean(raw.validUntil, 10) : null;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(retrievedAt) || !Number.isFinite(Date.parse(retrievedAt))) throw new Error("候选资料缺少有效获取时间。");
  if (validUntil && (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || !Number.isFinite(Date.parse(validUntil)))) throw new Error("候选资料有效期无效。");
  if (!simulation && !validUntil) throw new Error("真实候选资料缺少有效期。");
  return { id, capability, title, text, sourceLabel: clean(raw?.sourceLabel || fallback.sourceLabel, 300), sourceUrl, retrievedAt, validUntil, provider: clean(raw?.provider || fallback.provider, 80), simulation, state: "pending", ...contextOf(fallback), createdAt: new Date().toISOString() };
}
function storedCandidate(raw) {
  if (!raw || !["search", "weather"].includes(raw.capability)) throw new Error("候选资料存档包含未知能力。");
  const normalized = candidate({ ...raw, observationId: raw.id, summary: raw.text, url: raw.sourceUrl }, raw.capability, raw), state = clean(raw.state, 20);
  if (!["pending", "dismissed", "adopted"].includes(state)) throw new Error("候选资料存档包含未知状态。");
  return { ...normalized, state, createdAt: clean(raw.createdAt, 40), ...(raw.handledAt ? { handledAt: clean(raw.handledAt, 40) } : {}), ...(raw.adoptedTaskHash ? { adoptedTaskHash: clean(raw.adoptedTaskHash, 100) } : {}) };
}

class ObservationRepository {
  constructor(options = {}) { this.file = options.file || toolDataPaths(options.home).observations; }
  read() {
    if (!fs.existsSync(this.file)) return { formatVersion: FORMAT_VERSION, items: [] };
    const stat = fs.statSync(this.file); if (stat.size > MAX_BYTES) throw new Error("候选资料存档超过大小上限。");
    let value; try { value = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { throw new Error("候选资料存档损坏；原文件保持不变。"); }
    if (value?.formatVersion !== FORMAT_VERSION || !Array.isArray(value.items) || value.items.length > MAX_ITEMS) throw new Error("候选资料存档格式无效。");
    return { formatVersion: FORMAT_VERSION, items: value.items.map(storedCandidate) };
  }
  write(value) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const next = { formatVersion: FORMAT_VERSION, items: value.items.slice(-MAX_ITEMS) }, temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temporary, this.file); return next;
  }
  capture(toolResult) {
    const capability = toolResult?.capability;
    if (!["search", "weather"].includes(capability)) return [];
    const result = toolResult.result || {}, raws = capability === "search" ? result.observations || [] : [result], made = raws.map(raw => candidate(raw, capability, result));
    const key = item => `${item.taskId}:${item.revision}:${item.taskHash}:${item.id}`, archive = this.read(), existing = new Map(archive.items.map(item => [key(item), item])), stored = made.map(item => existing.get(key(item)) || item), additions = stored.filter(item => !existing.has(key(item))); if (additions.length) { archive.items.push(...additions); this.write(archive); } return stored;
  }
  list(rawContext) { const context = contextOf(rawContext); return this.read().items.filter(item => item.state === "pending" && item.taskId === context.taskId && item.taskHash === context.taskHash && item.revision === context.revision); }
  find(id, rawContext) { const item = this.list(rawContext).find(row => row.id === id); if (!item) throw new Error("候选资料不存在、已处理或已随任务变化失效。"); return item; }
  update(id, rawContext, state, extra = {}) { const context = contextOf(rawContext), archive = this.read(), index = archive.items.findIndex(item => item.id === id && item.state === "pending" && item.taskId === context.taskId && item.taskHash === context.taskHash && item.revision === context.revision); if (index < 0) throw new Error("候选资料不存在、已处理或已随任务变化失效。"); archive.items[index] = { ...archive.items[index], state, handledAt: new Date().toISOString(), ...extra }; this.write(archive); return archive.items[index]; }
  dismiss(id, context) { return this.update(id, context, "dismissed"); }
  prepareAdoption(id, rawContext, rawTask, resourceId = null) {
    const context = contextOf(rawContext), task = Schema.parse(rawTask), taskHash = Schema.hash(task);
    if (task.taskId !== context.taskId || task.revision !== context.revision || taskHash !== context.taskHash) throw new Error("任务已变化，请重新加载候选资料。");
    const item = this.find(id, context); if (item.simulation && !task.demo) throw new Error("模拟候选不能写入非模拟正式任务。");
    if (!item.simulation && (!item.validUntil || item.validUntil < new Date().toISOString().slice(0, 10))) throw new Error("真实候选资料缺少有效期或已经过期。");
    if (resourceId !== null && !task.resources.some(resource => resource.id === resourceId)) throw new Error("候选资料关联的资源不存在。");
    const factId = `OBS-${crypto.createHash("sha256").update(item.id).digest("hex").slice(0, 16)}`, observedAt = item.retrievedAt.slice(0, 10), fact = { id: factId, resourceId, topic: item.capability === "weather" ? "天气观察" : item.title.slice(0, 100), text: item.text, sourceLabel: item.sourceLabel || item.provider, sourceUrl: item.sourceUrl, observedAt, validFrom: observedAt, validTo: item.validUntil, status: "unknown", demo: item.simulation };
    const next = structuredClone(task); if (next.facts.some(row => row.id === factId)) throw new Error("该候选资料已经存在于任务中。"); next.facts.push(fact); next.revision++;
    return { candidate: item, fact, task: Schema.parse(next), previousTaskHash: taskHash, taskHash: Schema.hash(next) };
  }
  commitAdoption(id, rawContext, adoptedTaskHash) { if (!/^(?:[a-f0-9]{64}|task-v2-[a-f0-9]{16})$/i.test(String(adoptedTaskHash || ""))) throw new Error("采纳后的任务哈希无效。"); return this.update(id, rawContext, "adopted", { adoptedTaskHash }); }
}

module.exports = { ObservationRepository, contextOf, candidate, storedCandidate, FORMAT_VERSION, MAX_ITEMS };
