# Autonomy Director

Autonomy Director decides when Yuko may speak without a direct manual prompt. It is separate from the LLM provider and does not change the configured model.

## Modes

- `off`: Yuko never speaks by herself. Manual chat still works normally.
- `companion`: low or medium intervention. Yuko respects silence and reacts mostly to strong signals.
- `vtuber`: more active streamer behavior. Yuko can react more often to LIVE activity, follows, gifts, and longer silence.

Intensity can be `low`, `medium`, or `high`. Higher intensity lowers thresholds and cooldowns, but still respects anti-spam limits.

## Signals

Current signals:

- TikFinity LIVE chat, gifts, likes, follows, shares, members, subscriptions, viewer count.
- Manual autonomy trigger from the UI/API.
- Silence detector when autonomy is active.
- Runtime busy state: LLM busy, TTS busy, assistant speaking, cooldown.

Not implemented:

- screen vision or capture for autonomy,
- Twitch autonomy changes,
- OBS scene understanding,
- camera access,
- LoRA,
- new voice system.

Yuko must not claim she sees the screen unless a future vision feature explicitly provides that context.

## Decision Flow

1. A live or internal event becomes an `AutonomyEvent`.
2. `scoreAutonomyEvent()` calculates score from priority, confidence, mention/question detection, mode, intensity, spam signals, recent speech, and event type.
3. `canSpeakNow()` blocks speech if autonomy is off, Yuko/user is speaking, LLM is busy, TTS queue is busy, do-not-disturb is active, or cooldown has not expired.
4. Anti-spam checks enforce maximum autonomous messages per 10 minutes.
5. If allowed, Yuko either uses a fast template or a short prompt through the existing LLM flow.
6. Speech uses the existing `ChatResponse` and TTS pipeline.

## API

- `GET /api/autonomy/state`
- `POST /api/autonomy/config`
- `POST /api/autonomy/trigger`
- `GET /api/autonomy/decisions`

Manual trigger example:

```json
{
  "type": "manual_trigger",
  "message": "Haz una intervención breve de prueba"
}
```

Live chat trigger example:

```json
{
  "type": "live_chat_message",
  "username": "tester",
  "text": "Yuko, ¿me lees?"
}
```

## Testing From UI

1. Open `Viewers / Directo`.
2. Set Autonomy to `Acompañante` or `VTuber`.
3. Pick intensity.
4. Press `Probar autonomía`.
5. Use `Test event` in the TikFinity panel.
6. Check last decision for score, threshold, reason, and blocker.

To disable everything, set mode to `OFF`. TikFinity can still receive events, but Yuko will not speak autonomously.
