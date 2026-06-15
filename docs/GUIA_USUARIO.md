# Guía de usuario - Luma Local VTuber AI

Nota 2026-05-02: para estado tecnico completo y decisiones actuales, ver `AI_HANDOFF_MASTER.md`. Esta guia sigue siendo el manual practico para usar la app.

Nota de interfaz: el panel principal ahora se organiza como cockpit de stream con barra lateral, estados superiores, vista previa, consola en vivo, checklist `Ready for Stream` y panel del operador.

Esta guía explica cómo usar Luma tal como está hoy. No promete funciones futuras: Twitch ya existe en modo solo lectura; YouTube Live, Kick y memoria automática por usuario todavía no están conectados.

## 1. Qué es Luma

Luma es una VTuber IA local para Windows. Se abre como una app en navegador, pero corre en tu propia PC.

Hoy Luma puede:

- Abrir un panel local en `http://127.0.0.1:5173/`.
- Mostrar una escena limpia para OBS en `http://127.0.0.1:8787/viewer`.
- Responder usando LM Studio local si hay un modelo cargado.
- Funcionar sin modelo cargado usando fallback, aunque ese fallback no es inteligencia real.
- Hablar con Kokoro local si está configurado, o con voz del navegador como respaldo.
- Usar memoria manual guardada por el usuario.
- Simular mensajes de directo desde el panel `Chat del directo`.
- Recibir mensajes de Twitch en modo solo lectura si configuras el canal y token local.
- Moderar mensajes simulados con Guardia/GuardaespaldasBot.
- Crear backups restaurables y handoffs livianos.

Twitch funciona como lectura inicial de chat: Luma puede recibir mensajes y procesarlos con Guardia, pero no escribe respuestas al chat de Twitch. YouTube Live, Kick y TikTok todavía no están disponibles como conexión real de stream.

Los mensajes recibidos desde Twitch aparecen en `Chat del directo` y se guardan localmente en `data/vtuber.sqlite` como historial por viewer. Ese historial sirve para consultar lo que escribió cada persona y qué respondió Luma, pero todavía no es memoria automática.

## 2. Qué necesitas antes de usarla

Necesitas:

- Windows.
- Node/npm instalados, si vas a correr el proyecto desde esta carpeta.
- LM Studio si quieres respuestas reales del modelo local.
- Un modelo descargado en LM Studio.
- OBS si quieres usar la escena en stream.

Opcional:

- Kokoro local para mejor voz. Se instala con `Setup-Kokoro.bat`.
- Un avatar VRM en `public/avatar/luma.vrm` o carga manual desde la app.

Importante: Ollama aparece como fallback técnico en algunos archivos, pero no es necesario para el uso actual del usuario. No necesitas instalar Ollama para usar Luma con LM Studio.

## 3. Cómo encender Luma

Desde la carpeta del proyecto, abre:

```powershell
Start-Luma.bat
```

El menú principal es:

```text
Encender Luma

1. Iniciar Luma sin cargar modelo
2. Iniciar Luma y cargar modelo guardado: <modelo actual>
3. Elegir modelo de LM Studio y cargarlo
4. Reiniciar Luma limpia
5. Salir
```

### Opción 1: Iniciar Luma sin cargar modelo

Úsala para:

1. Abrir rápido la UI.
2. Probar OBS.
3. Ajustar escena/avatar/persona.
4. Usar fallback si LM Studio no está listo.

Qué hace:

- Inicia frontend en `5173`.
- Inicia backend en `8787`.
- No carga modelo en LM Studio.

Nota: si no hay modelo cargado, Luma puede responder con fallback. Ese fallback solo evita que la app se rompa; no es IA real.

### Opción 2: Iniciar Luma y cargar modelo guardado

Úsala cuando quieras hablar con Luma usando el modelo configurado en `.env`.

Qué hace:

- Inicia LM Studio server si hace falta.
- Carga el modelo guardado.
- Inicia Luma.

Nota: modelos grandes como `gemma-4-26b-a4b-it` pueden usar mucha RAM si no caben en VRAM. Para stream conviene usar modelos 7B, 8B o 12B cuantizados.

