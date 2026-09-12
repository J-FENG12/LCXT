(function(root){"use strict";
  const clone=value=>structuredClone(value);
  function localDraft(text,current){
    const source=String(text||"").trim();if(!source||source.length>20000)throw new Error("请输入 1–20000 字符的游客需求。");
    const next=clone(current),r=next.request,evidence=[],clarifications=[],changed=[];
    const set=(key,value,excerpt)=>{if(JSON.stringify(r[key])===JSON.stringify(value))return;r[key]=value;changed.push(key);if(excerpt)evidence.push({target:key,excerpt});};
    const capture=(regex,key,convert=x=>x)=>{const m=source.match(regex);if(m)set(key,convert(m[1]),m[0]);};
    capture(/(?:共|玩|游玩|行程)\s*(\d+)\s*天/,"days",Number);
    capture(/(\d+)\s*名?成人/,"adults",Number);capture(/(\d+)\s*(?:名)?儿童/,"children",Number);capture(/(\d+)\s*(?:名)?(?:老人|长者)/,"seniors",Number);
    capture(/(?:预算|总预算)(?:约|为|改为|调整为|控制在)?\s*(\d+(?:\.\d+)?)\s*元/,"budget",Number);
    capture(/(?:步行|走路)(?:不超过|上限|控制在)?\s*(\d+)\s*分钟/,"maxWalkingMinutes",Number);
    const date=source.match(/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?/);if(date)set("startDate",`${date[1]}-${date[2].padStart(2,"0")}-${date[3].padStart(2,"0")}`,date[0]);
    const interests=[...new Set([...(r.interests||[]),...["非遗","亲子","美食","摄影","研学","康养","夜游","文创"].filter(x=>source.includes(x))])];if(interests.length!==(r.interests||[]).length)set("interests",interests,interests.filter(x=>source.includes(x)).join("、"));
    const allergens=["花生","坚果","牛奶","鸡蛋","海鲜","虾","蟹","麸质","大豆"].filter(x=>new RegExp(`(?:过敏|不吃|不能吃|排除|不含)[^。；，,]{0,8}${x}|${x}[^。；，,]{0,8}(?:过敏|不吃|不能吃|排除|不含)`).test(source));
    if(allergens.length){const d={...r.dietaryRequirements,excludedAllergens:[...new Set([...(r.dietaryRequirements?.excludedAllergens||[]),...allergens])]};set("dietaryRequirements",d,allergens.join("、"));set("dietary",`排除：${d.excludedAllergens.join("、")}`,allergens.join("、"));}
    if(/避免交叉接触|严格防止交叉接触/.test(source)){set("dietaryRequirements",{...r.dietaryRequirements,avoidCrossContact:true},source.match(/避免交叉接触|严格防止交叉接触/)[0]);}
    const accessibility={...r.accessibilityRequirements};let accessChanged=false;for(const [pattern,key]of [[/轮椅/,"wheelchairRoute"],[/无台阶|无障碍通道/,"stepFree"],[/无障碍客房/,"accessibleRoom"],[/无障碍车辆/,"accessibleVehicle"]])if(pattern.test(source)){accessibility[key]=true;accessChanged=true;}if(accessChanged)set("accessibilityRequirements",accessibility,source.match(/轮椅|无台阶|无障碍通道|无障碍客房|无障碍车辆/g).join("、"));
    const arrival=source.match(/(?:首日|第一天)?[^。；]{0,8}(?:抵达|到达)[^\d]{0,4}(上午|下午|晚上)?\s*(\d{1,2})(?:[:：点时](\d{1,2})?)?|(?:首日|第一天)?[^。；]{0,8}(上午|下午|晚上)\s*(\d{1,2})(?:[:：点时](\d{1,2})?)?[^。；]{0,5}(?:抵达|到达)/);if(arrival){const period=arrival[1]||arrival[4]||"",rawHour=Number(arrival[2]||arrival[5]),rawMinute=arrival[3]||arrival[6],h=Math.min(23,rawHour+(/[下午晚上]/.test(period)&&rawHour<12?12:0)),m=rawMinute?Math.min(59,Number(rawMinute)):0;r.dayWindows=clone(r.dayWindows);r.dayWindows[0]={...r.dayWindows[0],start:`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`};changed.push("dayWindows[0].start");evidence.push({target:"dayWindows[0].start",excerpt:arrival[0]});}
    if(/那里|那个地方|那边/.test(source)&&!/(?:去|到|目的地为)(?!那里|那个地方|那边)[^。；，,]{2,20}/.test(source))clarifications.push("“那里/那个地方”指哪个目的地或资源？请补充明确名称。");
    const days=Math.max(1,Math.min(7,Number(r.days)||1));r.days=days;r.dayWindows=Array.from({length:days},(_,i)=>r.dayWindows?.find(x=>x.day===i+1)||{day:i+1,start:"09:00",end:"18:00",minActivities:1,requiredMeals:["lunch"]});const nights=Array.from({length:Math.max(0,days-1)},(_,i)=>i+1);r.requiredNights=(r.requiredNights||[]).filter(x=>nights.includes(x));r.selfArrangedNights=(r.selfArrangedNights||[]).filter(x=>nights.includes(x)&&!r.requiredNights.includes(x));for(const night of nights)if(!r.requiredNights.includes(night)&&!r.selfArrangedNights.includes(night))r.selfArrangedNights.push(night);
    return{payload:next,evidence,questions:clarifications,changed:[...new Set(changed)],source,mode:"local"};
  }
  function diff(current,draft){const out=[];for(const key of Object.keys(draft.request)){const before=current.request[key],after=draft.request[key];if(JSON.stringify(before)!==JSON.stringify(after))out.push({field:key,before,after});}return out;}
  const api={localDraft,diff};if(typeof module==="object"&&module.exports)module.exports=api;else root.TravelRequestEditor=api;
})(globalThis);
