(function (root) {
  "use strict";

  const definitions = {
    search: { label: "联网搜索", icon: "搜", hint: "检索公开网页，结果先进入待核实候选箱。", quota: 3 },
    weather: { label: "天气查询", icon: "天", hint: "自动解析城市编码，预报范围以高德实时返回为准。", quota: 1 },
    route: { label: "路线规划", icon: "路", hint: "自动解析起终点，核对距离、时长和路线几何。", quota: 12 },
    map: { label: "地理坐标", icon: "位", hint: "解析任务资源坐标，不加载第三方地图底图。", quota: 1 }
  };
  const providers = {
    mock: "本地模拟适配器",
    tavily: "Tavily 网页搜索（自备密钥）",
    searxng: "SearXNG 搜索（局域网或 HTTPS 域名）",
    amap: "高德地图 Web 服务（自备 Key）",
    custom: "自定义远程服务（预配置）",
    selfhost: "本机自托管服务（预配置）"
  };
  const $ = id => document.getElementById(`tt-${id}`);
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null) continue;
      if (key === "text") node.textContent = value;
      else if (key === "class") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) if (child != null) node.append(child);
    return node;
  };

  let snapshot = null;
  let candidates = [];
  const offlineSnapshot = () => ({
    capabilities: Object.fromEntries(Object.keys(definitions).map(id => [id, {
      label: definitions[id].label,
      enabled: false,
      provider: "mock",
      baseUrl: null,
      hasApiKey: false,
      maxRequests: definitions[id].quota,
      executable: true
    }]))
  });
  const taskContext = () => {
    const task = root.TravelWorkbench.read();
    return { task, context: { taskId: task.taskId, revision: task.revision, taskHash: root.TravelTaskSchema.hash(task) } };
  };

  function providerOptions(id, selected) {
    return Object.entries(providers)
      .filter(([value]) => (!["tavily", "searxng"].includes(value) || id === "search") && (value !== "amap" || ["weather", "route", "map"].includes(id)))
      .map(([value, text]) => el("option", { value, text, selected: selected === value }));
  }

  function testButtonText(provider, id) {
    if (provider === "amap") return id === "weather" ? "测试天气接口" : id === "route" ? "测试路线接口" : id === "map" ? "测试坐标接口" : "测试高德连通性";
    if (provider === "searxng") return "测试 SearXNG 连通性";
    return "运行模拟检查";
  }

  function toggleFields(id) {
    const provider = $(`${id}-provider`).value;
    const disabled = provider === "mock";
    const fixed = provider === "tavily" || provider === "amap";
    $(`${id}-base`).disabled = disabled || fixed;
    $(`${id}-key`).disabled = disabled;
    if (provider === "tavily") $(`${id}-base`).value = "https://api.tavily.com";
    if (provider === "amap") $(`${id}-base`).value = "https://restapi.amap.com";
    $(`${id}-base`).placeholder = provider === "searxng" ? "例如 http://192.168.6.162:8888" : "远程 HTTPS 或本机回环地址";
    $(`${id}-base-help`).textContent = provider === "amap"
      ? "官方地址已锁定，无需填写或修改。"
      : provider === "searxng"
        ? "局域网可使用 HTTP；公网域名必须使用 HTTPS。"
        : "只有高级适配器才需要配置服务地址。";
    const test = $(`${id}-test`);
    if (test) test.textContent = testButtonText(provider, id);
  }

  function renderConfig() {
    $("cards").replaceChildren(...Object.entries(definitions).map(([id, definition]) => {
      const item = snapshot.capabilities?.[id] || {};
      const provider = item.provider || "mock";
      const enabled = item.enabled === true;
      const ready = enabled && item.executable !== false;
      const stateText = ready ? "已启用" : enabled ? "待完善" : "未启用";
      return el("section", { class: `tt-card ${enabled ? "is-enabled" : ""}`, "data-capability": id }, [
        el("div", { class: "tt-card-head" }, [
          el("div", { class: "tt-capability" }, [
            el("span", { class: "tt-capability-icon", text: definition.icon }),
            el("div", {}, [el("h4", { text: definition.label }), el("p", { text: definition.hint })])
          ]),
          el("span", { class: `tt-status-pill ${ready ? "ready" : ""}`, text: stateText })
        ]),
        el("div", { class: "tt-card-controls" }, [
          el("label", { class: "tt-switch" }, [
            el("input", { id: `tt-${id}-enabled`, type: "checkbox", checked: enabled, onchange: () => toggleFields(id) }),
            el("span", { class: "tt-switch-track" }),
            el("span", { text: "启用此能力" })
          ]),
          el("span", { class: "tt-quota", text: `每个任务版本最多 ${item.maxRequests || definition.quota} 次` })
        ]),
        el("label", { class: "tt-provider-field" }, [
          el("span", { text: "服务适配器" }),
          el("select", { id: `tt-${id}-provider`, onchange: () => toggleFields(id) }, providerOptions(id, provider))
        ]),
        el("details", { class: "tt-advanced", open: provider !== "mock" && provider !== "amap" }, [
          el("summary", { text: "高级连接设置" }),
          el("div", { class: "tt-fields" }, [
            el("label", {}, [
              el("span", { text: "服务地址（Base URL）" }),
              el("input", { id: `tt-${id}-base`, value: item.baseUrl || "", autocomplete: "off" }),
              el("small", { id: `tt-${id}-base-help` })
            ]),
            el("label", {}, [
              el("span", { text: "访问凭据" }),
              el("input", { id: `tt-${id}-key`, type: "password", value: "", placeholder: item.hasApiKey ? "已安全保存，留空保持不变" : "未配置", autocomplete: "new-password" }),
              el("small", { text: "仅保存到当前用户目录，页面和状态接口不会回显。" })
            ])
          ])
        ]),
        el("div", { class: "tt-card-footer" }, [
          el("span", { text: provider === "amap" ? "固定样例：杭州（330100）" : provider === "searxng" ? "固定检索：杭州 文旅" : item.providerLabel || providers[provider] }),
          el("button", { id: `tt-${id}-test`, type: "button", class: "tt-test", onclick: () => testCapability(id), text: testButtonText(provider, id) })
        ]),
        el("div", { id: `tt-${id}-feedback`, class: "tt-card-feedback", "aria-live": "polite" })
      ]);
    }));
    for (const id of Object.keys(definitions)) toggleFields(id);
  }

  function renderCandidates() {
    const task = root.TravelWorkbench.read();
    const content = candidates.length ? candidates.map(item => {
      const resource = el("select", { id: `tt-resource-${item.id}` }, [
        el("option", { value: "", text: "作为全局事实" }),
        ...task.resources.map(row => el("option", { value: row.id, text: `关联：${row.name}` }))
      ]);
      return el("article", { class: "tt-candidate" }, [
        el("div", { class: "tt-candidate-head" }, [el("b", { text: item.title }), el("span", { text: item.simulation ? "模拟候选" : "联网待核实" })]),
        el("p", { text: item.text }),
        el("small", { text: `${item.sourceLabel || item.provider} · ${item.retrievedAt} · ${item.validUntil ? `复核期限 ${item.validUntil}` : "无有效期"} · revision ${item.revision}` }),
        item.sourceUrl ? el("a", { href: item.sourceUrl, target: "_blank", rel: "noopener noreferrer", text: "查看来源网页（请人工核对）" }) : null,
        resource,
        el("div", { class: "tt-inline-actions" }, [
          el("button", { onclick: () => adoptCandidate(item.id), text: "人工采纳为事实草稿" }),
          el("button", { onclick: () => dismissCandidate(item.id), text: "忽略" })
        ])
      ]);
    }) : [el("div", { class: "tt-empty" }, [el("b", { text: "暂无待核实资料" }), el("span", { text: "运行搜索或天气核对后，候选结果会出现在这里。" })])];
    $("inbox").replaceChildren(...content);
  }

  async function loadCandidates() {
    if (!root.TravelToolRequest) { candidates = []; return renderCandidates(); }
    const { context } = taskContext();
    const out = await root.TravelToolRequest({ action: "list_candidates", context });
    candidates = out.candidates || [];
    renderCandidates();
  }

  async function load() {
    $("error").textContent = "";
    snapshot = root.TravelToolRequest ? await root.TravelToolRequest({ action: "status" }) : offlineSnapshot();
    renderConfig();
    await loadCandidates();
    const live = Object.values(snapshot.capabilities || {}).filter(item => item.enabled && item.executable && item.provider !== "mock").map(item => item.label);
    $("state").textContent = !root.TravelToolRequest
      ? "离线页面不读取用户工具配置，也不会发起网络请求。"
      : live.length
        ? `已启用真实能力：${live.join("、")}。联网结果不会自动覆盖任务。`
        : "真实工具默认关闭；可配置 Tavily、SearXNG 或高德 Web 服务。";
    $("save").disabled = !root.TravelToolRequest;
  }

  const values = () => ({ capabilities: Object.fromEntries(Object.keys(definitions).map(id => [id, {
    enabled: $(`${id}-enabled`).checked,
    provider: $(`${id}-provider`).value,
    baseUrl: $(`${id}-base`).value,
    apiKey: $(`${id}-key`).value
  }])) });

  function savedSnapshotValues() {
    return { capabilities: Object.fromEntries(Object.keys(definitions).map(id => {
      const item = snapshot.capabilities?.[id] || {};
      return [id, { enabled: item.enabled === true, provider: item.provider || "mock", baseUrl: item.baseUrl || null, apiKey: "" }];
    })) };
  }

  async function persist(payload, message) {
    try {
      $("save").disabled = true;
      $("error").textContent = "";
      snapshot = await root.TravelToolRequest({ action: "save", ...payload });
      renderConfig();
      $("state").textContent = message || (snapshot.realNetworkEnabled
        ? "配置已保存；真实调用仍需用户主动触发。"
        : "配置已保存；真实工具仍处于关闭状态。");
      return true;
    } catch (error) {
      $("error").textContent = error.message;
      return false;
    } finally {
      $("save").disabled = !root.TravelToolRequest;
    }
  }

  async function save() { return persist(values()); }

  function sampleInput(id, task) {
    const destination = task.request?.destination || "未填写目的地";
    const resources = task.resources || [];
    const date = task.request?.startDate || new Date().toISOString().slice(0, 10);
    if (id === "search") return { destination, query: "文旅开放信息", limit: 1 };
    if (id === "weather") return { location: destination, date };
    if (id === "route") return { origin: resources[0]?.name || "起点", destination: resources[1]?.name || "终点", mode: "walking" };
    const resourceIds = resources.slice(0, 3).map(item => item.id);
    return { resourceIds: resourceIds.length ? resourceIds : ["draft-resource"] };
  }

  function setCardFeedback(id, message, kind = "info") {
    const node = $(`${id}-feedback`);
    if (!node) return;
    node.className = `tt-card-feedback ${kind}`;
    node.textContent = message;
  }

  function resultSummary(id, result) {
    if (id === "weather") return `核对完成：已取得 ${result.location || "当前目的地"} ${result.date || ""} 的天气候选，请在候选箱人工核实。`;
    if (id === "route") return `核对完成：约 ${result.distanceMeters ?? "?"} 米、${result.durationMinutes ?? "?"} 分钟；不会自动修改正式路线。`;
    if (id === "map") return `核对完成：已解析 ${Array.isArray(result.points) ? result.points.length : 0} 个资源坐标，不会自动改写任务。`;
    return `检查完成：取得 ${Array.isArray(result.observations) ? result.observations.length : 0} 条待核实结果。`;
  }

  function connectionSummary(result) {
    if (result.provider === "amap") return `已联通：高德 Web 服务已验证。${result.testCase}；${result.responseSummary}`;
    if (result.provider === "searxng") return `已联通：SearXNG 已返回 JSON。${result.testCase}；${result.responseSummary}`;
    return "已联通：服务已返回有效响应。";
  }

  async function testCapability(id) {
    const button = $(`${id}-test`);
    const originalText = button.textContent;
    try {
      if (!root.TravelToolRequest) throw new Error("离线页面不运行基础工具。");
      const saved = snapshot.capabilities?.[id] || {};
      const provider = saved.provider;
      if ($(`${id}-enabled`).checked !== (saved.enabled === true) || $(`${id}-provider`).value !== provider) throw new Error("此卡片有尚未保存的更改，请先点击“保存全部配置”。");
      if (!saved.enabled) throw new Error("此能力尚未启用，请打开开关并保存配置。");
      if (provider === "amap" && !saved.hasApiKey) throw new Error("尚未保存高德 Web 服务 API Key。");
      if (! ["mock", "amap", "searxng"].includes(provider)) throw new Error("此处只提供高德和 SearXNG 的连通性测试；真实网页搜索请在对话中先查看检索主题并确认。");
      $("error").textContent = "";
      button.disabled = true;
      button.textContent = provider === "amap" ? "正在连接高德…" : provider === "searxng" ? "正在连接 SearXNG…" : "正在检查…";
      const amapProbe = id === "weather" ? "杭州市天气" : id === "route" ? "杭州市中心步行路线" : "杭州西湖地理编码";
      setCardFeedback(id, provider === "amap" ? `正在用${amapProbe}验证对应高德接口，请稍候…` : provider === "searxng" ? "正在用“杭州 文旅”验证 SearXNG JSON 搜索服务，请稍候…" : "正在运行本地模拟检查…", "busy");
      if (provider === "amap" || provider === "searxng") {
        const out = await root.TravelToolRequest({ action: "test_connection", capability: id });
        $("result").textContent = `${definitions[id].label}连通性测试成功：不会修改当前任务，也不会写入待核实资料。\n${JSON.stringify(out.result, null, 2)}`;
        setCardFeedback(id, connectionSummary(out.result), "success");
        return;
      }
      const { task, context } = taskContext();
      const out = await root.TravelToolRequest({ action: "execute", capability: id, context, input: sampleInput(id, task) });
      $("result").textContent = `${definitions[id].label}模拟检查完成：结果不会自动覆盖任务。\n${JSON.stringify(out.result, null, 2)}`;
      setCardFeedback(id, resultSummary(id, out.result), "success");
      await loadCandidates();
    } catch (error) {
      const provider = snapshot.capabilities?.[id]?.provider;
      const message = `${provider === "amap" || provider === "searxng" ? "连通失败" : "核对失败"}：${error.message}`;
      setCardFeedback(id, message, "error");
      $("error").textContent = message;
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function quickAmap() {
    try {
      if (!root.TravelToolRequest) throw new Error("离线页面不能保存高德配置。");
      const key = $("amap-key").value.trim();
      if (!key) throw new Error("请填写高德 Web 服务 API Key。");
      const payload = savedSnapshotValues();
      for (const id of ["weather", "route", "map"]) payload.capabilities[id] = {
        enabled: true,
        provider: "amap",
        baseUrl: "https://restapi.amap.com",
        apiKey: key
      };
      if (!await persist(payload, "高德天气、路线和地理坐标已启用；可在能力卡片中分别运行核对。")) return;
      $("amap-key").value = "";
    } catch (error) { $("error").textContent = error.message; }
  }

  async function dismissCandidate(id) {
    try {
      const { context } = taskContext();
      await root.TravelToolRequest({ action: "dismiss_candidate", candidateId: id, context });
      await loadCandidates();
    } catch (error) { $("error").textContent = error.message; }
  }

  async function adoptCandidate(id) {
    try {
      const item = candidates.find(row => row.id === id);
      if (!item) throw new Error("候选资料已经变化。");
      if (!confirm(`确认把“${item.title}”作为 unknown 状态的事实草稿写入当前任务？`)) return;
      const { context } = taskContext();
      const resourceId = $(`resource-${id}`).value || null;
      await root.TravelWorkbench.flush();
      const out = await root.TravelToolRequest({ action: "adopt_candidate", candidateId: id, context, resourceId });
      root.TravelWorkbench.restoreRecord(out.record, `已写入事实草稿 ${out.fact.id}；仍需人工核实。`);
      $("result").textContent = `已写入事实草稿 ${out.fact.id}；状态仍为 unknown，需在资源管理中人工核实。`;
      await loadCandidates();
    } catch (error) { $("error").textContent = error.message; }
  }

  function install() {
    if ($("button")) return;
    document.head.append(el("style", { text: `
      #tt-button{position:fixed;left:18px;bottom:68px;z-index:10002;border:1px solid #c8dcdf;border-radius:12px;background:#fff;color:#17596a;padding:10px 15px;box-shadow:0 8px 24px rgba(21,80,91,.12)}
      #tt-dialog{width:min(980px,95vw);height:min(820px,91vh);max-height:91vh;padding:0;border:0;border-radius:24px;overflow:hidden;background:#f5f8f8;color:#173c45;box-shadow:0 28px 90px rgba(15,52,61,.28);font:14px/1.55 "Segoe UI","Microsoft YaHei",sans-serif}
      #tt-dialog::backdrop{background:rgba(13,33,39,.48);backdrop-filter:blur(3px)}#tt-dialog *{box-sizing:border-box}#tt-dialog button,#tt-dialog input,#tt-dialog select{font:inherit}
      .tt-shell{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto}.tt-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:24px 28px 18px;background:#fff;border-bottom:1px solid #e2ebec}
      .tt-header-copy{display:flex;gap:13px;align-items:flex-start}.tt-brand-mark{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:linear-gradient(145deg,#0e6d74,#218b7d);color:#fff;font-weight:800}.tt-header h2{margin:0;font-size:22px;letter-spacing:.01em}.tt-header p{margin:4px 0 0;color:#698087;font-size:13px}.tt-close{border:0!important;background:#eef4f4!important;border-radius:50%!important;width:36px;height:36px;padding:0!important;font-size:23px!important;color:#536c72!important}
      .tt-scroll{overflow:auto;padding:22px 28px 28px}.tt-section-heading{display:flex;justify-content:space-between;align-items:end;gap:16px;margin:24px 0 12px}.tt-section-heading h3{margin:0;font-size:17px}.tt-section-heading p{margin:0;color:#70868b;font-size:12px}.tt-alert{display:flex;gap:10px;align-items:flex-start;margin:0 0 14px;padding:11px 13px;border:1px solid #ecd79d;border-radius:12px;background:#fff9e9;color:#6d5720}.tt-alert b{flex:0 0 auto}
      .tt-amap-quick{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:16px;align-items:center;padding:20px;border:1px solid #b8d9d2;border-radius:18px;background:linear-gradient(135deg,#eaf8f4,#f8fcfb);box-shadow:0 8px 22px rgba(28,108,97,.07)}.tt-step{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:#16766f;color:#fff;font-weight:800}.tt-amap-copy b{display:block;font-size:17px}.tt-amap-copy span{display:block;margin-top:3px;color:#5d7779;font-size:12px}.tt-amap-input{display:flex;gap:9px;align-items:end}.tt-amap-input label{display:grid;gap:5px;min-width:250px;color:#49656b;font-size:12px}.tt-amap-input input{width:100%;padding:10px 12px;border:1px solid #b9d1d1;border-radius:10px;background:#fff;color:#173c45}.tt-primary{border:1px solid #176e78!important;border-radius:10px!important;background:#176e78!important;color:#fff!important;padding:10px 15px!important;white-space:nowrap}
      .tt-cards{display:grid;grid-template-columns:1fr 1fr;gap:14px}.tt-card{display:flex;flex-direction:column;min-width:0;border:1px solid #d7e4e5;border-radius:17px;padding:17px;background:#fff;box-shadow:0 4px 14px rgba(25,71,80,.04)}.tt-card.is-enabled{border-color:#afd2cd;box-shadow:0 5px 18px rgba(27,112,102,.08)}.tt-card-head,.tt-candidate-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.tt-capability{display:flex;gap:11px;min-width:0}.tt-capability-icon{display:grid;place-items:center;flex:0 0 auto;width:36px;height:36px;border-radius:11px;background:#e8f3f2;color:#166b70;font-weight:800}.tt-capability h4{margin:0;font-size:17px}.tt-capability p{margin:3px 0 0;color:#6b8085;font-size:12px}.tt-status-pill{flex:0 0 auto;padding:3px 9px;border-radius:999px;background:#eef2f2;color:#708084;font-size:11px}.tt-status-pill.ready{background:#def3e9;color:#156444}
      .tt-card-controls{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:15px 0 12px;padding:10px 0;border-top:1px solid #edf2f2;border-bottom:1px solid #edf2f2}.tt-switch{display:flex;align-items:center;gap:8px;color:#456068;font-size:12px}.tt-switch input{position:absolute;opacity:0;pointer-events:none}.tt-switch-track{position:relative;width:34px;height:19px;border-radius:20px;background:#cbd7d9;transition:.2s}.tt-switch-track::after{content:"";position:absolute;top:3px;left:3px;width:13px;height:13px;border-radius:50%;background:#fff;transition:.2s}.tt-switch input:checked+.tt-switch-track{background:#178077}.tt-switch input:checked+.tt-switch-track::after{transform:translateX(15px)}.tt-quota{color:#7b8e92;font-size:11px}
      .tt-provider-field,.tt-fields label{display:grid;gap:6px;color:#4d676d;font-size:12px}.tt-provider-field select,.tt-fields input,.tt-candidate select{width:100%;padding:9px 10px;border:1px solid #cfdddf;border-radius:9px;background:#fff;color:#173c45}.tt-provider-field select:focus,.tt-fields input:focus,.tt-amap-input input:focus{outline:3px solid rgba(31,139,127,.13);border-color:#4b9c93}.tt-advanced{margin-top:10px;border-radius:10px;background:#f7f9f9}.tt-advanced summary{cursor:pointer;padding:9px 10px;color:#527077;font-size:12px}.tt-fields{display:grid;gap:10px;padding:1px 10px 11px}.tt-fields small{color:#7b8e92}.tt-fields input:disabled{background:#eef2f2;color:#62767b}.tt-card-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:auto;padding-top:13px}.tt-card-footer>span{overflow:hidden;color:#72868a;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.tt-card-footer button,.tt-inline-actions button{border:1px solid #bdd3d6;border-radius:9px;background:#fff;color:#195b69;padding:8px 11px;cursor:pointer}.tt-card-footer button:disabled{cursor:wait;opacity:.65}.tt-card-feedback{display:none;margin-top:10px;padding:9px 10px;border-radius:9px;font-size:12px;line-height:1.45}.tt-card-feedback:not(:empty){display:block}.tt-card-feedback.busy{background:#edf5f6;color:#28616c}.tt-card-feedback.success{background:#e5f5eb;color:#17633f}.tt-card-feedback.error{background:#fff0ee;color:#a22e25}
      .tt-inbox{display:grid;gap:9px}.tt-empty{display:flex;flex-direction:column;align-items:center;gap:3px;padding:25px;border:1px dashed #c9d9db;border-radius:14px;background:#fff;color:#70858a}.tt-empty b{color:#456067}.tt-candidate{padding:15px;border:1px solid #d7e3e4;border-radius:13px;background:#fff}.tt-candidate p{color:#536e74}.tt-candidate a{display:block;margin:7px 0;color:#167078}.tt-inline-actions{display:flex;gap:8px;margin-top:10px}.tt-feedback{display:grid;gap:8px;margin-top:18px}.tt-state{margin:0;color:#587278;font-size:12px}.tt-error{display:none;margin:0;padding:11px 13px;border:1px solid #efb6ae;border-radius:10px;background:#fff1ef;color:#a72d22}.tt-error:not(:empty){display:block}.tt-result{max-height:190px;overflow:auto;margin:0;padding:12px;border-radius:10px;background:#102f38;color:#d9eeee;white-space:pre-wrap;font:11px/1.6 Consolas,monospace}.tt-footer{display:flex;justify-content:flex-end;gap:9px;padding:14px 28px;border-top:1px solid #dfe9ea;background:#fff}.tt-footer button{border:1px solid #c7d8da;border-radius:10px;background:#fff;color:#275963;padding:9px 15px;cursor:pointer}
      @media(max-width:760px){#tt-dialog{width:96vw;height:94vh}.tt-header,.tt-scroll,.tt-footer{padding-left:16px;padding-right:16px}.tt-amap-quick{grid-template-columns:auto 1fr}.tt-amap-input{grid-column:1/-1;display:grid}.tt-amap-input label{min-width:0}.tt-cards{grid-template-columns:1fr}.tt-section-heading{display:block}}
    ` }));

    const dialog = el("dialog", { id: "tt-dialog" }, [
      el("div", { class: "tt-shell" }, [
        el("header", { class: "tt-header" }, [
          el("div", { class: "tt-header-copy" }, [
            el("span", { class: "tt-brand-mark", text: "旅" }),
            el("div", {}, [el("h2", { text: "基础工具与联网服务" }), el("p", { text: "按需启用公开信息搜索、天气、路线与地理坐标能力" })])
          ]),
          el("button", { type: "button", class: "tt-close", onclick: () => dialog.close(), title: "关闭", text: "×" })
        ]),
        el("main", { class: "tt-scroll" }, [
          el("p", { class: "tt-alert" }, [el("b", { text: "安全说明" }), "联网工具只发送当前任务中的公开地点或确认后的检索主题；结果需要人工核实，不会自动覆盖任务。"]),
          el("section", { class: "tt-amap-quick" }, [
            el("span", { class: "tt-step", text: "01" }),
            el("div", { class: "tt-amap-copy" }, [el("b", { text: "一键接入高德 Web 服务" }), el("span", { text: "只填一次 Web 服务 Key，天气、路线和地理坐标同时启用；官方服务地址已固定。" })]),
            el("div", { class: "tt-amap-input" }, [
              el("label", {}, ["高德 Web 服务 API Key", el("input", { id: "tt-amap-key", type: "password", value: "", placeholder: "Key 仅保存到当前用户目录", autocomplete: "new-password" })]),
              el("button", { type: "button", class: "tt-primary", onclick: quickAmap, text: "保存并启用" })
            ])
          ]),
          el("div", { class: "tt-section-heading" }, [el("h3", { text: "能力配置" }), el("p", { text: "高德快捷接入不会校验或覆盖尚未完成的搜索配置" })]),
          el("div", { id: "tt-cards", class: "tt-cards" }),
          el("div", { class: "tt-section-heading" }, [el("h3", { text: "联网资料候选箱" }), el("p", { text: "采纳前请核对来源、日期与适用范围" })]),
          el("div", { id: "tt-inbox", class: "tt-inbox" }),
          el("div", { class: "tt-feedback" }, [el("p", { id: "tt-state", class: "tt-state" }), el("p", { id: "tt-error", class: "tt-error", role: "alert" }), el("pre", { id: "tt-result", class: "tt-result", text: "尚未运行检查。" })])
        ]),
        el("footer", { class: "tt-footer" }, [el("button", { type: "button", onclick: () => dialog.close(), text: "取消" }), el("button", { id: "tt-save", type: "button", class: "tt-primary", onclick: save, text: "保存全部配置" })])
      ])
    ]);
    document.body.append(dialog, el("button", { id: "tt-button", onclick: async () => { dialog.showModal(); try { await load(); } catch (error) { $("error").textContent = error.message; } }, text: "基础工具" }));
    document.addEventListener("travel-workbench-invalidated", () => { if (dialog.open) loadCandidates().catch(() => {}); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
  root.TravelToolSettings = { load, values, loadCandidates, open: async () => { const dialog = $("dialog"); if (!dialog.open) dialog.showModal(); await load(); } };
})(globalThis);
