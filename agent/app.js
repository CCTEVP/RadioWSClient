// ============================================================================
// RADIO WEBSOCKET CLIENT - AGENT
// Listens to the radio room on the remote server and, for every "post",
// tells the local BroadSign player (ws://localhost:2326) to play the radio
// content now, for as long as the content's duration.
// ============================================================================

// ============================================================================
// 1. CONFIGURATION & CONSTANTS
// ============================================================================

const SERVERS = {
  prod: "wss://radiowsserver-763503917257.europe-west1.run.app/rooms/radio",
  local: "ws://localhost:8080/rooms/radio",
};

// Pick the server with ?server=local|prod (default prod). Any other URL can
// be given with ?ws=wss://...; it uses the token of ?server (default prod).
const SERVER = (() => {
  const params = new URLSearchParams(window.location.search);
  const name = Object.hasOwn(SERVERS, params.get("server") ?? "") ? params.get("server") : "prod";
  const custom = params.get("ws");
  return { name, url: custom && /^wss?:\/\//i.test(custom) ? custom : SERVERS[name] };
})();

const CONFIG = {
  WS_URL_BASE: SERVER.url,
  // One token per server (tokens only work on the server that minted them),
  // role "agent". Written by RadioWSServer/scripts/mint-client-tokens.js.
  AUTH_TOKENS: {
    local: "eyJjbGllbnRJZCI6ImFnZW50Iiwicm9vbSI6InJhZGlvIiwiZXhwaXJlc0F0IjoxODI3MzAyODc0NjE2LCJtZXRhZGF0YSI6eyJyb2xlIjoiYWdlbnQifSwiaXNzdWVkQXQiOjE3OTU3NjY4NzQ2MTZ9.S6yPMnQ2ud4Jjxxo3IcOQO4z0I_wtbsvkfNInaEQ7-o",
    prod: "",
  },
  get AUTH_TOKEN() {
    return this.AUTH_TOKENS[SERVER.name] || "";
  },
  get WS_URL() {
    return `${this.WS_URL_BASE}?token=${this.AUTH_TOKEN}`;
  },

  LOCAL_WS_URL: "ws://localhost:2326",
  LOCAL_CONNECT_TIMEOUT_MS: 4000,

  // play_now is sent with max-duration = content.duration (seconds), or this
  DEFAULT_MAX_DURATION_S: 10,
  CONTENT_NAME: "RadioContent",

  HEARTBEAT_INTERVAL: 30000,
  RECONNECT_DELAY: 3000, // grows to 15 s over the first attempts
  MAX_RECONNECT_ATTEMPTS: 20, // fast retries (~4.5 min), then slow ones
  SLOW_RECONNECT_DELAY: 60000,
};

// Shown when this app has no token for the selected server
const MISSING_TOKEN_MESSAGE = `No token for the "${SERVER.name}" server in CONFIG.AUTH_TOKENS: run RadioWSServer/scripts/mint-client-tokens.js --target ${SERVER.name}`;

// ============================================================================
// 2. STATE
// ============================================================================

const State = {
  ws: null,
  localWs: null,
  localConnecting: null, // Promise while a local connection is being opened
  heartbeatTimer: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
  isManualDisconnect: false,
  connectionStartTime: null,
  stats: { posts: 0, sent: 0, failed: 0 },

  // UI elements (cached)
  statusEl: null,
  localStatusEl: null,
  connectBtn: null,
  disconnectBtn: null,
  logsEl: null,
  payloadEl: null,
  lastTriggerEl: null,
  statEls: {},
};

function initializeDOMElements() {
  const $ = (id) => document.getElementById(id);
  State.statusEl = $("status");
  State.localStatusEl = $("localStatus");
  State.connectBtn = $("connectBtn");
  State.disconnectBtn = $("disconnectBtn");
  State.logsEl = $("logs");
  State.payloadEl = $("payloadDisplay");
  State.lastTriggerEl = $("lastTrigger");
  State.statEls = { posts: $("statPosts"), sent: $("statSent"), failed: $("statFailed") };

  const note = $("serverNote");
  if (note) note.textContent = `Server: ${CONFIG.WS_URL_BASE}`;
}

// ============================================================================
// 3. LOGGER
// ============================================================================

const Logger = {
  MAX_ENTRIES: 500,

  /**
   * @param {string} message
   * @param {string} type - info | error | received | sent | local-received
   */
  log(message, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] [${type}] ${message}`);
    if (!State.logsEl) return;

    // Built with DOM APIs (never innerHTML): messages can carry server data
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    const ts = document.createElement("span");
    ts.className = "timestamp";
    ts.textContent = `[${timestamp}]`;
    entry.append(ts, " ", String(message));

    State.logsEl.appendChild(entry);
    while (State.logsEl.childElementCount > this.MAX_ENTRIES) {
      State.logsEl.firstElementChild.remove();
    }
    State.logsEl.scrollTop = State.logsEl.scrollHeight;
  },

  clear() {
    if (State.logsEl) State.logsEl.replaceChildren();
  },
};

// ============================================================================
// 4. UI
// ============================================================================

const UI = {
  remoteStatus(state, text) {
    if (!State.statusEl) return;
    State.statusEl.className = `status ${state}`;
    State.statusEl.textContent = `Remote: ${text}`;
  },

  localStatus(state, text) {
    if (!State.localStatusEl) return;
    State.localStatusEl.className = `status ${state}`;
    State.localStatusEl.textContent = `BroadSign: ${text}`;
  },

  buttons(connected) {
    if (State.connectBtn) State.connectBtn.disabled = connected;
    if (State.disconnectBtn) State.disconnectBtn.disabled = !connected;
  },

  stats() {
    for (const [key, el] of Object.entries(State.statEls)) {
      if (el) el.textContent = String(State.stats[key]);
    }
  },

  lastTrigger(text) {
    if (State.lastTriggerEl) State.lastTriggerEl.textContent = text;
  },

  payload(payload) {
    if (State.payloadEl) State.payloadEl.textContent = JSON.stringify(payload, null, 2);
  },
};

// ============================================================================
// 5. REMOTE WEBSOCKET (radio room)
// ============================================================================

const Remote = {
  connect() {
    if (
      State.ws &&
      (State.ws.readyState === WebSocket.OPEN ||
        State.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    State.isManualDisconnect = false;
    if (!CONFIG.AUTH_TOKEN) {
      UI.remoteStatus("disconnected", "no token");
      Logger.log(MISSING_TOKEN_MESSAGE, "error");
      return;
    }
    UI.remoteStatus("connecting", "connecting…");
    Logger.log(`Connecting to ${CONFIG.WS_URL_BASE}…`);

    try {
      State.ws = new WebSocket(CONFIG.WS_URL);
    } catch (error) {
      Logger.log(`Failed to connect: ${error.message}`, "error");
      this.scheduleReconnect();
      return;
    }

    State.ws.onopen = () => {
      clearTimeout(State.reconnectTimer);
      State.reconnectAttempts = 0;
      State.connectionStartTime = Date.now();
      Logger.log("Connected to the radio room");
      UI.remoteStatus("connected", "connected");
      UI.buttons(true);
      this.startHeartbeat();
      this.announcePresence();
    };

    State.ws.onmessage = (event) => this.handleMessage(event.data);

    State.ws.onerror = () => {
      Logger.log("Remote WebSocket error", "error");
    };

    State.ws.onclose = (event) => {
      this.stopHeartbeat();
      Logger.log(
        `Remote connection closed (code ${event.code}${
          event.reason ? `, ${event.reason}` : ""
        })`
      );
      if (State.connectionStartTime) {
        const seconds = Math.round((Date.now() - State.connectionStartTime) / 1000);
        Logger.log(`Connection lasted ${seconds}s`);
        State.connectionStartTime = null;
      }
      UI.buttons(false);
      State.ws = null;

      if (State.isManualDisconnect) {
        UI.remoteStatus("disconnected", "offline");
      } else if (event.code === 4001 || event.code === 4002 || event.code === 4004) {
        // Auth problems will not fix themselves by retrying
        UI.remoteStatus("disconnected", "rejected");
        Logger.log("Token rejected by the server; not reconnecting", "error");
      } else {
        this.scheduleReconnect();
      }
    };
  },

  scheduleReconnect() {
    clearTimeout(State.reconnectTimer);
    State.reconnectAttempts++;
    const fast = State.reconnectAttempts <= CONFIG.MAX_RECONNECT_ATTEMPTS;
    const delay = fast
      ? CONFIG.RECONNECT_DELAY * Math.min(State.reconnectAttempts, 5)
      : CONFIG.SLOW_RECONNECT_DELAY;
    UI.remoteStatus("connecting", `retry in ${delay / 1000}s`);
    Logger.log(`Reconnecting in ${delay / 1000}s (attempt ${State.reconnectAttempts})`);
    State.reconnectTimer = setTimeout(() => {
      if (!State.isManualDisconnect) this.connect();
    }, delay);
  },

  startHeartbeat() {
    this.stopHeartbeat();
    State.heartbeatTimer = setInterval(() => {
      if (State.ws?.readyState === WebSocket.OPEN) {
        State.ws.send(
          JSON.stringify({ type: "keepalive", timestamp: new Date().toISOString(), clientId: "agent" })
        );
      }
    }, CONFIG.HEARTBEAT_INTERVAL);
  },

  stopHeartbeat() {
    clearInterval(State.heartbeatTimer);
    State.heartbeatTimer = null;
  },

  announcePresence() {
    const announcement = {
      type: "announce",
      timestamp: new Date().toISOString(),
      clientId: "agent",
      userAgent: navigator.userAgent,
      location: { href: location.href },
    };
    try {
      State.ws.send(JSON.stringify(announcement));
      Logger.log("Announce sent", "sent");
    } catch (e) {
      Logger.log(`Failed to send announce: ${e.message}`, "error");
    }
  },

  handleMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      Logger.log(`Ignored non-JSON message: ${String(raw).slice(0, 200)}`, "received");
      return;
    }

    if (data.type === "welcome") {
      Logger.log(`Server: ${data.message}`, "received");
      return;
    }
    if (data.type === "ack") return; // keepalive acknowledgements

    // Unwrap the broadcast envelope used for messages sent over WebSocket
    const inner = data.type === "broadcast" && data.data && typeof data.data === "object" ? data.data : data;
    if (inner?.type !== "post") return; // only posts trigger BroadSign

    State.stats.posts++;
    UI.stats();
    const content = inner.data?.content || {};
    Logger.log(
      `Post received: ${content.name || "unnamed content"}${
        content.duration ? ` (${content.duration}s)` : ""
      }`,
      "received"
    );
    Bridge.trigger(content, "post");
  },

  disconnect() {
    State.isManualDisconnect = true;
    clearTimeout(State.reconnectTimer);
    this.stopHeartbeat();
    if (State.ws) State.ws.close(1000, "User initiated disconnect");
    UI.remoteStatus("disconnected", "offline");
  },
};

// ============================================================================
// 6. LOCAL BROADSIGN WEBSOCKET (port 2326)
// ============================================================================

const Local = {
  /** Resolve with an open local socket, opening one if needed */
  ensureOpen() {
    if (State.localWs?.readyState === WebSocket.OPEN) return Promise.resolve(State.localWs);
    if (State.localConnecting) return State.localConnecting;

    UI.localStatus("connecting", "connecting…");
    State.localConnecting = new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        State.localConnecting = null;
        fn(value);
      };
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        done(reject, new Error(`no answer from ${CONFIG.LOCAL_WS_URL} within ${CONFIG.LOCAL_CONNECT_TIMEOUT_MS / 1000}s`));
      }, CONFIG.LOCAL_CONNECT_TIMEOUT_MS);

      let ws;
      try {
        ws = new WebSocket(CONFIG.LOCAL_WS_URL);
      } catch (error) {
        done(reject, error);
        return;
      }
      State.localWs = ws;

      let opened = false;
      ws.onopen = () => {
        opened = true;
        UI.localStatus("connected", "connected");
        Logger.log(`Connected to BroadSign at ${CONFIG.LOCAL_WS_URL}`);
        done(resolve, ws);
      };
      ws.onmessage = (event) => this.handleMessage(event.data);
      ws.onerror = () => {
        done(reject, new Error(`cannot reach ${CONFIG.LOCAL_WS_URL} (is the BroadSign player running?)`));
      };
      ws.onclose = () => {
        if (State.localWs === ws) State.localWs = null;
        // A failed attempt keeps its "unreachable" status; only a connection
        // that was actually open drops back to idle
        if (opened) UI.localStatus("idle", "idle");
        done(reject, new Error("local connection closed"));
      };
    });
    return State.localConnecting;
  },

  async send(payload) {
    const ws = await this.ensureOpen();
    ws.send(JSON.stringify(payload));
  },

  handleMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      Logger.log(`BroadSign: ${raw}`, "local-received");
      return;
    }
    const rc = data?.rc;
    const ok = rc && String(rc.status) === "1";
    Logger.log(
      `BroadSign ${rc?.action || "response"}: ${ok ? "OK" : "status " + (rc?.status ?? "?")}`,
      ok ? "local-received" : "error"
    );
  },

  disconnect() {
    if (State.localWs) State.localWs.close(1000, "User initiated disconnect");
    State.localWs = null;
    UI.localStatus("idle", "idle");
  },
};

// ============================================================================
// 7. BRIDGE (post -> BroadSign play_now)
// ============================================================================

const Bridge = {
  /** Seconds to play: content.duration when valid, otherwise the default */
  maxDurationSeconds(content) {
    const seconds = Number(content?.duration);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : CONFIG.DEFAULT_MAX_DURATION_S;
  },

  buildPayload(content) {
    return {
      rc: {
        version: "1",
        id: String(Date.now()),
        action: "play_now",
        name: CONFIG.CONTENT_NAME,
        "max-duration": String(this.maxDurationSeconds(content)),
      },
    };
  },

  async trigger(content, source) {
    const payload = this.buildPayload(content);
    UI.payload(payload);
    const label = content?.name || (source === "test" ? "test trigger" : "unnamed content");
    const time = new Date().toLocaleTimeString();

    try {
      await Local.send(payload);
      State.stats.sent++;
      Logger.log(`play_now sent to BroadSign for ${payload.rc["max-duration"]}s (${label})`, "sent");
      UI.lastTrigger(`Last: ${label}, ${payload.rc["max-duration"]}s at ${time}`);
    } catch (error) {
      State.stats.failed++;
      Logger.log(`Could not send play_now: ${error.message}`, "error");
      UI.lastTrigger(`Failed at ${time}: ${error.message}`);
      UI.localStatus("disconnected", "unreachable");
    }
    UI.stats();
  },
};

// ============================================================================
// 8. PUBLIC API
// ============================================================================

function connect() {
  Remote.connect();
}

function disconnect() {
  Remote.disconnect();
  Local.disconnect();
}

/** Send play_now to BroadSign without waiting for a post */
function testTrigger() {
  Logger.log("Manual test trigger");
  Bridge.trigger({ name: "Test trigger" }, "test");
}

function clearLogs() {
  Logger.clear();
}

window.addEventListener("load", () => {
  initializeDOMElements();
  UI.stats();
  Logger.log("Agent starting; connecting to the radio room…");
  connect();
});

window.connect = connect;
window.disconnect = disconnect;
window.testTrigger = testTrigger;
window.clearLogs = clearLogs;
