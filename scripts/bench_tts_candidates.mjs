import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const rootDir = process.cwd();
const runSynthesis = process.argv.includes("--run");
const jsonOnly = process.argv.includes("--json");
const texts = [
  "Si, mi creador.",
  "Hola, soy Yuko. Estoy lista para hablar contigo con una voz suave y rapida.",
  "Mi creador, encontre un bug pequeñito, pero no entre en panico. Solo lo mire feo.",
  "Apareci en Minecraft sin herramientas. Primero madera, luego mesa de crafteo, y si escucho un creeper, niego todo."
];

const results = [];

results.push(await benchKokoro());
const kokoroOnnxWorker = await benchKokoroOnnxWorker();
if (kokoroOnnxWorker) results.push(kokoroOnnxWorker);
results.push(await benchPiper());
results.push(await benchCommandBackend("chatterbox", process.env.CHATTERBOX_BENCH_COMMAND));
results.push(skippedResearchBackend("f5-tts", "Research candidate only; set up a dedicated command before running."));
results.push(skippedResearchBackend("gpt-sovits", "Research candidate only; install/benchmark separately."));
results.push(skippedResearchBackend("indextts2", "Research candidate only; install/benchmark separately."));

if (jsonOnly) {
  console.log(JSON.stringify({ runSynthesis, createdAt: new Date().toISOString(), results }, null, 2));
} else {
  printSummary(results);
}

async function benchKokoro() {
  const python = firstExisting([
    process.env.KOKORO_PYTHON,
    path.join(rootDir, ".local", "kokoro-onnx-venv", "Scripts", "python.exe"),
    path.join(rootDir, ".local", "kokoro-venv", "Scripts", "python.exe")
  ]);
  const onnxModel = firstExisting([
    process.env.KOKORO_MODEL_PATH,
    path.join(rootDir, "data", "tts", "kokoro", "kokoro-v1.0.onnx")
  ]);
  const onnxVoices = firstExisting([
    process.env.KOKORO_VOICES_PATH,
    path.join(rootDir, "data", "tts", "kokoro", "voices-v1.0.bin")
  ]);
  const onnxScript = path.join(rootDir, "scripts", "tts_kokoro_onnx.py");
  const legacyScript = path.join(rootDir, "scripts", "kokoro_tts.py");
  if (!python) {
    return skipped("kokoro", "KOKORO_PYTHON or .local Kokoro venv not found.");
  }
  const hasOnnxFiles = Boolean(onnxModel && onnxVoices && fs.existsSync(onnxModel) && fs.existsSync(onnxVoices));
  if (!hasOnnxFiles && !fs.existsSync(legacyScript)) {
    return skipped("kokoro", "Kokoro Python detected, but no Kokoro ONNX model/voices or legacy script were found.");
  }
  if (!runSynthesis) {
    return detected("kokoro", hasOnnxFiles
      ? "Kokoro ONNX Python/model/voices detected. Re-run with --run to synthesize benchmark WAV files in temp."
      : "Kokoro Python detected. Re-run with --run to synthesize benchmark WAV files in temp.");
  }
  if (hasOnnxFiles) {
    return runFileBackend({
      backend: "kokoro-onnx",
      command: python,
      argsFor: (text, output) => [
        onnxScript,
        "--text", text,
        "--output", output,
        "--model", onnxModel,
        "--voices", onnxVoices,
        "--voice", process.env.KOKORO_VOICE || "ef_dora",
        "--lang", process.env.KOKORO_LANGUAGE || process.env.KOKORO_LANG || "es",
        "--speed", process.env.KOKORO_SPEED || "1.0"
      ]
    });
  }
  return runFileBackend({
    backend: "kokoro",
    command: python,
    argsFor: (text, output) => [
      legacyScript,
      "--text", text,
      "--output", output,
      "--voice", process.env.KOKORO_VOICE || "jf_alpha",
      "--lang", process.env.KOKORO_LANG || "e",
      "--speed", process.env.KOKORO_SPEED || "0.95"
    ]
  });
}

