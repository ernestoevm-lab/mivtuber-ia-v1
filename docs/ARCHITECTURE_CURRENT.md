# Arquitectura actual - Luma / Local VTuber AI

Fecha de auditoria: 2026-04-29

## Diagrama textual del flujo actual

```text
Usuario / Operador
  |
  | Start-Luma.bat
  v
Start-Luma.ps1
  |
  | prepara .env, opcionalmente lms server/load
  v
npm run dev
  |
  +--> scripts/dev.mjs
         |
         +--> Backend: tsx watch server/index.ts
         |      |
         |      +--> Express API en http://127.0.0.1:8787
         |      +--> WebSocket /events
         |      +--> SQLite via scripts/sqlite_store.py
         |      +--> LM Studio / Ollama
         |      +--> Kokoro worker / TTS
         |
         +--> Frontend: Vite en http://127.0.0.1:5173
                |
                +--> Panel principal /
                +--> Viewer OBS /viewer
```

## Flujo de mensaje actual

```text
Panel React
  |
  | POST /api/chat/admin
  | o POST /api/chat
  | o POST /api/chat/ingest
  v
server/index.ts
  |
  +--> server/stream/ingestService.ts (solo /api/chat/ingest)
  |      |
  |      +--> moderateMessage()
  |      +--> chatQueue en memoria
  |
  +--> generateChatResponse()
         |
         +--> db("recent_messages")
         +--> db("memories")
         +--> askOllama()
         |      |
         |      +--> LM Studio /chat/completions
         |      +--> Ollama /api/chat
         |      +--> fallback local-template
         |
         +--> sanitizeOutput()
         +--> inferEmotionState()
         +--> synthesize()
         |      |
         |      +--> Kokoro worker si existe
         |      +--> audio null si no existe
         |
         +--> db("add_message")
         +--> broadcast("response")
                |
                v
             WebSocket /events
                |
                v
             src/App.tsx
                |
                +--> pinta burbuja
                +--> enqueueSpeech()
                +--> AvatarStage emotion/speaking
```

## Modulos existentes y comunicacion

### Frontend

- `src/main.tsx`: monta React.
- `src/App.tsx`: contiene la mayor parte de la UI y estado:
  - viewer detection;
  - WebSocket `/events`;
  - chat admin/directo;
  - tabs de controles;
  - escena;
  - memoria;
  - modelos;
  - TTS;
  - logs;
  - apagado.
- `src/api.ts`: cliente HTTP hacia endpoints `/api/*`.
- `src/audioQueue.ts`: reproduce audio recibido o usa `speechSynthesis`; reclama la respuesta en `/api/control/claim-speech`.
- `src/AvatarStage.tsx`: renderer Three.js, carga VRM, fallback avatar y expresiones.
- `src/sceneMath.ts`: rangos de escena y conversion a porcentaje.
- `src/types.ts`: contratos frontend.

### Backend

- `server/index.ts`: punto de entrada del backend y rutas principales.
- `server/events.ts`: WebSocket `/events`.
- `server/config.ts`: lectura/escritura de `.env` y config JSON.
- `server/db.ts`: wrapper para ejecutar `scripts/sqlite_store.py`.
- `server/localModels.ts`: integra CLI `lms`.
- `server/ollama.ts`: llama LM Studio y Ollama.
- `server/moderation.ts`: guardia de mensajes entrantes.
- `server/safety.ts`: filtro de salida y emocion.
- `server/tts.ts`: Kokoro worker y fallback a audio null.
- `server/types.ts`: contratos backend.

### Python

- `scripts/sqlite_store.py`: crea tablas y ejecuta comandos SQLite.
- `scripts/kokoro_worker.py`: proceso persistente de TTS.
- `scripts/kokoro_tts.py`: TTS one-shot.

## Datos que entran y salen

### Entradas actuales

- Mensajes admin desde UI.
- Mensajes simulados/directo desde UI mediante `POST /api/chat/ingest`.
- Configuracion persona/safety/runtime/scene.
- Fondos locales como base64.
- VRM cargado desde archivo o `public/avatar/luma.vrm`.
- Memorias manuales.

### Salidas actuales

