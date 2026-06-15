import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import net from "node:net";
import process from "node:process";

const children = [];
const runDir = join(process.cwd(), "data", "run");
const pidPath = join(runDir, "luma-pids.json");
let browserOpened = false;

// Windows (WinNAT/Hyper-V) puede RESERVAR el 8787 (rangos excluidos que cambian por
// reinicio) y el backend muere con EACCES dejando la app sin cerebro. El supervisor
// elige aquí el primer puerto realmente disponible y se lo pasa al backend (PORT) y
// al proxy de Vite (MIVTUBERIA_BACKEND_PORT) para que SIEMPRE queden coordinados.
const backendPort = await pickBackendPort();
if (backendPort !== 8787) {
  console.warn(`[dev] El puerto 8787 no esta disponible (Windows lo reserva o esta ocupado). Backend en ${backendPort}.`);
  console.warn(`[dev] OBS Browser Sources: http://127.0.0.1:${backendPort}/viewer y http://127.0.0.1:${backendPort}/speaker`);
}

async function pickBackendPort() {
  const preferred = Number(process.env.PORT) || 8787;
  const candidates = [...new Set([preferred, 17787, 27787, 37787, 47787])];
  for (const port of candidates) {
    if (await canBind(port)) return port;
  }
  console.error(`[dev] Ningun puerto candidato disponible (${candidates.join(", ")}).`);
  process.exit(1);
}

function canBind(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

function run(name, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: makeEnv(),
    stdio: "pipe"
  });

  child.stdout.on("data", (data) => {
    const text = data.toString();
    process.stdout.write(`[${name}] ${text}`);
    maybeOpenBrowser(name, text);
  });
  child.stderr.on("data", (data) => {
    const text = data.toString();
    process.stderr.write(`[${name}] ${text}`);
    if (name === "api" && /EADDRINUSE|address already in use/i.test(text)) {
      console.error(`[api] El puerto ${backendPort} ya esta ocupado. Ejecuta Stop-Luma.bat o elige Reiniciar Luma limpia en Start-Luma.bat.`);
    }
    if (name === "web" && /Port 5173 is already in use/i.test(text)) {
      console.error("[web] El puerto 5173 ya esta ocupado. Ejecuta Stop-Luma.bat o elige Reiniciar Luma limpia en Start-Luma.bat.");
    }
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
    shutdown();
  });
  children.push(child);
  writePidFile();
}

function makeEnv() {
  const env = {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(backendPort),
    MIVTUBERIA_BACKEND_PORT: String(backendPort)
  };
  if ("Path" in env && "PATH" in env) {
    delete env.PATH;
  }
  return env;
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  rmSync(pidPath, { force: true });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const viteEntry = join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
const tsxEntry = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

if (!existsSync(viteEntry) || !existsSync(tsxEntry)) {
  console.error("Faltan dependencias locales. Ejecuta npm install antes de npm run dev.");
  process.exit(1);
}

mkdirSync(runDir, { recursive: true });
run("api", process.execPath, [tsxEntry, "watch", "--clear-screen=false", "server/index.ts"]);
run("web", process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", "5173", "--strictPort"]);

function writePidFile() {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    pidPath,
    JSON.stringify({
      startedAt: new Date().toISOString(),
      parentPid: process.pid,
      children: children.map((child) => ({
        pid: child.pid,
        name: child.spawnargs.join(" ")
      }))
    }, null, 2),
    "utf8"
  );
}

function maybeOpenBrowser(name, text) {
  if (browserOpened || name !== "web") return;
  if (process.env.LUMA_OPEN_BROWSER !== "1" && process.env.LUMA_PROMPT_BROWSER !== "1") return;
  if (!text.includes("Local:") && !text.includes("ready in")) return;
  browserOpened = true;
  waitForReadiness()
    .then((ready) => {
      if (!ready) {
        console.error("[dev] Luma no quedo lista a tiempo. No abro navegador a ciegas; revisa la consola.");
        return;
      }
      return maybePromptAndOpenBrowser();
    })
    .catch((error) => {
      console.error(`[dev] No pude verificar readiness: ${error instanceof Error ? error.message : error}`);
    });
}

async function maybePromptAndOpenBrowser() {
  if (process.env.LUMA_OPEN_BROWSER === "1") {
    openBrowser();
    return;
  }
  if (process.env.LUMA_PROMPT_BROWSER !== "1") return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Luma esta lista. Abrir navegador automaticamente? [S/n] ");
    if (!/^[nN]/.test(answer.trim())) openBrowser();
  } finally {
    rl.close();
  }
}

async function waitForReadiness() {
  const started = Date.now();
  const timeoutMs = 45000;
  while (Date.now() - started < timeoutMs) {
    const [apiReady, webReady] = await Promise.all([
      checkJson(`http://127.0.0.1:${backendPort}/api/status`),
      checkHtml("http://127.0.0.1:5173/")
    ]);
    if (apiReady && webReady) return true;
    await sleep(750);
  }
  return false;
}

async function checkJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

async function checkHtml(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const text = await response.text();
    return /<html/i.test(text) || text.includes("root");
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openBrowser() {
  const opener = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32"
    ? ["/c", "start", "", "http://127.0.0.1:5173/"]
    : ["http://127.0.0.1:5173/"];
  spawn(opener, args, { detached: true, stdio: "ignore" }).unref();
}
