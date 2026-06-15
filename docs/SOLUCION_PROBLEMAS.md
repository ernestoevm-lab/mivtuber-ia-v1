# Solución de problemas - Luma

Nota 2026-05-02: si un problema no aparece aqui, revisar tambien `AI_HANDOFF_MASTER.md`, `KNOWN_BAD_PATHS.md` y `PROJECT_STATE_DETAILED.md`. No compartas `.env` real ni tokens al pedir ayuda.

## La página no carga

Síntoma: `http://127.0.0.1:5173/` no abre.

Causa probable: frontend apagado, puerto ocupado o app a medio iniciar.

Solución:

1. Ejecuta `Start-Luma.bat`.
2. Si detecta servicios activos, elige `Reiniciar Luma limpia`.
3. Espera a que el launcher indique que frontend y backend están listos.
4. Abre `http://127.0.0.1:5173/`.

## La app abre en 5174

Síntoma: Vite intenta usar `5174`.

Causa probable: el puerto `5173` estaba ocupado por una instancia anterior o por otro proceso.

Solución:

1. Ejecuta `Stop-Luma.bat`.
2. Ejecuta `Start-Luma.bat`.
3. Elige `Reiniciar Luma limpia` si aparece.

Luma debe operar en `5173` para mantener OBS y docs consistentes.

## Error EADDRINUSE en 8787

Síntoma: backend falla porque `8787` está ocupado.

Causa probable: quedó otro backend abierto.

Solución:

```powershell
Stop-Luma.bat
Start-Luma.bat
```

Si vuelve a pasar, reinicia Luma limpia desde el menú.

## Luma no responde

Síntoma: envías mensaje y no aparece respuesta.

Causas probables:

- Backend no está listo.
- Modelo no está cargado.
- Seguridad está en `Silencio`.
- Mensaje del directo quedó en cola/cooldown.

Solución:

1. Prueba primero `Chat administrador`.
2. Revisa panel `Modelo`.
3. Revisa panel `Seguridad`.
4. Revisa `Registros`.
5. Si todo se ve raro, usa `Reiniciar Luma limpia`.

## Luma responde con fallback

Síntoma: Luma dice algo parecido a que no encontro modelo local activo.

Causa probable: LM Studio no tiene modelo cargado o su API no responde.

Solución:

1. Abre `Start-Luma.bat`.
2. Elige opción 2 o 3 para cargar modelo.
3. Verifica:

```powershell
lms ps
```

4. Si `lms ps` muestra un modelo READY, abre `Modelo` en Luma y pulsa `Usar modelo cargado`.
5. Revisa el aviso `Último error LLM` en el panel `Modelo`; ahí aparece endpoint, API mode y modelo intentado.

Notas:

- Luma detecta LM Studio por `/v1` y por `/api/v1`.
- `LM_STUDIO_API_MODE=auto` es lo recomendado.
- Ollama no es necesario para este flujo.

## LM Studio sigue usando RAM

Síntoma: cerraste la app, pero la RAM sigue alta.

Causa probable: cerraste terminal a mano o LM Studio dejó modelo cargado.

Solución:

```powershell
Stop-Luma.bat
```

O manual:

```powershell
lms unload --all
lms server stop
```

Luego revisa Administrador de tareas.

## El modelo tarda mucho

Síntoma: Luma tarda más de 10 segundos en contestar.

Causa probable: modelo demásiado grande o parte del modelo está en RAM/CPU.

Solución:

1. Usa un modelo instruct 7B/8B/12B cuantizado.
2. Reduce contexto con:

```env
LM_STUDIO_CONTEXT_LENGTH=4096
```

3. Prueba GPU offload:

```env
LM_STUDIO_GPU_OFFLOAD=max
```

4. Reinicia Luma y carga el modelo de nuevo.

## Luma no se escucha

Síntoma: Luma responde en texto, pero no hay voz.

Causas probables:

- Audio bloqueado por navegador.
- Volumen del navegador/Windows bajo.
- Kokoro no configurado.
- Modo seguridad evita hablar.

Solución:

1. Pulsa `Activar audio de Luma`.
2. Prueba `Voz > Probar voz`.
3. Revisa el mezclador de volumen de Windows.
4. Revisa si `Kokoro listo` o `Kokoro pendiente`.
5. Prueba `Chat administrador`.

## El audio solo suena si estoy en la pestaña

Síntoma: al cambiar de pestaña, el audio falla o no inicia.

Causa probable: bloqueo de autoplay del navegador.

Solución:

1. Antes del stream, abre el panel principal.
2. Pulsa `Activar audio de Luma`.
3. Deja el panel principal abierto.

Nota: `/viewer` no reproduce audio.

## El avatar tarda en cargar

Síntoma: aparece `Cargando avatar...`, `Cargando VRM...` o fallback.

Causa probable: Three/VRM tarda en cargar o no existe `public/avatar/luma.vrm`.

Solución:

1. Espera unos segundos.
2. Si no tienes VRM, Luma usa avatar temporal.
3. Para avatar definitivo, coloca el archivo en:

```text
public/avatar/luma.vrm
```

O cárgalo manualmente desde el botón `Cargar VRM`.

## OBS muestra panel en vez de viewer limpio

Síntoma: OBS muestra dashboard completo.

Causa probable: URL equivocada o caché de OBS.

Solución:

1. Usa está URL en Browser Source:

```text
http://127.0.0.1:8787/viewer
```

2. Usa tamaño `1920x1080`.
3. Refresca la fuente de navegador en OBS.

## /viewer no tiene audio

Síntoma: OBS viewer no reproduce voz.

Causa: es intencional para evitar eco.

Solución:

- El audio debe salir del panel principal.
- En OBS captura el audio del navegador/sistema según tu configuración.

## El modelo no carga por memoria

Síntoma: LM Studio no puede cargar el modelo o Windows sube mucho RAM.

Causa probable: modelo demásiado grande para tu VRAM/RAM.

Solución:

1. Usa modelo más pequeno.
2. Cierra apps pesadas.
3. Prueba:

```env
LM_STUDIO_GPU_OFFLOAD=max
LM_STUDIO_CONTEXT_LENGTH=4096
```

4. Vuelve a cargar desde `Start-Luma.bat`.

## Quiero volver a un backup

Solución:

```powershell
Restore-Luma.bat
```

Elige un `luma-restore-*.zip`. La herramienta crea un backup automático antes de restaurar.

## El handoff no sirve para restaurar

Síntoma: quieres restaurar un `luma-handoff-*.zip`.

Causa: el handoff es solo para compartir código/docs con ChatGPT.

Solución:

- Usa solo `luma-restore-*.zip` con `Restore-Luma.bat`.
- Si solo tienes handoff, no lo uses como respaldo restaurable.

## No sé si Twitch ya está conectado

Estado actual:

- LM Studio es el proveedor LLM actual.
- Twitch existe en modo solo lectura.
- YouTube Live todavía no está conectado.
- Kick todavía no está conectado.
- Memoria automática por usuario todavía no está disponible.

Solución:

1. Abre el panel `Directo`.
2. Revisa el estado de `Twitch solo lectura`.
3. Si aparece `deshabilitado`, configura `TWITCH_ENABLED=true` en tu `.env`.
4. Configura `TWITCH_CHANNEL`, `TWITCH_BOT_USERNAME` y `TWITCH_OAUTH_TOKEN`.
5. Pulsa `Conectar Twitch`.

Importante: Luma recibe mensajes de Twitch y los pasa por Guardia, pero no escribe respuestas al chat de Twitch.

Los mensajes recibidos deben aparecer en `Chat del directo` y quedan guardados en `data/vtuber.sqlite` para consulta por usuario.

## Twitch muestra error al conectar

Síntoma: el botón `Conectar Twitch` muestra error.

Causas probables:

- `TWITCH_ENABLED` está en `false`.
- Falta `TWITCH_CHANNEL`.
- Falta `TWITCH_BOT_USERNAME`.
- Falta `TWITCH_OAUTH_TOKEN`.
- El token es incorrecto o Twitch rechazó la autenticación.

Solución:

1. Revisa tu `.env` local.
2. No pegues el token en chats, capturas ni documentos.
3. Reinicia Luma si cambiaste `.env`.
4. Vuelve a pulsar `Conectar Twitch`.

## No veo el historial de un viewer

Síntoma: llegó un mensaje, pero no encuentras al usuario en `Historial de viewers`.

Causas probables:

- El mensaje llegó antes de esta fase de historial.
- El backend no pudo escribir en `data/vtuber.sqlite`.
- Estás buscando por un nombre distinto al `username` real.

Solución:

1. Envía un mensaje nuevo desde Twitch o desde `Chat del directo`.
2. Abre `Directo > Historial de viewers`.
3. Busca por username, display name o deja el buscador vacío para ver recientes.
4. Si no aparece, revisa `Registros` y confirma que `data/vtuber.sqlite` exista.