### Opción 3: Elegir modelo de LM Studio y cargarlo

Úsala cuando hayas descargado varios modelos en LM Studio y quieras elegir otro.

Qué hace:

- Lista modelos disponibles con `lms`.
- Guarda el modelo elegido en `.env`.
- Intenta cargarlo en LM Studio.

Cambiar de modelo puede cambiar el estilo de respuesta. Para revisar que Luma mantiene personalidad, usa [PERSONA_REGRESSION_TESTS.md](PERSONA_REGRESSION_TESTS.md).

### Opción 4: Reiniciar Luma limpia

Úsala cuando:

- La página no carga.
- El backend no responde.
- Hay puertos ocupados.
- Luma quedó en un estado raro.

Qué hace:

- Detiene frontend/backend.
- Descarga modelos de LM Studio.
- Detiene LM Studio server.
- Reinicia en puertos fijos `5173` y `8787`.

### Si Luma ya está abierta

Si `Start-Luma.bat` detecta servicios activos, muestra otro menú:

```text
1. Abrir Luma existente
2. Reiniciar Luma limpia
3. Cancelar
```

Usa `Abrir Luma existente` solo si frontend y backend están listos. Si uno no responde, usa `Reiniciar Luma limpia`.

## 4. Cómo apagar Luma correctamente

Método recomendado:

```powershell
Stop-Luma.bat
```

También puedes usar el botón `Apagar todo` dentro de la app.

Importante: no cierres solo la terminal como método normal. Eso puede dejar LM Studio server o un modelo cargado consumiendo RAM.

`Stop-Luma.bat` hace esto:

- Detiene frontend/Vite.
- Detiene backend/API.
- Detiene worker de Kokoro si existe.
- Ejecuta `lms unload --all`.
- Ejecuta `lms server stop`.

Para revisar si LM Studio todavía tiene modelos cargados:

```powershell
lms ps
```

Si quieres liberar RAM manualmente:

```powershell
lms unload --all
lms server stop
```

Si la RAM sigue alta después de apagar Luma y LM Studio, revisa el Administrador de tareas. Puede haber otros programas usando memoria o Windows puede tardar unos segundos en devolver memoria cacheada.

## 5. Pantallas principales

[Pendiente: captura del panel principal]

### Panel principal

URL:

```text
http://127.0.0.1:5173/
```

El panel principal ahora usa navegacion por workspaces. La sidebar abre pantallas completas:

- `Live`: cabina de operacion del stream.
- `Scene`: escena/OBS, fondos, camara y subtitulos.
- `Avatar`: avatar VRM y carga de archivo.
- `Voice`: audio, TTS y ruta `/speaker`.
- `Model`: LM Studio, modelo real/fallback y errores.
- `Persona`: personalidad editable y memoria manual.
- `Safety`: Guardia, moderacion y cola.
- `Viewers`: Twitch solo lectura e historial local.
- `Logs`, `Backups` y `Settings`: registros, herramientas locales y rutas.

Importante: `/viewer` y `/speaker` son rutas especiales para OBS, no pantallas de operacion.

Aqué ves:

- Luma/avatar.
- Actividad de voz.
- Estado del modelo.
- Chat.
- Seguridad.
- Panel técnico derecho.

### Viewer OBS

URL:

```text
http://127.0.0.1:8787/viewer
```

Es la escena limpia para OBS. No muestra paneles ni controles.

### Chat administrador

Sirve para probar a Luma en privado. Usa `POST /api/chat/admin`. En el estado actual, el chat administrador salta la Guardia y sirve para pruebas directas.

### Chat del directo

Es un simulador de mensajes de viewer. Usa `POST /api/chat/ingest`. Pasa por Guardia, cola y cooldown.

### Twitch solo lectura

El panel `Directo` puede conectar Twitch en modo solo lectura. Esto sirve para que Luma reciba mensajes reales del chat y los trate igual que el simulador: Guardia, cola y cooldown.

Configura estas variables en tu `.env` local:

