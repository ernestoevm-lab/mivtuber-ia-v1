# Guía rápida - Luma

Para usar Luma sin meterte en lo técnico.

## Encender

1. Abre:

```powershell
Start-Luma.bat
```

2. Elige una opción:

- `1. Iniciar Luma sin cargar modelo`: abre rápido la app. Si no hay modelo, usará fallback.
- `2. Iniciar Luma y cargar modelo guardado`: uso normal si quieres IA real con LM Studio.
- `3. Elegir modelo de LM Studio y cargarlo`: cuando quieras cambiar de modelo.
- `4. Reiniciar Luma limpia`: si algo se trabó.

Si Luma ya está abierta, elige `Abrir Luma existente`. Si algo no responde, elige `Reiniciar Luma limpia`.

## Abrir panel

```text
http://127.0.0.1:5173/
```

La sidebar cambia pantallas completas:

- `Live`: operacion del stream y consola.
- `Scene`: escena y OBS visual.
- `Avatar`: VRM y avatar activo.
- `Voice`: audio y `/speaker`.
- `Model`: LM Studio/modelo.
- `Persona`: personalidad y memoria manual.
- `Safety`: Guardia.
- `Viewers`: Twitch e historial.
- `Logs`, `Backups`, `Settings`: registros, respaldo y rutas.

## Activar audio

1. En el panel principal pulsa `Activar audio de Luma`.
2. Prueba con `Chat administrador`.
3. Si no se escucha, revisa volumen del navegador y Windows.

Importante: `/viewer` no tiene audio para evitar eco.

## OBS

En OBS agrega una fuente `Browser Source` con:

```text
http://127.0.0.1:8787/viewer
```

Tamaño recomendado:

```text
1920x1080
```

Usa el panel `Escena` para ajustar fondo, encuadre y posición.

## Probar chat

- `Chat administrador`: pruebas privadas, salta Guardia.
- `Chat del directo`: simulador de viewer, pasa por Guardia, cola y cooldown.
- `Directo > Twitch solo lectura`: recibe chat de Twitch si lo configuraste, pero Luma no escribe respuestas en Twitch.

Estado actual:

- LM Studio es el proveedor LLM actual.
- Twitch está disponible solo en modo lectura.
- YouTube Live todavía no está conectado.
- Kick todavía no está conectado.
- Memoria automática por usuario todavía no está disponible.

## Apagar

Usa:

```powershell
Stop-Luma.bat
```

No cierres solo la terminal como método normal. Puede dejar LM Studio o el modelo usando RAM.

Si necesitas liberar LM Studio manualmente:

```powershell
lms unload --all
lms server stop
```

## Backups

Antes de cambios grandes:

```powershell
Backup-Luma.bat
```

Elige `Crear backup restaurable`.

Para compartir código con ChatGPT, elige `Crear handoff liviano para ChatGPT`.

Importante: el handoff no se restaura.

## Restaurar

```powershell
Restore-Luma.bat
```

Solo muestra backups `luma-restore-*.zip`. Pide escribir `RESTAURAR` antes de tocar archivos y crea un backup automático antes de restaurar.

## No hagas esto

- No cierres la terminal como apagado normal.
- No uses handoff como restore.
- No uses `/` en OBS si puedes usar `/viewer`.
- No cargues modelos enormás para streamási necesitas respuestas rápidas.

## OBS con audio de Luma

Usa dos fuentes de navegador en OBS:

```text
Visual: http://127.0.0.1:8787/viewer
Audio:  http://127.0.0.1:8787/speaker
```

En `/speaker`, pulsa `Activar audio de Luma`. `/viewer` sigue sin audio para evitar eco. Si OBS ofrece `Control audio via OBS`, activalo para la fuente `/speaker`. Si quieres escucharla en audifonos, usa `Monitor and Output` en `Advanced Audio Properties`.

## Si Luma responde con local-template

1. Confirma que LM Studio tiene un modelo `READY`.
2. En Luma abre `Modelo`.
3. Pulsa `Usar modelo cargado`.
4. Prueba `Chat administrador`.
5. Si sigue fallando, abre:

```text
http://127.0.0.1:8787/api/llm/diagnostics
```

Ahi debe verse modelo configurado, modelo READY, endpoint usado y error real.

## Si /viewer muestra avatar temporal

Abre:

```text
http://127.0.0.1:8787/api/avatar/health
```

Si `exists=false`, vuelve a subir el `.vrm` desde el panel `Avatar`. El avatar activo tambien debe servirse en:

```text
http://127.0.0.1:5173/avatar/current.vrm
```
