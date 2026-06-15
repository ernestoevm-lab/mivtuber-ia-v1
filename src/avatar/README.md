# Avatar runtime foundation

`AvatarSignal` is the small bridge between Yuko's chat/voice metadata and future avatar runtimes.

- `animationSignals.ts` derives safe signals from `ChatResponse` and `luma:speech`.
- `avatarRuntime.ts` keeps the latest signal and lets UI/runtime code subscribe without coupling to LM Studio, TTS, VRM or Live2D.
- VRM should translate signals into expressions, gaze, blink, idle motion, head tilt and lip sync.
- Live2D should translate the same signals into Cubism parameters, expressions and motions.

Not implemented yet:

- full Live2D loader;
- new TTS backend;
- audio amplitude lip sync;
- model or asset packaging.
