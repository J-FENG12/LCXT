"use strict";
const fs = require("node:fs"), path = require("node:path"), { modelConfigPaths } = require("./model-config-paths.cjs");

const PLUGIN_ID = "travel-tools";
const pluginRoot = () => path.join(__dirname, "..", "runtime", "plugins", PLUGIN_ID);

function decorate(config, root = pluginRoot()) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("OpenClaw 配置无效。");
  config.plugins = config.plugins && typeof config.plugins === "object" && !Array.isArray(config.plugins) ? config.plugins : {};
  config.plugins.enabled = true;
  const allow = Array.isArray(config.plugins.allow) ? config.plugins.allow.filter(value => typeof value === "string") : [];
  config.plugins.allow = [...new Set([...allow, PLUGIN_ID])];
  config.plugins.load = config.plugins.load && typeof config.plugins.load === "object" && !Array.isArray(config.plugins.load) ? config.plugins.load : {};
  const paths = Array.isArray(config.plugins.load.paths) ? config.plugins.load.paths.filter(value => typeof value === "string" && !/[\\/]runtime[\\/]plugins[\\/]travel-tools$/i.test(value)) : [];
  config.plugins.load.paths = [...paths, path.resolve(root)];
  config.plugins.entries = config.plugins.entries && typeof config.plugins.entries === "object" && !Array.isArray(config.plugins.entries) ? config.plugins.entries : {};
  config.plugins.entries[PLUGIN_ID] = { ...(config.plugins.entries[PLUGIN_ID] || {}), enabled: true };
  return config;
}

function ensureFile(target, root = pluginRoot()) {
  if (!fs.existsSync(target)) return { updated: false, reason: "missing-config", target };
  const config = JSON.parse(fs.readFileSync(target, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("OpenClaw 配置无效。");
  const before = JSON.stringify(config), next = decorate(config, root), after = JSON.stringify(next);
  if (before === after) return { updated: false, reason: "already-configured", target };
  const temporary = `${target}.${process.pid}.travel-tools.tmp`;
  try { fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, target); }
  finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
  return { updated: true, reason: "configured", target };
}

function ensure(home, root = pluginRoot()) {
  return ensureFile(modelConfigPaths(home)[0], root);
}

function ensureDesktopProfiles(home, root = pluginRoot()) {
  const targets = [
    modelConfigPaths(home)[0],
    path.join(home, ".tr-ai-assist", "tr-ai-assist.json"),
    path.join(home, ".tr-ai-review", "tr-ai-review.json")
  ];
  return [...new Set(targets.map(target => path.resolve(target)))].map(target => ensureFile(target, root));
}

module.exports = { PLUGIN_ID, pluginRoot, decorate, ensureFile, ensure, ensureDesktopProfiles };
