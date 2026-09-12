(()=>{
  "use strict";
  const buttonId="travel-diagnostics-button",modalId="travel-diagnostics-modal",resultId="travel-diagnostics-result";
  const retiredDeveloper=String.fromCharCode(30021,25463,36890);
  const hiddenMarketCategories=new Set(["智能供应链","智能制造",`${retiredDeveloper}服务`,"电商采集","私域运营"]);
  const escapeHtml=value=>String(value??"").replace(/[&<>\"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"})[char]);
  const isRetiredDeveloper=skill=>String(skill?.author??"").trim().startsWith(retiredDeveloper);
  function filterSkillMarketCards(root=document){
    let removed=0;
    for(const card of root.querySelectorAll('[data-testid^="market-skill-card-"]')){
      const author=[...card.querySelectorAll("span")].find(node=>node.textContent.trim().startsWith(retiredDeveloper));
      if(author){card.remove();removed++;}
    }
    return removed;
  }
  function filterSkillMarketCategories(root=document){
    let removed=0;
    for(const button of root.querySelectorAll("button")){
      if(hiddenMarketCategories.has(button.textContent.trim())){button.remove();removed++;}
    }
    return removed;
  }
  globalThis.TravelSkillMarketPolicy=Object.freeze({isRetiredDeveloper,filterSkillMarketCards,filterSkillMarketCategories});
  function hideLegacyDiagnostics(){
    for(const button of document.querySelectorAll("button")){
      const label=`${button.textContent} ${button.getAttribute("aria-label")||""} ${button.title||""}`;
      if(button.id!==buttonId&&/诊断|診斷|Doctor|Diagnos/i.test(label))button.style.display="none";
    }
  }
  async function openDiagnostics(){
    ensureDiagnostics();
    const modal=document.getElementById(modalId),result=modal.querySelector(`#${resultId}`);
    modal.hidden=false;modal.style.display="flex";result.textContent="正在检查本机状态…";
    try{
      const [gateway,model]=await Promise.all([
        globalThis.__TAURI_INTERNALS__?.invoke?.("sidecar_gateway_info").catch(error=>({ready:false,error:String(error)})),
        globalThis.TravelAgentRequest?globalThis.TravelAgentRequest({action:"status"}).catch(error=>({available:false,error:String(error)})):Promise.resolve({available:false})
      ]);
      const gatewayText=gateway?.ready?`已连接（本机端口 ${gateway.port??"已分配"}）`:(gateway?.error||gateway?.status||"尚未就绪");
      const modelText=model?.available?`${model.provider||"自定义服务"} / ${model.model||"已配置模型"}`:"尚未配置可用模型；请由使用者在“模型设置”中添加";
      result.innerHTML=`<div><strong>本机网关：</strong>${escapeHtml(gatewayText)}</div><div><strong>当前模型：</strong>${escapeHtml(modelText)}</div><div><strong>文旅 Skill：</strong>需求规划、服务协同、内容创作（3 个已内置）</div><div><strong>安全边界：</strong>不登录、不上传、不自动预订、不付款、不发布</div>`;
    }catch(error){result.textContent=`本机检查暂未完成：${String(error?.message||error)}`;}
  }
  function ensureDiagnostics(){
    if(document.getElementById(buttonId))return;
    const button=document.createElement("button");
    button.id=buttonId;button.type="button";button.textContent="✓ 本机检查";
    button.style.cssText="position:fixed;left:16px;bottom:16px;z-index:2147483000;border:1px solid #d6dbe4;border-radius:12px;background:#fff;color:#425466;padding:10px 16px;font:14px system-ui;box-shadow:0 6px 18px rgba(15,23,42,.12);cursor:pointer";
    const modal=document.createElement("div");
    modal.id=modalId;modal.hidden=true;
    modal.style.cssText="position:fixed;inset:0;z-index:2147483640;background:rgba(15,23,42,.35);display:none;align-items:center;justify-content:center;padding:24px";
    modal.innerHTML=`<section role="dialog" aria-modal="true" aria-labelledby="travel-diagnostics-title" style="width:min(620px,100%);max-height:85vh;overflow:auto;background:#fff;border-radius:22px;padding:28px;box-shadow:0 24px 70px rgba(15,23,42,.25);color:#172033;font-family:system-ui"><div style="display:flex;align-items:center;justify-content:space-between;gap:16px"><h2 id="travel-diagnostics-title" style="margin:0;font-size:23px">旅策协同 本机检查</h2><button type="button" data-close aria-label="关闭" style="border:0;background:transparent;font-size:28px;cursor:pointer;color:#536175">×</button></div><p style="color:#667085;line-height:1.7">只检查本机网关、模型和文旅能力，不需要登录，也不会上传诊断数据。</p><div id="${resultId}" aria-live="polite" style="margin-top:18px;border-radius:15px;background:#f7f9fc;padding:18px;line-height:1.8">正在检查本机状态…</div><p style="margin:18px 0 0;color:#667085;font-size:13px">赛题：JBGS-2026-06　·　专业 Skill：3 个　·　确定性规划与安全导出可离线使用</p></section>`;
    const close=()=>{modal.hidden=true;modal.style.display="none";};
    modal.querySelector("[data-close]").addEventListener("click",close);
    modal.addEventListener("click",event=>{if(event.target===modal)close();});
    button.addEventListener("click",openDiagnostics);
    document.body.append(button,modal);
  }
  function apply(){
    const brand=globalThis.TravelBrand;if(!brand)return;
    document.title="旅策协同 · 文旅智能辅助";
    let icon=document.querySelector('link[rel="icon"]');if(!icon){icon=document.createElement("link");icon.rel="icon";document.head.append(icon);}icon.href=brand.symbol;
    const node=document.querySelector(".tv-brand");if(node){node.replaceChildren();const img=document.createElement("img");img.src=brand.symbol;img.alt="旅策协同";img.style.cssText="display:inline-block;width:38px;height:38px;vertical-align:middle;margin-right:11px";node.append(img,document.createTextNode("旅策协同 · Travel.AI"));}
    ensureDiagnostics();hideLegacyDiagnostics();filterSkillMarketCards();filterSkillMarketCategories();
  }
  const observer=new MutationObserver(()=>{hideLegacyDiagnostics();ensureDiagnostics();filterSkillMarketCards();filterSkillMarketCategories();});
  globalThis.addEventListener("travel-open-local-check",openDiagnostics);
  document.addEventListener("travel-workbench-ready",apply);
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{apply();observer.observe(document.body,{childList:true,subtree:true});});else{apply();observer.observe(document.body,{childList:true,subtree:true});}
})();
