"use strict";
const fs = require("node:fs"), path = require("node:path");
const Schema = require("./task-schema.js");
const Core = require("./travel-core.js");
const ModulePatch = require("./module-patch.js");
const { taskDataPaths } = require("../platform/task-data-paths.cjs");

const FORMAT_VERSION = 1, MAX_HISTORY = 20, MAX_BYTES = 12 * 1024 * 1024;
const clone = value => value == null ? value : structuredClone(value);

function compactProposal(value, task, taskHash) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("待确认提案格式无效。");
  const proposalId = String(value.proposalId || "");
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(proposalId)) throw new Error("待确认提案 ID 无效。");
  if (value.baseRevision !== task.revision || value.baseTaskHash !== taskHash) throw new Error("待确认提案与当前任务版本不一致。");
  const target = ModulePatch.context(task, value.target).target, proposedTask = Schema.parse(value.task);
  if (proposedTask.revision !== task.revision + 1) throw new Error("待确认提案 revision 无效。");
  const evaluation = Core.evaluate(proposedTask);
  return { proposalId, baseRevision: task.revision, baseTaskHash: taskHash, target, task: proposedTask, evaluation, diff: Array.isArray(value.diff) ? clone(value.diff).slice(0, 12) : [], reason: String(value.reason || "").slice(0, 1000), evidenceIds: Array.isArray(value.evidenceIds) ? value.evidenceIds.filter(id => typeof id === "string").slice(0, 12) : [], questions: Array.isArray(value.questions) ? value.questions.filter(item => typeof item === "string").slice(0, 12) : [] };
}

function compactSnapshot(value) {
  const task = Schema.parse(value.task), taskHash = Schema.hash(task);
  const evaluation = value.evaluation ? Core.evaluate(task) : null;
  const selectedPlanId = task.plans.some(plan => plan.id === value.selectedPlanId) ? value.selectedPlanId : null;
  const pendingProposal = compactProposal(value.pendingProposal, task, taskHash);
  return { task, taskHash, evaluation, selectedPlanId, pendingProposal, savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date().toISOString() };
}

function parseRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.formatVersion !== FORMAT_VERSION) throw new Error("任务存档格式无效。");
  const current = compactSnapshot(raw), history = Array.isArray(raw.history) ? raw.history.slice(-MAX_HISTORY).map(item => compactSnapshot({ ...item, pendingProposal: null })) : [];
  return { formatVersion: FORMAT_VERSION, ...current, history };
}

class TaskRepository {
  constructor(options = {}) {
    this.file = options.file || taskDataPaths(options.home).current;
  }
  load() {
    if (!fs.existsSync(this.file)) return null;
    const stat = fs.statSync(this.file);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("任务存档过大或不是普通文件。");
    let raw;
    try { raw = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { throw new Error("任务存档损坏；为保护数据未覆盖该文件。"); }
    return clone(parseRecord(raw));
  }
  write(record) {
    const parsed = parseRecord(record), dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const temporary = path.join(dir, `.${path.basename(this.file)}.${process.pid}.${Date.now()}.tmp`);
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, this.file);
    } finally {
      try { fs.rmSync(temporary, { force: true }); } catch {}
    }
    return clone(parsed);
  }
  save(value) {
    const next = compactSnapshot(value), previous = this.load();
    if (previous && typeof value.baseStoredTaskHash === "string" && previous.taskHash !== value.baseStoredTaskHash && previous.taskHash !== next.taskHash) throw new Error("已保存任务已被其他窗口更新，请先重新载入。");
    if (previous && previous.task.taskId === next.task.taskId && previous.taskHash !== next.taskHash && next.task.revision <= previous.task.revision) throw new Error("已保存任务已有相同或更新 revision，请先重新载入。");
    let history = previous?.history ? clone(previous.history) : [];
    if (previous && previous.taskHash !== next.taskHash) history.push(compactSnapshot(previous));
    history = history.slice(-MAX_HISTORY);
    if (!("pendingProposal" in value) && previous?.taskHash === next.taskHash) next.pendingProposal = previous.pendingProposal;
    return this.write({ formatVersion: FORMAT_VERSION, ...next, history });
  }
  saveProposal(value) {
    const current = this.load();
    if (!current) throw new Error("请先保存正式任务，再保存待确认提案。");
    const pendingProposal = compactProposal(value, current.task, current.taskHash);
    return this.write({ ...current, pendingProposal });
  }
  clearProposal(proposalId) {
    const current = this.load();
    if (!current) return null;
    if (proposalId && current.pendingProposal?.proposalId !== proposalId) throw new Error("待确认提案已变化，请重新载入。");
    return this.write({ ...current, pendingProposal: null });
  }
  undo(input = {}) {
    const current = this.load();
    if (!current) throw new Error("没有可撤销的已保存任务。");
    if (input.baseRevision !== current.task.revision || input.baseTaskHash !== current.taskHash) throw new Error("任务已变化，请刷新后再撤销。");
    const history = clone(current.history), previous = history.pop();
    if (!previous) throw new Error("没有更早的任务版本可撤销。");
    const task = clone(previous.task);
    task.revision = current.task.revision + 1;
    const parsed = Schema.parse(task);
    return this.write({ formatVersion: FORMAT_VERSION, task: parsed, taskHash: Schema.hash(parsed), evaluation: null, selectedPlanId: parsed.plans.some(plan => plan.id === previous.selectedPlanId) ? previous.selectedPlanId : null, pendingProposal: null, savedAt: new Date().toISOString(), history });
  }
  status() {
    const current = this.load();
    return current ? { available: true, savedAt: current.savedAt, taskId: current.task.taskId, revision: current.task.revision, taskHash: current.taskHash, historyCount: current.history.length } : { available: false, savedAt: null, taskId: null, revision: null, taskHash: null, historyCount: 0 };
  }
}

module.exports = { TaskRepository, FORMAT_VERSION, MAX_HISTORY, parseRecord };
