"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = __dirname;
const source = path.join(root, "tools", "native-runtime-host.cs");
const output = path.join(root, "runtime", "bin", "travel-window-host.exe");
const icon = path.join(root, "assets", "travel.ico");
const compilers = [
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")
];
const compiler = compilers.find(file => fs.existsSync(file));
if (!compiler) throw new Error("Windows .NET Framework C# compiler unavailable; cannot build the branded window host.");
for (const file of [source, icon]) if (!fs.existsSync(file)) throw new Error(`Native window host input missing: ${file}`);
fs.mkdirSync(path.dirname(output), { recursive: true });
const result = spawnSync(compiler, [
  "/nologo", "/target:winexe", "/platform:x64", "/codepage:65001",
  `/out:${output}`, `/win32icon:${icon}`,
  "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll", source
], { cwd: root, encoding: "utf8", windowsHide: true });
if (result.status !== 0 || !fs.existsSync(output)) throw new Error(`Native window host build failed: ${result.stderr || result.stdout || result.status}`);
console.log(`Built branded native window host: ${output}`);