- Respuestas de Luma como `ChatResponse`.
- Audio WAV base64 si Kokoro esta disponible.
- Eventos WebSocket:
  - `ready`
  - `thinking`
  - `response`
  - `runtime`
  - `tts`
  - `memories`
  - `scene`
  - `backgrounds`
  - `moderation`
  - `control`
  - `safety`
- Historial y logs desde SQLite.
- Viewer OBS en `/viewer`.

## Estado actual de persistencia

SQLite actual (`scripts/sqlite_store.py`):

- `messages`
  - `role`
  - `content`
  - `emotion`
  - `source`
  - `created_at`
- `memories`
  - `content`
  - `importance`
  - `created_at`
- `blocked_events`
  - `reason`
  - `content`
  - `mode`
  - `created_at`
- `moderation_events`
  - `decision`
  - `reason`
  - `score`
  - `content`
  - `source`
  - `user`
  - `created_at`

No hay tablas para:

- usuarios por plataforma;
- mensajes normalizados de stream;
- eventos raw;
- respuestas ligadas a `replyToUserId`;
- memoria por usuario;
- migraciones versionadas.

## Dónde conectar el futuro sistema de chat

El punto correcto es antes de la cola, no directo al LLM:

```text
Twitch / YouTube / Kick
  |
  v
PlatformAdapter
  |
  v
normalizeStreamMessage()
  |
  v
StreamIngestService
  |
  +--> guardar raw event
  +--> upsert usuario
  +--> guardar mensaje normalizado
  +--> moderateMessage()
  +--> chatQueue
```

Punto actual aprovechable:

- `POST /api/chat/ingest` normaliza el payload legacy y delega en `server/stream/ingestService.ts`.
- `ingestNormalizedChatMessage()` es el punto interno reutilizable para futuros adaptadores.

Recomendacion:

- No conectar plataformas directamente a `POST /api/chat`.
- Conectar plataformas reales al servicio interno despues de normalizar.
- Dejar `POST /api/chat/ingest` como compatibilidad y como endpoint de prueba.

## Dónde conectar memoria por usuario

Hoy `memories` es global y manual. La memoria por usuario debe ir despues de normalizar identidad y antes de llamar al LLM:

```text
NormalizedChatMessage
  |
  +--> upsert ChatUser
  +--> add ChatMessage inbound
  |
  v
generateChatResponse()
  |
  +--> load global persona
  +--> load recent conversation
  +--> load user memories by userId
  +--> LLM
  +--> add ChatMessage outbound with replyToUserId/replyToMessageId
```

Tablas sugeridas:

- `chat_users`
- `chat_messages`
- `user_memories`
- `stream_raw_events`

## Dónde conectar el futuro LLM

El punto actual es `server/ollama.ts`, pero el nombre ya no representa todo el comportamiento porque tambien llama LM Studio.

Recomendacion de evolucion:

```text
server/services/llm/
  ├─ index.ts
  ├─ lmStudioProvider.ts
  ├─ ollamaProvider.ts
  ├─ openAiProvider.ts        futuro opcional
  └─ types.ts
```

La funcion publica deberia ser algo como:

```ts
generateLumaText({
  persona,
  input,
  history,
  globalMemories,
  userMemories,
  runtime
})
```

## Modulo recomendado para chat futuro

```text
server/integrations/
  ├─ twitch/
  ├─ youtube/
  └─ kick/

server/stream/
  ├─ types.ts
  ├─ normalize.ts
  ├─ ingest.ts
  ├─ users.ts
  └─ rawEvents.ts
```

Frontend recomendado:

```text
src/features/stream/
  ├─ StreamSettingsPanel.tsx
  ├─ PlatformStatusCard.tsx
  ├─ UserSearchPanel.tsx
  └─ UserHistoryPanel.tsx
```

## Observaciones importantes

- El proyecto actual no contiene integraciones nativas Twitch/YouTube/Kick.
- El proyecto actual no contiene un bridge TikFinity en los archivos presentes.
- La cola de chat ya es util para simular el comportamiento de un stream real.
- La memoria actual no distingue usuario ni plataforma.
- El viewer OBS no debe reproducir voz ni mostrar paneles.
- La siguiente fase recomendada es estabilizar contratos compartidos y crear el modelo comun de mensaje antes de conectar una plataforma real.

## Actualizacion 2026-04-29 - Modelo base normalizado de chat

