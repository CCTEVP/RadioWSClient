# RadioWSClient – Control, Player Overlay & Test Utilities

Rich WebSocket clients for interacting with a broadcast WebSocket server that relays JSON payloads (e.g. advertiser/content triggers) to multiple subscribers. The repository currently contains:

- `control/` – An operator UI to connect, inspect incoming broadcast data, and send test JSON messages.
- `player/` – A lightweight overlay that highlights one of 10 squares based on an `advertiser.id` found in incoming payloads (visual trigger display).
- `connection-test.html` – A dual‑client diagnostic page to observe long‑lived connection behavior and keepalive traffic.

The clients are tuned for hour‑long stable sessions against the deployed server endpoint:

```
wss://radiowsserver-763503917257.europe-west1.run.app/
```

> For local testing you can swap the URL to `ws://localhost:8080` (or secure `wss://` behind a reverse proxy) in the respective `app.js` files.

---

## Tokens and servers

Each app keeps one token per server in `CONFIG.AUTH_TOKENS` (`local`, `prod`)
and picks the server with `?server=local|prod` (Monitor and Player default to
`local`, Agent to `prod`). Tokens are minted per server, with the right role,
by `RadioWSServer/scripts/mint-client-tokens.js`:

| App | Role | Can post |
|---|---|---|
| Monitor | `control` | yes: it posts with its own token |
| Player | `screen` | no |
| Agent | `agent` | no |

An app without a token for the selected server says so in its log and does
not connect.

## Key Features

### Shared

- Automatic reconnection with capped exponential backoff (3s → 6s → 9s → 12s → 15s, reused) up to a defined attempt ceiling.
- Application‑level keepalive (JSON `keepalive` messages every 30s) in addition to the server’s native WebSocket ping/pong heartbeat.
- Connection duration tracking (logged on close) and attempt counting.
- Graceful manual disconnect logic that suppresses auto‑reconnect.
- Robust JSON parsing with safe fallbacks (logs raw text if non‑JSON).

### `control/` client

- Connect / Disconnect / Clear Logs UI with status badge (connecting / connected / disconnected).
- JSON editor + validation before send (prevents invalid JSON dispatch).
- Color‑coded log entries: sent / received / info / error.
- Keyboard shortcut: `Ctrl+Enter` to send.

### `player/` overlay

- 10 visual squares (IDs 1..10) – highlights the square matching `advertiser.id`.
- Pulse animation retriggered on each update.
- Minimal footprint (no pointer events, can overlay existing signage/player content).
- Connection indicator dot (red while disconnected; hidden when connected).

### `connection-test.html`

- Spawns two independent WebSocket connections ("control" + "player" roles) for endurance testing.
- Displays rolling logs and periodic duration checks (every 5 mins).
- Emits keepalive messages for both simulated clients.

---

## Message Flow & Envelope

The server (code not stored in this repo, reference provided separately) may wrap client‑originated payloads in a broadcast envelope before forwarding to other clients:

```json
{
  "type": "broadcast",
  "from": "203.0.113.10:54321", // originating client address (example)
  "receivedAt": 1730462400123, // server receive timestamp (ms)
  "data": {
    // original client JSON
    "type": "ping",
    "timestamp": "2025-10-02T00:00:00.000Z",
    "data": {
      "content": { "id": 6564, "name": "Florida" },
      "advertiser": { "id": 3, "name": "Mc Donalds" }
    }
  }
}
```

Additionally, upon connection the server sends a welcome message:

```json
{
  "type": "welcome",
  "message": "Connected to broadcast server",
  "time": 1730462400456
}
```

The clients:

- Recognize `welcome` (informational log only).
- Unwrap `broadcast` envelopes and process the inner `data` object.
- Look for an `advertiser` object with numeric `id` for visual highlighting (`player/`).

---

## Keepalive & Reconnection Strategy

| Aspect              | Server                                | Client                                                            |
| ------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Transport heartbeat | Native `ping` every 30s (`ws.ping()`) | Browser auto‑`pong` (no manual code required)                     |
| App keepalive       | Accepts arbitrary JSON                | Sends `{ "type": "keepalive", ... }` every 30s                    |
| Reconnect           | N/A (stateless)                       | Exponential backoff up to `MAX_RECONNECT_ATTEMPTS` (currently 20) |
| Manual disconnect   | Close with code 1000                  | Suppresses reconnection temporarily                               |

If the connection drops (network blip / server recycle / transient proxy issue), the client schedules a reconnect unless:

- User explicitly disconnected.
- Reconnect attempt cap reached (log advises manual action).

---

## Example Client Payloads

### Keepalive (sent automatically)

```json
{
  "type": "keepalive",
  "timestamp": "2025-10-02T00:00:00.000Z",
  "clientId": "control"
}
```

### Advertiser Trigger (manual test)