async function benchKokoroOnnxWorker() {
  const python = firstExisting([
    process.env.KOKORO_PYTHON,
    path.join(rootDir, ".local", "kokoro-onnx-venv", "Scripts", "python.exe"),
    path.join(rootDir, ".local", "kokoro-venv", "Scripts", "python.exe")
  ]);
  const onnxModel = firstExisting([
    process.env.KOKORO_MODEL_PATH,
    path.join(rootDir, "data", "tts", "kokoro", "kokoro-v1.0.onnx")
  ]);
  const onnxVoices = firstExisting([
    process.env.KOKORO_VOICES_PATH,
    path.join(rootDir, "data", "tts", "kokoro", "voices-v1.0.bin")
  ]);
  const workerScript = path.join(rootDir, "scripts", "kokoro_onnx_worker.py");
  const hasOnnxFiles = Boolean(onnxModel && onnxVoices && fs.existsSync(onnxModel) && fs.existsSync(onnxVoices));
  if (!python || !hasOnnxFiles || !fs.existsSync(workerScript)) return null;
  if (!runSynthesis) {
    return detected("kokoro-onnx-worker", "Persistent Kokoro ONNX worker detected. Re-run with --run to measure warm synthesis.");
  }
  return runJsonLineWorkerBackend({
    backend: "kokoro-onnx-worker",
    command: python,
    args: [workerScript, "--model", onnxModel, "--voices", onnxVoices],
    payloadFor: (text) => ({
      text,
      voice: process.env.KOKORO_VOICE || "ef_dora",
      lang: process.env.KOKORO_LANGUAGE || process.env.KOKORO_LANG || "es",
      speed: Number(process.env.KOKORO_SPEED || 1.0)
    })
  });
}

async function benchPiper() {
  const piper = process.env.PIPER_BIN || await findCommand("piper");
  const model = process.env.PIPER_MODEL;
  if (!piper) return skipped("piper", "PIPER_BIN not set and piper not found in PATH.");
  if (!model || !fs.existsSync(model)) return skipped("piper", "Set PIPER_MODEL to a local .onnx voice model before running.");
  if (!runSynthesis) return detected("piper", "Piper binary/model detected. Re-run with --run to synthesize benchmark WAV files in temp.");
  return runFileBackend({
    backend: "piper",
    command: piper,
    argsFor: (_text, output) => ["--model", model, "--output_file", output],
    stdinFor: (text) => text
  });
}

async function benchCommandBackend(backend, template) {
  if (!template) return skipped(backend, `Set ${backend.toUpperCase()}_BENCH_COMMAND with {text} and {output} placeholders.`);
  if (!runSynthesis) return detected(backend, "Command template configured. Re-run with --run to execute it.");
  return runFileBackend({
    backend,
    command: process.platform === "win32" ? "cmd.exe" : "sh",
    argsFor: (text, output) => process.platform === "win32"
      ? ["/d", "/s", "/c", template.replaceAll("{text}", shellQuote(text)).replaceAll("{output}", shellQuote(output))]
      : ["-lc", template.replaceAll("{text}", shellQuote(text)).replaceAll("{output}", shellQuote(output))]
  });
}

