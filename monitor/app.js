// ============================================================================
// RADIO WEBSOCKET CLIENT - CONTROL
// Control panel for testing WebSocket messages
// ============================================================================

// ============================================================================
// 1. CONFIGURATION & CONSTANTS
// ============================================================================

const SERVERS = {
  prod: "wss://radiowsserver-763503917257.europe-west1.run.app/rooms/radio",
  local: "ws://localhost:8080/rooms/radio",
};

// Pick the server with ?server=local|prod (default local)
const SERVER = (() => {
  const params = new URLSearchParams(window.location.search);
  const name = Object.hasOwn(SERVERS, params.get("server") ?? "") ? params.get("server") : "local";
  return { name, url: SERVERS[name] };
})();

const CONFIG = {
  WS_URL_BASE: SERVER.url,
  // One token per server (tokens only work on the server that minted them),
  // role "control". Written by RadioWSServer/scripts/mint-client-tokens.js.
  AUTH_TOKENS: {
    local: "eyJjbGllbnRJZCI6Im1vbml0b3IiLCJyb29tIjoicmFkaW8iLCJleHBpcmVzQXQiOjE4MjczMDI4NzQ2MDEsIm1ldGFkYXRhIjp7InJvbGUiOiJjb250cm9sIn0sImlzc3VlZEF0IjoxNzk1NzY2ODc0NjAxfQ.I8OAGXCgiOsaST-6Izq7ucPdBtbmX01mhxpDMVK_CbE",
    prod: "",
  },
  get AUTH_TOKEN() {
    return this.AUTH_TOKENS[SERVER.name] || "";
  },
  get WS_URL() {
    return `${this.WS_URL_BASE}?token=${this.AUTH_TOKEN}`;
  },
  // Posts go over HTTP to the same room ("ws://host/rooms/radio" ->
  // "http://host/rooms/radio/post") with the same token: its role (control)
  // may post.
  get POST_URL() {
    return `${this.WS_URL_BASE.replace(/^ws/, "http")}/post`;
  },
  HEARTBEAT_INTERVAL: 30000, // 30 seconds
  RECONNECT_DELAY: 3000, // 3 seconds (grows to 15s over the first attempts)
  MAX_RECONNECT_ATTEMPTS: 20, // Fast retries (~4.5 minutes total)
  SLOW_RECONNECT_DELAY: 60000, // After fast retries, keep trying every 60s
};

// Shown when this app has no token for the selected server
const MISSING_TOKEN_MESSAGE = `No token for the "${SERVER.name}" server in CONFIG.AUTH_TOKENS: run RadioWSServer/scripts/mint-client-tokens.js --target ${SERVER.name}`;

// ============================================================================
// 2. STATE MANAGEMENT
// ============================================================================

const State = {
  ws: null,
  heartbeatTimer: null,
  reconnectTimer: null,
  isManualDisconnect: false,
  connectionStartTime: null,
  reconnectAttempts: 0,

  // UI Elements (cached)
  statusEl: null,
  connectBtn: null,
  disconnectBtn: null,
  sendBtn: null,
  messageInput: null,
  logsEl: null,
  countdownEl: null,
};

// ============================================================================
// 3. UTILITY FUNCTIONS
// ============================================================================

/**
 * Initialize DOM element references
 */
function initializeDOMElements() {
  State.statusEl = document.getElementById("status");
  State.connectBtn = document.getElementById("connectBtn");
  State.disconnectBtn = document.getElementById("disconnectBtn");
  State.sendBtn = document.getElementById("sendBtn");
  State.messageInput = document.getElementById("messageInput");
  State.logsEl = document.getElementById("logs");
  State.countdownEl = document.getElementById("delayCountdowns");
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Handle Ctrl+Enter in textarea to send message
  if (State.messageInput) {
    State.messageInput.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.key === "Enter") {
        sendMessage();
      }
    });
  }
}

// ============================================================================
// 4. LOGGER MODULE
// ============================================================================

