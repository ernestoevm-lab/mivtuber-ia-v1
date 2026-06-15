import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const binariesDir = join(rootDir, "src-tauri", "binaries");
const bundleStagingDir = join(rootDir, ".tauri-bundle");
const bundleScriptsDir = join(bundleStagingDir, "scripts");
const sidecarBaseName = "mivtuberia-node";
const backendRuntimeDependencies = ["better-sqlite3", "cors", "express", "ws"];
const bundledRuntimeScripts = [
  "kokoro_tts.py",
  "kokoro_worker.py",
  "tts_kokoro_onnx.py",
  "kokoro_onnx_worker.py"
];

const targetTriple = detectTargetTriple();
const extension = process.platform === "win32" ? ".exe" : "";
const source = process.execPath;
const destination = join(binariesDir, `${sidecarBaseName}-${targetTriple}${extension}`);

if (!existsSync(source)) {
  console.error(`[tauri-sidecar] Node runtime not found at ${source}`);
  process.exit(1);
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);

const sourceSize = statSync(source).size;
const destinationSize = statSync(destination).size;
if (sourceSize !== destinationSize) {
  console.error(`[tauri-sidecar] Copied Node runtime size mismatch: ${sourceSize} != ${destinationSize}`);
  process.exit(1);
}

console.log(`[tauri-sidecar] Prepared ${destination}`);
console.log(`[tauri-sidecar] Node ${process.version} (${process.platform}/${process.arch}) will be bundled as ${sidecarBaseName}.`);

prepareBundleStaging();

function detectTargetTriple() {
  const explicit = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || "";
  if (explicit) return explicit;

  if (process.platform === "win32") {
    if (process.arch === "x64") return "x86_64-pc-windows-msvc";
    if (process.arch === "arm64") return "aarch64-pc-windows-msvc";
  }
  if (process.platform === "darwin") {
    if (process.arch === "x64") return "x86_64-apple-darwin";
    if (process.arch === "arm64") return "aarch64-apple-darwin";
  }
  if (process.platform === "linux") {
    if (process.arch === "x64") return "x86_64-unknown-linux-gnu";
    if (process.arch === "arm64") return "aarch64-unknown-linux-gnu";
  }

  console.error(`[tauri-sidecar] Unsupported sidecar target for ${process.platform}/${process.arch}.`);
  process.exit(1);
}

function prepareBundleStaging() {
  const projectPackage = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  const dependencies = {};
  for (const name of backendRuntimeDependencies) {
    const version = projectPackage.dependencies?.[name];
    if (!version) {
      console.error(`[tauri-bundle] Missing runtime dependency in package.json: ${name}`);
      process.exit(1);
    }
    dependencies[name] = version;
  }

  rmSync(bundleStagingDir, { recursive: true, force: true });
  mkdirSync(bundleScriptsDir, { recursive: true });
  writeFileSync(
    join(bundleStagingDir, "package.json"),
    JSON.stringify({
      private: true,
      name: "mivtuberia-tauri-runtime",
      version: projectPackage.version || "0.1.0",
      type: "module",
      dependencies
    }, null, 2),
    "utf8"
  );

  const installCommand = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
  const installArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd install --omit=dev --no-audit --no-fund"]
    : ["install", "--omit=dev", "--no-audit", "--no-fund"];
  const install = spawnSync(installCommand, installArgs, {
    cwd: bundleStagingDir,
    stdio: "inherit"
  });
  if (install.error) {
    console.error(`[tauri-bundle] npm install failed to start: ${install.error.message}`);
    process.exit(1);
  }
  if (install.signal) {
    console.error(`[tauri-bundle] npm install stopped with signal ${install.signal}.`);
    process.exit(1);
  }
  if (install.status !== 0) {
    console.error(`[tauri-bundle] npm install failed with status ${install.status}.`);
    process.exit(install.status || 1);
  }

  for (const scriptName of bundledRuntimeScripts) {
    const from = join(rootDir, "scripts", scriptName);
    const to = join(bundleScriptsDir, scriptName);
    if (!existsSync(from)) {
      console.error(`[tauri-bundle] Required runtime script not found: ${from}`);
      process.exit(1);
    }
    copyFileSync(from, to);
  }

  console.log(`[tauri-bundle] Prepared production backend deps: ${backendRuntimeDependencies.join(", ")}.`);
  console.log(`[tauri-bundle] Prepared runtime scripts: ${bundledRuntimeScripts.join(", ")}.`);
}