async function runFileBackend({ backend, command, argsFor, stdinFor }) {
  const measurements = [];
  for (const text of texts) {
    const output = path.join(os.tmpdir(), `mivtuberia-${backend}-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
    const started = performance.now();
    try {
      const args = argsFor(text, output);
      await runProcess(command, args, stdinFor?.(text));
      const totalMs = Math.round(performance.now() - started);
      const audioDurationMs = readWavDurationMs(output);
      fs.rmSync(output, { force: true });
      measurements.push({
        textChars: text.length,
        firstAudioMs: totalMs,
        totalMs,
        audioDurationMs,
        rtf: audioDurationMs ? round(totalMs / audioDurationMs, 3) : null
      });
    } catch (error) {
      fs.rmSync(output, { force: true });
      measurements.push({
        textChars: text.length,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return {
    backend,
    status: measurements.some((item) => !item.error) ? "measured" : "failed",
    runSynthesis: true,
    measurements,
    note: "firstAudioMs equals totalMs for file-based backends; streaming must be benchmarked separately."
  };
}

async function runJsonLineWorkerBackend({ backend, command, args, payloadFor }) {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], shell: false });
  let stdoutBuffer = "";
  let stderr = "";
  const pending = [];
  child.stderr.on("data", (data) => {
    stderr += data.toString();
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });
  child.stdout.on("data", (data) => {
    stdoutBuffer += data.toString();
    let newline = stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line) {
        const waiter = pending.shift();
        if (waiter) {
          try {
            waiter.resolve(JSON.parse(line));
          } catch (error) {
            waiter.reject(error);
          }
        }
      }
      newline = stdoutBuffer.indexOf("\n");
    }
  });

  const readLine = () => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${backend} timed out. ${stderr}`)), 120_000);
    pending.push({
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    });
  });

  const measurements = [];
  try {
    const ready = await readLine();
    if (!ready.ok) throw new Error(ready.error || `${backend} failed to become ready.`);
    for (const text of texts) {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const started = performance.now();
      child.stdin.write(`${JSON.stringify({ id, ...payloadFor(text) })}\n`);
      const response = await readLine();
      const totalMs = Math.round(performance.now() - started);
      if (!response.ok || !response.audio) {
        measurements.push({ textChars: text.length, error: response.error || `${backend} failed.` });
        continue;
      }
      const audioBuffer = Buffer.from(response.audio, "base64");
      const audioDurationMs = readWavDurationMsFromBuffer(audioBuffer);
      measurements.push({
        textChars: text.length,
        firstAudioMs: totalMs,
        totalMs,
        audioDurationMs,
        rtf: audioDurationMs ? round(totalMs / audioDurationMs, 3) : null
      });
    }
  } catch (error) {
    measurements.push({ textChars: 0, error: error instanceof Error ? error.message : String(error) });
  } finally {
    child.kill();
  }
  return {
    backend,
    status: measurements.some((item) => !item.error) ? "measured" : "failed",
    runSynthesis: true,
    measurements,
    note: "persistent worker excludes model load from each request; firstAudioMs still equals full WAV completion until streaming/chunking exists."
  };
}

function runProcess(command, args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

function readWavDurationMs(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return null;
  const byteRate = buffer.readUInt32LE(28);
  const dataIndex = buffer.indexOf(Buffer.from("data"));
  if (byteRate <= 0 || dataIndex < 0 || dataIndex + 8 > buffer.length) return null;
  const dataSize = buffer.readUInt32LE(dataIndex + 4);
  return Math.round((dataSize / byteRate) * 1000);
}

function readWavDurationMsFromBuffer(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return null;
  const byteRate = buffer.readUInt32LE(28);
  const dataIndex = buffer.indexOf(Buffer.from("data"));
  if (byteRate <= 0 || dataIndex < 0 || dataIndex + 8 > buffer.length) return null;
  const dataSize = buffer.readUInt32LE(dataIndex + 4);
  return Math.round((dataSize / byteRate) * 1000);
}

async function findCommand(command) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  try {
    const output = await capture(locator, [command]);
    return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  } catch {
    return "";
  }
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (data) => stdout += data.toString());
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited with ${code}`)));
  });
}

function firstExisting(paths) {
  return paths.filter(Boolean).find((item) => fs.existsSync(item)) || "";
}

function skipped(backend, reason) {
  return { backend, status: "skipped", runSynthesis: false, reason };
}

function detected(backend, note) {
  return { backend, status: "detected", runSynthesis: false, note };
}

function skippedResearchBackend(backend, reason) {
  return { backend, status: "research-only", runSynthesis: false, reason };
}

function shellQuote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function printSummary(items) {
  console.log(`MiVtuberIA TTS benchmark (${runSynthesis ? "synthesis enabled" : "detection only"})`);
  console.log("Use --run to synthesize with locally configured backends. No models are downloaded by this script.");
  console.log("");
  for (const item of items) {
    console.log(`${item.backend}: ${item.status}`);
    if (item.reason) console.log(`  reason: ${item.reason}`);
    if (item.note) console.log(`  note: ${item.note}`);
    if (item.measurements) {
      for (const measurement of item.measurements) {
        if (measurement.error) {
          console.log(`  ${measurement.textChars} chars -> error: ${measurement.error}`);
        } else {
          console.log(`  ${measurement.textChars} chars -> first ${measurement.firstAudioMs}ms, total ${measurement.totalMs}ms, audio ${measurement.audioDurationMs ?? "?"}ms, RTF ${measurement.rtf ?? "?"}`);
        }
      }
    }
  }
}
