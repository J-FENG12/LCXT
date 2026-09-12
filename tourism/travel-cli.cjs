"use strict";
const fs=require("node:fs"),core=require("./travel-core.js"),demo=require("./demo-data.js");
try{
  const args=process.argv.slice(2),payload=args[0]==="--demo"?demo.scenario():JSON.parse(fs.readFileSync(args[0]||0,"utf8").replace(/^\uFEFF/,""));
  const result=core.evaluate(payload);process.stdout.write(args.includes("--markdown")?core.report(result):JSON.stringify(result,null,2)+"\n");
}catch(error){process.stderr.write(error instanceof SyntaxError?"输入不是有效 JSON。\n":`文旅方案校验失败：${error.message}\n`);process.exitCode=1;}
