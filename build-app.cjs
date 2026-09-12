"use strict";
const fs = require("node:fs");
const path = require("node:path");
require("./tourism/build-demo.cjs");
const out = path.join(__dirname, "dist", "app");
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(__dirname, "tourism", "旅策协同-双击体验.html"), path.join(out, "index.html"));
console.log(`Built source-only contest app: ${path.join(out, "index.html")}`);
