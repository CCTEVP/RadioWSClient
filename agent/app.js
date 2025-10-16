// ============================================================================
// RADIO WEBSOCKET CLIENT - AGENT
// Listens to remote WebSocket and triggers local WebSocket actions
// ============================================================================

// ============================================================================
// 1. CONFIGURATION & CONSTANTS
// ============================================================================

const CONFIG = {
  WS_URL_BASE:
    "wss://radiowsserver-763503917257.europe-west1.run.app/room/radio",
  //WS_URL_BASE: "ws://localhost:8080/room/radio",
  AUTH_TOKEN:
    "eyJjbGllbnRJZCI6InNjcmVlbiIsInJvb20iOiJyYWRpbyIsImV4cGlyZXNBdCI6NDkxNDEyMTU2NjQ2NCwibWV0YWRhdGEiOnsidmFsaWRpdHkiOiJObyBleHBpcmF0aW9uIn0sImlzc3VlZEF0IjoxNzYwNTIxNTY2NDY0fQ.1tMYGVIeJl5zPxOclrPWHieEognJGWDaq4-vzjziNi0",
  get WS_URL() {
    return `${this.WS_URL_BASE}?token=${this.AUTH_TOKEN}`;
  },
  LOCAL_WS_URL: "ws://localhost:2326",
  RADIO_CONTENT_PAYLOAD: {
    rc: {
      version: "1",
      id: "1",
      action: "play_now",
      name: "RadioContent",
      "max-duration": "10",
    },
  },
};

// ============================================================================
// 2. STATE MANAGEMENT
// ============================================================================

const State = {
  ws: null,
  localWs: null,

  // UI Elements (cached)
  statusEl: null,
  connectBtn: null,
  disconnectBtn: null,
  logsEl: null,
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
  State.logsEl = document.getElementById("logs");
}

// ============================================================================
// 4. LOGGER MODULE
// ============================================================================