```env
TWITCH_ENABLED=true
TWITCH_CHANNEL=tu_canal
TWITCH_BOT_USERNAME=tu_usuario_o_bot
TWITCH_OAUTH_TOKEN=oauth_token_local
TWITCH_CLIENT_ID=
```

Importante:

- `TWITCH_OAUTH_TOKEN` es secreto local. No lo pegues en capturas, documentos, backups públicos ni handoffs.
- Luma no escribe mensajes al chat de Twitch en esta fase.
- Si la configuración falta o es incorrecta, el botón `Conectar Twitch` mostrará error sin romper Luma.
- Puedes usar `Desconectar` desde el panel `Directo`.
- Los mensajes reales de Twitch aparecen como burbujas en `Chat del directo`.
- El panel `Directo > Historial de viewers` busca mientras escribes y permite ver mensajes/respuestas asociadas.
- Si Guardia ignora o bloquea un mensaje, `GuardaespaldasBot` puede aparecer en el panel y como aviso visual breve en `/viewer`.

Importante: el historial por viewer no es memoria automática. Luma no usa esos datos como recuerdos todavía.

Los saludos y preguntas cortas naturales como `¿Estás por ahí?`, `Luma?` o `¿Cómo estás?` tienen permiso más flexible. Retos como `Di: holaholaholahola...` se bloquean como repetición o copypasta.

### Seguridad

Modos visibles:

- `Normal`: conversación normal con filtros básicos.
- `Estricto`: más conservador.
- `Aprobación`: genera con más cautela.
- `Silencio`: recibe/registra, pero Luma no responde con voz.

### Paneles técnicos

Tabs actuales:

- `Escena`: fondo, encuadre, posición, escala y preview 16:9.
- `Avatar`: estado del VRM, cámara y pruebas de emoción.
- `Voz`: Kokoro, voz seleccionada y prueba de voz.
- `Modelo`: proveedor/modelo LM Studio.
- `Persona`: nombre, tono, lore, gustos, límites y estilo.
- `Memoria`: recuerdos manuales.
- `Guardia`: cola, cooldown y moderación.
- `Directo`: estado local para OBS/directo.
- `Registros`: logs recientes.

## 6. Activar audio de Luma

Los navegadores bloquean audio hasta que el usuario interactúa. Por eso existe el botón:

```text
Activar audio de Luma
```

Antes de probar o salir en vivo:

1. Abre el panel principal.
2. Pulsa `Activar audio de Luma`.
3. Envia un mensaje en `Chat administrador`.
4. Confirma que Luma se escucha.

Si no lo pulsas, puede aparecer:

```text
Audio bloqueado por el navegador. Pulsa Activar audio de Luma.
```

Importante: `/viewer` no reproduce audio para evitar eco en OBS. El audio debe salir desde el panel principal.

Si no se escucha:

1. Pulsa `Activar audio de Luma`.
2. Revisa volumen del navegador.
3. Revisa mezclador de volumen de Windows.
4. Prueba `Voz > Probar voz`.
5. Si Kokoro no está listo, Luma usa fallback del navegador.

## 7. Usar Luma con OBS

Panel principal:

```text
http://127.0.0.1:5173/
```

Viewer limpio:

```text
http://127.0.0.1:8787/viewer
```

Pasos en OBS:

1. Agrega una fuente `Browser Source`.
2. Usa la URL `http://127.0.0.1:8787/viewer`.
3. Usa tamaño 16:9, por ejemplo `1920x1080`.
4. Marca refrescar fuente cuando sea necesario si OBS se queda con caché.
5. Ajusta la escena desde el panel `Escena`.

Notas:

- `/viewer` es la escena limpia.
- `/viewer` no debe reproducir audio.
- Si OBS usa `http://127.0.0.1:5173/`, la app intenta detectar user agent de OBS y mástrar viewer limpio, pero la URL recomendada sigue siendo `/viewer`.
- Los fondos locales se suben desde `Escena` y se guardan en `data/backgrounds/`.
- El avatar puede usar fallback o `public/avatar/luma.vrm`.
- Si cargas un `.vrm` desde el panel, Luma lo guarda como avatar activo local en `data/avatar/current.vrm`; `/viewer` lo usa también.