Ya existe una primera capa base para normalizar mensajes de chat antes de que entren a la cola:

```text
Payload legacy { message, source, user }
  |
  v
server/stream/ingest.ts
  |
  v
server/stream/normalize.ts
  |
  v
NormalizedChatMessage
  |
  v
POST /api/chat/ingest mantiene moderacion, cola, cooldown y logs actuales
```

Tipos compartidos creados:

- `shared/streamTypes.ts`
  - `StreamPlatform`
  - `StreamSource`
  - `NormalizedChatUser`
  - `NormalizedChatMessage`
  - `StreamRawEvent`
  - `StreamIngestResult`

Compatibilidad actual:

- `POST /api/chat/ingest` sigue aceptando el payload legacy actual: `{ message, source, user }`.
- El payload legacy se convierte internamente a `NormalizedChatMessage`.
- Para el simulador local, `platform` es `local` y `source` queda normalizado como `simulator`.
- Twitch, YouTube Live y Kick todavia no estan implementados.
- LM Studio sigue siendo el proveedor LLM principal actual.
- Ollama sigue siendo fallback opcional/documentado, no dependencia requerida.

Siguiente punto natural:

- Agregar persistencia SQLite para usuarios/mensajes normalizados en una fase posterior.
- Integrar Twitch como primer adaptador real usando el mismo `NormalizedChatMessage`.

## Actualizacion 2026-04-29 - Mini-fase 2.1 contratos compartidos y adaptador base

`shared/streamTypes.ts` queda como fuente base de contratos de stream/chat para frontend y backend.

Consumo actual:

- `src/types.ts` reexporta los tipos compartidos para que la UI pueda usarlos sin duplicarlos.
- `server/types.ts` reexporta los mismos tipos para que el backend pueda migrar gradualmente sin cambiar imports grandes.
- `src/api.ts` mantiene el nombre publico `ChatIngestPayload`; ahora acepta campos opcionales `message` y `rawEvent` compatibles con el contrato normalizado, sin exigir que el endpoint los devuelva todavia.

Base para adaptadores:

- `server/stream/adapters.ts` define `ChatPlatformAdapter`.
- El contrato cubre `connect()`, `disconnect()`, `getStatus()` y `onMessage(callback)`.
- No abre sockets, no llama APIs externas y no implementa Twitch, YouTube ni Kick.

Compatibilidad:

- `POST /api/chat/ingest` sigue aceptando `{ message, source, user }`.
- El endpoint sigue usando moderacion, cola, cooldown, GuardaespaldasBot y logs actuales.
- No se agregaron tablas SQLite.
- LM Studio sigue siendo el proveedor LLM principal actual.
- Ollama sigue siendo fallback opcional/documentado.

Deuda tecnica pendiente:

- `ChatResponse`, `Persona`, `SceneSettings` y tipos de runtime siguen duplicados entre `src/types.ts` y `server/types.ts`.
- Esa duplicacion no se elimino en esta fase para evitar un refactor transversal de UI/backend.

## Actualizacion 2026-05-01 - Mini-fase 2.2 servicio reutilizable de ingestion

La logica compartible de ingestion de chat se extrajo de `POST /api/chat/ingest` hacia:

- `server/stream/ingestService.ts`

Flujo actual del endpoint legacy:

```text
POST /api/chat/ingest
  |
  v
ingestLegacyChatPayload()
  |
  v
NormalizedChatMessage
  |
  v
ingestNormalizedChatMessage()
  |
  +--> purgeQueue()
  +--> moderateMessage()
  +--> recordModeration()
  +--> rememberMessage()
  +--> chatQueue.push()
  +--> scheduleQueue()
  +--> guardStatus()
```

Uso esperado para futuros adaptadores:

```text
Twitch adapter / YouTube adapter / Kick adapter
  |
  v
normalizePlatformChatMessage()
  |
  v
ingestNormalizedChatMessage()
  |
  v
cola existente y respuesta de Luma
```

Compatibilidad:

