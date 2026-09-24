(function(root){
  "use strict";

  const $=id=>document.getElementById(`tj-${id}`);
  const el=(tag,attrs={},children=[])=>{
    const node=document.createElement(tag);
    for(const [key,value] of Object.entries(attrs)){
      if(key==="text")node.textContent=value;
      else if(key==="class")node.className=value;
      else if(key.startsWith("on"))node.addEventListener(key.slice(2),value);
      else if(value!==undefined&&value!==null)node.setAttribute(key,value);
    }
    node.append(...children);
    return node;
  };
  const button=(text,onclick,attrs={})=>el("button",{type:"button",text,onclick,...attrs});
  const money=value=>Number.isFinite(value)?`¥${Number(value).toLocaleString("zh-CN",{maximumFractionDigits:2})}`:"待核实";
  const clock=value=>Number.isFinite(value)?`${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`:"--:--";
  const typeNames={activity:"游览",meal:"餐饮",stay:"住宿",transfer:"交通"};
  const typeMarks={activity:"游",meal:"餐",stay:"住",transfer:"行"};
  let activeTab="journey";

  function isBlank(task){return !task.demo&&task.plans.length===0&&task.facts.length===0&&task.resources.length===1&&task.resources[0].id==="draft-resource";}

  function dayLabel(startDate,day){
    if(!startDate)return `第 ${day} 天`;
    const date=new Date(`${startDate}T00:00:00`);
    if(Number.isNaN(date.getTime()))return `第 ${day} 天`;
    date.setDate(date.getDate()+day-1);
    return `${date.getMonth()+1}月${date.getDate()}日 · 第 ${day} 天`;
  }

  function current(){
    const task=root.TravelWorkbench.read();
    const result=root.TravelWorkbench.currentResult();
    const selectedPlanId=root.TravelWorkbench.selectedPlanId();
    const row=result?.rows?.find(item=>item.id===selectedPlanId)||result?.rows?.[0]||null;
    const plan=task.plans.find(item=>item.id===(row?.id||selectedPlanId))||task.plans[0]||null;
    return{task,result,row,plan};
  }

  function evidenceSummary(task){
    const date=task.evaluationDate;
    const result={confirmed:0,unknown:0,conflict:0,expired:0};
    for(const fact of task.facts){
      const expired=Boolean(fact.validTo&&date&&fact.validTo<date);
      if(expired)result.expired++;
      else if(fact.status==="confirmed")result.confirmed++;
      else if(fact.status==="conflict")result.conflict++;
      else result.unknown++;
    }
    return result;
  }

  function renderHeader(state){
    const {task,row,plan}=state,request=task.request,total=request.adults+request.children+request.seniors,evidence=evidenceSummary(task);
    const blank=isBlank(task);
    $("destination").textContent=blank?"开始新的文旅行程":request.destination;
    $("subtitle").textContent=blank?`在主对话中选择“文旅需求规划”并描述需求 · 版本 ${task.revision}`:`${request.startDate||"日期待定"} · ${request.days} 天 · ${total} 人 · ${request.weather==="rain"?"雨天条件":"晴天条件"} · 版本 ${task.revision}`;
    $("interest").textContent=blank?"尚未载入演示或真实资料":(request.interests.length?request.interests.join(" · "):"兴趣待补充");
    $("budget-value").textContent=blank?"待填写":money(request.budget);
    $("cost-value").textContent=row?money(row.totals.knownSubtotal):"待评估";
    $("walk-value").textContent=row?`${row.walkingMinutes} 分钟`:"待评估";
    $("evidence-value").textContent=`${evidence.confirmed}/${task.facts.length}`;
    $("evidence-caption").textContent=evidence.conflict?`${evidence.conflict} 条冲突`:(evidence.unknown+evidence.expired?`${evidence.unknown+evidence.expired} 条待核实`:"当前资料均有效");
    const ratio=row&&request.budget>0?Math.min(100,Math.round(row.totals.knownSubtotal/request.budget*100)):0;
    $("budget-bar").style.width=`${ratio}%`;
    $("budget-caption").textContent=row?(row.totals.priceComplete?`占预算 ${ratio}%`:`已知小计，占预算 ${ratio}%`):"评估后显示预算占用";
    const requestEdit=$("request-edit");if(requestEdit){requestEdit.hidden=blank||!plan;requestEdit.dataset.planId=plan?.id||"";}
  }

  function renderPlans(state){
    const box=$("plans"),{task,result,row}=state;
    if(!result){
      box.replaceChildren(el("div",{class:"tj-empty",text:isBlank(task)?"当前是空白任务。请先在对话中描述需求；需要体验完整界面时，可点击顶部“载入演示”。":"需求发生变化，请先进行确定性评估。"}));
      return;
    }
    box.replaceChildren(...result.rows.map(item=>{
      const selected=item.id===row?.id;
      const card=button("",()=>root.TravelWorkbench.select(item.id),{class:`tj-plan-card ${selected?"selected":""}`,"aria-pressed":String(selected)});
      card.append(
        el("span",{class:`tj-state ${item.status}`,text:item.status==="eligible"?"可选":item.status==="pending"?"待核实":"不满足"}),
        el("strong",{text:item.name}),
        el("span",{class:"tj-plan-meta",text:`${money(item.totals.knownSubtotal)} · 步行 ${item.walkingMinutes} 分钟`}),
        el("small",{text:item.issues.length?`${item.issues.length} 项需关注`:"当前条件无冲突"})
      );
      return card;
    }));
  }

  function scheduleCard(item,planId,stayIndex=-1){
    const article=el("article",{class:`tj-stop ${item.type||item.kind}`});
    article.append(
      el("div",{class:"tj-stop-time",text:clock(item.start)}),
      el("div",{class:"tj-stop-mark",text:typeMarks[item.type||item.kind]||"点"}),
      el("div",{class:"tj-stop-body"},[
        el("div",{class:"tj-stop-heading"},[
          el("strong",{text:item.name||"未命名项目"}),
          el("span",{class:"tj-stop-actions"},[
            el("span",{class:"tj-kind",text:typeNames[item.type||item.kind]||"项目"}),
            item.kind==="item"?button("在对话中修改",()=>root.TravelConversation?.setTarget({type:"plan-item",planId,itemId:item.itemId}),{class:"tj-edit","data-target-type":"plan-item","data-plan-id":planId,"data-item-id":item.itemId}):
              item.kind==="stay"&&stayIndex>=0?button("在对话中修改",()=>root.TravelConversation?.setTarget({type:"stay",planId,stayIndex,resourceId:item.resourceId}),{class:"tj-edit","data-target-type":"stay","data-plan-id":planId,"data-stay-index":String(stayIndex)}):null
          ].filter(Boolean))
        ]),
        el("p",{text:`${item.location||"位置待核实"} · ${clock(item.start)}–${clock(item.end)}`}),
        item.kind==="stay"?el("small",{text:`${item.rooms} 间 · ${item.nights} 晚`}):el("small",{text:item.mealSlot?`餐次：${({breakfast:"早餐",lunch:"午餐",dinner:"晚餐"})[item.mealSlot]||item.mealSlot}`:"已纳入当前方案"})
      ])
    );
    return article;
  }

  function transferCard(item,planId){
    return el("div",{class:"tj-transfer"},[
      el("span"),
      el("span",{class:"tj-transfer-line",text:"↓"}),
      el("span",{},[el("span",{text:`交通 ${Math.max(0,item.end-item.start)} 分钟${item.walkingMinutes?` · 步行 ${item.walkingMinutes} 分钟`:""}`}),button("在对话中修改",()=>root.TravelConversation?.setTarget({type:"transfer",planId,transferId:item.transferId}),{class:"tj-edit","data-target-type":"transfer","data-plan-id":planId,"data-transfer-id":item.transferId})])
    ]);
  }

  function renderTimeline(state){
    const box=$("timeline"),{task,row}=state;
    if(!row){box.replaceChildren(el("div",{class:"tj-empty",text:"完成评估后，这里会按天生成可视化行程。"}));return;}
    const selectedPlan=task.plans.find(plan=>plan.id===row.id);
    const days=[];
    for(let day=1;day<=task.request.days;day++){
      const schedule=row.schedule.filter(item=>item.day===day).sort((a,b)=>a.start-b.start);
      const window=task.request.dayWindows.find(item=>item.day===day);
      days.push(el("section",{class:"tj-day"},[
        el("header",{class:"tj-day-head"},[
          el("div",{},[el("span",{class:"tj-day-index",text:String(day)}),el("strong",{text:dayLabel(task.request.startDate,day)})]),
          el("small",{text:window?`${window.start}–${window.end}`:"时段待核实"})
        ]),
        el("div",{class:"tj-day-body"},schedule.length?schedule.map(item=>{if(item.kind==="transfer")return transferCard(item,row.id);const stayIndex=item.kind==="stay"?selectedPlan?.stays.findIndex(stay=>stay.resourceId===item.resourceId&&stay.checkInDay===item.day&&stay.rooms===item.rooms):-1;return scheduleCard(item,row.id,stayIndex);}):[el("p",{class:"tj-empty",text:"本日尚无安排。"})])
      ]));
    }
    box.replaceChildren(...days);
  }

  function renderRoute(state){
    const box=$("route"),{task,row}=state;
    if(!row){box.replaceChildren(el("div",{class:"tj-empty",text:"尚无可展示路线。"}));return;}
    const groups=[];
    for(let day=1;day<=task.request.days;day++){
      const schedule=row.schedule.filter(item=>item.day===day).sort((a,b)=>a.start-b.start),nodes=[];
      let number=0;
      for(const item of schedule){
        if(item.kind==="transfer"){
          nodes.push(el("div",{class:"tj-route-link"},[
            el("span"),el("small",{text:`${Math.max(0,item.end-item.start)} 分钟${item.walkingMinutes?` · 步行 ${item.walkingMinutes}`:""}`})
          ]));
        }else{
          number++;
          nodes.push(el("div",{class:"tj-route-node"},[
            el("span",{class:"tj-route-number",text:String(number)}),
            el("div",{},[el("strong",{text:item.name}),el("small",{text:`${item.location||"位置待核实"} · ${clock(item.start)}`})])
          ]));
        }
      }
      groups.push(el("section",{class:"tj-route-day"},[
        el("h4",{text:`第 ${day} 天路线`}),
        ...(nodes.length?nodes:[el("p",{class:"tj-empty",text:"本日尚无路线。"})])
      ]));
    }
    box.replaceChildren(...groups);
  }

  function renderDetails(state){
    const {task,row}=state,evidence=evidenceSummary(task),riskBox=$("risks"),costBox=$("costs");
    const risks=row?.issues||[];
    riskBox.replaceChildren(
      el("div",{class:"tj-mini-stats"},[
        el("span",{text:`已确认 ${evidence.confirmed}`}),
        el("span",{text:`待核实 ${evidence.unknown+evidence.expired}`}),
        el("span",{text:`冲突 ${evidence.conflict}`})
      ]),
      ...(risks.length?risks.slice(0,5).map(issue=>el("div",{class:`tj-risk ${issue.severity||"pending"}`,text:issue.message})):[el("p",{class:"tj-good",text:"当前方案未发现已录入条件冲突。"})])
    );
    const costs=row?.costItems||[];
    costBox.replaceChildren(...(costs.length?costs.map(item=>el("div",{class:"tj-cost-row"},[
      el("span",{},[el("strong",{text:item.name}),el("small",{text:item.formula})]),
      el("b",{text:item.complete?money(item.subtotal):"待核实"})
    ])):[el("p",{class:"tj-empty",text:"评估后显示费用组成。"})]));
  }

  function render(){
    if(!root.TravelWorkbench||!$("root"))return;
    const state=current();
    renderHeader(state);
    renderPlans(state);
    renderTimeline(state);
    renderRoute(state);
    renderDetails(state);
  }

  function showTab(name){
    activeTab=name;
    for(const pane of document.querySelectorAll(".tj-pane"))pane.hidden=pane.dataset.pane!==name;
    for(const tab of document.querySelectorAll(".tj-tab")){
      const active=tab.dataset.tab===name;
      tab.classList.toggle("active",active);
      tab.setAttribute("aria-selected",String(active));
    }
    $("root")?.scrollIntoView({block:"start",behavior:"smooth"});
  }

  function install(){
    if(!root.TravelWorkbench||$("root"))return;
    const main=document.querySelector("#tv-root .tv-main");
    if(!main)return;
    document.getElementById("tv-root").classList.add("tv-journey-enabled");
    document.head.append(el("style",{text:`
      #tv-root.tv-journey-enabled{--tj-ink:#173d45;--tj-muted:#688087;--tj-brand:#0d6b68;--tj-accent:#e8904f;--tj-line:#dce9e7;background:linear-gradient(180deg,#edf6f2 0,#f7f9f7 340px,#f4f6f5 100%)}
      .tv-journey-enabled .tv-top{position:sticky;top:0;z-index:4;padding:13px max(22px,calc((100vw - 1420px)/2));background:#113d43eF;backdrop-filter:blur(14px)}
      .tv-journey-enabled .tv-main{max-width:1480px;padding:20px 28px 42px}.tv-journey-enabled .tv-hero,.tv-journey-enabled .tc-scenarios,.tv-journey-enabled>.tv-nav{display:none!important}
      .tv-journey-enabled .tv-banner{margin:0 0 14px;border-color:#ead7a3;background:#fff8e8;border-radius:12px}
      .tj-shell{display:grid;gap:14px}.tj-overview{position:relative;overflow:hidden;padding:28px;border-radius:24px;color:#fff;background:linear-gradient(125deg,#123f47 0%,#176f6b 66%,#2c8b7d 100%);box-shadow:0 18px 45px #174b4920}.tj-overview:after{content:"";position:absolute;width:360px;height:360px;right:-150px;top:-210px;border:70px solid #ffffff12;border-radius:50%}
      .tj-kicker{font-size:12px;letter-spacing:.14em;color:#b9e0d5}.tj-title-row{position:relative;z-index:1;display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.tj-title-row h1{font-size:clamp(27px,3vw,43px);line-height:1.12;margin:7px 0}.tj-title-row p{margin:0;color:#d2e9e4}.tj-title-actions{display:flex;align-items:flex-end;gap:8px;flex-direction:column}.tj-interest{max-width:340px;padding:8px 12px;border:1px solid #ffffff28;border-radius:999px;background:#ffffff12;color:#f8fffd}#tv-root button.tj-request-edit{padding:7px 11px;border:1px solid #ffffff38;border-radius:999px;background:#ffffff10;color:#fff;font-size:12px}#tv-root button.tj-request-edit:hover{background:#ffffff22}
      .tj-metrics{position:relative;z-index:1;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:24px}.tj-metric{min-height:94px;padding:14px 16px;border:1px solid #ffffff22;border-radius:15px;background:#0b333770;backdrop-filter:blur(8px)}.tj-metric span,.tj-metric small{display:block;color:#bcd8d4}.tj-metric strong{display:block;margin:3px 0;font-size:21px}.tj-progress{height:5px;margin:8px 0 5px;border-radius:6px;background:#ffffff22;overflow:hidden}.tj-progress i{display:block;height:100%;border-radius:inherit;background:#f2ae6c}
      .tj-skill-strip{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:2px 4px;color:var(--tj-muted)}.tj-skill-strip b{color:var(--tj-ink)}.tj-skill{padding:7px 11px;border:1px solid var(--tj-line);border-radius:999px;background:#fff;color:#365e65;font-size:12px}
      .tj-tabs{position:sticky;top:67px;z-index:3;display:flex;gap:5px;padding:6px;border:1px solid var(--tj-line);border-radius:15px;background:#ffffffed;box-shadow:0 8px 28px #173d4510;backdrop-filter:blur(12px)}#tv-root .tj-tab{flex:1;border:0;border-radius:10px;background:transparent;color:#587178;padding:10px}.tj-tab.active{background:#e4f1ed!important;color:#0b625f!important;font-weight:700}
      .tj-pane[hidden]{display:none!important}.tj-board{display:grid;gap:14px}.tj-plan-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.tv-journey-enabled button.tj-plan-card{text-align:left;display:grid;gap:4px;min-height:116px;padding:15px;border:1px solid var(--tj-line);border-radius:16px;background:#fff;color:var(--tj-ink);box-shadow:0 8px 22px #173d4509}.tv-journey-enabled button.tj-plan-card.selected{border-color:#13857e;box-shadow:0 0 0 2px #13857e20,0 12px 28px #173d4512;transform:translateY(-1px)}.tj-plan-card strong{font-size:16px}.tj-plan-meta{color:#315f67}.tj-plan-card small{color:var(--tj-muted)}
      .tj-state{justify-self:start;padding:3px 8px;border-radius:999px;font-size:11px}.tj-state.eligible{background:#dff2e8;color:#17683d}.tj-state.pending{background:#fff0cf;color:#825d13}.tj-state.rejected{background:#fae5e2;color:#98473e}
      .tj-grid{display:grid;grid-template-columns:minmax(0,1.18fr) minmax(320px,.82fr);gap:14px;align-items:start}.tj-card{border:1px solid var(--tj-line);border-radius:18px;background:#fff;box-shadow:0 10px 30px #173d4508;overflow:hidden}.tj-card-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:16px 18px;border-bottom:1px solid #e9f0ef}.tj-card-head h2{margin:0;font-size:18px}.tj-card-head span{font-size:12px;color:var(--tj-muted)}.tj-card-body{padding:16px}
      .tj-day+.tj-day{margin-top:17px;padding-top:17px;border-top:1px solid #edf2f1}.tj-day-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.tj-day-head>div{display:flex;gap:9px;align-items:center}.tj-day-index{display:grid;place-items:center;width:27px;height:27px;border-radius:9px;background:#123f47;color:#fff;font-weight:700}.tj-day-body{position:relative}.tj-stop{display:grid;grid-template-columns:48px 30px 1fr;gap:9px;padding:7px 0}.tj-stop-time{padding-top:6px;font-size:12px;color:var(--tj-muted)}.tj-stop-mark{position:relative;z-index:1;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#e6f3ef;color:#126c67;font-size:11px;font-weight:700;box-shadow:0 0 0 5px #fff}.tj-stop-body{padding:9px 11px;border:1px solid #e3ecea;border-radius:12px;background:#fbfdfc}.tj-stop-heading,.tj-stop-actions{display:flex;justify-content:space-between;align-items:center;gap:8px}.tj-stop-body p{margin:3px 0;color:#587178;font-size:12px}.tj-kind{font-size:11px;color:#926039}#tv-root button.tj-edit{padding:3px 7px;border-radius:999px;font-size:11px;color:#176b68;border-color:#b8d8d2;background:#f1faf7}.tj-transfer{display:grid;grid-template-columns:48px 30px 1fr;gap:9px;align-items:center;min-height:38px;color:#758a8f;font-size:11px}.tj-transfer-line{text-align:center;color:#4f8f86}.tj-transfer span:last-child{padding:5px 10px;border-left:1px dashed #9cc1ba}
      .tj-route{min-height:300px;background:radial-gradient(circle at 18% 12%,#dceee7 0 3px,transparent 4px),linear-gradient(145deg,#f2f7f3,#eef4f2)}.tj-route-day{padding:14px;border:1px solid #d8e5e1;border-radius:14px;background:#ffffffdc}.tj-route-day+.tj-route-day{margin-top:12px}.tj-route-day h4{margin:0 0 10px;color:#315f67}.tj-route-node{display:grid;grid-template-columns:28px 1fr;gap:10px;align-items:center}.tj-route-node small{display:block;color:var(--tj-muted)}.tj-route-number{display:grid;place-items:center;width:27px;height:27px;border-radius:50%;background:#126c67;color:#fff;font-size:11px;font-weight:700}.tj-route-link{display:grid;grid-template-columns:28px 1fr;gap:10px;min-height:37px}.tj-route-link span{justify-self:center;border-left:2px dotted #8eb9b1}.tj-route-link small{align-self:center;color:#688087}
      .tj-secondary{display:grid;grid-template-columns:1fr 1fr;gap:14px}.tj-mini-stats{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:11px}.tj-mini-stats span{padding:5px 8px;border-radius:8px;background:#eef5f3;color:#42676d;font-size:12px}.tj-risk{padding:9px 10px;margin-top:7px;border-left:3px solid #dfa249;background:#fff8e9;border-radius:7px}.tj-risk.rejected{border-color:#c55a4d;background:#fff0ee}.tj-good{padding:11px;border-radius:10px;background:#e9f6ef;color:#246442}.tj-cost-row{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid #edf1f0}.tj-cost-row:last-child{border:0}.tj-cost-row span{display:grid}.tj-cost-row small{color:var(--tj-muted)}
      .tj-editor-wrap{border:1px solid var(--tj-line);border-radius:16px;background:#fff}.tj-editor-wrap>summary{cursor:pointer;padding:15px 18px;color:#28585f;font-weight:700}.tj-editor-wrap[open]>summary{border-bottom:1px solid var(--tj-line)}.tj-editor-wrap #tv-area-2{border:0;box-shadow:none;margin:0;border-radius:0}.tj-pane>.tv-panel{margin:0;border-radius:18px;box-shadow:0 10px 30px #173d4508}.tj-empty{padding:24px;text-align:center;color:var(--tj-muted)}
      @media(max-width:980px){.tj-metrics{grid-template-columns:1fr 1fr}.tj-grid,.tj-secondary{grid-template-columns:1fr}.tj-plan-list{grid-template-columns:1fr}.tj-title-row{display:block}.tj-interest{display:inline-block;margin-top:14px}.tj-tabs{overflow:auto;justify-content:flex-start}.tv-journey-enabled #tv-root .tj-tab{flex:0 0 auto;min-width:110px}}
      @media(max-width:620px){.tv-journey-enabled .tv-main{padding:12px}.tj-overview{padding:20px;border-radius:18px}.tj-metrics{grid-template-columns:1fr 1fr}.tj-metric{min-height:82px;padding:11px}.tj-metric strong{font-size:17px}.tj-stop{grid-template-columns:42px 28px 1fr}.tj-tabs{top:60px}.tj-card-body{padding:12px}}
    `}));

    const oldHero=main.querySelector(".tv-hero"),oldNav=main.querySelector(".tv-nav"),scenarios=main.querySelector(".tc-scenarios"),banner=main.querySelector(".tv-banner");
    if(oldHero)oldHero.hidden=true;if(oldNav)oldNav.hidden=true;if(scenarios)scenarios.hidden=true;

    const overview=el("section",{class:"tj-overview"},[
      el("div",{class:"tj-title-row"},[
        el("div",{},[el("div",{class:"tj-kicker",text:"CURRENT JOURNEY · 当前旅程"}),el("h1",{id:"tj-destination"}),el("p",{id:"tj-subtitle"})]),
        el("div",{class:"tj-title-actions"},[
          el("span",{id:"tj-interest",class:"tj-interest"}),
          button("在对话中修改整体需求",()=>{const state=current();if(state.plan)root.TravelConversation?.setTarget({type:"request",planId:state.plan.id});},{id:"tj-request-edit",class:"tj-request-edit","data-target-type":"request"})
        ])
      ]),
      el("div",{class:"tj-metrics"},[
        el("div",{class:"tj-metric"},[el("span",{text:"预算上限"}),el("strong",{id:"tj-budget-value"}),el("div",{class:"tj-progress"},[el("i",{id:"tj-budget-bar"})]),el("small",{id:"tj-budget-caption"})]),
        el("div",{class:"tj-metric"},[el("span",{text:"当前已知费用"}),el("strong",{id:"tj-cost-value"}),el("small",{text:"未知价格不会被当作零元"})]),
        el("div",{class:"tj-metric"},[el("span",{text:"方案总步行"}),el("strong",{id:"tj-walk-value"}),el("small",{text:"按显式交通区间累计"})]),
        el("div",{class:"tj-metric"},[el("span",{text:"有效事实"}),el("strong",{id:"tj-evidence-value"}),el("small",{id:"tj-evidence-caption"})])
      ])
    ]);
    const skills=el("div",{class:"tj-skill-strip"},[
      el("b",{text:"在对话中 @ 调用"}),
      ...[["文旅需求规划","travel-demand-planner"],["文旅服务协同","travel-service-coordinator"],["文旅内容创意","travel-content-lab"]].map(([name,id])=>el("span",{class:"tj-skill",text:`@${name}`,title:`内部标识：${id}`})),
      el("span",{text:"本地事实检索与路线约束由 Agent 自动协同"})
    ]);
    const tabs=[['journey','行程规划'],['consult','有据咨询'],['service','服务接待'],['content','营销创意'],['resources','资源管理']];
    const nav=el("nav",{class:"tj-tabs",role:"tablist","aria-label":"文旅任务视图"},tabs.map(([id,label])=>button(label,()=>showTab(id),{class:`tj-tab ${id===activeTab?"active":""}`,"data-tab":id,role:"tab","aria-selected":String(id===activeTab)})));

    const board=el("div",{class:"tj-board"},[
      el("div",{id:"tj-plans",class:"tj-plan-list"}),
      el("div",{class:"tj-grid"},[
        el("section",{class:"tj-card"},[el("header",{class:"tj-card-head"},[el("h2",{text:"逐日行程"}),el("span",{text:"时间、地点与住宿上下文"})]),el("div",{id:"tj-timeline",class:"tj-card-body"})]),
        el("section",{class:"tj-card"},[el("header",{class:"tj-card-head"},[el("h2",{text:"路线联动"}),el("span",{text:"示意路线 · 不代表地理比例"})]),el("div",{id:"tj-route",class:"tj-card-body tj-route"})])
      ]),
      el("div",{class:"tj-secondary"},[
        el("section",{class:"tj-card"},[el("header",{class:"tj-card-head"},[el("h2",{text:"证据与风险"}),el("span",{text:"只依据当前事实卡"})]),el("div",{id:"tj-risks",class:"tj-card-body"})]),
        el("section",{class:"tj-card"},[el("header",{class:"tj-card-head"},[el("h2",{text:"费用组成"}),el("span",{text:"已知金额与计算公式"})]),el("div",{id:"tj-costs",class:"tj-card-body"})])
      ])
    ]);

    const panes={
      journey:el("section",{class:"tj-pane","data-pane":"journey"},[board]),
      consult:el("section",{class:"tj-pane","data-pane":"consult",hidden:""}),
      service:el("section",{class:"tj-pane","data-pane":"service",hidden:""}),
      content:el("section",{class:"tj-pane","data-pane":"content",hidden:""}),
      resources:el("section",{class:"tj-pane","data-pane":"resources",hidden:""})
    };
    const editor=el("details",{class:"tj-editor-wrap"},[el("summary",{text:"编辑需求、约束与候选方案"})]);
    editor.append(document.getElementById("tv-area-2"));
    panes.journey.append(editor);
    panes.consult.append(document.getElementById("tv-area-1"));
    panes.service.append(document.getElementById("tv-area-3"));
    panes.content.append(document.getElementById("tv-area-4"));
    panes.resources.append(document.getElementById("tv-area-5"));
    const shell=el("section",{id:"tj-root",class:"tj-shell"},[overview,skills,nav,...Object.values(panes)]);
    banner.after(shell);
    render();
    document.addEventListener("travel-workbench-evaluated",render);
    document.addEventListener("travel-workbench-invalidated",render);
    document.addEventListener("travel-workbench-selection",render);
    document.addEventListener("travel-workbench-restored",render);
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(install,0));
  else setTimeout(install,0);
})(globalThis);