```json
{
  "type": "ping",
  "timestamp": "2025-10-02T00:00:00.000Z",
  "data": {
    "content": { "id": 6564, "name": "Florida" },
    "advertiser": { "id": 5, "name": "Demo Brand" }
  }
}
```

If multiple nested objects exist, the player client attempts to locate the first object containing an `advertiser` key (defensive parsing for slightly malformed wrappers).

---

## Using the Control Client

1. Open `control/index.html` in a modern browser (Chrome, Edge, Firefox).
2. Click **Connect** – status changes to yellow (Connecting) then green (Connected).
3. Edit JSON in the textarea (must be valid) and press **Send Message** or `Ctrl+Enter`.
4. Observe incoming broadcasts and keepalive logs.
5. Use **Disconnect** to manually close (prevents auto‑reconnect) or **Clear Logs** to reset the view.

### Log Color Legend

- Blue border – Sent
- Green border – Received
- Amber – Info (keepalive, lifecycle)
- Red – Error / invalid JSON

---

## Using the Player Overlay

1. Open `player/index.html` (can be overlaid onto signage runtime; the included background is only a demo asset).
2. After connection, the red dot fades (hidden) indicating active WebSocket.
3. When a payload with `advertiser.id = N` arrives, square N (1‑10) highlights and pulses.
4. Consecutive activations retrigger pulse animation.

### Customizing Mapping

- Add more squares: duplicate `.square` elements and adjust range logic in `player/app.js`.
- Change visual style in `player/styles.css` (`.square.active`, `.square.pulse`).

---

## Connection Test Utility

Open `connection-test.html` to:

- Spin up two simultaneous connections (labels: control / player).
- Observe keepalive emission every 30s.
- Log uptime snapshots every 5 minutes.
- Manually stop both connections for controlled scenarios.

Ideal for confirming stability over 60+ minutes (watch for absence of unexpected disconnect logs).

---

## Folder Structure

```
RadioWSClient/
├── control/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── player/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── img/
│       └── BMO_Welcome_1080x1920.jpg
├── connection-test.html
└── README.md
```

---

## Status Indicators

- 🟢 Connected – WebSocket OPEN
- 🟡 Connecting – Handshake in progress / reconnect pending
- 🔴 Disconnected – Closed or not yet opened

Player red dot mirrors the same (hidden when connected).

---

## Error / Close Codes (Observed / Potential)

| Code | Meaning (Server Policy / Standard)                    |
| ---- | ----------------------------------------------------- |
| 1000 | Normal closure (manual disconnect)                    |
| 4000 | Idle timeout (if server `IDLE_TIMEOUT_MS` configured) |
| 4001 | Max connection age reached (if `MAX_CONN_AGE_MS` set) |
| 4002 | Server shutting down (graceful termination)           |
| 4003 | Origin not allowed (origin allowlist violation)       |

If frequent unexpected codes appear, verify network stability and server environment variables.

---

## Troubleshooting

| Symptom                          | Action                                                               |
| -------------------------------- | -------------------------------------------------------------------- |
| Reconnect loop hits max attempts | Reload page or investigate server availability / firewall            |
| No square highlight              | Confirm payload contains `advertiser.id` within 1..10                |
| Keepalive logs absent            | Ensure `startHeartbeat()` executed post connection (check console)   |
| Immediate close with 4003        | Configure server `ORIGIN_ALLOWLIST` or load page from allowed origin |
| Mixed content warnings           | Use `wss://` if page is served over `https://`                       |

Browser devtools console + network panel are invaluable for deeper inspection.

---

## Extending

- Add authentication: sign each outbound message with a token header via a custom upgrade handler (server change required).
- Add metrics: push connection durations / reconnect counts to an analytics endpoint.
- Add QoS: queue outbound messages while `CONNECTING` and flush on `OPEN`.
- Add square labels / tooltips (brand names) from dynamic config payloads.

---

## Roadmap Ideas (Optional)

- Configurable square count & dynamic layout.
- Offline queue + resend after reconnect.
- Visual latency indicator (round‑trip ping measurement using app‑level echo messages).
- Theming system / dark mode toggle for control UI.

---

## License

Currently unspecified – add a LICENSE file if distribution is intended.

---

## Quick Start (Summary)

1. Open `control/index.html` – connect & send a test payload.
2. Open `player/index.html` – observe square highlight when advertiser payload received.
3. (Optional) Use `connection-test.html` for endurance validation.

---

## Keyboard Shortcut

- `Ctrl+Enter` – Send message in control client.

---

## Browser Support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari). No legacy IE support.

---

## Security Note

If you deploy the static clients on a different origin than the WebSocket server and enable `ORIGIN_ALLOWLIST` server‑side, ensure the page origin is included or connections will close with code 4003.

---

Happy hacking! 🚀
