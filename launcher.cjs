const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const WebSocket = require("./runtime/openclaw/node_modules/ws");
const { attachAgent } = require("./tourism/agent-desktop.cjs");
const { modelConfigPaths } = require("./platform/model-config-paths.cjs");

const root = __dirname;
const executablePath = path.join(root, "runtime", "旅策协同.exe");
const frontendPath = path.join(root, "dist", "index-v4.js");
const nativeBrandPath = path.join(root, "native-brand.ps1");
const nativeIconPath = path.join(root, "assets", "travel.ico");
const logPath = path.join(root, "logs", "launcher.log");
const webviewDataPath = path.join(process.env.LOCALAPPDATA || path.join(root, "logs"), "旅策协同", "WebView2");
const portableOpenClawCommandPath = path.join(root, "runtime", "bin", "openclaw.cmd");
let startupReadyPath;
let activeChild;
let activeNativeBrand;

function ensurePortableRuntimeCommand() {
  fs.writeFileSync(portableOpenClawCommandPath, '@"%~dp0node.exe" "%~dp0..\\openclaw\\openclaw.mjs" %*\r\n');
}

function migrateModelConfig() {
  if (!process.env.USERPROFILE) return;
  const [currentFile, ...priorFiles] = modelConfigPaths(process.env.USERPROFILE);
  const currentDir = path.dirname(currentFile);
  const migrationSource = priorFiles.find(file => fs.existsSync(file));
  if (!fs.existsSync(currentFile) && migrationSource) {
    fs.mkdirSync(currentDir, { recursive: true });
    fs.copyFileSync(migrationSource, currentFile);
  }
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${line}\n`);
  console.log(line);
}

function assertFiles() {
  for (const filePath of [executablePath, frontendPath, nativeBrandPath, nativeIconPath]) {
    if (!fs.existsSync(filePath)) throw new Error(`V4 文件缺失：${filePath}`);
  }
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForTarget(port, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("旅策协同进程提前退出。请先关闭正在运行的其他单实例，再重新启动。");
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) {
        const targets = await response.json();
        // Some WebView2 versions expose the Tauri page before its initial title
        // is populated. The local origin and page target are the stable signals;
        // waiting for a title can turn a healthy cold start into a false timeout.
        const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl && /^https?:\/\/tauri\.localhost\/?/.test(item.url));
        if (target) return target;
      }
    } catch {
      // WebView2 is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("等待旅策协同桌面窗口超时。请确认 WebView2 Runtime 已安装。");
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const listeners = new Set();
  let nextId = 0;

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      const operation = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) operation.reject(new Error(JSON.stringify(message.error)));
      else operation.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });

  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  return {
    socket,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
  };
}

async function injectStandaloneFrontend(cdp, frontend) {
  const body = Buffer.from(frontend).toString("base64");
  let fulfilled = false;
  const seenAssets = new Set();
  let scriptUrls = [];
  let mainBundleUrl;
  const scriptDeadline = Date.now() + 30000;
  while (!mainBundleUrl && Date.now() < scriptDeadline) {
    const scriptsResult = await cdp.call("Runtime.evaluate", {
      expression: "JSON.stringify(Array.from(document.scripts).map((script) => script.src).filter(Boolean))",
      returnByValue: true
    });
    scriptUrls = JSON.parse(scriptsResult.result?.value || "[]");
    mainBundleUrl = scriptUrls.find((url) => /\/assets\/index-[^/]+\.js(?:$|\?)/.test(url));
    if (!mainBundleUrl) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!mainBundleUrl) throw new Error("未识别到桌面主前端资源。");
  const mainBundlePath = new URL(mainBundleUrl).pathname;

  cdp.onEvent((message) => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    try {
      const pathname = new URL(request.url).pathname;
      if (/\.(?:js|css|html)$/.test(pathname) || pathname === "/") seenAssets.add(pathname);
    } catch {}
    const isMainBundle = new URL(request.url).pathname === mainBundlePath;
    const operation = isMainBundle
      ? cdp.call("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/javascript; charset=utf-8" },
            { name: "Cache-Control", value: "no-store" }
          ],
          body
        }).then(() => { fulfilled = true; })
      : cdp.call("Fetch.continueRequest", { requestId });
    operation.catch((error) => console.error("资源拦截失败：", error.message));
  });

  await cdp.call("Page.enable");
  await cdp.call("Network.enable");
  await cdp.call("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.call("Network.setBypassServiceWorker", { bypass: true });
  await cdp.call("Fetch.enable", {
    patterns: [{ urlPattern: `*${mainBundlePath}`, requestStage: "Request" }]
  });
  await cdp.call("Page.reload", { ignoreCache: true });

  const deadline = Date.now() + 15000;
  while (!fulfilled && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!fulfilled) throw new Error(`前端资源未被加载，无法切换到内部使用模式。已观察资源：${[...seenAssets].join(", ") || "无"}`);
}

async function main() {
  assertFiles();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  ensurePortableRuntimeCommand();
  migrateModelConfig();
  const frontend = fs.readFileSync(frontendPath);
  const port = await getFreePort();
  const existingArguments = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS || "";
  const debugArguments = `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}`;
  startupReadyPath = path.join(root, "logs", `startup-ready-${process.pid}-${port}`);
  fs.rmSync(startupReadyPath, { force: true });
  const child = spawn(executablePath, [], {
    cwd: path.dirname(executablePath),
    env: {
      ...process.env,
      TRAVEL_INTERNAL_MODE: "1",
      WEBVIEW2_USER_DATA_FOLDER: webviewDataPath,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `${existingArguments} ${debugArguments}`.trim()
    },
    stdio: "ignore",
    windowsHide: true
  });
  activeChild = child;
  const nativeBrand = spawn("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
    "-File", nativeBrandPath, "-TargetProcessId", String(child.pid), "-IconPath", nativeIconPath,
    "-HoldHiddenUntilFile", startupReadyPath
  ], { cwd: root, stdio: "ignore", windowsHide: true });
  activeNativeBrand = nativeBrand;

  child.once("error", (error) => {
    console.error("无法启动旅策协同桌面：", error.message);
    process.exitCode = 1;
  });

  const target = await waitForTarget(port, child);
  const cdp = await connect(target);
  const closeAgent = await attachAgent(cdp);
  cdp.socket.once("close", closeAgent);
  await injectStandaloneFrontend(cdp, frontend);
  ensurePortableRuntimeCommand();
  fs.writeFileSync(startupReadyPath, "ready");
  log("旅策协同已载入文旅工作台、Skill协同与模型桥接。");

  child.once("exit", (code) => {
    if (nativeBrand.exitCode === null) nativeBrand.kill();
    closeAgent();
    cdp.socket.close();
    fs.rmSync(startupReadyPath, { force: true });
    activeChild = undefined;
    activeNativeBrand = undefined;
    process.exitCode = code || 0;
  });
}

main().catch((error) => {
  if (activeNativeBrand?.exitCode === null) activeNativeBrand.kill();
  if (activeChild?.exitCode === null) activeChild.kill();
  log(`启动失败：${error.stack || error.message}`);
  process.exitCode = 1;
});