const Logger = {
  /**
   * Logs a message to the UI and console
   * @param {string} message - Log message
   * @param {string} type - Log type (info, error, received, sent)
   */
  log(message, type = "info") {
    // Always log to console
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] [${type}] ${message}`);

    // Also log to UI if element exists
    if (!State.logsEl) return;

    const logEntry = document.createElement("div");
    logEntry.className = `log-entry ${type}`;

    // Build with DOM APIs (not innerHTML): messages can carry raw server data,
    // which must be displayed as text, never parsed as markup
    const timestampEl = document.createElement("span");
    timestampEl.className = "timestamp";
    timestampEl.textContent = `[${timestamp}]`;
    logEntry.append(timestampEl, " ", String(message));

    State.logsEl.appendChild(logEntry);
    // Drop the oldest entries so the DOM doesn't grow without bound
    while (State.logsEl.childElementCount > Logger.MAX_ENTRIES) {
      State.logsEl.firstElementChild.remove();
    }
    State.logsEl.scrollTop = State.logsEl.scrollHeight;
  },

  MAX_ENTRIES: 500,

  /**
   * Clears all logs
   */
  clear() {
    if (State.logsEl) {
      State.logsEl.innerHTML = "";
    }
  },
};

// ============================================================================
// 5. UI CONTROLLER
// ============================================================================

const UIController = {
  /**
   * Updates connection status display
   * @param {string} status - Status class (connecting, connected, disconnected)
   * @param {string} text - Status text to display
   */
  updateStatus(status, text) {
    if (!State.statusEl) return;
    State.statusEl.className = `status ${status}`;
    State.statusEl.textContent = text;
  },

  /**
   * Updates button states based on connection
   * @param {boolean} connected - Whether connected or not
   */
  updateButtons(connected) {
    if (State.connectBtn) State.connectBtn.disabled = connected;
    if (State.disconnectBtn) State.disconnectBtn.disabled = !connected;
    // Send posts over HTTP with the posting token, so it does not depend on
    // the monitor's WebSocket connection (it stays enabled)
  },
};

// ============================================================================
// 6. WEBSOCKET MODULE
// ============================================================================

const WebSocketController = {
  /**
   * Establishes WebSocket connection
   */
  connect() {
    if (State.ws && State.ws.readyState === WebSocket.OPEN) {
      Logger.log("Already connected!", "info");
      return;
    }

    if (!CONFIG.AUTH_TOKEN) {
      UIController.updateStatus("disconnected", "No token");
      Logger.log(MISSING_TOKEN_MESSAGE, "error");
      return;
    }
    UIController.updateStatus("connecting", "Connecting...");
    Logger.log(`Connecting to ${CONFIG.WS_URL_BASE}...`, "info");

    try {
      State.ws = new WebSocket(CONFIG.WS_URL);

      State.ws.onopen = () => {
        Logger.log("Connected to WebSocket server", "info");
        UIController.updateStatus("connected", "Connected");
        UIController.updateButtons(true);

        // Reset reconnection attempts on successful connection
        State.reconnectAttempts = 0;
        State.connectionStartTime = Date.now();

        this.startHeartbeat();
        this.announcePresence("control");
      };

      State.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      State.ws.onerror = (error) => {
        Logger.log("WebSocket error occurred", "error");
        console.error("WebSocket error:", error);
      };

      State.ws.onclose = (event) => {
        const reason = event.wasClean
          ? "Connection closed cleanly"
          : "Connection lost";
        Logger.log(
          `${reason} (Code: ${event.code}, Reason: ${
            event.reason || "No reason provided"
          })`,
          "info",
        );

        this.stopHeartbeat();

        // Show connection time if it was established
        if (State.connectionStartTime) {
          const connectionDuration = Math.round(
            (Date.now() - State.connectionStartTime) / 1000,
          );
          Logger.log(`Connection lasted ${connectionDuration} seconds`, "info");
        }

        UIController.updateStatus("disconnected", "Disconnected");
        UIController.updateButtons(false);

        // Auto-reconnect unless the user disconnected manually. After the fast
        // retries are used up, keep retrying slowly instead of giving up, so
        // an outage longer than a few minutes still recovers on its own.
        if (!State.isManualDisconnect) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      Logger.log(`Failed to connect: ${error.message}`, "error");
      UIController.updateStatus("disconnected", "Connection Failed");
      UIController.updateButtons(false);
    }
  },

  /**
   * Handles incoming messages
   * @param {string} rawData - Raw message data
   */
  handleMessage(rawData) {
    try {
      const data = JSON.parse(rawData);

      // Handle different message types from server
      if (data.type === "welcome") {
        Logger.log(`Server welcome: ${data.message}`, "info");
      } else if (data.type === "broadcast") {
        Logger.log(
          `Broadcast from ${data.from}: ${JSON.stringify(data.data, null, 2)}`,
          "received",
        );
      } else {
        Logger.log(`Received: ${JSON.stringify(data, null, 2)}`, "received");
      }
    } catch (e) {
      // If not JSON, log as plain text
      Logger.log(`Received: ${rawData}`, "received");
    }
  },

  /**
   * Announces presence to server
   * @param {string} role - Client role identifier
   */
  announcePresence(role) {
    if (!State.ws || State.ws.readyState !== WebSocket.OPEN) return;

    const announcement = {
      type: "announce",
      timestamp: new Date().toISOString(),
      clientId: role,
      userAgent: navigator.userAgent,
      screen: {
        width: window.screen?.width || null,
        height: window.screen?.height || null,
      },
      pageVisibility: document.visibilityState,
      location: { href: location.href },
    };

    try {
      State.ws.send(JSON.stringify(announcement));
      Logger.log("Announce sent: " + JSON.stringify(announcement), "sent");
    } catch (e) {
      Logger.log("Failed to send announce: " + e.message, "error");
    }
  },

  /**
   * Posts a message to the room over HTTP with the posting token. (The
   * monitor's own WebSocket token is published and can only receive.)
   * @param {string} message - JSON message to send
   * @returns {Promise<boolean>} true when the server accepted it (202)
   */
  async send(message) {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      Logger.log("Please enter a message to send", "error");
      return false;
    }

    let jsonData;
    try {
      jsonData = JSON.parse(trimmedMessage);
    } catch (error) {
      Logger.log(`Invalid JSON: ${error.message}`, "error");
      return false;
    }

    if (!CONFIG.AUTH_TOKEN) {
      Logger.log(MISSING_TOKEN_MESSAGE, "error");
      return false;
    }

    try {
      const response = await fetch(CONFIG.POST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CONFIG.AUTH_TOKEN}`,
        },
        body: trimmedMessage,
      });
      const result = await response.json().catch(() => ({}));

      if (response.status === 202) {
        Logger.log(`Sent: ${JSON.stringify(jsonData, null, 2)}`, "sent");
        DelayCountdown.track(jsonData);
        return true;
      }

      const reasons = {
        401: "the posting token is invalid or expired",
        403: "this token's role is not allowed to post",
      };
      const detail = result.details ? ` (${result.details.join("; ")})` : "";
      Logger.log(
        `Not sent (HTTP ${response.status}): ${reasons[response.status] || result.error || "rejected by server"}${detail}`,
        "error"
      );
      return false;
    } catch (error) {
      Logger.log(`Not sent: cannot reach ${CONFIG.POST_URL} (${error.message})`, "error");
      return false;
    }
  },

  /**
   * Starts heartbeat interval
   */
  startHeartbeat() {
    this.stopHeartbeat(); // Clear any existing heartbeat

    State.heartbeatTimer = setInterval(() => {
      if (State.ws && State.ws.readyState === WebSocket.OPEN) {
        try {
          const keepAlive = JSON.stringify({
            type: "keepalive",
            timestamp: new Date().toISOString(),
            clientId: "control",
          });
          State.ws.send(keepAlive);
          Logger.log("Keepalive sent", "info");
        } catch (error) {
          Logger.log(`Failed to send keepalive: ${error.message}`, "error");
        }
      }
    }, CONFIG.HEARTBEAT_INTERVAL);
  },

  /**
   * Stops heartbeat interval
   */
  stopHeartbeat() {
    if (State.heartbeatTimer) {
      clearInterval(State.heartbeatTimer);
      State.heartbeatTimer = null;
    }
  },

  /**
   * Schedules reconnection with exponential backoff
   */
  scheduleReconnect() {
    clearTimeout(State.reconnectTimer);
    State.reconnectAttempts++;

    const fastPhase = State.reconnectAttempts <= CONFIG.MAX_RECONNECT_ATTEMPTS;
    const delay = fastPhase
      ? CONFIG.RECONNECT_DELAY * Math.min(State.reconnectAttempts, 5)
      : CONFIG.SLOW_RECONNECT_DELAY;
    const attemptLabel = fastPhase
      ? `${State.reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS}`
      : `${State.reconnectAttempts}, slow retry`;

    if (State.reconnectAttempts === CONFIG.MAX_RECONNECT_ATTEMPTS + 1) {
      Logger.log(
        `Fast reconnection attempts used up; retrying every ${
          CONFIG.SLOW_RECONNECT_DELAY / 1000
        }s`,
        "error",
      );
    }
    Logger.log(
      `Reconnection attempt ${attemptLabel} in ${delay / 1000}s...`,
      "info",
    );
    UIController.updateStatus(
      "connecting",
      `Reconnecting... (${attemptLabel})`,
    );

    State.reconnectTimer = setTimeout(() => {
      if (!State.isManualDisconnect) {
        this.connect();
      }
    }, delay);
  },

  /**
   * Manually disconnects WebSocket
   */
  disconnect() {
    if (State.ws) {
      State.isManualDisconnect = true;
      this.stopHeartbeat();
      clearTimeout(State.reconnectTimer);
      State.ws.close(1000, "User initiated disconnect");
      State.ws = null;
      State.connectionStartTime = null;

      // Reset manual disconnect flag after a delay
      setTimeout(() => {
        State.isManualDisconnect = false;
      }, 1000);
    }
  },
};

