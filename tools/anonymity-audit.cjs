"use strict";
const fs=require("node:fs"),path=require("node:path"),root=path.resolve(__dirname,".."),version=require("../package.json").version;
const roots=["README.md","THIRD_PARTY_NOTICES.md","package.json","package-lock.json","docs","tourism","runtime/skills","assets/travel-symbol.svg","assets/travel-wordmark.svg","build-app.cjs","build-travel-brand.cjs","platform/model-config-paths.cjs","tools/check-environment.cjs"];
const textExtensions=new Set([".md",".txt",".json",".js",".cjs",".mjs",".html",".css",".svg",".yml",".yaml",".toml",".cmd",".ps1"]),excluded=rel=>/^(?:tourism\/validation\/(?:desktop-results|native-brand-results|package-audit|brand-audit)\.json|tourism\/validation\/.*\.png|tourism\/旅策协同-双击体验\.html)$/.test(rel);
function files(){const out=[];function add(abs){const rel=path.relative(root,abs).replaceAll("\\","/");if(excluded(rel))return;const stat=fs.statSync(abs);if(stat.isDirectory())for(const name of fs.readdirSync(abs))add(path.join(abs,name));else if(textExtensions.has(path.extname(abs).toLowerCase()))out.push({abs,rel});}for(const item of roots){const abs=path.join(root,item);if(fs.existsSync(abs))add(abs);}return out;}
const patterns=[
  ["可识别院校",/[\u4e00-\u9fff]{2,24}(?:大学|职业技术学院|职业学院|高等专科学校|中学)/g],
  ["Windows 用户路径",/[A-Za-z]:\\Users\\[^\\\s"']+/g],
  ["电子邮箱",/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
  ["疑似手机号",/(?<!\d)1[3-9]\d{9}(?!\d)/g],
  ["疑似 API Key",/(?:(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,})/g]
];
const findings=[];for(const file of files()){const text=fs.readFileSync(file.abs,"utf8");for(const[type,re]of patterns){for(const match of text.matchAll(re))findings.push({type,file:file.rel,line:text.slice(0,match.index).split(/\r?\n/).length,sample:type==="疑似 API Key"?"[REDACTED]":match[0]});}}
const report={product:"旅策协同",version,checkedAt:new Date().toISOString(),scope:roots,passed:findings.length===0,findings};const target=path.join(root,"tourism","validation","anonymity-audit.json");fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({passed:report.passed,findings:findings.length,report:path.relative(root,target)},null,2));if(!report.passed)process.exitCode=1;
module.exports={files,patterns};