- `POST /api/chat/ingest` sigue aceptando `{ message, source, user }`.
- La respuesta sigue incluyendo `ok`, `queued`, `moderation` y `guard`.
- Tambien incluye `message`, con el `NormalizedChatMessage`, para depuracion y futuras pantallas.
- El source legacy externo (`twitch`, `youtube`, `kick`) se mantiene solo por compatibilidad temporal; las integraciones reales deben usar adaptadores dedicados.
- Twitch, YouTube Live y Kick todavia no estan implementados.
- No se agregaron tablas SQLite.
- LM Studio sigue siendo el proveedor LLM principal actual y Ollama fallback opcional.

## Actualizacion 2026-06-15 - Estado real (corrige secciones previas desactualizadas)

Las secciones de arriba (auditoria 2026-04-29) quedaron obsoletas en varios puntos. El
estado REAL del codigo hoy es:

### Persistencia (corrige "SQLite via scripts/sqlite_store.py")
- NO hay Python para la base de datos. `server/db.ts` usa **better-sqlite3 nativo**
  (sincrono), DB en `data/vtuber.sqlite` (WAL). El esquema se crea/migra en `initSchema()`
  con `ensureColumn()` idempotente.
- Tablas reales: `messages`, `memories`, `blocked_events`, `moderation_events`,
  **`chat_users`**, **`chat_messages`**, **`llm_traces`** (estas tres ya existen, al
  contrario de lo que decia la seccion vieja).

### Integraciones de stream (corrige "no contiene Twitch/TikFinity")
- **Twitch read-only**: `server/integrations/twitch/` (adapter + normalizador). Se habilita
  cuando las 3 credenciales TWITCH_* estan completas.
- **TikFinity**: `server/integrations/tikfinity/` (cliente WS + normalizador) alimenta al
  director de autonomia.
- **VTube Studio**: `server/integrations/vtubeStudio/vtsClient.ts` (emocion + lipsync).

### Cerebro LLM (corrige "server/ollama.ts solo LM Studio/Ollama")
- `server/ollama.ts` orquesta varios proveedores via `callPreferredLocalModel()`:
  - **LM Studio** (local), **Ollama** (local/fallback), **fallback** template.
  - **Nube OpenAI-compatible**: **Gemini**, y desde 2026-06-15 tambien **OpenRouter**,
    **DeepSeek** y **MiniMax**.
- Hermes fue retirado por completo (cerebro, endpoints y el tipo de proveedor).
- Los cerebros de nube comparten un unico cliente `callOpenAiCompatibleCloud`/
  `postOpenAiCompatibleJson` (POST `{base}/chat/completions`, `Authorization: Bearer`).
  **Solo se usan cuando el usuario los elige EXPLICITAMENTE**; nunca entran en la cadena
  `auto`, para no gastar la cuota del usuario sin que lo pida.
- Config por proveedor en `server/config.ts` (`{provider}BaseUrl`/`{provider}Model`), keys
  en el `.env` del perfil (allowlist `SECRET_ENV_KEYS`). Defaults verificados contra docs
  oficiales: OpenRouter `https://openrouter.ai/api/v1`, DeepSeek `https://api.deepseek.com`,
  MiniMax `https://api.minimax.io/v1`.
- Listado de modelos: `listCloudModels(provider)` consulta `GET {base}/models` en vivo para
  Gemini/OpenRouter/DeepSeek; **MiniMax no expone ese endpoint**, asi que devuelve una lista
  estatica (`MINIMAX_STATIC_MODELS`). Endpoint HTTP: `GET /api/llm/models?provider=...`
  (y `GET /api/llm/gemini-models` se mantiene por compatibilidad).

### Capsula de escritorio (no existia en la auditoria vieja)
- `src-tauri/` (Tauri v2): supervisa un sidecar Node, elige puerto disponible con failover
  (8787 -> 17787 -> ...), healthcheck en hilo aparte, apagado limpio. El frontend descubre
  el puerto real via comando Rust `get_backend_port`.

### Frontend (corrige "casi todo en App.tsx")
- Las pestañas se extrajeron a `src/tabs/` (Scene, Avatar, Live, Persona, Voice, Model,
  Viewers, Memory, Logs, Safety, Settings). `src/App.tsx` conserva estado raiz + handlers
  y la columna central del Live (sigue siendo grande; ver plan de extraccion de hooks).
- La seleccion de proveedor/modelo de nube vive en `src/tabs/ModelTab.tsx` (generico para
  los 4 cerebros de nube); las API keys se administran tambien en `src/tabs/SettingsTab.tsx`.
