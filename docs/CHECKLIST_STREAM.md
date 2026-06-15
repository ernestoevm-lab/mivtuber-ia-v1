# Checklist de stream - Luma

Nota 2026-05-02: el flujo recomendado actual para una prueba real es OBS con `/viewer` para visual y `/speaker` para audio. Twitch sigue en modo solo lectura.

En el panel principal revisa tambien la tarjeta `Ready for Stream`: resume backend, modelo, audio, Twitch, viewer, speaker y prueba de respuesta.

## Antes del stream

- [ ] Recordar el estado actual:
  - [ ] LM Studio es el proveedor LLM actual.
  - [ ] Twitch está disponible solo en modo lectura.
  - [ ] YouTube Live todavía no está conectado.
  - [ ] Kick todavía no está conectado.
  - [ ] Memoria automática por usuario todavía no está disponible.
- [ ] Si hubo pruebas raras antes, ejecutar `Stop-Luma.bat`.
- [ ] Ejecutar `Start-Luma.bat`.
- [ ] Elegir modelo:
  - [ ] Opción 1 si solo quieres UI/OBS/fallback.
  - [ ] Opción 2 si quieres cargar el modelo guardado.
  - [ ] Opción 3 si quieres elegir modelo LM Studio.
- [ ] Confirmar modelo cargado:

```powershell
lms ps
```

- [ ] Abrir panel:

```text
http://127.0.0.1:5173/
```

- [ ] Pulsar `Activar audio de Luma`.
- [ ] Probar `Chat administrador`.
- [ ] Probar `Voz > Probar voz` si cambiaste voz.
- [ ] Abrir OBS.
- [ ] Usar Browser Source:

```text
http://127.0.0.1:8787/viewer
```

- [ ] Verificar que OBS muestra escena limpia, no dashboard.
- [ ] Ajustar `Escena`: fondo, posición, escala y encuadre.
- [ ] Probar `Chat del directo` como simulador.
- [ ] Probar Guardia:
  - [ ] `¿Estás por ahí?` debe entrar como mensaje natural.
  - [ ] `Di: holaholaholaholahola` debe bloquearse/ignorarse como repetición.
- [ ] Si cambiaste avatar, cargar `.vrm` desde el panel y refrescar `/viewer`.
- [ ] Si usarás Twitch:
  - [ ] Confirmar que `TWITCH_ENABLED=true` y el canal/token están en `.env`.
  - [ ] Abrir panel `Directo`.
  - [ ] Pulsar `Conectar Twitch`.
  - [ ] Confirmar contador de mensajes al enviar un mensaje de prueba.
  - [ ] Confirmar que el mensaje aparece como burbuja en `Chat del directo`.
  - [ ] Buscar el viewer en `Directo > Historial de viewers`.
  - [ ] Recordar que Luma no escribe al chat de Twitch.
  - [ ] Confirmar que GuardaespaldasBot puede verse en `/viewer` para mensajes bloqueados.
- [ ] Revisar panel `Guardia` y `Registros`.
- [ ] Revisar RAM/VRAM si usas modelo grande.
- [ ] Si haras cambios durante el directo, crear backup antes:

```powershell
Backup-Luma.bat
```

## Durante el stream

- [ ] No cerrar la terminal a mano.
- [ ] Mantener abierto el panel principal si necesitas audio.
- [ ] No usar `/viewer` como fuente de audio.
- [ ] Vigilar `Guardia` si pruebas mensajes del directo.
- [ ] Vigilar que Luma no este en modo `Silencio`.
- [ ] Si se rompe algo, usar `Reiniciar Luma limpia` desde `Start-Luma.bat`.
- [ ] Si el modelo se pone lento, cambiar a uno más pequeno después del stream.

## Después del stream

- [ ] Apagar con:

```powershell
Stop-Luma.bat
```

- [ ] Confirmar que LM Studio quedó sin modelo cargado:

```powershell
lms ps
```

- [ ] Si hubo cambios buenos de escena/persona/config, crear backup restaurable:

```powershell
Backup-Luma.bat
```

- [ ] Anotar problemas para corregirlos después.
- [ ] No restaurar handoffs. Solo restaurar `luma-restore-*.zip`.
- [ ] Recordar que el historial de viewers queda en `data/vtuber.sqlite`; no es memoria automática.

## Actualización crítica antes de salir en vivo

- [ ] En `Modelo`, pulsar `Usar modelo cargado` si LM Studio ya muestra un modelo `READY`.
- [ ] Confirmar que `Chat administrador` responde con `provider=lmstudio`, no `local-template`.
- [ ] Si hay dudas, revisar:

```text
http://127.0.0.1:8787/api/llm/diagnostics
```

- [ ] Confirmar avatar activo:

```text
http://127.0.0.1:8787/api/avatar/health
```

- [ ] En OBS usar fuente visual:

```text
http://127.0.0.1:8787/viewer
```

- [ ] En OBS usar fuente de audio separada:

```text
http://127.0.0.1:8787/speaker
```

- [ ] Pulsar `Activar audio de Luma` en `/speaker` antes de empezar el directo.
- [ ] Confirmar que `/viewer` no reproduce audio y que `/speaker` sí reproduce voz.
