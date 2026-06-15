# Contrato estructurado de respuesta de Yuko

## Problema que resuelve

Hoy la emoción y el modo de Yuko se infieren del texto plano del LLM con heurísticas
de regex (`inferEmotion` en `server/safety.ts`). Eso funciona pero es frágil: el modelo
no declara explícitamente su intención (modo/emoción/gesto), así que el sistema tiene
que "adivinarla" del texto ya generado.

Este contrato prepara el terreno para que el LLM exprese su respuesta como un objeto
estructurado —sin romper el flujo actual de texto plano— y, cuando lo hace, su emoción
declarada manda sobre la inferida por regex (más fiable para VTube Studio).

## Contrato

Tipo `YukoStructuredResponse` (`server/llm/structuredResponse.ts`):

```jsonc
{
  "mode":    "comfy | chaos | spicy | firm | narrator | neutral",
  "emotion": "neutral | happy | annoyed | sad | surprised | thinking | safe",
  "gesture": "gesto breve o null",
  "spoken_text": "lo que Yuko dice en voz alta",
  "meta": {
    "source": "structured | legacy_text_fallback",
    "raw_was_json": true
  }
}
```

> **Nota de enum:** el enum real de emociones del proyecto es
> `neutral|happy|annoyed|sad|surprised|thinking|safe` (definido en `server/types.ts`).
> NO existe `angry` ni `playful`: el normalizador los mapea como alias
> (`angry→annoyed`, `playful→happy`). Los 5 modos también aceptan sus nombres en
> español como alias (`Caos VTuber→chaos`, `Picante→spicy`, `Firme→firm`,
> `Narradora→narrator`, `Comfy→comfy`).

## Cómo encaja en el flujo (emoción → VTube Studio → TTS → lipsync)

1. `processChat` (`server/index.ts`) obtiene `llm.text` del modelo.
2. `parseYukoResponse(llm.text)` corre **siempre** y devuelve el contrato.
3. `sanitizeOutput(structured.spoken_text)` aplica los filtros de seguridad sobre lo
   que se va a decir (en fallback, `spoken_text` == el texto crudo: idéntico a antes).
4. La emoción se resuelve así: si `meta.source === "structured"`, se usa
   `structured.emotion`; si no, la inferida por regex. La intensidad sigue saliendo de
   `inferEmotionState(text)`.
5. `broadcast("response", response)` incluye los campos opcionales `mode`, `gesture` y
   `structuredSource`. `applyEmotionToVts(response.emotion)` refleja la emoción efectiva.
6. TTS (Kokoro) y lipsync trabajan sobre `response.text` (= `spoken_text` saneado): sin
   cambios respecto al comportamiento previo.

## Producción del JSON (opt-in, apagado por defecto)

El parser está **siempre activo**, pero **pedir** JSON al modelo es opt-in:

- Flag de runtime: `structuredResponseEnabled` (env `STRUCTURED_RESPONSE_ENABLED`,
  default `false`).
- Solo se pide JSON cuando el flag está activo **y** el cerebro efectivo es **Gemini
  nube** (clava la persona; el local 4B es más inconsistente). LM Studio y Ollama
  siguen en texto plano aunque el flag esté activo.
- Cuando aplica, `buildChatPrompt` añade una instrucción mínima y reversible al system
  prompt (`buildStructuredResponseInstruction`), sin tocar el resto de la personalidad.

Para activarlo en pruebas: poner `STRUCTURED_RESPONSE_ENABLED=true` en `.env`, usar
provider `gemini` y reiniciar el backend. Para desactivarlo: quitar el flag o ponerlo
en `false`.

## Ejemplos de entrada/salida

| Entrada del modelo (`llm.text`) | `source` | Resultado |
|---|---|---|
| `Holi, me alegra verte!` | `legacy_text_fallback` | `spoken_text` = el texto crudo; emoción por regex |
| `{"mode":"comfy","emotion":"happy","gesture":"nod","spoken_text":"Aquí estoy."}` | `structured` | usa esos campos; emoción `happy` manda |
| `{"spoken_text":"Solo texto."}` | `structured` | `mode→neutral`, emoción inferida, `gesture→null` |
| `{...,"emotion":"angry",...}` | `structured` | emoción normalizada a `annoyed` |
| `` ```json\n{...}\n``` `` | `structured` | se quita el code fence y se parsea |
| `{...,"spoken_text":""}` (vacío) | `legacy_text_fallback` | no rompe la voz: cae al bruto |
| JSON truncado con `spoken_text` rescatable | `structured` | rescata `spoken_text` por regex |

## Cómo validar

```bash
npm run qa:structured   # 28 aserciones sobre el parser (sin red, sin LLM)
npm run check           # typecheck
npm run build           # build completo
```

## Limitaciones pendientes / próximos pasos

- El parseo ocurre sobre `llm.text` ya pasado por `sanitizeFinalContent`. Si un
  `spoken_text` contuviera literalmente `Respuesta:`/`Final:`, podría recortarse (caso
  borde, baja probabilidad). Una iteración futura podría parsear el JSON crudo dentro
  de `callGeminiCloud` antes de sanitizar.
- `mode`/`gesture` se exponen en la respuesta pero aún **no** se cablean a gestos de
  VTube Studio (idle/gesto autónomo); ese es el siguiente paso natural.
- Solo Gemini emite JSON por ahora. Habilitar el contrato en modelos locales requiere
  validar que el 4B respete el formato (probablemente con few-shot).
- El frontend (`src/types.ts`) aún no consume `mode`/`gesture`; los ignora sin romper.
