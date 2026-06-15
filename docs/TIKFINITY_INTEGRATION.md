# TikFinity Integration

MiVtuberIA can receive TikTok LIVE events from TikFinity Desktop through a local WebSocket. TikFinity Desktop must be open on the same PC while the LIVE is active.

## Configuration

The default WebSocket URL is:

```text
ws://127.0.0.1:21213/
```

If that does not connect, try:

```text
ws://localhost:21213/
```

The URL and behavior are stored in `config/tikfinity.json` and can be edited from the cockpit under `Viewers / Directo`.

Main options:

- `enabled`: allows MiVtuberIA to connect.
- `wsUrl`: local TikFinity WebSocket URL.
- `reconnect`: retry when TikFinity closes or restarts.
- `respondToChat`: lets TikFinity chat events reach Autonomy Director.
- `respondToMentionsOnly`: only forwards chat events that mention Yuko.
- `mentionKeywords`: words treated as direct mentions.

## Backend Endpoints

- `GET /api/tikfinity/state`
- `POST /api/tikfinity/config`
- `POST /api/tikfinity/connect`
- `POST /api/tikfinity/disconnect`
- `POST /api/tikfinity/test-event`

`/api/tikfinity/test-event` injects a simulated event, useful when the LIVE has no recent comments:

```json
{
  "type": "chat",
  "username": "tester",
  "displayName": "Tester",
  "text": "Hola Yuko, ¿me lees?"
}
```

## Supported Events

MiVtuberIA normalizes TikFinity payloads into:

- `chat`
- `gift`
- `like`
- `follow`
- `share`
- `member`
- `join`
- `subscribe`
- `viewer_count`
- `unknown`

Unknown payloads are kept as `raw` for debugging and must not crash the server.

## Troubleshooting

- TikFinity closed: open TikFinity Desktop, then press `Conectar TikFinity`.
- Wrong port: try `ws://localhost:21213/` or confirm the WebSocket URL in TikFinity.
- No LIVE active: use the test event to validate MiVtuberIA.
- Firewall: allow local connections on the TikFinity port.
- No comments: wait for LIVE activity or use the test event.
- Unknown payload: check logs for `tikfinity_event`; the raw payload is preserved for later mapper updates.

Limitations: this integration only reads local TikFinity events. It does not implement TikTok chat writing, Twitch changes, vision, captures, LoRA, or new voice systems.
