(function(root){
  "use strict";
  const Editor=root.TravelRequestEditor,Generator=root.TravelPlanGenerator,ModulePatch=root.TravelModulePatch;
  if(!Editor||!Generator||!ModulePatch)return;
  const el=(tag,attrs={},children=[])=>{const node=document.createElement(tag);for(const[key,value]of Object.entries(attrs)){if(key==="text")node.textContent=value;else if(key==="class")node.className=value;else if(key.startsWith("on"))node.addEventListener(key.slice(2),value);else if(value!==undefined&&value!==null)node.setAttribute(key,value);}node.append(...children.filter(Boolean));return node;};
  const button=(text,onclick,attrs={})=>el("button",{type:"button",text,onclick,...attrs});
  let sessionId=null,target=null,pending=null,busy=false,lastPrompt="",lastApplied=null;

  function workbench(){if(!root.TravelWorkbench)throw new Error("文旅工作台尚未加载，请稍后重试。");return root.TravelWorkbench;}
  async function ensureSession(){if(!root.TravelAgentRequest)throw new Error("当前入口没有本机文旅 Agent；请使用桌面版并先配置自己的模型。");if(!sessionId)sessionId=(await root.TravelAgentRequest({action:"new"})).sessionId;return sessionId;}
  function panel(){return document.getElementById("tcv-panel");}
  function content(){return document.getElementById("tcv-content");}
  function show(){const node=panel();if(node)node.hidden=false;}
  function hide(){const node=panel();if(node)node.hidden=true;}
  function setBusy(value,message){busy=value;const node=document.getElementById("tcv-state");if(node){node.textContent=message||"";node.dataset.kind=value?"busy":"info";}}
  function targetLabel(){if(!target)return"";try{const found=ModulePatch.locate(workbench().read(),target);if(found.target.type==="request")return`整体需求 / ${found.plan?.name||"当前任务"}`;if(found.target.type==="stay")return`${found.plan.name} / 住宿 / ${found.resource.name}`;if(found.target.type==="transfer")return`${found.plan.name} / 交通 / ${found.from.name} → ${found.to.name}`;return`${found.plan.name} / 第 ${found.item.day} 天 / ${found.resource?.name||found.item.itemId}`;}catch{return"所选模块已经变化";}}
  function targetHint(){if(target?.type==="request")return"请描述预算、人数、步行上限、天气、雨天策略或兴趣偏好的调整。模型只会形成待确认提案。";if(target?.type==="stay")return"请描述住宿替换、房间数或入住退房安排。模型只会形成待确认提案。";if(target?.type==="transfer")return"请描述交通总耗时、步行耗时、计费方式、金额或已录入交通服务的调整。模型只会形成待确认提案。";return"请在下方输入框描述对这个行程项的修改要求。模型只会形成待确认提案。";}
  function targetScope(){if(target?.type==="request")return"只修改提案中列出的整体需求字段；方案、资源与事实尚未改变。";if(target?.type==="stay")return"只修改所选方案中的该住宿记录；其他方案与资源库尚未改变。";if(target?.type==="transfer")return"只修改这条共享交通记录；使用同一起终点的方案会一并重新核算，正式任务尚未改变。";return"只影响所选行程项；正式任务尚未改变。";}
  function format(value){if(Array.isArray(value))return value.join("、");if(value&&typeof value==="object")return JSON.stringify(value);return String(value??"未填写");}
  async function discardPatch(){const proposalId=pending?.kind==="patch"?pending.out?.proposalId:null;pending=null;target=null;if(proposalId&&root.TravelAgentRequest)try{await root.TravelAgentRequest({action:"task_discard_proposal",proposalId});}catch{}renderWelcome();}
  function restorePatch(out){if(!out||pending||busy)return false;try{const found=ModulePatch.locate(workbench().read(),out.target);if(out.baseRevision!==workbench().read().revision||out.baseTaskHash!==workbench().metadata().taskHash)return false;target={...found.target};pending={kind:"patch",out};const node=attach();if(node){show();renderPatch(out);}return true;}catch{return false;}}

  function renderWelcome(){const box=content();if(!box)return;box.replaceChildren(el("div",{class:"tcv-head"},[el("div",{},[el("b",{text:target?`正在修改：${targetLabel()}`:"文旅方案对话"}),el("p",{text:target?targetHint():"选择“文旅需求规划”后，直接在下方描述出行需求。模型完成后可确认并打开同一任务的工作台。"})]),button("关闭",()=>{target=null;pending=null;hide();})]),...(target?[]:[el("div",{class:"tcv-actions"},[button("让模型建议公开资料检索",suggestSearch)])]));}
  function diffTable(rows){return el("div",{class:"tcv-diff"},rows.length?rows.map(row=>el("div",{class:"tcv-diff-row"},[el("b",{text:row.label||row.field}),el("span",{text:format(row.before)}),el("span",{text:"→"}),el("strong",{text:format(row.after)})])):[el("p",{text:"没有检测到可应用的字段变化。"})]);}
  function renderError(error){const box=content();if(!box)return;box.replaceChildren(el("div",{class:"tcv-head"},[el("div",{},[el("b",{text:"文旅方案对话"}),el("p",{class:"tcv-error",text:error.message||String(error)})]),button("关闭",hide)]));}
  function renderDraft(out){const rows=Editor.diff(workbench().read(),out.payload),box=content();box.replaceChildren(
    el("div",{class:"tcv-head"},[el("div",{},[el("b",{text:"需求草案已生成"}),el("p",{text:`模型：${out.model?.provider||"已配置服务"} / ${out.model?.model||"当前模型"}。尚未修改工作台任务。`})]),button("放弃",()=>{pending=null;renderWelcome();})]),
    diffTable(rows),
    out.questions?.length?el("p",{class:"tcv-warning",text:`待澄清：${out.questions.join("；")}`}):el("p",{class:"tcv-good",text:"可先应用草案，再由确定性规则生成和校验候选方案。"}),
    el("div",{class:"tcv-actions"},[button("应用并生成方案",applyDraft,{class:"tcv-primary",disabled:rows.length?null:""}),button("打开当前工作台",()=>workbench().open())])
  );}
  function renderPatch(out){const row=out.evaluation?.rows?.find(item=>item.id===out.target.planId),box=content();box.replaceChildren(
    el("div",{class:"tcv-head"},[el("div",{},[el("b",{text:`修改提案：${targetLabel()}`}),el("p",{text:targetScope()})]),button("放弃",discardPatch)]),
    diffTable(out.diff||[]),
    el("p",{text:out.reason||"按当前要求形成局部修改提案。"}),
    el("div",{class:"tcv-impact"},[el("span",{text:`校验：${row?.statusLabel||"待评估"}`}),el("span",{text:`已知费用：¥${Number(row?.totals?.knownSubtotal||0).toLocaleString("zh-CN")}`}),el("span",{text:`步行：${row?.walkingMinutes??"待核实"} 分钟`}),el("span",{text:`事实引用：${out.evidenceIds?.join("、")||"无"}`})]),
    out.questions?.length?el("p",{class:"tcv-warning",text:`待澄清：${out.questions.join("；")}`}):null,
    el("div",{class:"tcv-actions"},[button("确认应用修改",applyPatch,{class:"tcv-primary"}),button("返回工作台",()=>workbench().open())])
  );}
  function renderApplied(message){const box=content();box.replaceChildren(el("div",{class:"tcv-head"},[el("div",{},[el("b",{text:"方案已同步到工作台"}),el("p",{text:message})]),button("关闭",hide)]),el("div",{class:"tcv-actions"},[button("打开文旅工作台",()=>workbench().open(),{class:"tcv-primary"}),button("让模型建议公开资料检索",suggestSearch),button("继续在对话中调整",()=>{pending=null;renderWelcome();focusComposer();})]));}

  function renderSearchProposal(out,provider){const box=content();box.replaceChildren(
    el("div",{class:"tcv-head"},[el("div",{},[el("b",{text:"公开资料检索建议"}),el("p",{text:`模型只选择主题，实际查询由本机按白名单拼接；当前适配器：${provider}。尚未发起搜索。`})]),button("放弃",()=>{pending=null;renderWelcome();})]),
    el("div",{class:"tcv-diff"},out.intents.map(item=>el("div",{class:"tcv-diff-row"},[el("span",{text:item.query})]))),
    el("p",{class:"tcv-warning",text:"请先确认检索词不含个人信息。确认后将把上列词发送给搜索提供方，最多 3 次；可能消耗服务额度。结果只是待核实网页摘要，不会自动改变方案或认定为事实。"}),
    el("div",{class:"tcv-actions"},[button("确认并执行检索",executeSearch,{class:"tcv-primary"}),button("基础工具设置",()=>root.TravelToolSettings?.open?.())])
  );}
  async function suggestSearch(){if(busy)return;show();setBusy(true,"正在检查工具配置并生成公开资料检索建议……");try{
    if(!root.TravelToolRequest)throw new Error("当前入口没有联网工具；离线 HTML 不会搜索。");
    const status=await root.TravelToolRequest({action:"status"}),search=status.capabilities?.search;
    if(!search?.enabled||!search.executable){const box=content();box.replaceChildren(el("p",{text:"请先在基础工具设置中启用本地模拟搜索，或自行配置并启用 Tavily / SearXNG 搜索。"}),button("打开基础工具设置",()=>root.TravelToolSettings?.open?.()));return;}
    await workbench().flush();const task=workbench().read(),sid=await ensureSession(),out=await root.TravelAgentRequest({action:"suggest_search",sessionId:sid,task});
    pending={kind:"search",out};renderSearchProposal(out,search.providerLabel);
  }catch(error){renderError(error);}finally{setBusy(false,"");}}
  async function executeSearch(){if(busy||pending?.kind!=="search")return;setBusy(true,"正在检索公开网页……");try{
    const out=pending.out,task=workbench().read(),context={taskId:task.taskId,revision:task.revision,taskHash:root.TravelTaskSchema.hash(task)};
    if(out.taskHash!==context.taskHash||out.revision!==context.revision||out.taskId!==context.taskId)throw new Error("任务已变化，请重新生成检索建议。");
    await workbench().flush();const all=[];
    for(const intent of out.intents){const result=await root.TravelToolRequest({action:"execute",capability:"search",context,input:{theme:intent.theme,resourceId:intent.resourceId,limit:3}});all.push(...(result.candidates||[]));}
    pending=null;const box=content();box.replaceChildren(el("div",{class:"tcv-head"},[el("div",{},[el("b",{text:`检索完成：${all.length} 条待核实资料`}),el("p",{text:"请打开候选箱查看来源并人工采纳；未自动写入方案。"})]),button("关闭",hide)]),el("div",{class:"tcv-actions"},[button("查看候选资料",()=>root.TravelToolSettings?.open?.(),{class:"tcv-primary"}),button("打开文旅工作台",()=>workbench().open())]));
  }catch(error){renderError(error);}finally{setBusy(false,"");}}

  async function applyDraft(){if(!pending||pending.kind!=="draft"||busy)return;setBusy(true,"正在生成并校验候选方案……");try{const current=workbench().read(),draft=structuredClone(pending.out.payload),generated=Generator.generate({...draft,plans:[]},{maxOutput:12}),manual=current.plans.filter(plan=>plan.origin==="manual");draft.plans=[...manual,...generated.plans];workbench().load(draft);const task=workbench().read(),sid=await ensureSession(),evaluated=await root.TravelAgentRequest({action:"evaluate",sessionId:sid,task});workbench().result(evaluated.result);if(evaluated.selectedPlanId)workbench().select(evaluated.selectedPlanId);lastApplied={taskId:task.taskId,revision:task.revision,taskHash:evaluated.result.taskHash};pending=null;target=null;renderApplied(`已生成 ${generated.plans.length} 个本地有界候选，并保留 ${manual.length} 个手工方案；所有方案均已重新计算费用、时间、步行、证据与风险。`);}catch(error){renderError(error);}finally{setBusy(false,"");}}
  async function applyPatch(){if(!pending||pending.kind!=="patch"||busy)return;setBusy(true,"正在校验并应用局部修改……");try{const current=workbench().read(),sid=await ensureSession(),out=await root.TravelAgentRequest({action:"apply_proposal",sessionId:sid,proposalId:pending.out.proposalId,task:current});workbench().load(out.task);workbench().result(out.result);if(out.selectedPlanId)workbench().select(out.selectedPlanId);lastApplied={taskId:out.task.taskId,revision:out.task.revision,taskHash:out.result.taskHash};pending=null;target=null;renderApplied("模块修改已应用；未授权的源字段保持不变，费用、时间、步行、证据和风险已由确定性核心全量重算，旧确认已失效。");}catch(error){renderError(error);}finally{setBusy(false,"");}}
  async function submit(detail={}){const slugs=(detail.skills||detail.skillSlugs||[]).map(item=>typeof item==="string"?item:item.slug),claimed=slugs.includes("travel-demand-planner")||Boolean(target);if(!claimed)return false;if(busy){show();return true;}const text=String(detail.text||"").trim();if(!text){show();renderError(new Error("请输入具体的文旅需求或模块修改要求。"));return true;}show();lastPrompt=text;setBusy(true,target?"模型正在生成局部修改提案……":"模型正在整理需求草案……");try{const sid=await ensureSession();if(target){const out=await root.TravelAgentRequest({action:"propose_patch",sessionId:sid,text,task:workbench().read(),target});pending={kind:"patch",out};renderPatch(out);}else{const task=workbench().read(),out=await root.TravelAgentRequest({action:"extract",sessionId:sid,text,demo:task.demo,basePayload:task});pending={kind:"draft",out};renderDraft(out);}}catch(error){renderError(error);}finally{setBusy(false,"");}return true;}

  function focusComposer(){const input=document.querySelector('[data-testid="composer-input-area"] [contenteditable="true"]');input?.focus();}
  function setTarget(next){const found=ModulePatch.locate(workbench().read(),next);target={...found.target};pending=null;attach();show();renderWelcome();workbench().close();setTimeout(focusComposer,0);}
  function clearTarget(){target=null;pending=null;renderWelcome();}
  function attach(){if(panel())return panel();const dock=document.querySelector('[data-testid="composer-input-area"]')?.closest(".chat-composer-dock");if(!dock)return null;const node=el("section",{id:"tcv-panel",class:"tcv-panel",hidden:"","aria-label":"文旅方案对话结果"},[el("div",{id:"tcv-content"}),el("p",{id:"tcv-state","aria-live":"polite"})]);dock.parentElement.insertBefore(node,dock);if(pending?.kind==="patch"){node.hidden=false;renderPatch(pending.out);}return node;}
  function install(){if(!document.getElementById("tcv-style"))document.head.append(el("style",{id:"tcv-style",text:`.tcv-panel{margin:0 0 10px;border:1px solid #cfe1df;border-radius:16px;background:#f8fcfb;padding:14px;color:#173d45;box-shadow:0 10px 28px #173d4512}.tcv-panel[hidden]{display:none!important}.tcv-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.tcv-head b{font-size:15px}.tcv-head p{margin:4px 0 0;color:#61777d;font-size:12px}.tcv-head button,.tcv-actions button{border:1px solid #c8d9d7;border-radius:9px;background:#fff;padding:7px 11px;color:#28585f}.tcv-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px}.tcv-actions .tcv-primary{background:#126c67;color:#fff;border-color:#126c67}.tcv-diff{display:grid;gap:6px;margin-top:12px}.tcv-diff-row{display:grid;grid-template-columns:minmax(90px,.7fr) minmax(100px,1fr) 22px minmax(100px,1fr);gap:7px;padding:8px;border-radius:9px;background:#fff;font-size:12px}.tcv-diff-row>span:nth-child(3){text-align:center;color:#819398}.tcv-warning{color:#8a5b12}.tcv-good{color:#216644}.tcv-error{color:#b42318!important}.tcv-impact{display:flex;gap:7px;flex-wrap:wrap}.tcv-impact span{padding:5px 8px;border-radius:8px;background:#e7f2ef;font-size:11px}#tcv-state{margin:7px 0 0;color:#507179;font-size:11px}#tcv-state[data-kind=busy]{color:#986515}@media(max-width:680px){.tcv-diff-row{grid-template-columns:1fr}.tcv-diff-row>span:nth-child(3){display:none}}`}));attach();new MutationObserver(()=>attach()).observe(document.body,{childList:true,subtree:true});document.addEventListener("travel-workbench-restored",event=>restorePatch(event.detail?.pendingProposal));setTimeout(()=>restorePatch(workbench().pendingProposal?.()),0);}
  root.TravelConversationSubmit=submit;
  root.TravelConversation={submit,setTarget,clearTarget,restorePatch,state:()=>({sessionId,target:target&&{...target},pending:pending&&{kind:pending.kind,proposalId:pending.out?.proposalId||null},busy,lastPrompt,lastApplied}),openWorkbench:()=>workbench().open()};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install);else install();
})(globalThis);
