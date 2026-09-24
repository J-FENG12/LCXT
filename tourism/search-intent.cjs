"use strict";
const Schema = require("./task-schema.js");

const THEMES = Object.freeze({ opening: "开放时间 官方信息", tickets: "门票 价格 官方信息", access: "交通 到达 无障碍 官方信息" });
function intentsFor(raw, rawTask) {
  const task = Schema.parse(rawTask);
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) throw new Error("模型检索建议必须包含 1–3 个主题。");
  const ids = new Set(task.resources.map(item => item.id));
  const seen = new Set();
  return raw.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || !Object.hasOwn(THEMES, item.theme)) throw new Error("模型提出了不受支持的搜索主题。");
    const resourceId = item.resourceId == null ? null : String(item.resourceId);
    if (resourceId !== null && !ids.has(resourceId)) throw new Error("模型提出的检索资源不属于当前任务。");
    const key = `${resourceId || "destination"}:${item.theme}`;
    if (seen.has(key)) throw new Error("模型提出了重复的检索主题。");
    seen.add(key);
    return { theme: item.theme, resourceId };
  });
}
function publicSearchQuery(task, intent) {
  const validated = intentsFor([intent], task)[0];
  const source = validated.resourceId ? task.resources.find(item => item.id === validated.resourceId)?.name : task.request.destination;
  const place = String(source || "").trim();
  if (!place || place.length > 60 || /[\r\n@]|(?:\+?86[- ]?)?1[3-9]\d{9}|\d{6,}|(?:api[_-]?key|token|password|密码|身份证)/i.test(place)) throw new Error("公开检索地点疑似包含个人资料或凭据，请先修改资源名称。");
  return `${place} ${THEMES[validated.theme]}`;
}
module.exports = { THEMES, intentsFor, publicSearchQuery };
