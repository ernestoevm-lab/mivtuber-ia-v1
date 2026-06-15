# MiVtuberIA — Yuko

Aplicación de escritorio para Windows que da vida a una VTuber con IA llamada **Yumekawa
Kokoria ("Yuko")**. Corre **localmente en tu PC** (local-first): conversa contigo, narra lo
que ve en tu pantalla, reacciona al chat de tu directo y mueve un avatar. El "cerebro" puede
ser un modelo **local** (LM Studio) o en la **nube** (Gemini, OpenRouter, DeepSeek o MiniMax),
y la voz puede salir por el sintetizador del navegador o por un motor local opcional.

El panel principal (el "cockpit") es para el operador; lo que ve el público se compone en OBS
a partir de dos fuentes de navegador que sirve la propia app.

## Estado del proyecto

Beta funcional. El flujo principal está probado de extremo a extremo: escribes (o llega un
mensaje del chat) → personalidad → respuesta del LLM → voz → expresión/movimiento del avatar →
salida a OBS. Existe un instalador `.exe` para Windows (ver [Releases](https://github.com/ernestoevm-lab/mivtuber-ia-v1/releases)).
No está firmado digitalmente, así que Windows SmartScreen mostrará un aviso la primera vez
(ver [Solución de problemas](#solución-de-problemas)).

## Funcionalidades disponibles

Verificadas en el código y/o en uso real:

- **Chat con personalidad.** Yuko responde con un personaje consistente (tono, lore, límites)
  y cinco modos de conversación que cambian según el contexto (cálido, caótico/divertido,
  picante controlado, firme y narrador).
- **Cerebro híbrido local/nube.** Eliges el proveedor en la pestaña **Modelo**:
  - **Gemini (nube):** pegas tu API key dentro de la app; se verifica y se activa sola.
  - **OpenRouter / DeepSeek / MiniMax (nube):** cerebros compatibles con OpenAI; pega su API
    key (en Modelo o Ajustes), elige el modelo y actívalo. Se usan solo si los seleccionas.
  - **LM Studio (local):** usa un modelo que corras en LM Studio (app externa).
- **Voz (TTS).** Por defecto usa la voz del navegador. Kokoro (voz local) es **experimental** y
  opcional (requiere instalación aparte).
- **Avatar.** Modelo **VRM** dentro de la app (Three.js + three-vrm) con parpadeo, microgestos
  y lip-sync, y/o **VTube Studio** (Live2D) para reflejar la emoción como expresión/hotkey.
- **Visión / narración de pantalla.** Yuko puede mirar una captura y describirla o narrarla
  para el directo (requiere un modelo multimodal, p. ej. Gemini).
- **Chat de stream.** Integración **read-only** con Twitch (IRC) y con **TikFinity** (eventos de
  TikTok LIVE vía WebSocket local). Una "guardia" modera los mensajes antes de pasarlos al LLM.
- **Salida a OBS.** El backend sirve `/viewer` (visual del avatar) y `/speaker` (audio) como
  Browser Sources.
- **Configuración desde la app.** Claves API, personalidad, voz, escena y avatar se gestionan
  desde la interfaz; no necesitas editar archivos a mano.

## Requisitos del sistema

**Para usar el instalador (.exe):**

- Windows 10 o 11, 64 bits.
- WebView2 Runtime (viene preinstalado en Windows 11; el instalador lo gestiona si falta).
- GPU recomendada si vas a usar avatar 3D + modelo LLM local al mismo tiempo (probado en una
  RTX 4070 12 GB). Con Gemini en la nube el consumo de VRAM local es mínimo.

**Componentes externos opcionales (los instalas tú si los quieres):**

- **LM Studio** — solo si quieres el cerebro local en lugar de Gemini. Debe estar abierto, con
  un modelo cargado y su servidor local activo (`http://127.0.0.1:1234/v1`).
- **VTube Studio** — solo si quieres avatar Live2D (con su API activa, puerto 8001).
- **Python + Kokoro** — solo para la voz local experimental.

**Para compilar desde el código fuente, además:**

- **Node.js 24** (x64). El repo incluye un `.nvmrc`. La única dependencia nativa
  (`better-sqlite3`) trae binarios precompilados para Node 24, así que `npm install` no necesita
  compilador para el frontend/backend.
- **Rust** + `cargo` y **Visual Studio Build Tools** con "Desktop development with C++" (MSVC).
  Esto **solo** hace falta para compilar la app de escritorio (Tauri), no para `npm install`.

## Instalación para usuarios (solo usar la app)

1. Descarga `MiVtuberIA_x.y.z_x64-setup.exe` desde la página de
   [Releases](https://github.com/ernestoevm-lab/mivtuber-ia-v1/releases).
2. Ejecútalo. Como el instalador no está firmado, Windows mostrará "Windows protegió tu equipo":
   pulsa **Más información → Ejecutar de todas formas**.
3. Abre **MiVtuberIA** desde el menú de inicio. La app instala el backend y lo arranca sola; no
   hay que abrir terminales ni archivos.
4. Sigue el onboarding inicial.
5. **Configura el cerebro** en la pestaña **Modelo**:
   - Para Gemini: pega tu API key (gratis en Google AI Studio) y pulsa **Guardar y activar
     Gemini**. La app la verifica y empieza a usarla. La key queda solo en tu PC.
   - Para LM Studio: abre LM Studio, carga un modelo, activa su servidor y selecciónalo.
6. Para streamear, añade las dos Browser Sources de OBS (ver [OBS](#salida-a-obs)).

La app se instala por usuario en `%LOCALAPPDATA%\MiVtuberIA`. Tus datos (configuración, historial
y tus claves) se guardan en `%LOCALAPPDATA%\com.mivtuberia.desktop`, separados del programa.

## Instalación para desarrolladores (desde el código fuente)

```powershell
git clone https://github.com/ernestoevm-lab/mivtuber-ia-v1.git
cd mivtuber-ia-v1
npm install
```

Modos de ejecución:

```powershell
# A) App de escritorio nativa (Tauri) — requiere Rust + MSVC C++ Build Tools
npm run app:dev

# B) En el navegador (desarrollo) — backend + panel web, sin compilar Rust
npm run dev
#   Backend en http://127.0.0.1:8787 (puerto por defecto; ver nota abajo)
#   Panel  en http://127.0.0.1:5173
```

Verificación y build:

```powershell
npm run check        # typecheck (tsc --noEmit) — es la verificación de calidad disponible
npm run build        # compila backend (-> dist-server/) y frontend (-> dist/)
npm run app:build    # genera el instalador .exe (compila Rust + empaqueta el backend)
```

> **Nota sobre el puerto:** el backend usa **8787** por defecto, pero algunas máquinas Windows
> reservan ese puerto (rangos de WinNAT). Si pasa, la app cae automáticamente al siguiente
> candidato (17787, 27787, 37787 o 47787) y expone el puerto real en `/api/status`. La pestaña
> **Ajustes** muestra las URLs exactas de Viewer/Speaker para OBS — cópialas de ahí en vez de
> asumir 8787.

`npm run app:build` ejecuta antes `npm run build` y `npm run tauri:prepare-sidecars` (este último
copia el runtime de Node como *sidecar* y prepara un `node_modules` solo de producción). El
instalador queda en `src-tauri/target/release/bundle/nsis/`.

## Configuración inicial

- **Claves API:** se gestionan **dentro de la app** (pestañas **Modelo** y **Ajustes**). La app
  las verifica y las guarda en un archivo `.env` dentro de tu carpeta de datos; nunca las vuelve
  a mostrar y nunca las sube a ningún lado. No edites el `.env` a mano.
- **Variables de entorno:** el archivo `.env.example` lista las claves soportadas como plantilla
  (sin valores). Las principales: `GEMINI_API_KEY`, `TWITCH_CHANNEL`, `TWITCH_BOT_USERNAME`,
  `TWITCH_OAUTH_TOKEN`, y opciones de modelo/voz. En desarrollo puedes copiar `.env.example` a
  `.env` si prefieres precargar valores; en la app empaquetada todo se hace desde la interfaz.

## Salida a OBS

En OBS añade **dos Browser Sources** (separan video y audio):

- **Visual:** `http://127.0.0.1:8787/viewer`
- **Audio:** `http://127.0.0.1:8787/speaker`

Si el backend arrancó en un puerto distinto a 8787 (ver la nota del puerto), usa las URLs que
muestra la pestaña **Ajustes**.

## Estructura del repositorio

```
src/            Frontend React + Vite (cockpit del operador; pestañas en src/tabs/)
server/         Backend Node/Express + TypeScript (LLM, TTS, integraciones, SQLite, WebSocket)
shared/         Tipos compartidos cliente/servidor
src-tauri/      App de escritorio (Tauri v2): supervisor Rust del backend, build, iconos
scripts/        Supervisor de desarrollo, preparación de sidecars, workers de TTS, QA
config/         Semillas de configuración del producto (persona, seguridad, estilo, etc.)
data/           Carpeta de datos en runtime (la base de datos y los assets reales se ignoran)
docs/           Manuales y guías de usuario/desarrollador
```

## Solución de problemas

- **"Windows protegió tu equipo" al instalar.** El instalador no está firmado. Pulsa **Más
  información → Ejecutar de todas formas**.
- **Yuko no responde / usa "fallback".** Falta configurar el cerebro. Ve a **Modelo**: con Gemini,
  pega y guarda tu API key; con LM Studio, confirma que la app esté abierta, con un modelo cargado
  y el servidor activo.
- **El chat de Gemini falla tras guardar la key.** Si la key es incorrecta o no hubo conexión, la
  app la guarda igual pero te avisa. Revísala en **Modelo** (sin espacios, completa) y vuelve a
  guardar.
- **OBS no muestra el avatar.** Verifica el puerto real en **Ajustes** y usa esas URLs en las
  Browser Sources.
- **No aparecen modelos de LM Studio.** LM Studio es una app aparte: debe estar abierta, con un
  modelo cargado y su servidor local encendido. Si no, usa Gemini.
- **Logs del backend (app empaquetada):** `%LOCALAPPDATA%\com.mivtuberia.desktop\logs\tauri-backend.log`.

Más detalle en [docs/SOLUCION_PROBLEMAS.md](docs/SOLUCION_PROBLEMAS.md).

## Limitaciones actuales / qué todavía no puede hacer

Basado en el estado real del código:

- **No hay voz a texto (STT).** No puedes hablarle por micrófono; la entrada es por texto (o
  por el chat del stream). No existe botón de micrófono.
- **Twitch es de solo lectura.** Yuko lee el chat de Twitch pero no escribe en él. **YouTube y
  Kick no están integrados.**
- **Proveedores de nube de pago.** Además de Gemini, puedes usar **OpenRouter**, **DeepSeek** o
  **MiniMax** como cerebro (compatibles con OpenAI). Requieren tu propia API key y consumen tu
  cuota/crédito con ese proveedor; solo se usan cuando los seleccionas explícitamente en **Modelo**.
- **Kokoro (voz local) es experimental.** No viene en el instalador; requiere instalación aparte.
  Sin ella, Yuko habla con la voz del navegador.
- **La emoción es automática.** Se infiere de cada respuesta y se refleja en el avatar/VTS; no hay
  un selector manual de emoción.
- **El instalador no está firmado** (aviso de SmartScreen) y solo hay build para **Windows x64**.
- **No hay tests automatizados ni linter.** La verificación disponible es el typecheck
  (`npm run check`).

## Licencia

Aún no se ha definido una licencia para este proyecto. Mientras tanto, se reservan todos los
derechos; consulta con el autor antes de reutilizar el código.