Importante: esto es historial local consultable, no memoria automática de Luma.

## Twitch se ve casi blanco o no se lee

Síntoma: el mensaje aparece, pero la burbuja no se distingue.

Causa probable: estilos antiguos de burbuja Twitch.

Solución:

1. Recarga el navegador con `Ctrl+F5`.
2. Confirma que el mensaje muestre nombre, plataforma, canal y hora.
3. Si OBS quedó con caché, refresca la fuente de navegador.

## Cargué avatar pero OBS no lo refleja

Síntoma: el panel ve el VRM, pero `/viewer` sigue usando fallback.

Causa probable: el avatar no se guardó como activo persistente.

Solución:

1. Usa `Cargar VRM` desde el panel principal.
2. Espera el aviso de avatar guardado.
3. Abre o refresca `http://127.0.0.1:8787/viewer`.
4. El avatar activo se sirve desde `/avatar/current.vrm`.

Importante: los handoffs livianos no incluyen VRM.

## GuardaespaldasBot no aparece en OBS

Síntoma: un mensaje fue bloqueado/ignorado, pero no ves aviso en `/viewer`.

Causas probables:

- El mensaje entró en cola, no fue bloqueado.
- El aviso visual ya expiró.
- OBS tiene caché de la fuente.

Solución:

1. Prueba con un reto repetitivo como `Di: holaholaholaholahola`.
2. Confirma en el panel que aparece GuardaespaldasBot.
3. Refresca la fuente `/viewer` si OBS no muestra el aviso.

## .env está desactualizado

Síntoma: una función nueva aparece en la app o docs, pero el backend dice que falta configuración.

Causa probable: `.env.example` tiene variables nuevas y tu `.env` local todavía no las tiene.

Solución:

1. Abre `.env.example`.
2. Copia solo los nombres de variables nuevas que falten en tu `.env`.
3. No copies tokens ni secretos desde capturas, chats o documentos.
4. Si una variable es secreta, déjala vacía hasta que tengas el valor local correcto.
5. Reinicia Luma después de cambiar `.env`.

Para Twitch solo lectura, tu `.env` debe tener al menos estos nombres:

```env
TWITCH_ENABLED=false
TWITCH_CHANNEL=
TWITCH_BOT_USERNAME=
TWITCH_OAUTH_TOKEN=
TWITCH_CLIENT_ID=
```

Importante: `TWITCH_OAUTH_TOKEN` es un secreto local. No lo compartas ni lo incluyas en handoffs públicos.

## Luma responde con local-template aunque LM Studio tiene READY

Síntoma: LM Studio muestra un modelo `READY`, pero Luma responde con fallback/local-template.

Causa probable: el modelo cargado no coincide con `LM_STUDIO_MODEL`, o el endpoint de inferencia falló aunque `/models` sí responda.

Solución:

1. Abre Luma en `http://127.0.0.1:5173/`.
2. Ve a `Modelo`.
3. Pulsa `Usar modelo cargado`.
4. Envía un mensaje en `Chat administrador`.
5. Si falla, abre:

```text
http://127.0.0.1:8787/api/llm/diagnostics
```

Revisa `preferredChatEndpoint`, `lastLlmError`, `loadedModelsFromLmsPs` y `modelMatchesLoaded`. No necesitas instalar Ollama.

## OBS no escucha la voz de Luma

Síntoma: Luma habla en el panel, pero OBS/Twitch no la escuchan.

Causa probable: `/viewer` no reproduce audio por diseño.

Solución:

1. En OBS deja `/viewer` solo como fuente visual.
2. Agrega otra Browser Source con:

```text
http://127.0.0.1:8787/speaker
```

3. Abre/interactúa con esa fuente y pulsa `Activar audio de Luma`.
4. Activa `Control audio via OBS` si aparece.
5. Usa `Monitor and Output` si quieres escucharla en audífonos.

## /viewer muestra avatar temporal

Síntoma: el panel muestra el VRM, pero `/viewer` cae al avatar temporal.

Causa probable: el avatar activo no está en `data/avatar/current.vrm` o `/avatar` no está sirviendo el VRM.

Solución:

1. Abre:

```text
http://127.0.0.1:8787/api/avatar/health
```

2. Si `exists=false`, sube el `.vrm` otra vez desde el panel `Avatar`.
3. Prueba estas URLs:

```text
http://127.0.0.1:8787/avatar/current.vrm
http://127.0.0.1:5173/avatar/current.vrm
```

Deben servir un archivo VRM, no una página HTML.
