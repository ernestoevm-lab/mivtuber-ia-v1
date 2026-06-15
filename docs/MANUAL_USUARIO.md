# Manual de usuario — MiVtuberIA (Yuko)

> Guía actualizada para usar a **Yuko**, tu VTuber con IA local. Pensada para usuarios finales, sin comandos técnicos donde sea posible.

## ¿Qué es?
Yuko (Yumekawa Kokoria) es una **VTuber con IA que corre en tu PC**. Te acompaña, narra lo que pasa en pantalla, reacciona al chat de tu stream y habla con voz propia. Cambia de "modo" según el momento: tiene cinco (cálido, caótico/divertido, picante controlado, firme y narrador).

## Qué necesitas
- **Windows** (probado en Windows 11).
- **VTube Studio** (gratis en Steam) con un modelo Live2D cargado — para que se vea el avatar.
- **Internet** si usas el cerebro en la nube (Gemini), o **LM Studio** con un modelo si prefieres cerebro local.
- **OBS Studio** (opcional) si vas a transmitir.

## Cómo iniciar la app
- **Recomendado:** instala el `.exe` desde la página de Releases y abre **MiVtuberIA** desde el
  menú de inicio. La app arranca su backend sola; no hay que abrir terminales.
- **Desde el código (desarrollo):** `npm run app:dev` (ventana nativa) o `npm run dev` (panel en
  el navegador, `127.0.0.1:5173`). Los lanzadores `.bat`/`.ps1` de la raíz siguen como alternativa.

## Primer inicio (onboarding)
La primera vez verás una **pantalla de bienvenida** con:
- Aceptación de términos (uso responsable, sin pegar datos privados ni secretos).
- **Estado del Sistema**: chequeos de backend, cerebro (modelo), voz, avatar y OBS.
- Si algo falta (ej. LM Studio), te lo explica en simple y puedes **entrar en modo limitado**.

Una vez aceptado, entras al **panel de control (cockpit)**. Esa pantalla solo la ves tú (el operador); tus espectadores ven OBS.

## Usar el panel
- **Live**: aquí hablas con Yuko (chat admin) y ves el chat del directo. Yuko responde con voz y personalidad.
- **Avatar**: pulsa **Conectar VTS** para enlazar VTube Studio. La primera vez VTS te pedirá permiso (acéptalo). Aquí también mapeas cada emoción a una expresión de tu modelo.
- **Voice**: activa el audio, prueba la voz y ajusta el **volumen**.
- **Model**: elige el cerebro — **Gemini (nube)** para mejor personalidad sin gastar tu tarjeta gráfica, o **LM Studio (local)** para privacidad. Para Gemini, pega tu API key ahí mismo y pulsa **Guardar y activar Gemini** (la app la verifica, la activa y la guarda solo en tu PC). Al cambiar a nube, el modelo local se descarga solo para liberar memoria de tu GPU.
- **Viewers**: conecta **Twitch** (solo lectura del chat).
- **Safety**: modos de moderación (normal/estricto/aprobación/silencio).

## Conectar a OBS (para transmitir)
Las URLs de Viewer y Speaker aparecen en la pestaña **Ajustes** (cópialas de ahí; el puerto
suele ser 8787 pero puede variar). En OBS agrega fuentes:
- **Browser Source** con la URL de **Viewer** (por defecto `http://127.0.0.1:8787/viewer`) → la escena visual de Yuko.
- **Browser Source** con la URL de **Speaker** (por defecto `http://127.0.0.1:8787/speaker`) → el audio de Yuko (pulsa "Activar audio" dentro).
- Para el avatar Live2D: en VTube Studio activa **Spout2** y en OBS usa **Spout2 Capture** (o captura de ventana de VTS).
- Agrega tu **webcam** y un **fondo** para armar tu "habitación".

## Que Yuko vea tu pantalla
En **Live**, sección de visión: **Activar visión** (eliges qué pantalla/ventana compartir) y Yuko la narra. "Mirar" describe en privado; "Narrar" lo dice en voz para el directo.

## Apagar
En la app instalada, cerrar la ventana apaga todo (backend incluido). En modo desarrollo, cierra
la ventana de Tauri o detén `npm run dev`; el lanzador `Stop-MiVtuberIA`/`Stop-Luma` también cierra
el backend y LM Studio.

## Seguridad
- Yuko bloquea contenido peligroso, acoso y datos privados.
- No pegues tokens, contraseñas ni datos personales en el chat.
- La personalidad y la voz son configurables, pero los límites de seguridad siempre aplican.
