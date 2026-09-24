"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { TaskRepository, MAX_HISTORY } = require("../tourism/task-repository.cjs"), Schema = require("../tourism/task-schema.js"), Core = require("../tourism/travel-core.js"), Demo = require("../tourism/demo-data.js");

function temporary(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "travel-task-repository-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

test("P01 新安装没有预置任务，首次保存使用用户任务目录", t => {
  const home = temporary(t), repository = new TaskRepository({ home });
  assert.deepEqual(repository.status(), { available: false, savedAt: null, taskId: null, revision: null, taskHash: null, historyCount: 0 });
  const task = Demo.scenario(), evaluation = Core.evaluate(task), saved = repository.save({ task, evaluation, selectedPlanId: "A" });
  assert.equal(saved.taskHash, Schema.hash(task));
  assert.equal(saved.evaluation.taskHash, saved.taskHash);
  assert.equal(saved.selectedPlanId, "A");
  assert.equal(saved.history.length, 0);
  assert.match(repository.file, /[\\/]\.tr-ai-assist[\\/]tasks[\\/]current-task\.json$/);
  assert.equal(fs.existsSync(repository.file), true);
});

test("P02 原子保存保留有界历史，撤销生成新 revision", t => {
  const repository = new TaskRepository({ home: temporary(t) }), first = Demo.scenario();
  repository.save({ task: first, evaluation: Core.evaluate(first), selectedPlanId: "A" });
  const second = structuredClone(first); second.revision = 1; second.request.budget = 2800;
  const saved = repository.save({ task: second, evaluation: Core.evaluate(second), selectedPlanId: "B" });
  assert.equal(saved.history.length, 1);
  assert.equal(saved.task.request.budget, 2800);
  const undone = repository.undo({ baseRevision: saved.task.revision, baseTaskHash: saved.taskHash });
  assert.equal(undone.task.request.budget, 3000);
  assert.equal(undone.task.revision, 2);
  assert.equal(undone.evaluation, null);
  assert.equal(undone.history.length, 0);
  assert.throws(() => repository.undo({ baseRevision: 1, baseTaskHash: saved.taskHash }), /变化|更早/);
});

test("P03 相同任务只更新评估不制造历史，历史数量有硬上限", t => {
  const repository = new TaskRepository({ home: temporary(t) }), task = Demo.scenario();
  repository.save({ task, evaluation: null, selectedPlanId: null });
  const evaluated = repository.save({ task, evaluation: Core.evaluate(task), selectedPlanId: "A" });
  assert.equal(evaluated.history.length, 0);
  let current = task;
  for (let revision = 1; revision <= MAX_HISTORY + 5; revision++) {
    current = structuredClone(current); current.revision = revision; current.request.budget = 3000 + revision;
    repository.save({ task: current, evaluation: null, selectedPlanId: null });
  }
  assert.equal(repository.load().history.length, MAX_HISTORY);
});

test("P04 损坏存档不会被静默当成空任务或覆盖", t => {
  const repository = new TaskRepository({ home: temporary(t) });
  fs.mkdirSync(path.dirname(repository.file), { recursive: true });
  fs.writeFileSync(repository.file, "{broken", "utf8");
  assert.throws(() => repository.load(), /损坏/);
  assert.equal(fs.readFileSync(repository.file, "utf8"), "{broken");
  assert.throws(() => repository.save({ task: Demo.scenario() }), /损坏/);
  assert.equal(fs.readFileSync(repository.file, "utf8"), "{broken");
});

test("P05 同一任务的旧窗口不能覆盖相同或更新 revision", t => {
  const repository = new TaskRepository({ home: temporary(t) }), first = Demo.scenario();
  repository.save({ task: first });
  const newer = structuredClone(first); newer.revision = 1; newer.request.budget = 2800;
  repository.save({ task: newer });
  const stale = structuredClone(first); stale.revision = 1; stale.request.budget = 1200;
  assert.throws(() => repository.save({ task: stale }), /revision|重新载入/);
  assert.equal(repository.load().task.request.budget, 2800);
});
