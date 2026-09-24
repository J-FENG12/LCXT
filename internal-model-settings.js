(() => {
  "use strict";

  const PRESETS = {
    deepseek: {
      label: "DeepSeek",
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      modelId: "deepseek-chat",
      modelName: "DeepSeek Chat",
      requiresKey: true
    },
    qwen: {
      label: "通义千问（Qwen）",
      providerId: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      modelId: "qwen-plus",
      modelName: "Qwen Plus",
      requiresKey: true
    },
    kimi: {
      label: "Kimi（Moonshot）",
      providerId: "kimi",
      baseUrl: "https://api.moonshot.cn/v1",
      modelId: "kimi-k2.5",
      modelName: "Kimi K2.5",
      requiresKey: true
    },
    openai: {
      label: "OpenAI",
      providerId: "openai",
      baseUrl: "https://api.openai.com/v1",
      modelId: "gpt-4o-mini",
      modelName: "GPT-4o mini",
      requiresKey: true
    },
    ollama: {
      label: "Ollama（本地）",
      providerId: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      modelId: "qwen2.5:7b",
      modelName: "Ollama Local",
      requiresKey: false
    },
    lmstudio: {
      label: "LM Studio（本地）",
      providerId: "lmstudio",
      baseUrl: "http://127.0.0.1:1234/v1",
      modelId: "local-model",
      modelName: "LM Studio Local",
      requiresKey: false
    },
    custom: {
      label: "其他 OpenAI 兼容服务",
      providerId: "internal-custom",
      baseUrl: "",
      modelId: "",
      modelName: "Custom Model",
      requiresKey: false
    }
  };

  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
  const byId = (id) => document.getElementById(id);
  let configPath = null;
  let currentConfig = null;

  function element(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "className") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "htmlFor") node.htmlFor = value;
      else if (key === "style") Object.assign(node.style, value);
      else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value !== undefined && value !== null) node.setAttribute(key, value);
    }
    for (const child of Array.isArray(children) ? children : [children]) {
      if (child !== null && child !== undefined) node.append(child);
    }
    return node;
  }

  function setStatus(message, kind = "info") {
    const status = byId("travel-model-status");
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
    status.style.color = kind === "error" ? "#dc2626" : kind === "success" ? "#059669" : "#64748b";
  }

  function selectedPreset() {
    return PRESETS[byId("travel-provider").value] || PRESETS.custom;
  }

  function fillPreset(key) {
    const preset = PRESETS[key] || PRESETS.custom;
    byId("travel-base-url").value = preset.baseUrl;
    byId("travel-model-id").value = preset.modelId;
    byId("travel-model-name").value = preset.modelName;
    byId("travel-api-key").placeholder = preset.requiresKey
      ? "请输入该平台的 API Key"
      : "本地服务通常无需填写";
    byId("travel-provider-id").value = preset.providerId;
    byId("travel-provider-id-row").style.display = key === "custom" ? "grid" : "none";
    setStatus("配置只保存在本机，仅使用你选择的模型服务。", "info");
  }

  function formValues() {
    const preset = selectedPreset();
    const providerId = byId("travel-provider-id").value.trim();
    const baseUrl = byId("travel-base-url").value.trim().replace(/\/$/, "");
    const modelId = byId("travel-model-id").value.trim();
    const modelName = byId("travel-model-name").value.trim() || modelId;
    const apiKey = byId("travel-api-key").value.trim();
    if (!/^[a-z][a-z0-9_-]*$/i.test(providerId)) {
      throw new Error("提供方标识只能包含英文字母、数字、横线和下划线，并以字母开头。");
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      throw new Error("Base URL 格式不正确。");
    }
    if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("Base URL 必须以 http:// 或 https:// 开头。");
    if (parsedUrl.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname)) {
      throw new Error("远程模型服务必须使用 HTTPS；本机回环地址可以使用 HTTP。");
    }
    if (!modelId) throw new Error("请输入模型 ID。");
    const existingKey = currentConfig?.models?.providers?.[providerId]?.apiKey || "";
    if (preset.requiresKey && !apiKey && !existingKey) throw new Error("该云端服务需要 API Key。");
    return { providerId, baseUrl, modelId, modelName, apiKey: apiKey || existingKey, preset };
  }

  async function readConfig() {
    configPath = await invoke("config_detect_local_path");
    if (!configPath) throw new Error("未找到本地 OpenClaw 配置文件。");
    const content = await invoke("config_read_local", { path: configPath });
    currentConfig = content ? JSON.parse(content) : {};
    return currentConfig;
  }

  async function testConnection() {
    try {
      const values = formValues();
      setStatus("正在测试模型服务连接…", "info");
      await invoke("validate_api_key", {
        baseUrl: values.baseUrl,
        apiKey: values.apiKey,
        modelId: values.modelId,
        apiType: "openai-completions"
      });
      setStatus("连接测试通过，可以保存。", "success");
    } catch (error) {
      setStatus(`连接测试失败：${error?.message || String(error)}`, "error");
    }
  }

  async function saveConfig() {
    const saveButton = byId("travel-save-model");
    try {
      saveButton.disabled = true;
      const values = formValues();
      setStatus("正在保存本地模型配置…", "info");
      await readConfig();
      const config = currentConfig || {};
      config.models = config.models || {};
      config.models.mode = "merge";
      config.models.providers = config.models.providers || {};
      const previousProvider = config.models.providers[values.providerId] || {};
      const provider = {
        ...previousProvider,
        api: "openai-completions",
        baseUrl: values.baseUrl,
        models: [{
          id: values.modelId,
          name: values.modelName,
          api: "openai-completions",
          input: ["text", "image"],
          contextWindow: 128000,
          maxTokens: 16384
        }]
      };
      if (values.apiKey) provider.apiKey = values.apiKey;
      else delete provider.apiKey;
      config.models.providers[values.providerId] = provider;

      config.agents = config.agents || {};
      config.agents.defaults = config.agents.defaults || {};
      const modelReference = `${values.providerId}/${values.modelId}`;
      config.agents.defaults.model = modelReference;
      if (Array.isArray(config.agents.list)) {
        const main = config.agents.list.find((agent) => agent.id === "main");
        if (main) main.model = modelReference;
      }
      await invoke("config_write_local", { path: configPath, content: JSON.stringify(config, null, 2) });
      byId("travel-api-key").value = "";
      currentConfig = config;
      setStatus("配置已保存，正在重启本地网关…", "success");
      await invoke("sidecar_gateway_restart", { timeoutMs: 300000 });
      setStatus(`已启用 ${values.preset.label} / ${values.modelId}`, "success");
      setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      setStatus(`保存失败：${error?.message || String(error)}`, "error");
      saveButton.disabled = false;
    }
  }

  function field(label, input) {
    return element("label", { className: "travel-field" }, [
      element("span", { text: label }),
      input
    ]);
  }

  function createModal() {
    if (byId("travel-model-modal")) return;
    const providerSelect = element("select", { id: "travel-provider" });
    for (const [key, preset] of Object.entries(PRESETS)) {
      providerSelect.append(element("option", { value: key, text: preset.label }));
    }
    providerSelect.addEventListener("change", () => fillPreset(providerSelect.value));

    const modal = element("div", { id: "travel-model-modal" }, [
      element("div", { className: "travel-model-card" }, [
        element("div", { className: "travel-model-header" }, [
          element("div", {}, [
            element("h2", { text: "旅策协同 模型设置" }),
            element("p", { text: "连接公司自有的云端或本地大模型，模型凭据仅写入本机配置。" })
          ]),
          element("button", {
            type: "button",
            className: "travel-close",
            text: "×",
            "aria-label": "关闭模型设置",
            onclick: () => { modal.style.display = "none"; }
          })
        ]),
        element("div", { className: "travel-preset-grid" }, Object.entries(PRESETS).slice(0, 6).map(([key, preset]) =>
          element("button", {
            type: "button",
            text: preset.label,
            onclick: () => {
              providerSelect.value = key;
              fillPreset(key);
            }
          })
        )),
        element("div", { className: "travel-form-grid" }, [
          field("模型平台", providerSelect),
          field("模型 ID", element("input", { id: "travel-model-id", autocomplete: "off" })),
          field("Base URL", element("input", { id: "travel-base-url", autocomplete: "url" })),
          field("显示名称", element("input", { id: "travel-model-name", autocomplete: "off" })),
          element("div", { id: "travel-provider-id-row", className: "travel-field" }, [
            element("span", { text: "提供方标识" }),
            element("input", { id: "travel-provider-id", autocomplete: "off" })
          ]),
          field("API Key", element("input", {
            id: "travel-api-key",
            type: "password",
            autocomplete: "new-password"
          }))
        ]),
        element("p", {
          id: "travel-model-status",
          text: "配置只保存在本机，仅使用你选择的模型服务。"
        }),
        element("div", { className: "travel-actions" }, [
          element("button", { type: "button", text: "测试连接", onclick: testConnection }),
          element("button", {
            id: "travel-save-model",
            type: "button",
            className: "primary",
            text: "保存并启用",
            onclick: saveConfig
          })
        ])
      ])
    ]);
    document.body.append(modal);
    fillPreset("deepseek");
  }

  function installStyles() {
    if (byId("travel-model-styles")) return;
    const style = element("style", { id: "travel-model-styles" });
    style.textContent = `
      #travel-model-button{position:fixed;left:18px;bottom:122px;z-index:9997;border:1px solid rgba(100,116,139,.24);border-radius:10px;padding:8px 14px;background:rgba(255,255,255,.92);color:#1f2937;box-shadow:0 8px 24px rgba(15,23,42,.08);font:500 13px system-ui;cursor:pointer;backdrop-filter:blur(14px)}
      .dark #travel-model-button{background:rgba(30,30,34,.94);color:#f3f4f6}
      #travel-model-modal{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.38);backdrop-filter:blur(5px);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
      .travel-model-card{width:min(760px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow:auto;border-radius:20px;padding:26px;background:#fff;color:#1f2937;box-shadow:0 28px 90px rgba(15,23,42,.25)}
      .dark .travel-model-card{background:#202024;color:#f4f4f5}
      .travel-model-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:20px}.travel-model-header h2{margin:0;font-size:22px}.travel-model-header p{margin:6px 0 0;color:#64748b;font-size:13px}.travel-close{border:0;background:transparent;color:inherit;font-size:28px;line-height:1;cursor:pointer}
      .travel-preset-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:18px}.travel-preset-grid button{border:1px solid rgba(100,116,139,.22);border-radius:11px;padding:10px 12px;background:rgba(148,163,184,.08);color:inherit;cursor:pointer;text-align:left}.travel-preset-grid button:hover{border-color:#6366f1;background:rgba(99,102,241,.08)}
      .travel-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.travel-field{display:grid;gap:6px;font-size:12px;color:#64748b}.travel-field input,.travel-field select{width:100%;box-sizing:border-box;border:1px solid rgba(100,116,139,.28);border-radius:10px;padding:10px 11px;background:transparent;color:inherit;outline:none}.travel-field input:focus,.travel-field select:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.12)}
      #travel-model-status{min-height:20px;margin:16px 0 8px;font-size:13px}.travel-actions{display:flex;justify-content:flex-end;gap:10px}.travel-actions button{border:1px solid rgba(100,116,139,.3);border-radius:10px;padding:9px 16px;background:transparent;color:inherit;cursor:pointer}.travel-actions button.primary{border-color:#292b30;background:#292b30;color:#fff}.travel-actions button:disabled{cursor:wait;opacity:.6}
      @media(max-width:720px){.travel-preset-grid,.travel-form-grid{grid-template-columns:1fr}.travel-model-card{padding:20px}}
    `;
    document.head.append(style);
  }

  async function openModal() {
    createModal();
    byId("travel-model-modal").style.display = "flex";
    try {
      await readConfig();
      const reference = currentConfig?.agents?.defaults?.model;
      if (typeof reference === "string" && reference.includes("/")) {
        const [providerId, ...modelParts] = reference.split("/");
        const provider = currentConfig?.models?.providers?.[providerId];
        const matchedKey = Object.keys(PRESETS).find((key) => PRESETS[key].providerId === providerId);
        const key = matchedKey || (provider ? "custom" : "deepseek");
        byId("travel-provider").value = key;
        fillPreset(key);
        if (provider) {
          byId("travel-provider-id").value = providerId;
          byId("travel-base-url").value = provider.baseUrl || "";
          byId("travel-model-id").value = modelParts.join("/");
          const model = provider.models?.find((item) => item.id === modelParts.join("/"));
          byId("travel-model-name").value = model?.name || modelParts.join("/");
          if (provider.apiKey) byId("travel-api-key").placeholder = "已配置；留空则保留原密钥";
        }
      }
    } catch (error) {
      setStatus(`读取配置失败：${error?.message || String(error)}`, "error");
    }
  }

  async function needsSetup() {
    try {
      const config = await readConfig();
      const reference = config?.agents?.defaults?.model;
      if (!reference) return true;
      if (/(?:^|\/)auto$/i.test(String(reference))) return true;
      if (/oauth2/i.test(String(reference))) return true;
      const providerId = String(reference).split("/")[0];
      return !config?.models?.providers?.[providerId];
    } catch {
      return true;
    }
  }

  async function install() {
    if (!window.__TAURI_INTERNALS__?.invoke || byId("travel-model-button")) return;
    installStyles();
    const button = element("button", {
      id: "travel-model-button",
      type: "button",
      text: "⚙ 模型设置",
      onclick: openModal
    });
    document.body.append(button);
    if (await needsSetup()) await openModal();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(install, 800));
  else setTimeout(install, 800);
})();