const Logger = {
  /**
   * Logs a message to the UI and console
   * @param {string} message - Log message
   * @param {string} type - Log type (info, error, received, sent, local-received)
   */
  log(message, type = "info") {
    // Always log to console
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] [${type}] ${message}`);

    // Also log to UI if element exists
    if (!State.logsEl) return;

    const logEntry = document.createElement("div");
    logEntry.className = `log-entry ${type}`;

    logEntry.innerHTML = `
      <span class="timestamp">[${timestamp}]</span> ${message}
    `;

    State.logsEl.appendChild(logEntry);
    State.logsEl.scrollTop = State.logsEl.scrollHeight;
  },

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
  },
};

// ============================================================================
// 6. REMOTE WEBSOCKET MODULE
// ============================================================================

const RemoteWebSocketController = {
  /**
   * Connects to remote WebSocket server
   */
  connect() {
    if (State.ws && State.ws.readyState === WebSocket.OPEN) {
      Logger.log("Already connected to remote server!", "info");
      return;
    }

    UIController.updateStatus("connecting", "Connecting to remote server...");
    Logger.log(`Connecting to ${CONFIG.WS_URL}...`, "info");

    try {
      State.ws = new WebSocket(CONFIG.WS_URL);

      State.ws.onopen = () => {
        Logger.log("Connected to remote WebSocket server", "info");
        UIController.updateStatus("connected", "Connected to remote server");
        UIController.updateButtons(true);
        this.announcePresence("agent");
      };

      State.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      State.ws.onclose = (event) => {
        const reason = event.wasClean
          ? "Remote connection closed cleanly"
          : "Remote connection lost";
        Logger.log(
          `${reason} (Code: ${event.code}, Reason: ${
            event.reason || "No reason provided"
          })`,
          "info"
        );
        UIController.updateStatus(
          "disconnected",
          "Disconnected from remote server"
        );
        UIController.updateButtons(false);
      };

      State.ws.onerror = (error) => {
        Logger.log("Remote WebSocket error occurred", "error");
        console.error("Remote WebSocket error:", error);
      };
    } catch (error) {
      Logger.log(
        `Failed to connect to remote server: ${error.message}`,
        "error"
      );
      UIController.updateStatus("disconnected", "Remote connection failed");
      UIController.updateButtons(false);
    }
  },

  /**
   * Announces presence to remote server
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
   * Handles incoming messages from remote server
   * @param {string} rawData - Raw message data
   */
  handleMessage(rawData) {
    let data;
    try {
      data = JSON.parse(rawData);
    } catch (e) {
      Logger.log(
        `Received non-JSON remote message ignored: ${rawData}`,
        "received"
      );
      return;
    }

    // Unwrap broadcast envelope if present
    let inner = data;
    if (
      data &&
      data.type === "broadcast" &&
      data.data &&
      typeof data.data === "object"
    ) {
      inner = data.data;
    }

    // Log the raw remote message
    Logger.log(
      `Received from remote: ${JSON.stringify(data, null, 2)}`,
      "received"
    );

    // Only react when the (possibly unwrapped) message is a post
    if (inner && inner.type === "post") {
      Logger.log(
        "Trigger: 'post' message received - ensuring local WebSocket communication",
        "info"
      );
      this.handlePostMessage(inner);
    }
  },

  /**
   * Handles post-type messages
   * @param {object} postMessage - Post message data
   */
  handlePostMessage(postMessage) {
    Logger.log(
      "Post message received - connecting to local WebSocket if needed...",
      "info"
    );
    LocalWebSocketController.connectAndSend();
  },

  /**
   * Disconnects from remote server
   */
  disconnect() {
    if (State.ws) {
      State.ws.close(1000, "User initiated disconnect");
      State.ws = null;
    }
  },
};

// ============================================================================
// 7. LOCAL WEBSOCKET MODULE
// ============================================================================

const LocalWebSocketController = {
  /**
   * Connects to local WebSocket and sends payload
   */
  connectAndSend() {
    if (State.localWs && State.localWs.readyState === WebSocket.OPEN) {
      // If already connected, just send the payload
      this.sendPayload();
      return;
    }

    Logger.log(
      `Connecting to local WebSocket at ${CONFIG.LOCAL_WS_URL}...`,
      "info"
    );

    try {
      State.localWs = new WebSocket(CONFIG.LOCAL_WS_URL);

      State.localWs.onopen = () => {
        Logger.log("Connected to local WebSocket server", "info");
        // Send the radio content payload immediately upon connection
        this.sendPayload();
      };

      State.localWs.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      State.localWs.onclose = (event) => {
        const reason = event.wasClean
          ? "Local connection closed cleanly"
          : "Local connection lost";
        Logger.log(
          `${reason} (Code: ${event.code}, Reason: ${
            event.reason || "No reason provided"
          })`,
          "info"
        );
      };

      State.localWs.onerror = (error) => {
        Logger.log("Local WebSocket error occurred", "error");
        console.error("Local WebSocket error:", error);
      };
    } catch (error) {
      Logger.log(
        `Failed to connect to local server: ${error.message}`,
        "error"
      );
    }
  },

  /**
   * Sends radio content payload to local WebSocket
   */
  sendPayload() {
    if (!State.localWs || State.localWs.readyState !== WebSocket.OPEN) {
      Logger.log(
        "Local WebSocket not connected - cannot send payload",
        "error"
      );
      return;
    }

    try {
      const payloadString = JSON.stringify(CONFIG.RADIO_CONTENT_PAYLOAD);
      State.localWs.send(payloadString);
      Logger.log(
        `Sent to local WebSocket: ${JSON.stringify(
          CONFIG.RADIO_CONTENT_PAYLOAD,
          null,
          2
        )}`,
        "sent"
      );
    } catch (error) {
      Logger.log(
        `Failed to send payload to local WebSocket: ${error.message}`,
        "error"
      );
    }
  },

  /**
   * Handles messages from local WebSocket
   * @param {string} rawData - Raw message data
   */
  handleMessage(rawData) {
    try {
      const data = JSON.parse(rawData);
      Logger.log(
        `Received from local: ${JSON.stringify(data, null, 2)}`,
        "local-received"
      );
    } catch (e) {
      Logger.log(`Received from local: ${rawData}`, "local-received");
    }
  },

  /**
   * Disconnects from local server
   */
  disconnect() {
    if (State.localWs) {
      State.localWs.close(1000, "User initiated disconnect");
      State.localWs = null;
    }
  },
};

// ============================================================================
// 8. PUBLIC API
// ============================================================================

/**
 * Connects to remote WebSocket
 */
function connect() {
  RemoteWebSocketController.connect();
}

/**
 * Disconnects from both remote and local WebSockets
 */
function disconnect() {
  RemoteWebSocketController.disconnect();
  LocalWebSocketController.disconnect();
}

/**
 * Clears the log display
 */
function clearLogs() {
  Logger.clear();
}

// ============================================================================
// 9. INITIALIZATION
// ============================================================================

/**
 * Initialize application on page load
 */
window.addEventListener("load", () => {
  initializeDOMElements();
  Logger.log("Agent starting - auto-connecting to remote server...", "info");
  connect();
});

// Expose public functions to window
window.connect = connect;
window.disconnect = disconnect;
window.clearLogs = clearLogs;
