import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const targetUrl = process.env.COCKPIT_URL || "http://127.0.0.1:5173/";
const chromePath = process.env.CHROME_BIN || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifactsDir = path.resolve("data/run/layout-validation");
const port = 9400 + Math.floor(Math.random() * 400);
const userDataDir = path.join(os.tmpdir(), `mivtuberia-layout-${Date.now()}`);

const sizes = [
  [1720, 900],
  [1440, 900],
  [1280, 760],
  [1180, 760],
  [1100, 720],
  [1024, 760],
  [1024, 600],
  [900, 760],
  [768, 760],
  [768, 600],
  [640, 760],
  [560, 760],
  [560, 600],
  [430, 760],
  [390, 760],
  [360, 740],
  [320, 700]
];

const screenshotCases = new Set([
  "live-1440x900",
  "live-1024x600",
  "live-768x600",
  "live-560x600",
  "live-390x760",
  "scene-768x600",
  "backups-768x600"
]);

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  "--headless=new",
  "--disable-gpu",
  "--disable-extensions",
  "--no-first-run",
  "--window-position=0,0",
  "about:blank"
], { stdio: "ignore" });

let pageWs;
let browserWs;
let nextId = 1;
const pending = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function waitForChrome() {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  for (let i = 0; i < 80; i += 1) {
    try {
      return await fetchJson(endpoint);
    } catch {
      await sleep(100);
    }
  }
  throw new Error("Chrome DevTools endpoint did not start.");
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function wire(ws) {
  ws.on("message", (buffer) => {
    const message = JSON.parse(String(buffer));
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message || "CDP error"));
    else entry.resolve(message.result || {});
  });
}

function send(method, params = {}) {
  const id = nextId++;
  pageWs.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  }
  return result.result?.value;
}

async function setViewport(width, height) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  });
}

async function navigate(url) {
  await send("Page.navigate", { url });
  await sleep(700);
}

async function clickNav(label) {
  await evaluate(`(() => {
    const target = Array.from(document.querySelectorAll(".sidebarNav button"))
      .find((button) => (button.textContent || "").trim().toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
    if (target) target.click();
    return Boolean(target);
  })()`);
  await sleep(150);
}

async function screenshot(name) {
  await fs.mkdir(artifactsDir, { recursive: true });
  const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = path.join(artifactsDir, `${name}.png`);
  await fs.writeFile(file, Buffer.from(result.data, "base64"));
  return file;
}

async function measure(route, width, height) {
  if (route !== "live") await clickNav(route);
  else await clickNav("Live");
  return evaluate(`(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rectOf = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const intersectsViewport = (rect) => Boolean(rect && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < vw && rect.top < vh);
    const fullyInViewport = (rect) => Boolean(rect && rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.top >= -1 && rect.right <= vw + 1 && rect.bottom <= vh + 1);
    const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
    const visibleAfterScroll = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      element.scrollIntoView({ block: "center", inline: "nearest" });
      const rect = element.getBoundingClientRect();
      return intersectsViewport(rect);
    };
    const main = document.querySelector(".cockpitWorkspace");
    if (main) main.scrollTop = 0;
    const grid = document.querySelector(".cockpitGrid");
    if (grid) grid.scrollTop = 0;
    const chat = rectOf(".consoleCard.chatPanel");
    const composer = rectOf(".chatComposer");
    const send = rectOf(".sendButton");
    const preview = rectOf(".livePreviewCard.heroPanel");
    const sidebar = rectOf(".lumaSidebar");
    const workspace = rectOf(".cockpitWorkspace");
    const topbar = rectOf(".cockpitTopbar");
    const firstCard = rectOf(".cockpitGrid > .operatorPanel.controlPanel, .cockpitGrid > .consoleCard.chatPanel");
    const bodyText = document.body.innerText || "";
    const horizontalOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > vw + 2;
    const criticalZero = [chat, composer, send].some((rect) => !rect || rect.width < 8 || rect.height < 8);
    return {
      route: ${JSON.stringify(route)},
      width: ${width},
      height: ${height},
      horizontalOverflow,
      composerExists: Boolean(document.querySelector(".chatComposer")),
      composerVisible: intersectsViewport(composer),
      composerFullyVisible: fullyInViewport(composer),
      composerReachable: visibleAfterScroll(".chatComposer"),
      sendVisible: intersectsViewport(send),
      sendReachable: visibleAfterScroll(".sendButton"),
      chatExists: Boolean(document.querySelector(".consoleCard.chatPanel")),
      chatVisible: intersectsViewport(chat),
      chatBeforePreview: !preview || !chat || chat.top <= preview.top + 4,
      previewOverlapsChat: overlaps(preview, chat),
      sidebarOverlapsMain: overlaps(sidebar, firstCard) || overlaps(sidebar, workspace),
      topbarOverlapsMain: overlaps(topbar, firstCard),
      criticalZero,
      badText: /\\b(undefined|null|NaN)\\b/.test(bodyText),
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: vw
    };
  })()`);
}

async function restoreRouteTop(route) {
  await evaluate(`(() => {
    const main = document.querySelector(".cockpitWorkspace");
    const grid = document.querySelector(".cockpitGrid");
    if (main) main.scrollTop = 0;
    if (grid) grid.scrollTop = 0;
    if (${JSON.stringify(route)} === "live") {
      const chat = document.querySelector(".consoleCard.chatPanel");
      if (chat) chat.scrollIntoView({ block: "start", inline: "nearest" });
    }
    return true;
  })()`);
  await sleep(80);
}

async function main() {
  await fetch(targetUrl, { cache: "no-store" });
  const version = await waitForChrome();
  browserWs = await connect(version.webSocketDebuggerUrl);
  const tabs = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  const tab = tabs.find((item) => item.type === "page");
  if (!tab?.webSocketDebuggerUrl) throw new Error("No page target was created.");
  pageWs = await connect(tab.webSocketDebuggerUrl);
  wire(pageWs);
  await send("Runtime.enable");
  await send("Page.enable");
  const results = [];
  for (const [width, height] of sizes) {
    await setViewport(width, height);
    await navigate(targetUrl);
    const live = await measure("live", width, height);
    results.push(live);
    const liveKey = `live-${width}x${height}`;
    if (screenshotCases.has(liveKey)) {
      await restoreRouteTop("live");
      live.screenshot = await screenshot(liveKey);
    }
    if (width === 768 && height === 600) {
      const scene = await measure("scene", width, height);
      await restoreRouteTop("scene");
      scene.screenshot = await screenshot("scene-768x600");
      results.push(scene);
      const backups = await measure("backups", width, height);
      await restoreRouteTop("backups");
      backups.screenshot = await screenshot("backups-768x600");
      results.push(backups);
    }
  }
  const failures = results.filter((item) =>
    item.horizontalOverflow ||
    (item.route === "live" && (!item.composerExists || !item.composerReachable || !item.sendReachable || !item.chatExists)) ||
    (item.route === "live" && item.width <= 1280 && !item.composerFullyVisible) ||
    (item.route === "live" && item.previewOverlapsChat) ||
    item.sidebarOverlapsMain ||
    item.topbarOverlapsMain ||
    (item.route === "live" && item.criticalZero) ||
    item.badText ||
    (item.route === "live" && item.width <= 1280 && !item.chatBeforePreview)
  );
  console.log(JSON.stringify({ ok: failures.length === 0, artifactsDir, results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  try { pageWs?.close(); } catch {}
  try { browserWs?.close(); } catch {}
  chrome.kill();
  await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
});
