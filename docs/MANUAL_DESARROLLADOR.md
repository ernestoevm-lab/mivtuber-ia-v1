# Manual de desarrollador — MiVtuberIA

> Cómo está construido el proyecto y dónde tocar para editar o agregar funcionalidades. Estado actualizado tras la fase de limpieza.

## Stack
- **Frontend**: React 19 + Vite + TypeScript (`src/`).
- **Backend**: Node + Express 5 + TypeScript (`server/`), un solo backend. WebSocket en `/events`.
- **Base de datos**: SQLite vía **better-sqlite3 nativo** (en proceso, sin Python). Toda la BD pasa por `server/db.ts` → función `db(command, payload)`.
- **Voz (TTS)**: por defecto voz del navegador; Kokoro ONNX (worker Python en `scripts/`) es opcional/experimental.
- **Avatar**: VTube Studio (Live2D) vía su API WebSocket; opcional Three.js/VRM in-app.
- **Escritorio**: Tauri v2 (`src-tauri/`) — empaqueta el frontend en ventana nativa (WebView del SO).

## Cómo correr y verificar
- `npm run dev` → backend (8787 por defecto) + Vite (:5173). Panel en `127.0.0.1:5173`.
  El puerto del backend cae a 17787/27787/37787/47787 si 8787 está reservado; el real se
  expone en `/api/status` (`runtime.port`) y la UI lo consume de ahí.
- `npm run app:dev` → lo mismo pero en ventana nativa Tauri (compila el crate Rust).
- `npm run check` → typecheck (tsc). **Córrelo siempre antes de dar algo por hecho.**
- `npm run build` → compila backend (→ `dist-server/`) y frontend (→ `dist/`).
- `npm run app:build` → genera el instalador `.exe`. Antes corre `npm run build` y
  `npm run tauri:prepare-sidecars`, que empaqueta el backend Node como *sidecar*
  (`externalBin: binaries/mivtuberia-node` en `tauri.conf.json`) con un `node_modules` solo de
  producción. Kokoro sigue siendo opcional/externo, no se bundlea.

## Mapa: dónde editar cada cosa
| Quieres cambiar... | Edita |
|---|---|
| Personalidad de Yuko (carácter) | `config/persona.json` |
| Los 5 modos / comportamiento | `server/llm/promptBuilder.ts` (bloque de modos) |
| Ejemplos de estilo (few-shot) | `config/yuko-style-examples.json` |
| Lógica/ruteo del LLM (LM Studio, Gemini, Ollama, fallback) | `server/ollama.ts` (nombre histórico) |
| Voz/TTS | `server/tts.ts` + scripts Kokoro en `scripts/` |
| VTube Studio (conexión, emoción→expresión, lipsync) | `server/integrations/vtubeStudio/vtsClient.ts` |
| Twitch (lectura de chat IRC) | `server/integrations/twitch/` |
| Moderación / filtros de seguridad | `server/moderation.ts`, `server/safety.ts` |
| Base de datos (esquema, queries) | `server/db.ts` |
| Rutas API | `server/index.ts` |
| Config runtime (modelo, voz, etc.) | `server/config.ts` (persiste en `config/runtime-*.json`) |
| UI del cockpit | `src/App.tsx` (shell + estado raíz), pestañas en `src/tabs/`, `src/components/`, estilos en `src/design/` + `src/cockpit.css` |
| Onboarding / Estado del Sistema | `src/components/SystemSetupPanel.tsx` |

## Cerebro híbrido (local vs nube)
- Provider se elige en el panel **Model** (o `POST /api/runtime { llmProvider }`). Valores activos: `lmstudio`, `gemini`, `auto`, `ollama`.
- Con `gemini`: usa el endpoint OpenAI-compatible de Gemini. Al cambiar a `gemini`, se descarga el modelo local de LM Studio para liberar VRAM (`unloadAllLocalModels`). Modelos en vivo vía `GET /api/llm/gemini-models`.
- **Claves API in-app:** la key de Gemini (y de otros proveedores) se guarda desde la UI, no editando `.env` a mano. El endpoint es `POST /api/settings/secrets` (allowlist `SECRET_ENV_KEYS` en `server/config.ts`: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `MINIMAX_API_KEY`, `TWITCH_*`). El backend la verifica con un ping, la persiste en el `.env` del perfil vía `updateSecretEnv()` y, si la key de Gemini valida, activa Gemini con un modelo válido. `GET /api/settings/secrets` solo devuelve si cada clave está configurada (nunca el valor).
- **Nota:** OpenRouter, DeepSeek y MiniMax se pueden guardar pero su ruteo de chat aún no está cableado en `server/ollama.ts`.

## Variables de entorno (`.env`, NUNCA se commitea)
El `.env` es el destino de persistencia; el usuario las introduce desde la app, no a mano.
Plantilla en `.env.example`. Claves soportadas:
- `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `MINIMAX_API_KEY`.
- `TWITCH_ENABLED`, `TWITCH_CHANNEL`, `TWITCH_BOT_USERNAME`, `TWITCH_OAUTH_TOKEN` (formato `oauth:...`).
- `LLM_PROVIDER`, `LM_STUDIO_*`, `GEMINI_MODEL`, `KOKORO_*`, etc. (ver el mapeo en `server/config.ts`).
- Configs locales (gitignored): `config/runtime-model.json`, `config/runtime-voice.json`, `config/vts.json`.

## Patrón para agregar una funcionalidad
1. Backend: nuevo endpoint en `server/index.ts` (+ lógica en el módulo que toque).
2. Cliente: función en `src/api.ts`.
3. UI: estado + render en `src/App.tsx` o un componente en `src/components/`.
4. Verifica: `npm run check` + `npm run build`. Commits pequeños y descriptivos.

## Git
- Rama principal: `main` (ya consolidada). Trabaja en ramas `feat/…`/`fix/…` y mergea a `main`.
- Antes de borrados/cambios grandes: verifica 0 referencias (`grep`) y corre `npm run check` +
  `npm run build` después de cada cambio. Commits pequeños y descriptivos.

## Pendientes técnicos
- **Refactor de `App.tsx`**: ya se extrajeron las 12 pestañas a `src/tabs/`; el shell todavía
  concentra estado raíz, la columna de chat del Live y las páginas `/viewer` y `/speaker`.
  Adelgazarlo más implica extraer hooks (`src/hooks/`).
- Cablear el ruteo de chat para OpenRouter/DeepSeek/MiniMax (las claves ya se guardan).
- Modelo local inconsistente en modo Caos (Gemini lo hace mejor).
- Opcional: gestos autónomos a partir del contrato estructurado de respuesta.

## Limpieza ya hecha (no revivir)
Eliminado código muerto: `scripts/sqlite_store.py` (reemplazado por better-sqlite3), Hermes completo (`server/hermes.ts`, endpoints `/api/hermes/*`), Mascoz/Live 2 (`/api/mascoz/status`), backend FastAPI `server_py/`.
