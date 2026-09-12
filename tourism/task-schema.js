(function (root) {
  "use strict";

  const VERSION = 2;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const tri = new Set(["yes", "no", "unknown"]);
  const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const fail = (path, message) => { const error = new Error(`${path}: ${message}`); error.path = path; throw error; };
  const string = (value, path, {min = 1, max = 500, nullable = false} = {}) => {
    if (nullable && value === null) return null;
    if (typeof value !== "string") fail(path, "必须是字符串");
    const result = value.trim();
    if (result.length < min || result.length > max) fail(path, `长度须为 ${min}–${max}`);
    return result;
  };
  const integer = (value, path, min, max) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) fail(path, `须为 ${min}–${max} 的整数`);
    return value;
  };
  const number = (value, path, min = 0, max = 10000000, nullable = false) => {
    if (nullable && value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(path, `须为 ${min}–${max} 的有限数值`);
    return value;
  };
  const bool = (value, path) => { if (typeof value !== "boolean") fail(path, "必须是布尔值"); return value; };
  const enumeration = (value, path, values) => values.includes(value) ? value : fail(path, `仅支持 ${values.join("、")}`);
  const date = (value, path, nullable = false) => {
    if (nullable && value === null) return null;
    const result = string(value, path, {max: 10});
    if (!datePattern.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) fail(path, "须为 YYYY-MM-DD");
    return result;
  };
  const time = (value, path) => { const result = string(value, path, {max: 5}); if (!timePattern.test(result)) fail(path, "须为 HH:MM"); return result; };
  const strings = (value, path, maxItems = 30) => {
    if (!Array.isArray(value) || value.length > maxItems) fail(path, `必须是最多 ${maxItems} 项的数组`);
    const result = value.map((item, index) => string(item, `${path}[${index}]`, {max: 100}));
    if (new Set(result).size !== result.length) fail(path, "不能包含重复项");
    return result;
  };
  const ids = (value, path) => strings(value ?? [], path, 50);
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const assertKeys = (value, path, allowed) => {
    if (!plain(value)) fail(path, "必须是对象");
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, "未知字段");
  };
  const makeUuid = () => {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
  };

  function parseRequest(input, daysPath = "request") {
    assertKeys(input, daysPath, ["destinationId","destination","startDate","days","adults","children","seniors","budget","maxWalkingMinutes","weather","avoidOutdoorInRain","interests","dietary","accessibility","dayWindows","requiredNights","selfArrangedNights","dietaryRequirements","accessibilityRequirements","unresolvedRequirements"]);
    const days = integer(input.days, `${daysPath}.days`, 1, 7);
    const result = {
      destinationId:string(input.destinationId, `${daysPath}.destinationId`, {max:80}),
      destination:string(input.destination, `${daysPath}.destination`, {max:200}),
      startDate:date(input.startDate, `${daysPath}.startDate`, true), days,
      adults:integer(input.adults, `${daysPath}.adults`, 0, 100), children:integer(input.children, `${daysPath}.children`, 0, 100), seniors:integer(input.seniors, `${daysPath}.seniors`, 0, 100),
      budget:number(input.budget, `${daysPath}.budget`, 0.01), maxWalkingMinutes:integer(input.maxWalkingMinutes, `${daysPath}.maxWalkingMinutes`, 0, 1440),
      weather:enumeration(input.weather, `${daysPath}.weather`, ["clear","rain"]), avoidOutdoorInRain:bool(input.avoidOutdoorInRain, `${daysPath}.avoidOutdoorInRain`),
      interests:strings(input.interests ?? [], `${daysPath}.interests`), dietary:typeof input.dietary === "string" ? input.dietary.trim().slice(0, 1000) : "", accessibility:typeof input.accessibility === "string" ? input.accessibility.trim().slice(0, 1000) : ""
    };
    if (result.adults + result.children + result.seniors < 1) fail(daysPath, "同行人数至少为 1");
    if (!Array.isArray(input.dayWindows) || input.dayWindows.length !== days) fail(`${daysPath}.dayWindows`, "必须逐日提供且与 days 一致");
    result.dayWindows = input.dayWindows.map((window, index) => {
      assertKeys(window, `${daysPath}.dayWindows[${index}]`, ["day","start","end","minActivities","requiredMeals"]);
      const parsed = {day:integer(window.day, `${daysPath}.dayWindows[${index}].day`, 1, days), start:time(window.start, `${daysPath}.dayWindows[${index}].start`), end:time(window.end, `${daysPath}.dayWindows[${index}].end`), minActivities:integer(window.minActivities, `${daysPath}.dayWindows[${index}].minActivities`, 0, 20), requiredMeals:strings(window.requiredMeals, `${daysPath}.dayWindows[${index}].requiredMeals`, 3)};
      parsed.requiredMeals.forEach((meal, mealIndex) => enumeration(meal, `${daysPath}.dayWindows[${index}].requiredMeals[${mealIndex}]`, ["breakfast","lunch","dinner"]));
      if (minutes(parsed.end) <= minutes(parsed.start)) fail(`${daysPath}.dayWindows[${index}]`, "暂不支持跨午夜时段");
      return parsed;
    });
    if (new Set(result.dayWindows.map(x => x.day)).size !== days) fail(`${daysPath}.dayWindows`, "day 必须唯一并覆盖全部日期");
    result.requiredNights = Array.isArray(input.requiredNights) ? input.requiredNights.map((x,i)=>integer(x,`${daysPath}.requiredNights[${i}]`,1,Math.max(1,days-1))) : fail(`${daysPath}.requiredNights`, "必须是数组");
    result.selfArrangedNights = Array.isArray(input.selfArrangedNights) ? input.selfArrangedNights.map((x,i)=>integer(x,`${daysPath}.selfArrangedNights[${i}]`,1,Math.max(1,days-1))) : fail(`${daysPath}.selfArrangedNights`, "必须是数组");
    const expected = new Set(Array.from({length:Math.max(0,days-1)},(_,i)=>i+1));
    const nightValues = [...result.requiredNights,...result.selfArrangedNights];
    if (new Set(nightValues).size !== nightValues.length || nightValues.some(x=>!expected.has(x)) || nightValues.length !== expected.size) fail(`${daysPath}.requiredNights`, "requiredNights 与 selfArrangedNights 须互斥并覆盖全部夜晚");
    assertKeys(input.dietaryRequirements, `${daysPath}.dietaryRequirements`, ["excludedAllergens","avoidCrossContact","dietTypes"]);
    result.dietaryRequirements = {excludedAllergens:strings(input.dietaryRequirements.excludedAllergens ?? [], `${daysPath}.dietaryRequirements.excludedAllergens`), avoidCrossContact:bool(input.dietaryRequirements.avoidCrossContact, `${daysPath}.dietaryRequirements.avoidCrossContact`), dietTypes:strings(input.dietaryRequirements.dietTypes ?? [], `${daysPath}.dietaryRequirements.dietTypes`)};
    assertKeys(input.accessibilityRequirements, `${daysPath}.accessibilityRequirements`, ["wheelchairRoute","stepFree","accessibleRoom","accessibleVehicle"]);
    result.accessibilityRequirements = {};
    for (const key of ["wheelchairRoute","stepFree","accessibleRoom","accessibleVehicle"]) result.accessibilityRequirements[key] = bool(input.accessibilityRequirements[key], `${daysPath}.accessibilityRequirements.${key}`);
    if (!Array.isArray(input.unresolvedRequirements) || input.unresolvedRequirements.length > 30) fail(`${daysPath}.unresolvedRequirements`, "必须是最多 30 项的数组");
    result.unresolvedRequirements = input.unresolvedRequirements.map((x,i)=>{ assertKeys(x,`${daysPath}.unresolvedRequirements[${i}]`,["text","reason"]); return {text:string(x.text,`${daysPath}.unresolvedRequirements[${i}].text`),reason:string(x.reason,`${daysPath}.unresolvedRequirements[${i}].reason`)}; });
    return result;
  }

  function parseFact(input, index) {
    const path = `facts[${index}]`;
    assertKeys(input, path, ["id","resourceId","topic","text","sourceLabel","sourceUrl","observedAt","validFrom","validTo","status","demo"]);
    return {id:string(input.id,`${path}.id`,{max:80}),resourceId:input.resourceId===null?null:string(input.resourceId,`${path}.resourceId`,{max:80}),topic:string(input.topic,`${path}.topic`,{max:100}),text:string(input.text,`${path}.text`,{max:2000}),sourceLabel:string(input.sourceLabel,`${path}.sourceLabel`,{max:300}),sourceUrl:input.sourceUrl===null?null:string(input.sourceUrl,`${path}.sourceUrl`,{max:1000}),observedAt:date(input.observedAt,`${path}.observedAt`),validFrom:date(input.validFrom,`${path}.validFrom`,true),validTo:date(input.validTo,`${path}.validTo`,true),status:enumeration(input.status,`${path}.status`,["confirmed","unknown","conflict"]),demo:bool(input.demo,`${path}.demo`)};
  }

  function parseResource(input, index) {
    const path = `resources[${index}]`;
    assertKeys(input,path,["id","destinationId","areaId","name","type","location","durationMinutes","openStart","openEnd","indoor","tags","priceMode","adultPrice","childPrice","seniorPrice","unitPrice","capacityPerSlot","capacityPerRoom","accessibleRoomsAvailable","allergenFree","crossContactControlled","dietSupport","accessibility","pricingEvidenceIds","openingEvidenceIds","capacityEvidenceIds","suitabilityEvidenceIds"]);
    const result = {...input};
    result.id=string(input.id,`${path}.id`,{max:80}); result.destinationId=string(input.destinationId,`${path}.destinationId`,{max:80}); result.areaId=string(input.areaId,`${path}.areaId`,{max:80}); result.name=string(input.name,`${path}.name`); result.type=enumeration(input.type,`${path}.type`,["activity","stay","meal","transfer"]); result.location=string(input.location,`${path}.location`);
    result.durationMinutes=integer(input.durationMinutes,`${path}.durationMinutes`,0,1440); result.openStart=time(input.openStart,`${path}.openStart`); result.openEnd=time(input.openEnd,`${path}.openEnd`); if(minutes(result.openEnd)<=minutes(result.openStart))fail(`${path}.openEnd`,"暂不支持跨午夜开放时段");
    result.indoor=bool(input.indoor,`${path}.indoor`); result.tags=strings(input.tags??[],`${path}.tags`); result.priceMode=enumeration(input.priceMode,`${path}.priceMode`,["ticket","per_person","per_room_night","fixed"]);
    for (const key of ["pricingEvidenceIds","openingEvidenceIds","capacityEvidenceIds","suitabilityEvidenceIds"]) result[key]=ids(input[key]??[],`${path}.${key}`);
    for (const key of ["adultPrice","childPrice","seniorPrice","unitPrice"]) result[key]=input[key]===null||input[key]===undefined?null:number(input[key],`${path}.${key}`,0,10000000,true);
    result.capacityPerSlot=input.capacityPerSlot===null||input.capacityPerSlot===undefined?null:integer(input.capacityPerSlot,`${path}.capacityPerSlot`,1,100000);
    result.capacityPerRoom=input.capacityPerRoom===null||input.capacityPerRoom===undefined?null:integer(input.capacityPerRoom,`${path}.capacityPerRoom`,1,100);
    result.accessibleRoomsAvailable=input.accessibleRoomsAvailable===null||input.accessibleRoomsAvailable===undefined?null:integer(input.accessibleRoomsAvailable,`${path}.accessibleRoomsAvailable`,0,100000);
    result.allergenFree=plain(input.allergenFree)?{...input.allergenFree}:{}; result.crossContactControlled=plain(input.crossContactControlled)?{...input.crossContactControlled}:{}; result.dietSupport=plain(input.dietSupport)?{...input.dietSupport}:{};
    for(const [group,map] of [["allergenFree",result.allergenFree],["crossContactControlled",result.crossContactControlled],["dietSupport",result.dietSupport]])for(const [key,value] of Object.entries(map))if(!tri.has(value))fail(`${path}.${group}.${key}`,"须为 yes/no/unknown");
    result.accessibility=plain(input.accessibility)?{...input.accessibility}:{}; for(const key of ["wheelchairRoute","stepFree","accessibleRoom","accessibleVehicle"]){const value=result.accessibility[key]??"unknown";if(!tri.has(value))fail(`${path}.accessibility.${key}`,"须为 yes/no/unknown");result.accessibility[key]=value;}
    return result;
  }

  function parseTransfer(input,index){const path=`transfers[${index}]`;assertKeys(input,path,["id","fromResourceId","toResourceId","minutes","walkingMinutes","costMode","amount","serviceResourceId","evidenceIds"]);return{id:string(input.id,`${path}.id`,{max:80}),fromResourceId:string(input.fromResourceId,`${path}.fromResourceId`,{max:80}),toResourceId:string(input.toResourceId,`${path}.toResourceId`,{max:80}),minutes:integer(input.minutes,`${path}.minutes`,0,1440),walkingMinutes:integer(input.walkingMinutes,`${path}.walkingMinutes`,0,1440),costMode:enumeration(input.costMode,`${path}.costMode`,["included","fixed","per_person","unknown"]),amount:input.amount===null?null:number(input.amount,`${path}.amount`,0,10000000,true),serviceResourceId:input.serviceResourceId===null?null:string(input.serviceResourceId,`${path}.serviceResourceId`,{max:80}),evidenceIds:ids(input.evidenceIds??[],`${path}.evidenceIds`)};}
  function parsePlan(input,index,days){const path=`plans[${index}]`;assertKeys(input,path,["id","name","origin","source","items","stays"]);const plan={id:string(input.id,`${path}.id`,{max:80}),name:string(input.name,`${path}.name`),origin:enumeration(input.origin??"manual",`${path}.origin`,["manual","generated"]),source:typeof input.source==="string"?input.source.trim().slice(0,300):"",items:[],stays:[]};if(!Array.isArray(input.items)||input.items.length>100)fail(`${path}.items`,"须为最多100项的数组");plan.items=input.items.map((x,i)=>{const p=`${path}.items[${i}]`;assertKeys(x,p,["itemId","resourceId","day","start","quantity","mealSlot"]);return{itemId:string(x.itemId,p+".itemId",{max:80}),resourceId:string(x.resourceId,p+".resourceId",{max:80}),day:integer(x.day,p+".day",1,days),start:time(x.start,p+".start"),quantity:integer(x.quantity??1,p+".quantity",1,1000),mealSlot:x.mealSlot===null?null:enumeration(x.mealSlot,p+".mealSlot",["breakfast","lunch","dinner"])};});if(!Array.isArray(input.stays)||input.stays.length>20)fail(`${path}.stays`,"须为最多20项的数组");plan.stays=input.stays.map((x,i)=>{const p=`${path}.stays[${i}]`;assertKeys(x,p,["resourceId","rooms","checkInDay","checkInTime","checkoutDay"]);const stay={resourceId:string(x.resourceId,p+".resourceId",{max:80}),rooms:integer(x.rooms,p+".rooms",1,1000),checkInDay:integer(x.checkInDay,p+".checkInDay",1,days),checkInTime:time(x.checkInTime,p+".checkInTime"),checkoutDay:integer(x.checkoutDay,p+".checkoutDay",2,days+1)};if(stay.checkoutDay<=stay.checkInDay)fail(p,"checkoutDay 必须晚于 checkInDay");return stay;});return plan;}

  function parse(input,{allowEmptyPlans=true}={}){
    assertKeys(input,"task",["schemaVersion","taskId","revision","demo","evaluationDate","request","resources","facts","transfers","plans","migrationWarnings"]);
    if(input.schemaVersion!==VERSION)fail("schemaVersion",`必须为 ${VERSION}`);
    const task={schemaVersion:VERSION,taskId:string(input.taskId,"taskId",{max:80}),revision:integer(input.revision,"revision",0,Number.MAX_SAFE_INTEGER),demo:bool(input.demo,"demo"),evaluationDate:date(input.evaluationDate,"evaluationDate"),request:parseRequest(input.request),resources:[],facts:[],transfers:[],plans:[],migrationWarnings:Array.isArray(input.migrationWarnings)?input.migrationWarnings.map((x,i)=>string(x,`migrationWarnings[${i}]`,{max:500})):[]};
    if(!uuidPattern.test(task.taskId))fail("taskId","必须是 UUID");
    if(!Array.isArray(input.resources)||input.resources.length<1||input.resources.length>100)fail("resources","须为 1–100 项"); task.resources=input.resources.map(parseResource);
    if(!Array.isArray(input.facts)||input.facts.length>200)fail("facts","须为 0–200 项"); task.facts=input.facts.map(parseFact);
    if(!Array.isArray(input.transfers)||input.transfers.length>300)fail("transfers","须为 0–300 项"); task.transfers=input.transfers.map(parseTransfer);
    if(!Array.isArray(input.plans)||input.plans.length>20||(!allowEmptyPlans&&!input.plans.length))fail("plans",allowEmptyPlans?"须为 0–20 项":"须为 1–20 项"); task.plans=input.plans.map((x,i)=>parsePlan(x,i,task.request.days));
    for(const [collection,name] of [[task.resources,"resources"],[task.facts,"facts"],[task.transfers,"transfers"],[task.plans,"plans"]]){const seen=new Set();for(const item of collection){if(seen.has(item.id))fail(name,`ID 重复：${item.id}`);seen.add(item.id);}}
    const resourceIds=new Set(task.resources.map(x=>x.id)),factIds=new Set(task.facts.map(x=>x.id));
    for(const fact of task.facts)if(fact.resourceId!==null&&!resourceIds.has(fact.resourceId))fail(`facts.${fact.id}.resourceId`,"引用的资源不存在");
    for(const resource of task.resources){if(resource.destinationId!==task.request.destinationId)fail(`resources.${resource.id}.destinationId`,"必须与任务目的地一致");for(const key of ["pricingEvidenceIds","openingEvidenceIds","capacityEvidenceIds","suitabilityEvidenceIds"])for(const id of resource[key])if(!factIds.has(id))fail(`resources.${resource.id}.${key}`,`事实 ${id} 不存在`);}
    for(const transfer of task.transfers){if(!resourceIds.has(transfer.fromResourceId)||!resourceIds.has(transfer.toResourceId))fail(`transfers.${transfer.id}`,"起点或终点资源不存在");if(transfer.serviceResourceId!==null&&!resourceIds.has(transfer.serviceResourceId))fail(`transfers.${transfer.id}.serviceResourceId`,"服务资源不存在");for(const id of transfer.evidenceIds)if(!factIds.has(id))fail(`transfers.${transfer.id}.evidenceIds`,`事实 ${id} 不存在`);}
    for(const plan of task.plans){const itemIds=new Set();for(const item of plan.items){if(itemIds.has(item.itemId))fail(`plans.${plan.id}.items`,"itemId 重复");itemIds.add(item.itemId);if(!resourceIds.has(item.resourceId))fail(`plans.${plan.id}.${item.itemId}`,"引用的资源不存在");}for(const stay of plan.stays)if(!resourceIds.has(stay.resourceId))fail(`plans.${plan.id}.stays`,"引用的资源不存在");}
    return task;
  }

  function migrateV1(input){
    if(input?.schemaVersion===VERSION)return{task:parse(input),migrationWarnings:[],migrated:false,original:clone(input)};
    if(!plain(input)||!plain(input.request))fail("task","无法识别旧任务");
    const old=clone(input),r=old.request,days=Math.min(7,Math.max(1,Number.isInteger(r.days)?r.days:1)),warnings=["旧任务已迁移为 schema v2；新增饮食、无障碍、容量、事实有效期和住宿字段均需人工核对。","旧 confirmed 状态未升级为新增能力确认。"];
    const facts=[],resources=(old.resources||[]).map((resource,index)=>{const id=String(resource.id||`resource-${index+1}`),factId=`migrated-fact-${index+1}`;facts.push({id:factId,resourceId:id,topic:"旧资料",text:`由旧资源 ${resource.name||id} 迁移，需人工复核。`,sourceLabel:String(resource.source||"旧任务"),sourceUrl:null,observedAt:"1970-01-01",validFrom:null,validTo:null,status:"unknown",demo:Boolean(old.demo)});return{id,destinationId:"migrated-destination",areaId:String(resource.location||"unknown-area"),name:String(resource.name||id),type:["activity","stay","meal","transfer"].includes(resource.type)?resource.type:"activity",location:String(resource.location||"待核对地点"),durationMinutes:Number.isInteger(resource.durationMinutes)?Math.min(1440,Math.max(0,resource.durationMinutes)):60,openStart:/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(resource.openStart)?resource.openStart:"08:00",openEnd:/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(resource.openEnd)?resource.openEnd:"22:00",indoor:Boolean(resource.indoor),tags:Array.isArray(resource.tags)?resource.tags.map(String):[],priceMode:["ticket","per_person","per_room_night","fixed"].includes(resource.priceMode)?resource.priceMode:"fixed",adultPrice:resource.adultPrice??null,childPrice:resource.childPrice??null,seniorPrice:resource.seniorPrice??null,unitPrice:resource.unitPrice??null,capacityPerSlot:null,capacityPerRoom:null,accessibleRoomsAvailable:null,allergenFree:{},crossContactControlled:{},dietSupport:{},accessibility:{wheelchairRoute:"unknown",stepFree:"unknown",accessibleRoom:"unknown",accessibleVehicle:"unknown"},pricingEvidenceIds:[factId],openingEvidenceIds:[factId],capacityEvidenceIds:[factId],suitabilityEvidenceIds:[factId]};});
    const transfers=[]; const plans=(old.plans||[]).map((plan,pi)=>{const items=[];for(const [ii,item] of (plan.items||[]).entries()){const resource=resources.find(x=>x.id===item.resourceId);if(resource?.type==="stay"){warnings.push(`方案 ${plan.id||pi+1} 的旧住宿项目未推断房间与晚数，需人工补录。`);continue;}items.push({itemId:`migrated-${pi+1}-${ii+1}`,resourceId:item.resourceId,day:item.day,start:item.start,quantity:item.quantity??1,mealSlot:resource?.type==="meal"?"lunch":null});if(ii>0&&Number.isInteger(item.travelMinutes)){const previous=(plan.items||[])[ii-1];transfers.push({id:`migrated-transfer-${pi+1}-${ii}`,fromResourceId:previous.resourceId,toResourceId:item.resourceId,minutes:item.travelMinutes,walkingMinutes:Number.isInteger(item.walkingMinutes)?item.walkingMinutes:0,costMode:"unknown",amount:null,serviceResourceId:null,evidenceIds:[]});}}return{id:String(plan.id||`M${pi+1}`),name:String(plan.name||`迁移方案${pi+1}`),origin:"manual",source:String(plan.source||"旧任务迁移"),items,stays:[]};});
    const task={schemaVersion:VERSION,taskId:makeUuid(),revision:0,demo:Boolean(old.demo),evaluationDate:"1970-01-01",request:{destinationId:"migrated-destination",destination:String(r.destination||"待核对目的地"),startDate:null,days,adults:Number.isInteger(r.adults)?r.adults:1,children:Number.isInteger(r.children)?r.children:0,seniors:Number.isInteger(r.seniors)?r.seniors:0,budget:typeof r.budget==="number"&&r.budget>0?r.budget:1,maxWalkingMinutes:Number.isInteger(r.maxWalkingMinutes)?r.maxWalkingMinutes:600,weather:["clear","rain"].includes(r.weather)?r.weather:"clear",avoidOutdoorInRain:Boolean(r.avoidOutdoorInRain),interests:Array.isArray(r.interests)?r.interests:[],dietary:String(r.dietary||""),accessibility:String(r.accessibility||""),dayWindows:Array.from({length:days},(_,i)=>({day:i+1,start:"08:00",end:"22:00",minActivities:0,requiredMeals:[]})),requiredNights:[],selfArrangedNights:Array.from({length:Math.max(0,days-1)},(_,i)=>i+1),dietaryRequirements:{excludedAllergens:[],avoidCrossContact:false,dietTypes:[]},accessibilityRequirements:{wheelchairRoute:false,stepFree:false,accessibleRoom:false,accessibleVehicle:false},unresolvedRequirements:[...String(r.dietary||"").trim()?[{text:String(r.dietary),reason:"旧饮食原文尚未结构化"}]:[],...String(r.accessibility||"").trim()?[{text:String(r.accessibility),reason:"旧无障碍原文尚未结构化"}]:[]]},resources,facts,transfers,plans,migrationWarnings:warnings};
    return{task:parse(task),migrationWarnings:warnings,migrated:true,original:old};
  }

  function canonical(value){if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`;if(plain(value))return`{${Object.keys(value).filter(k=>!["revision","migrationWarnings"].includes(k)).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")}}`;return JSON.stringify(value);}
  function hash(input){const source=canonical(parse(input));let a=0x811c9dc5,b=0x9e3779b9;for(let i=0;i<source.length;i++){const c=source.charCodeAt(i);a=Math.imul(a^c,0x01000193)>>>0;b=Math.imul(b^(c+i),0x85ebca6b)>>>0;}return`task-v2-${a.toString(16).padStart(8,"0")}${b.toString(16).padStart(8,"0")}`;}

  const api={VERSION,parse,migrateV1,hash,canonical,makeUuid,minutes,clone};
  if(typeof module==="object"&&module.exports)module.exports=api;else root.TravelTaskSchema=api;
})(globalThis);
