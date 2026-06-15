import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listCloudModels } from "./ollama.js";

// Tests del listado de modelos de los cerebros de nube. No tocan la red real ni usan
// keys reales: aislamos process.env y mockeamos fetch. Cubren la generalizacion de
// listGeminiModels -> listCloudModels (config por proveedor, URL, auth, parseo, orden,
// y la lista estatica de MiniMax que no expone /models).

const CLOUD_KEYS = ["GEMINI_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "MINIMAX_API_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};

function mockFetchJson(payload: unknown, ok = true, status = 200) {
  const fn = vi.fn(async (_url: string, _init?: unknown) => ({
    ok,
    status,
    text: async () => JSON.stringify(payload)
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  // Aislar el entorno: el .env local puede tener keys reales; las quitamos para que el
  // test sea deterministico. Nunca leemos ni imprimimos su valor.
  for (const key of CLOUD_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of CLOUD_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("listCloudModels", () => {
  it("MiniMax: devuelve lista estatica con M3 primero y sin tocar la red", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await listCloudModels("minimax");
    expect(res.ok).toBe(true);
    expect(res.models[0]).toBe("MiniMax-M3");
    expect(res.models).toContain("MiniMax-M2");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Gemini: sin API key devuelve error y no llama a la red (auth requerido)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await listCloudModels("gemini");
    expect(res.ok).toBe(false);
    expect(res.error || "").toMatch(/key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("DeepSeek: sin API key devuelve error (auth requerido)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await listCloudModels("deepseek");
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OpenRouter: parsea data[].id, quita prefijo models/ y ordena flash primero", async () => {
    const fetchMock = mockFetchJson({ data: [{ id: "z/model" }, { id: "a/flash-mini" }, { id: "models/b/model" }] });
    const res = await listCloudModels("openrouter");
    expect(res.ok).toBe(true);
    expect(res.models[0]).toBe("a/flash-mini"); // los "flash" van primero
    expect(res.models).toContain("b/model");    // se removio el prefijo "models/"
    expect(res.models).not.toContain("models/b/model");
    const calledUrl = String(fetchMock.mock.calls[0]?.[0] || "");
    expect(calledUrl.endsWith("/models")).toBe(true);
  });

  it("OpenRouter: un HTTP no-ok propaga el error con su status", async () => {
    mockFetchJson({}, false, 502);
    const res = await listCloudModels("openrouter");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(502);
  });
});
