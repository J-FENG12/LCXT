"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),sharp=require("sharp");
const root=__dirname,source=path.join(root,"build-input","authorized-runtime.bin"),output=path.join(root,"runtime","旅策协同.exe"),icon=path.join(root,"assets","travel.ico"),symbol=path.join(root,"assets","travel-symbol.svg");
const sourceSHA256="D0B395AFB78D50812570437C0AA52DEC1EBDDE2CFCE492750CB3D651BCC97337";
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
const embeddedIcons=[
  {width:44,height:44,bytes:3719,sha256:"A9385D7141A4228DBA2B66F55E07751B56841A781171023978325A1FD652C5A0"},
  {width:1024,height:1024,bytes:590331,sha256:"14ABC808965957E92E0BAAABAA5918F446C7E1DEFA98A327C85431C83DF99281"}
];

function crc32(buffer){
  let crc=0xffffffff;
  for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function padPng(png,targetSize){
  const iend=Buffer.from([0,0,0,0,0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82]);
  if(!png.subarray(-12).equals(iend))throw new Error("生成的品牌图标不是标准PNG。");
  const paddingSize=targetSize-png.length-12;
  if(paddingSize<0)throw new Error(`品牌图标体积 ${png.length} 超过内嵌资源空间 ${targetSize}。`);
  const type=Buffer.from("npAD","ascii"),data=Buffer.alloc(paddingSize);
  const chunk=Buffer.alloc(paddingSize+12);
  chunk.writeUInt32BE(paddingSize,0);type.copy(chunk,4);data.copy(chunk,8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type,data])),8+paddingSize);
  const padded=Buffer.concat([png.subarray(0,-12),chunk,iend]);
  if(padded.length!==targetSize)throw new Error("内嵌品牌图标填充长度异常。");
  return padded;
}
function findPngs(bytes){
  const signature=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),found=[];
  for(let cursor=0;(cursor=bytes.indexOf(signature,cursor))!==-1;cursor+=signature.length){
    let pos=cursor+8,width=0,height=0;
    while(pos+12<=bytes.length){
      const length=bytes.readUInt32BE(pos),type=bytes.toString("ascii",pos+4,pos+8);
      if(length>128*1024*1024||pos+12+length>bytes.length)break;
      if(type==="IHDR"){width=bytes.readUInt32BE(pos+8);height=bytes.readUInt32BE(pos+12);}
      pos+=12+length;
      if(type==="IEND"){const png=bytes.subarray(cursor,pos);found.push({offset:cursor,width,height,png,sha256:crypto.createHash("sha256").update(png).digest("hex").toUpperCase()});break;}
    }
  }
  return found;
}
function replaceAllFixedBytes(bytes,sourceBytes,targetText,minimum,skip=()=>false){
  const targetBytes=Buffer.from(targetText,"utf8");
  if(sourceBytes.length!==targetBytes.length)throw new Error(`原生品牌字符串长度不匹配：${sourceBytes.length} != ${targetBytes.length}`);
  let count=0;
  for(let offset=0;(offset=bytes.indexOf(sourceBytes,offset))!==-1;offset+=targetBytes.length){if(skip(bytes,offset))continue;targetBytes.copy(bytes,offset);count++;}
  if(count<minimum)throw new Error(`原生品牌字符串替换数量异常：${count} < ${minimum}`);
  return count;
}
function stripAuthenticode(file){
  let bytes=fs.readFileSync(file);
  const peOffset=bytes.readUInt32LE(0x3c);
  if(bytes.toString("ascii",peOffset,peOffset+4)!=="PE\0\0")throw new Error("品牌运行文件不是有效 PE 文件。");
  const optionalOffset=peOffset+24,magic=bytes.readUInt16LE(optionalOffset);
  const dataDirectoryOffset=optionalOffset+(magic===0x20b?112:magic===0x10b?96:0);
  if(!dataDirectoryOffset)throw new Error("品牌运行文件的 PE 可选头不受支持。");
  const securityOffset=dataDirectoryOffset+8*4,certificateOffset=bytes.readUInt32LE(securityOffset),certificateSize=bytes.readUInt32LE(securityOffset+4);
  if(!certificateOffset||!certificateSize)return false;
  bytes.writeUInt32LE(0,securityOffset);bytes.writeUInt32LE(0,securityOffset+4);
  if(certificateOffset>=bytes.length||certificateSize>bytes.length-certificateOffset){fs.writeFileSync(file,bytes);return true;}
  if(certificateOffset+certificateSize===bytes.length)bytes=bytes.subarray(0,certificateOffset);
  else bytes.fill(0,certificateOffset,certificateOffset+certificateSize);
  fs.writeFileSync(file,bytes);
  return true;
}
async function replaceEmbeddedBrandIcons(file){
  const bytes=fs.readFileSync(file),found=findPngs(bytes);
  for(const expected of embeddedIcons){
    const current=found.find(item=>item.width===expected.width&&item.height===expected.height&&item.png.length===expected.bytes&&item.sha256===expected.sha256);
    if(!current)throw new Error(`未找到已验证的 ${expected.width}x${expected.height} 原生图标，停止构建。`);
    const generated=await sharp(symbol).resize(expected.width,expected.height).png({compressionLevel:9}).toBuffer();
    padPng(generated,expected.bytes).copy(bytes,current.offset);
  }
  // The native tooltip and pre-injection title use a fixed five-byte product
  // label. TR.AI is the byte-compatible short brand for 旅策协同.
  replaceAllFixedBytes(bytes,Buffer.from([67,67,108,97,119]),"TR.AI",9);
  // Native environment variable prefix (17 occurrences in the verified input).
  // Equal byte length keeps the native string tables and code offsets intact.
  const environmentCount=replaceAllFixedBytes(bytes,Buffer.from([67,67,76,65,87]),"TR_AI",17);
  if(environmentCount!==17)throw new Error("Unexpected native environment-prefix count.");
  // Remove the former builder account name from embedded Rust debug paths.
  replaceAllFixedBytes(bytes,Buffer.from([99,99,108,97,119,98,117,105,108,100]),"travel-dev",100);
  // Rebrand every remaining native product and former vendor identifier,
  // including the equal-length Tauri application id. Desktop cold-start tests
  // verify that this byte-compatible identifier remains bootable.
  const nativeIdCount=replaceAllFixedBytes(bytes,Buffer.from([99,99,108,97,119]),"tr-ai",26);
  const legacyProviderTypeCount=replaceAllFixedBytes(bytes,Buffer.from([67,104,97,110,106,101,116]),"Tourism",11);
  const vendorCount=replaceAllFixedBytes(bytes,Buffer.from([99,104,97,110,106,101,116]),"tourism",83);
  if(nativeIdCount!==26||legacyProviderTypeCount!==11||vendorCount!==83)throw new Error("Unexpected native product-identifier count.");
  fs.writeFileSync(file,bytes);
}
async function main(){
  if(!fs.existsSync(source)||sha(source)!==sourceSHA256)throw new Error("已授权运行基线缺失或哈希不匹配，停止生成旅策协同运行文件。");
  if(!fs.existsSync(icon))throw new Error("旅策协同ICO不存在，请先生成品牌资源。");
  fs.copyFileSync(source,output);
  await replaceEmbeddedBrandIcons(output);
  const {rcedit}=await import("rcedit");
  await rcedit(output,{
    icon,
    "file-version":"4.2.0",
    "product-version":"4.2.0",
    "version-string":{
      FileDescription:"旅策协同 · 文旅智能辅助",
      ProductName:"旅策协同",
      InternalName:"TR.AI",
      OriginalFilename:"旅策协同.exe",
      CompanyName:"旅策协同",
      LegalCopyright:"Copyright © 2026 旅策协同"
    }
  });
  if(!stripAuthenticode(output))throw new Error("授权运行输入未包含预期的旧签名证书表，停止生成派生运行文件。");
  const brandedBytes=fs.readFileSync(output);
  for(const retired of [Buffer.from([67,67,108,97,119]),Buffer.from([99,99,108,97,119]),Buffer.from([67,104,97,110,106,101,116]),Buffer.from([99,104,97,110,106,101,116]),Buffer.from(String.fromCharCode(30021,25463,36890))]){
    if(brandedBytes.includes(retired))throw new Error("派生运行文件仍包含旧产品或旧开发者标识。");
  }
  if(sha(source)!==sourceSHA256)throw new Error("已授权运行基线发生变化，停止构建。");
  console.log(`Built branded runtime: ${output} (${sha(output)})`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
