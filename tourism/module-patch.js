(function(root){
  "use strict";
  const Schema=typeof module==="object"&&module.exports?require("./task-schema.js"):root.TravelTaskSchema;
  const clone=value=>structuredClone(value);
  const allowed=new Set(["replace-plan-item","update-plan-item-time","move-plan-item","remove-plan-item","update-request-field","replace-stay","update-stay","update-transfer","set-transfer-service"]);
  const requestFields=new Map([
    ["adults","成人数"],["children","儿童数"],["seniors","长者数"],["budget","预算上限"],
    ["maxWalkingMinutes","步行上限"],["weather","天气条件"],["avoidOutdoorInRain","雨天避开户外"],["interests","兴趣偏好"]
  ]);
  const stayFields=new Map([["resourceId","住宿"],["rooms","房间数"],["checkInDay","入住日"],["checkInTime","入住时间"],["checkoutDay","退房日"]]);
  const transferFields=new Map([["minutes","交通耗时"],["walkingMinutes","步行耗时"],["costMode","计费方式"],["amount","交通金额"],["serviceResourceId","交通服务"]]);
  const timePattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);

  function planFor(task,id){
    const plan=task.plans.find(item=>item.id===id);
    if(!plan)throw new Error("所选方案不存在或已经变化，请从工作台重新选择。");
    return plan;
  }

  function locate(input,target){
    const task=Schema.parse(input),type=String(target?.type||"");
    if(type==="request"){
      const planId=String(target?.planId||task.plans[0]?.id||"");
      const plan=planId?planFor(task,planId):null;
      return{task,target:{type,planId},plan,request:task.request};
    }
    if(type==="stay"){
      const planId=String(target?.planId||""),stayIndex=Number(target?.stayIndex),plan=planFor(task,planId);
      if(!Number.isInteger(stayIndex)||stayIndex<0||stayIndex>=plan.stays.length)throw new Error("所选住宿不存在或已经变化，请从工作台重新选择。");
      const stay=plan.stays[stayIndex],resource=task.resources.find(entry=>entry.id===stay.resourceId);
      if(!resource||resource.type!=="stay")throw new Error("所选住宿引用的资源不存在或类型错误。");
      if(target?.resourceId!==undefined&&String(target.resourceId)!==stay.resourceId)throw new Error("所选住宿已经变化，请从工作台重新选择。");
      return{task,target:{type,planId,stayIndex,resourceId:stay.resourceId},plan,stay,resource};
    }
    if(type==="transfer"){
      const planId=String(target?.planId||""),transferId=String(target?.transferId||""),plan=planFor(task,planId),transfer=task.transfers.find(entry=>entry.id===transferId);
      if(!transfer)throw new Error("所选交通区间不存在或已经变化，请从工作台重新选择。");
      const used=Array.from({length:task.request.days},(_,index)=>plan.items.filter(item=>item.day===index+1).sort((a,b)=>a.start.localeCompare(b.start))).some(items=>items.some((item,index)=>index>0&&items[index-1].resourceId===transfer.fromResourceId&&item.resourceId===transfer.toResourceId));
      if(!used)throw new Error("所选交通区间已不属于当前方案，请从工作台重新选择。");
      const from=task.resources.find(entry=>entry.id===transfer.fromResourceId),to=task.resources.find(entry=>entry.id===transfer.toResourceId),service=transfer.serviceResourceId?task.resources.find(entry=>entry.id===transfer.serviceResourceId):null;
      return{task,target:{type,planId,transferId},plan,transfer,from,to,service};
    }
    if(type!=="plan-item")throw new Error("当前支持整体需求、单个行程项、住宿和交通模块的对话修改。");
    const planId=String(target?.planId||""),itemId=String(target?.itemId||""),plan=planFor(task,planId),item=plan.items.find(entry=>entry.itemId===itemId);
    if(!item)throw new Error("修改目标不存在或已经变化，请从工作台重新选择。");
    const resource=task.resources.find(entry=>entry.id===item.resourceId);
    if(!resource)throw new Error("修改目标引用的资源不存在。");
    return{task,target:{type,planId,itemId},plan,item,resource};
  }

  function resourceProjection(entry){
    return{
      id:entry.id,name:entry.name,type:entry.type,location:entry.location,durationMinutes:entry.durationMinutes,
      openStart:entry.openStart,openEnd:entry.openEnd,indoor:entry.indoor,tags:entry.tags,
      priceMode:entry.priceMode,adultPrice:entry.adultPrice,childPrice:entry.childPrice,seniorPrice:entry.seniorPrice,unitPrice:entry.unitPrice,
      capacityPerRoom:entry.capacityPerRoom,accessibleRoomsAvailable:entry.accessibleRoomsAvailable,
      evidenceIds:[...new Set([...entry.pricingEvidenceIds,...entry.openingEvidenceIds,...entry.capacityEvidenceIds,...entry.suitabilityEvidenceIds])]
    };
  }

  function context(input,target){
    const found=locate(input,target),{task}=found;
    const base={taskId:task.taskId,revision:task.revision,taskHash:Schema.hash(task)};
    if(found.target.type==="request"){
      return{...base,target:{...found.target,label:"整体需求"},allowedFields:[...requestFields.keys()],request:Object.fromEntries([...requestFields.keys()].map(key=>[key,clone(task.request[key])])),candidates:[],facts:[]};
    }
    if(found.target.type==="transfer"){
      const transferCandidates=task.resources.filter(entry=>entry.type==="transfer").map(resourceProjection),allowedFacts=new Set([...found.transfer.evidenceIds,...transferCandidates.flatMap(entry=>entry.evidenceIds)]),transferFacts=task.facts.filter(fact=>allowedFacts.has(fact.id)).map(fact=>({factId:fact.id,resourceId:fact.resourceId,topic:fact.topic,sourceLabel:fact.sourceLabel,observedAt:fact.observedAt,validFrom:fact.validFrom,validTo:fact.validTo,status:fact.status,demo:fact.demo}));
      return{...base,request:{adults:task.request.adults,children:task.request.children,seniors:task.request.seniors,budget:task.request.budget,maxWalkingMinutes:task.request.maxWalkingMinutes,accessibilityRequirements:task.request.accessibilityRequirements},target:{...found.target,planName:found.plan.name,transfer:{...found.transfer},from:{id:found.from.id,name:found.from.name,location:found.from.location},to:{id:found.to.id,name:found.to.name,location:found.to.location},service:found.service?{id:found.service.id,name:found.service.name}:null},candidates:transferCandidates,facts:transferFacts};
    }
    const candidates=task.resources.filter(entry=>entry.type===found.resource.type).map(resourceProjection);
    const allowedFacts=new Set(candidates.flatMap(entry=>entry.evidenceIds));
    const facts=task.facts.filter(fact=>allowedFacts.has(fact.id)).map(fact=>({factId:fact.id,resourceId:fact.resourceId,topic:fact.topic,sourceLabel:fact.sourceLabel,observedAt:fact.observedAt,validFrom:fact.validFrom,validTo:fact.validTo,status:fact.status,demo:fact.demo}));
    if(found.target.type==="stay")return{...base,request:{days:task.request.days,adults:task.request.adults,children:task.request.children,seniors:task.request.seniors,budget:task.request.budget,accessibilityRequirements:task.request.accessibilityRequirements},target:{...found.target,planName:found.plan.name,stay:{...found.stay},resource:{id:found.resource.id,name:found.resource.name,type:found.resource.type,location:found.resource.location}},candidates,facts};
    return{
      ...base,request:{days:task.request.days,budget:task.request.budget,weather:task.request.weather,avoidOutdoorInRain:task.request.avoidOutdoorInRain,interests:task.request.interests,dietaryRequirements:task.request.dietaryRequirements,accessibilityRequirements:task.request.accessibilityRequirements,dayWindows:task.request.dayWindows},
      target:{...found.target,planName:found.plan.name,item:{...found.item},resource:{id:found.resource.id,name:found.resource.name,type:found.resource.type,location:found.resource.location,durationMinutes:found.resource.durationMinutes}},candidates,facts
    };
  }

  function assertKeys(raw,keys){for(const key of Object.keys(raw))if(!keys.includes(key))throw new Error(`修改操作包含未授权字段：${key}。`);}

  function updateRequest(request,raw){
    assertKeys(raw,["op","field","value"]);
    const field=String(raw.field||"");
    if(!requestFields.has(field))throw new Error("整体需求修改包含未授权字段。");
    const value=raw.value;
    if(["adults","children","seniors","maxWalkingMinutes"].includes(field)){
      if(!Number.isInteger(value))throw new Error(`${requestFields.get(field)}必须是整数。`);
    }else if(field==="budget"){
      if(typeof value!=="number"||!Number.isFinite(value))throw new Error("预算上限必须是数字。");
    }else if(field==="weather"){
      if(!["clear","rain"].includes(value))throw new Error("天气条件只支持 clear 或 rain。");
    }else if(field==="avoidOutdoorInRain"){
      if(typeof value!=="boolean")throw new Error("雨天避开户外必须是布尔值。");
    }else if(field==="interests"){
      if(!Array.isArray(value)||value.some(item=>typeof item!=="string"))throw new Error("兴趣偏好必须是字符串数组。");
      raw={...raw,value:[...new Set(value.map(item=>item.trim()).filter(Boolean))].slice(0,20)};
    }
    request[field]=clone(raw.value);
  }

  function apply(input,target,operations){
    const found=locate(input,target),next=clone(found.task);
    if(!Array.isArray(operations)||operations.length<1||operations.length>4)throw new Error("一次修改须包含 1–4 个受支持操作。");
    for(const raw of operations){
      if(!raw||typeof raw!=="object"||Array.isArray(raw)||!allowed.has(raw.op))throw new Error("包含不支持的模块修改操作。");
      if(found.target.type==="request"){
        if(raw.op!=="update-request-field")throw new Error("修改操作越出了整体需求范围。");
        updateRequest(next.request,raw);
        continue;
      }
      if(String(raw.planId||found.target.planId)!==found.target.planId)throw new Error("修改操作越出了所选方案范围。");
      if(found.target.type==="stay"){
        if(Number(raw.stayIndex??found.target.stayIndex)!==found.target.stayIndex)throw new Error("修改操作越出了所选住宿范围。");
        const plan=next.plans.find(item=>item.id===found.target.planId),stay=plan?.stays[found.target.stayIndex];
        if(!stay)throw new Error("所选住宿已不存在。");
        if(raw.op==="replace-stay"){
          assertKeys(raw,["op","planId","stayIndex","replacementResourceId"]);
          const replacement=next.resources.find(entry=>entry.id===String(raw.replacementResourceId||""));
          if(!replacement||replacement.type!=="stay")throw new Error("替换住宿不存在或资源类型错误。");
          stay.resourceId=replacement.id;
        }else if(raw.op==="update-stay"){
          assertKeys(raw,["op","planId","stayIndex","rooms","checkInDay","checkInTime","checkoutDay"]);
          const fields=["rooms","checkInDay","checkInTime","checkoutDay"].filter(key=>own(raw,key));
          if(!fields.length)throw new Error("住宿修改没有提供可应用字段。");
          for(const key of fields){
            if(["rooms","checkInDay","checkoutDay"].includes(key)&&!Number.isInteger(raw[key]))throw new Error(`${stayFields.get(key)}必须是整数。`);
            if(key==="checkInTime"&&!timePattern.test(raw[key]||""))throw new Error("入住时间必须为 HH:MM。");
            stay[key]=raw[key];
          }
        }else throw new Error("修改操作越出了所选住宿范围。");
        continue;
      }
      if(found.target.type==="transfer"){
        if(String(raw.transferId||"")!==found.target.transferId)throw new Error("修改操作越出了所选交通区间范围。");
        const transfer=next.transfers.find(item=>item.id===found.target.transferId);
        if(!transfer)throw new Error("所选交通区间已不存在。");
        if(raw.op==="set-transfer-service"){
          assertKeys(raw,["op","planId","transferId","serviceResourceId"]);
          if(raw.serviceResourceId===null)transfer.serviceResourceId=null;
          else{const service=next.resources.find(entry=>entry.id===String(raw.serviceResourceId||""));if(!service||service.type!=="transfer")throw new Error("交通服务资源不存在或类型错误。");transfer.serviceResourceId=service.id;}
        }else if(raw.op==="update-transfer"){
          assertKeys(raw,["op","planId","transferId","minutes","walkingMinutes","costMode","amount"]);
          const fields=["minutes","walkingMinutes","costMode","amount"].filter(key=>own(raw,key));
          if(!fields.length)throw new Error("交通修改没有提供可应用字段。");
          for(const key of fields){
            if(["minutes","walkingMinutes"].includes(key)&&(!Number.isInteger(raw[key])||raw[key]<0||raw[key]>1440))throw new Error(`${transferFields.get(key)}必须是 0–1440 的整数。`);
            if(key==="costMode"&&!['included','fixed','per_person','unknown'].includes(raw[key]))throw new Error("交通计费方式不受支持。");
            if(key==="amount"&&raw[key]!==null&&(typeof raw[key]!=="number"||!Number.isFinite(raw[key])||raw[key]<0||raw[key]>10000000))throw new Error("交通金额必须为空或有效非负数。");
            transfer[key]=raw[key];
          }
          if(transfer.walkingMinutes>transfer.minutes)throw new Error("步行耗时不能超过交通总耗时。");
          if(transfer.costMode==="unknown")transfer.amount=null;
          else if(transfer.costMode==="included")transfer.amount=0;
          else if(typeof transfer.amount!=="number"||!Number.isFinite(transfer.amount))throw new Error("固定或按人计费时必须提供交通金额。");
        }else throw new Error("修改操作越出了所选交通区间范围。");
        continue;
      }
      if(String(raw.itemId||"")!==found.target.itemId)throw new Error("修改操作越出了所选行程项范围。");
      const plan=next.plans.find(item=>item.id===found.target.planId),index=plan.items.findIndex(item=>item.itemId===found.target.itemId);
      if(index<0)throw new Error("修改目标已被删除，不能继续应用其他操作。");
      const item=plan.items[index];
      if(raw.op==="replace-plan-item"){
        assertKeys(raw,["op","planId","itemId","replacementResourceId"]);
        const replacementId=String(raw.replacementResourceId||""),current=next.resources.find(entry=>entry.id===item.resourceId),replacement=next.resources.find(entry=>entry.id===replacementId);
        if(!replacement||!current||replacement.type!==current.type)throw new Error("替换资源不存在或类型与原项目不一致。");
        item.resourceId=replacementId;
      }else if(raw.op==="update-plan-item-time"){
        assertKeys(raw,["op","planId","itemId","start"]);
        if(!timePattern.test(raw.start||""))throw new Error("行程项开始时间必须为 HH:MM。");
        item.start=raw.start;
      }else if(raw.op==="move-plan-item"){
        assertKeys(raw,["op","planId","itemId","day","start"]);
        if(!Number.isInteger(raw.day)||raw.day<1||raw.day>next.request.days)throw new Error("目标日期超出行程范围。");
        if(raw.start!==undefined&&!timePattern.test(raw.start))throw new Error("移动后的开始时间必须为 HH:MM。");
        item.day=raw.day;if(raw.start!==undefined)item.start=raw.start;
      }else if(raw.op==="remove-plan-item"){
        assertKeys(raw,["op","planId","itemId"]);plan.items.splice(index,1);
      }else throw new Error("修改操作越出了所选行程项范围。");
    }
    next.revision=found.task.revision+1;
    return Schema.parse(next);
  }

  function diff(beforeInput,afterInput,target){
    const before=locate(beforeInput,target),afterTask=Schema.parse(afterInput),rows=[];
    if(before.target.type==="request"){
      for(const [field,label] of requestFields){const left=before.task.request[field],right=afterTask.request[field];if(JSON.stringify(left)!==JSON.stringify(right))rows.push({field,label,before:clone(left),after:clone(right)});}
      return rows;
    }
    const resourceName=(task,id)=>task.resources.find(resource=>resource.id===id)?.name||id;
    if(before.target.type==="stay"){
      const after=afterTask.plans.find(item=>item.id===before.target.planId)?.stays[before.target.stayIndex];
      if(!after)throw new Error("修改后的住宿不存在。");
      for(const [field,label] of stayFields){const left=field==="resourceId"?resourceName(before.task,before.stay.resourceId):before.stay[field],right=field==="resourceId"?resourceName(afterTask,after.resourceId):after[field];if(left!==right)rows.push({field,label,before:left,after:right});}
      return rows;
    }
    if(before.target.type==="transfer"){
      const after=afterTask.transfers.find(item=>item.id===before.target.transferId);
      if(!after)throw new Error("修改后的交通区间不存在。");
      for(const [field,label] of transferFields){const left=field==="serviceResourceId"?(before.transfer[field]?resourceName(before.task,before.transfer[field]):"未绑定"):before.transfer[field],right=field==="serviceResourceId"?(after[field]?resourceName(afterTask,after[field]):"未绑定"):after[field];if(left!==right)rows.push({field,label,before:left,after:right});}
      return rows;
    }
    const afterPlan=afterTask.plans.find(item=>item.id===before.target.planId),after=afterPlan?.items.find(item=>item.itemId===before.target.itemId)||null;
    for(const [field,label] of [["resourceId","项目"],["day","日期"],["start","开始时间"]]){
      const left=field==="resourceId"?resourceName(before.task,before.item.resourceId):before.item[field],right=field==="resourceId"?(after?resourceName(afterTask,after.resourceId):"已删除"):after?.[field]??"已删除";
      if(left!==right)rows.push({field,label,before:left,after:right});
    }
    if(!after&&!rows.length)rows.push({field:"itemId",label:"行程项",before:resourceName(before.task,before.item.resourceId),after:"已删除"});
    return rows;
  }

  const api={allowedOperations:[...allowed],requestFields:[...requestFields.keys()],locate,context,apply,diff};
  if(typeof module==="object"&&module.exports)module.exports=api;else root.TravelModulePatch=api;
})(globalThis);