// ============================================================================
// 6b. DELAY COUNTDOWN
// Shows one small timer per sent post, next to "Send JSON message". Each
// badge has up to two phases:
//   1. amber  "⏱ Ns": time until the post is broadcast (its delay); skipped
//                     when the post has no delay (or delay 0)
//   2. blue   "▶ Ns": time the content stays on screen (content.duration),
//                     then it fades out
// Badges are only added after the server accepted the post (202), so
// data.content.duration and data.content.delay are known to be valid. The
// server never echoes a broadcast back to its sender, so both phases are
// timed from the send.
// ============================================================================

const DelayCountdown = {
  MAX_BADGES: 6, // beyond this, the rest are summarised as "+N"
  FADE_MS: 600, // must match the .countdown opacity transition
  entries: [], // { id, due, playEnd, label, el }, kept soonest first
  nextId: 1,
  tickTimer: null,
  moreEl: null,
  lastOrder: "",

  /** Seconds on screen: data.content.duration (required by the server) */
  contentDurationSeconds(message) {
    return Number(message.data.content.duration);
  },

  /** Seconds before broadcast: data.content.delay, 0 when not declared */
  declaredDelaySeconds(message) {
    const { delay } = message.data.content;
    return delay === undefined ? 0 : Number(delay);
  },

  /**
   * Add a badge for a post that was just sent. Delayed posts start in the
   * amber phase; posts without a delay go straight to the blue duration
   * phase. Other message types get no badge.
   */
  track(message) {
    if (!message || String(message.type).toLowerCase() !== "post") return;
    const seconds = this.declaredDelaySeconds(message);

    const name = message.data?.content?.name;
    const durationSeconds = this.contentDurationSeconds(message);
    const due = Date.now() + seconds * 1000;
    this.entries.push({
      id: this.nextId++,
      due,
      playEnd: due + durationSeconds * 1000,
      label: name ? String(name) : "Post",
      el: null,
    });
    this.entries.sort((a, b) => a.due - b.due);
    const quoted = name ? ` "${name}"` : "";
    Logger.log(
      seconds > 0
        ? `Delayed post${quoted}: broadcast in ${seconds}s, then on screen for ${durationSeconds}s`
        : `Post${quoted}: on screen for ${durationSeconds}s`,
      "info"
    );

    this.render();
    if (!this.tickTimer) {
      this.tickTimer = setInterval(() => this.render(), 250);
    }
  },

  format(totalSeconds) {
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  },

  render() {
    const container = State.countdownEl;
    if (!container) return;

    const now = Date.now();
    // Remove entries whose fade-out has finished
    this.entries = this.entries.filter(
      (entry) => now < entry.playEnd + this.FADE_MS
    );

    const shown = this.entries.slice(0, this.MAX_BADGES);
    const hidden = this.entries.length - shown.length;

    // Update each badge in place (re-creating them every tick would cancel
    // the colour change and fade transitions)
    for (const entry of shown) {
      if (!entry.el) {
        entry.el = document.createElement("span");
        entry.el.setAttribute("role", "timer");
      }
      const el = entry.el;

      if (now < entry.due) {
        const remaining = Math.ceil((entry.due - now) / 1000);
        el.className = "countdown";
        el.textContent = `⏱ ${this.format(remaining)}`;
        el.title = `${entry.label}: broadcast in ${remaining}s`;
      } else if (now < entry.playEnd) {
        const remaining = Math.ceil((entry.playEnd - now) / 1000);
        el.className = "countdown playing";
        el.textContent = `▶ ${this.format(remaining)}`;
        el.title = `${entry.label}: on screen for ${remaining}s more`;
      } else {
        el.className = "countdown playing fading";
        el.title = `${entry.label}: finished`;
      }
    }

    if (hidden > 0) {
      if (!this.moreEl) {
        this.moreEl = document.createElement("span");
        this.moreEl.className = "countdown more";
      }
      this.moreEl.textContent = `+${hidden}`;
      this.moreEl.title = `${hidden} more post${hidden === 1 ? "" : "s"} in progress`;
    }

    // Only touch the DOM order when the set of visible badges changes
    const order = shown.map((entry) => entry.id).join(",") + (hidden > 0 ? ",+" : "");
    if (order !== this.lastOrder) {
      const nodes = shown.map((entry) => entry.el);
      if (hidden > 0) nodes.push(this.moreEl);
      container.replaceChildren(...nodes);
      this.lastOrder = order;
    }

    if (this.entries.length === 0) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  },
};

// ============================================================================
// 7. PUBLIC API
// ============================================================================

/**
 * Connects to WebSocket server
 */
function connect() {
  WebSocketController.connect();
}

/**
 * Disconnects from WebSocket server
 */
function disconnect() {
  WebSocketController.disconnect();
}

/**
 * Sends a message from the input field
 */
function sendMessage() {
  if (!State.messageInput) return;
  WebSocketController.send(State.messageInput.value);
}

/**
 * Clears the log display
 */
function clearLogs() {
  Logger.clear();
}

/**
 * BroadSignPlay function that also connects to WebSocket
 */
function BroadSignPlay() {
  Logger.log(
    "BroadSignPlay() called - initiating WebSocket connection",
    "info",
  );
  State.isManualDisconnect = false;
  State.reconnectAttempts = 0;
  connect();
}

// ============================================================================
// 8. INITIALIZATION
// ============================================================================

/**
 * Initialize application on page load
 */
window.addEventListener("load", () => {
  initializeDOMElements();
  setupEventListeners();
});

// Expose public functions to window
window.connect = connect;
window.disconnect = disconnect;
window.sendMessage = sendMessage;
window.clearLogs = clearLogs;
window.BroadSignPlay = BroadSignPlay;
