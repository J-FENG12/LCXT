"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { modelConfigPaths } = require("../platform/model-config-paths.cjs");

const PROVIDERS = Object.freeze({
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", modelId: "deepseek-chat", requiresKey: true },
  qwen: { label: "通义千问（Qwen）", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", modelId: "qwen-plus", requiresKey: true },
  kimi: { label: "Kimi", baseUrl: "https://api.moonshot.cn/v1", modelId: "moonshot-v1-8k", requiresKey: true },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", modelId: "gpt-4.1-mini", requiresKey: true },
  ollama: { label: "Ollama（本机）", baseUrl: "http://127.0.0.1:11434/v1", modelId: "qwen3:8b", requiresKey: false },
  lmstudio: { label: "LM Studio（本机）", baseUrl: "http://127.0.0.1:1234/v1", modelId: "local-model", requiresKey: false },
  custom: { label: "自定义 OpenAI 兼容服务", baseUrl: "", modelId: "", requiresKey: false }
});

function safeUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw new Error("模型 Base URL 无效。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("模型地址应为无凭据、无查询参数的 HTTP(S) Base URL。");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("远程模型服务必须使用 HTTPS；HTTP 仅允许本机回环地址。");
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.href.replace(/\/$/, "");
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("模型配置无效。");
  const providerId = String(input.providerId || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(providerId) || /oauth2|auto/.test(providerId)) throw new Error("模型服务标识无效。");
  const modelId = String(input.modelId || "").trim();
  if (!modelId || modelId.length > 160 || /[\r\n]/.test(modelId) || modelId === "auto") throw new Error("请填写有效的模型名称。");
  const baseUrl = safeUrl(input.baseUrl);
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (apiKey.length > 4096 || /\r|\n|\$\{/.test(apiKey)) throw new Error("API Key 格式无效。");
  return { providerId, modelId, baseUrl, apiKey, clearKey: input.clearKey === true };
}

function readConfig(home) {
  for (const candidate of modelConfigPaths(home)) {
    try { return { config: JSON.parse(fs.readFileSync(candidate, "utf8")), source: candidate }; } catch { /* historical paths are read-only fallbacks */ }
  }
  return { config: {}, source: null };
}

function status(home) {
  const { config, source } = readConfig(home);
  const raw = config.agents?.defaults?.model;
  const reference = typeof raw === "string" ? raw : raw?.primary;
  if (typeof reference !== "string" || !reference.includes("/")) return { configured: false, providerId: null, modelId: null, baseUrl: null, hasApiKey: false, source: source ? "用户配置" : null, presets: PROVIDERS };
  const [providerId, ...modelParts] = reference.split("/");
  const provider = config.models?.providers?.[providerId] || {};
  return { configured: Boolean(provider.baseUrl && modelParts.join("/")), providerId, modelId: modelParts.join("/"), baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : null, hasApiKey: typeof provider.apiKey === "string" && provider.apiKey.length > 0, source: "用户配置", presets: PROVIDERS };
}

function save(input, home) {
  const values = validateInput(input);
  const { config } = readConfig(home);
  config.models = config.models && typeof config.models === "object" ? config.models : {};
  config.models.mode = "merge";
  config.models.providers = config.models.providers && typeof config.models.providers === "object" ? config.models.providers : {};
  const previous = config.models.providers[values.providerId] || {};
  const provider = { ...previous, api: "openai-completions", baseUrl: values.baseUrl, models: [{ id: values.modelId, name: values.modelId, api: "openai-completions" }] };
  if (values.apiKey) provider.apiKey = values.apiKey;
  else if (values.clearKey) delete provider.apiKey;
  config.models.providers[values.providerId] = provider;
  config.agents = config.agents && typeof config.agents === "object" ? config.agents : {};
  config.agents.defaults = config.agents.defaults && typeof config.agents.defaults === "object" ? config.agents.defaults : {};
  config.agents.defaults.model = `${values.providerId}/${values.modelId}`;
  const target = modelConfigPaths(home)[0];
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  return status(home);
}

module.exports = { PROVIDERS, safeUrl, validateInput, readConfig, status, save };