## 8. Chat administrador vs chat del directo

### Chat administrador

Uso:

- Probar respuestas privadas.
- Validar personalidad.
- Probar el modelo.
- Probar voz.

Características:

- No tiene el mismo límite visual que el chat simulado.
- Salta Guardia.
- Es ideal para configurar antes del stream.

### Chat del directo

Uso:

- Simular mensajes de viewers.
- Probar Guardia/cola/cooldown.
- Ver si Luma respondería a un chat publico.

Características:

- Pasa por Guardia.
- Puede quedar en cola.
- Puede ignorarse o bloquearse.
- Guarda motivos en logs.

### GuardaespaldasBot

Cuando la Guardia decide algo, puede aparecer un mensaje de `GuardaespaldasBot`.

Decisiones comunes:

- `queued`: mensaje aceptado y en cola.
- `ignored`: mensaje ignorado por bajo valor, repetición, cooldown u otra razón.
- `blocked`: bloqueado por seguridad.

En `/viewer`, GuardaespaldasBot puede mostrar avisos breves para que el stream entienda por qué Luma no leyó un mensaje. Ese aviso no tiene voz.

## 9. Modelos y rendimiento

Proveedor actual recomendado:

```text
LM Studio
```

LM Studio debe exponer su API local OpenAI-compatible en:

```text
http://127.0.0.1:1234/v1
```

Ollama no es necesario para el flujo actual del usuario. Algunos archivos lo mencionan como fallback legacy/opcional, pero no hace falta instalarlo.

### Modelos grandes

Un modelo como `gemma-4-26b-a4b-it` puede cargar alrededor de 17 GB o más. Si tu GPU tiene 12 GB VRAM, parte del modelo puede irse a RAM/CPU y eso causa:

- RAM alta.
- Respuestas lentas.
- Latencias mayores a 10 segundos.
- TTS menos fluido.

Para stream conviene:

- Modelo instruct 7B/8B/12B cuantizado.
- Contexto de 4096 o menos.
- Respuestas cortas.

### Variables disponibles

En `.env` o `.env.example` existen:

```env
LM_STUDIO_GPU_OFFLOAD=max
LM_STUDIO_CONTEXT_LENGTH=4096
LM_STUDIO_TTL=300
```

Notas:

- `LM_STUDIO_GPU_OFFLOAD=max` pide a LM Studio usar GPU al máximo posible.
- `LM_STUDIO_CONTEXT_LENGTH=4096` ayuda a reducir memoria.
- `LM_STUDIO_TTL=300` puede descargar el modelo tras unos minutos si tu versión de LM Studio CLI soporta `--ttl`.

### Ver modelo cargado

```powershell
lms ps
```

Si Luma tarda demásiado:

1. Usa `Stop-Luma.bat`.
2. Carga un modelo más pequeno.
3. Usa `Start-Luma.bat` opción 3.
4. Prueba desde `Chat administrador`.

## 10. Personalidad de Luma

La personalidad editable está en:

```text
config/persona.json
```

También existe:

```text
config/persona-lock.json
```

`persona-lock` fija identidad, tono, estilo de habla, reglas de stream y ejemplos. Su objetivo es que Luma siga siendo Luma aunque cambies de modelo en LM Studio.

Importante: esto reduce la variación entre modelos, pero no la elimina. Cada modelo nuevo puede interpretar la personalidad distinto.

Para probar un modelo nuevo:

1. Cárgalo en LM Studio.
2. Abre Luma.
3. Usa `Chat administrador`.
4. Prueba los casos de [PERSONA_REGRESSION_TESTS.md](PERSONA_REGRESSION_TESTS.md).

## 11. Backups y restauración

### Backup restaurable

Sirve para volver a un punto anterior del proyecto.

Crear:

```powershell
Backup-Luma.bat
```

Elige:

```text
Crear backup restaurable
```

Genera archivos:

```text
backups/luma-restore-YYYYMMDD-HHMMSS.zip
```

### Handoff liviano

Sirve para compartir código y documentación con ChatGPT. No sirve para restaurar.

Crear:

```powershell
Backup-Luma.bat
```

Elige:

```text
Crear handoff liviano para ChatGPT
```

Genera archivos:

```text
backups/luma-handoff-YYYYMMDD-HHMMSS.zip
```

Importante: no restaures un handoff.

### Restaurar backup

```powershell
Restore-Luma.bat
```

La herramienta:

- Lista solo `luma-restore-*.zip`.
- No lista handoffs.
- Pide confirmación exacta `RESTAURAR`.
- Crea un backup automático del estado actual antes de copiar.
- Pregunta si quieres restaurar SQLite si el backup lo trae.
- Ejecuta `npm.cmd install`, `npm.cmd run check` y `npm.cmd run build`.

## 12. Qué hacer si algo sale mal

Consulta [SOLUCION_PROBLEMAS.md](SOLUCION_PROBLEMAS.md).

## 13. Limitaciones actuales

- Twitch está conectado solo en modo lectura: Luma recibe mensajes, pero no escribe en Twitch.
- El historial local por viewer está disponible, pero no es memoria automática.
- Donaciones o regalos todavía no dan permisos especiales ni saltan Guardia.
- YouTube Live todavía no está conectado.
- Kick todavía no está conectado.
- TikTok/TikFinity no está documentado aquí como conexión real disponible.
- Memoria automática por usuario todavía no está disponible.
- La memoria actual es manual.
- El avatar VRM definitivo puede no estar incluido.
- El fallback no es inteligencia real.
- La voz puede requerir desbloqueo del navegador.
- `/viewer` no reproduce audio para evitar eco.

## 14. Flujo recomendado para iniciar stream

1. Si haras cambios, crea backup con `Backup-Luma.bat`.
2. Ejecuta `Start-Luma.bat`.
3. Carga modelo si quieres IA real.
4. Abre el panel `http://127.0.0.1:5173/`.
5. Pulsa `Activar audio de Luma`.
6. En OBS, usa `http://127.0.0.1:8787/viewer`.
7. Prueba `Chat administrador`.
8. Prueba `Chat del directo`.
9. Confirma que Luma responde y se escucha desde el panel principal.
10. Al terminar, usa `Stop-Luma.bat`.

## Nota actualizada: modelo READY, avatar y audio para OBS

### Usar el modelo READY de LM Studio

Si LM Studio muestra un modelo `READY`, pero Luma responde con `local-template`, no edites `.env` a mano primero. Abre la pestaña `Modelo` y pulsa `Usar modelo cargado`. Luma tomará el identifier exacto desde `lms ps`, configurará `LLM_PROVIDER=lmstudio`, probará el endpoint OpenAI compatible y guardará el modo que funcione.

Para diagnóstico técnico seguro abre:

```text
http://127.0.0.1:8787/api/llm/diagnostics
```

Ese endpoint no muestra secretos. Sirve para ver modelo configurado, modelo READY, endpoint preferido y último error real.

### Verificar avatar activo

El avatar persistente se guarda como `data/avatar/current.vrm` y se sirve por `/avatar/current.vrm`. Para revisar si existe:

```text
http://127.0.0.1:8787/api/avatar/health
```

Si `exists=false`, vuelve a subir el `.vrm` desde el panel `Avatar`. En desarrollo, también debe abrir desde:

```text
http://127.0.0.1:5173/avatar/current.vrm
```

### OBS con visual y audio separados

Para que Twitch/OBS escuchen a Luma usa dos Browser Sources:

```text
Visual: http://127.0.0.1:8787/viewer
Audio:  http://127.0.0.1:8787/speaker
```

`/viewer` no reproduce audio. `/speaker` es el host dedicado de audio; abre esa fuente, pulsa `Activar audio de Luma` y verifica que OBS capture su audio. Si necesitas escucharla en tus audífonos, usa `Monitor and Output` en las propiedades avanzadas de audio de OBS.
