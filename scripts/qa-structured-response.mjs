// QA ligero del contrato estructurado de Yuko. Ejecutar:
//   npm run qa:structured
// Sigue el patron de scripts/qa-tikfinity-autonomy.mjs (node --import tsx).
const { parseYukoResponse, normalizeEmotion, normalizeMode, isLikelyJson } =
  await import("../server/llm/structuredResponse.ts");

let passed = 0;
function assert(condition, message, detail = {}) {
  if (!condition) {
    const error = new Error(message);
    error.detail = detail;
    throw error;
  }
  passed += 1;
}

// 1. Texto plano normal -> fallback legacy, spoken_text == texto crudo.
{
  const raw = "Holi, hoy me siento feliz de verte por aqui!";
  const r = parseYukoResponse(raw);
  assert(r.meta.source === "legacy_text_fallback", "texto plano debe ser legacy", r);
  assert(r.spoken_text === raw, "spoken_text legacy debe preservar el texto crudo", r);
  assert(r.meta.raw_was_json === false, "texto plano: raw_was_json false", r);
}

// 2. JSON valido completo -> structured, emocion/mode normalizados.
{
  const raw = JSON.stringify({ mode: "comfy", emotion: "happy", gesture: "nod", spoken_text: "Aqui estoy contigo." });
  const r = parseYukoResponse(raw);
  assert(r.meta.source === "structured", "JSON valido debe ser structured", r);
  assert(r.spoken_text === "Aqui estoy contigo.", "spoken_text del JSON", r);
  assert(r.emotion === "happy" && r.mode === "comfy" && r.gesture === "nod", "campos normalizados", r);
}

// 3. JSON con campos faltantes (solo spoken_text) -> structured con defaults seguros.
{
  const raw = JSON.stringify({ spoken_text: "Solo texto." });
  const r = parseYukoResponse(raw);
  assert(r.meta.source === "structured", "JSON parcial sigue siendo structured", r);
  assert(r.mode === "neutral", "mode ausente -> neutral", r);
  assert((["neutral","happy","annoyed","sad","surprised","thinking","safe"]).includes(r.emotion), "emotion inferida valida", r);
  assert(r.gesture === null, "gesture ausente -> null", r);
}

// 4. JSON invalido (truncado) pero con spoken_text rescatable -> structured por rescate.
{
  const raw = '{"mode":"chaos","emotion":"surprised","spoken_text":"Casi me caigo en la lava!", "gestur';
  const r = parseYukoResponse(raw);
  assert(r.meta.source === "structured", "JSON truncado rescata spoken_text", r);
  assert(r.spoken_text === "Casi me caigo en la lava!", "spoken_text rescatado", r);
  assert(r.emotion === "surprised" && r.mode === "chaos", "campos rescatados", r);
}

// 5. Emocion desconocida -> alias o inferida, nunca invalida.
{
  const raw = JSON.stringify({ mode: "spicy", emotion: "angry", spoken_text: "No me molestes, eh." });
  const r = parseYukoResponse(raw);
  assert(r.emotion === "annoyed", "alias angry -> annoyed", r);
  const raw2 = JSON.stringify({ mode: "comfy", emotion: "xyz123", spoken_text: "jaja me encanta!" });
  const r2 = parseYukoResponse(raw2);
  assert((["neutral","happy","annoyed","sad","surprised","thinking","safe"]).includes(r2.emotion), "emocion desconocida -> inferida valida", r2);
}

// 6. Modo desconocido -> neutral.
{
  const raw = JSON.stringify({ mode: "ultra_modo", emotion: "neutral", spoken_text: "Listo." });
  const r = parseYukoResponse(raw);
  assert(r.mode === "neutral", "modo desconocido -> neutral", r);
  // alias en espanol
  assert(normalizeMode("Narradora") === "narrator", "alias Narradora -> narrator", {});
  assert(normalizeMode("Caos VTuber") === "chaos", "alias Caos VTuber -> chaos", {});
}

// 7. spoken_text vacio en JSON valido -> cae a legacy con el bruto (no rompe la voz).
{
  const raw = JSON.stringify({ mode: "comfy", emotion: "happy", spoken_text: "" });
  const r = parseYukoResponse(raw);
  assert(r.meta.source === "legacy_text_fallback", "spoken_text vacio -> fallback", r);
  assert(r.spoken_text === raw, "fallback preserva el bruto", r);
  assert(r.meta.raw_was_json === true, "se reconoce que parecia JSON", r);
}

// 8. JSON dentro de code fence ```json ... ``` -> structured.
{
  const raw = "```json\n{ \"mode\": \"narrator\", \"emotion\": \"thinking\", \"gesture\": null, \"spoken_text\": \"Avanzo despacio entre los arboles.\" }\n```";
  const r = parseYukoResponse(raw);
  assert(r.meta.source === "structured", "code fence debe parsear", r);
  assert(r.mode === "narrator" && r.emotion === "thinking", "campos dentro del fence", r);
  assert(r.gesture === null, "gesture null explicito", r);
}

// helpers basicos
assert(isLikelyJson('{"a":1}') === true, "isLikelyJson detecta objeto", {});
assert(isLikelyJson("hola mundo") === false, "isLikelyJson rechaza texto", {});
assert(normalizeEmotion("playful") === "happy", "alias playful -> happy", {});
assert(normalizeEmotion("") === null, "emocion vacia -> null", {});

console.log(`qa-structured-response OK: ${passed} aserciones pasaron.`);
