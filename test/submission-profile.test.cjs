"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { modelConfigPaths } = require("../platform/model-config-paths.cjs");
const { toolDataPaths } = require("../platform/tool-config-paths.cjs");
const { taskDataPaths } = require("../platform/task-data-paths.cjs");
const ModelConfig = require("../tourism/model-config.cjs");

test("提交版使用独立用户配置，不读取已有模型密钥", t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "travel-submission-profile-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const personalFile = path.join(home, ".tr-ai-assist", "tr-ai-assist.json");
  fs.mkdirSync(path.dirname(personalFile), { recursive: true });
  const personalConfig = {
    agents: { defaults: { model: "deepseek/personal" } },
    models: { providers: { deepseek: { baseUrl: "https://api.deepseek.com/v1", apiKey: "FAKE", models: [{ id: "personal" }] } } }
  };
  fs.writeFileSync(personalFile, JSON.stringify(personalConfig));
  const previous = process.env.TRAVEL_SUBMISSION_MODE;
  process.env.TRAVEL_SUBMISSION_MODE = "1";
  try {
    const reviewFile = modelConfigPaths(home)[0];
    assert.notEqual(reviewFile, personalFile);
    assert.equal(modelConfigPaths(home).length, 1, "提交版不能回退读取个人配置");
    assert.equal(ModelConfig.status(home).configured, false);
    assert.equal(ModelConfig.status(home).hasApiKey, false);
    assert.match(toolDataPaths(home).config, /\.tr-ai-review/);
    assert.match(taskDataPaths(home).current, /\.tr-ai-review/);
    ModelConfig.save({ providerId: "deepseek", baseUrl: "https://api.deepseek.com/v1", modelId: "review-model", apiKey: "FAKE" }, home);
    assert.equal(ModelConfig.status(home).modelId, "review-model");
    assert.equal(fs.readFileSync(personalFile, "utf8"), JSON.stringify(personalConfig), "个人原配置不能被改写");
  } finally {
    if (previous === undefined) delete process.env.TRAVEL_SUBMISSION_MODE;
    else process.env.TRAVEL_SUBMISSION_MODE = previous;
  }
});

test("开发入口使用本机配置，旧提交隔离模式仍可单独启用", () => {
  const root = path.resolve(__dirname, "..");
  assert.match(fs.readFileSync(path.join(root, "tools", "desktop-one-click-launcher.cs"), "utf8"), /TRAVEL_SUBMISSION_MODE/);
  assert.match(fs.readFileSync(path.join(root, "启动旅策协同.vbs"), "utf8"), /TRAVEL_SUBMISSION_MODE.*"0"/);
  const launcher = fs.readFileSync(path.join(root, "launcher.cjs"), "utf8");
  assert.match(launcher, /OPENCLAW_STATE_DIR/);
  assert.match(launcher, /if \(submissionMode\) return/);
  assert.match(require(path.join(root, "package.json")).scripts["start:app"], /--submission/);
  assert.match(fs.readFileSync(path.join(root, "tourism", "agent-server.cjs"), "utf8"), /TRAVEL_SUBMISSION_MODE = "1"/);
});
