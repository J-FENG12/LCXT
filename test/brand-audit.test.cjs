"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { inspect, retiredPattern } = require("../tools/brand-audit.cjs");
const retired = retiredPattern.source.split("|")[0];
test("发布品牌检查覆盖正文、文件名和宽字符", () => {
  assert.equal(inspect("README.md", Buffer.from(`<title>${retired}</title>`)).exception, null);
  assert.equal(inspect(`assets/${retired}.svg`, Buffer.from("<svg/>" )).exception, null);
  assert.equal(inspect("native-resource.bin", Buffer.from(retired.toUpperCase(), "utf16le")).exception, null);
  assert.equal(inspect("tourism/方案说明.md", Buffer.from("旅策协同 · 文旅智能辅助")), null);
});
test("当前模型配置路径本身不含旧产品标志", () => {
  const rel = "platform/model-config-paths.cjs", source = fs.readFileSync(path.join(__dirname, "..", rel));
  assert.equal(inspect(rel, source), null);
  assert.equal(inspect(rel, Buffer.concat([source, Buffer.from(`\n// ${retired}`)])).exception, null);
});
test("成品运行文件不再保留旧产品标志", () => {
  const rel = "runtime/旅策协同.exe", finding = inspect(rel, fs.readFileSync(path.join(__dirname, "..", rel)));
  assert.equal(finding, null);
});
