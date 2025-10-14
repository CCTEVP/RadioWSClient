// ============================================================================
// RADIO WEBSOCKET CLIENT - CONTROL
// Control panel for testing WebSocket messages
// ============================================================================

// ============================================================================
// 1. CONFIGURATION & CONSTANTS
// ============================================================================

const CONFIG = {
  //WS_URL_BASE: "wss://radiowsserver-763503917257.europe-west1.run.app/",
  WS_URL_BASE: "ws://localhost:8080/room/radio",
  AUTH_TOKEN:
    "eyJjbGllbnRJZCI6InRlc3QtY2xpZW50Iiwicm9vbSI6InJhZGlvIiwiZXhwaXJlc0F0Ijo0OTE0MDUzNDM1NjAwLCJtZXRhZGF0YSI6e30sImlzc3VlZEF0IjoxNzYwNDUzNDM1NjAwfQ.xiGw5MKTrsQhonWc8NFVJv6WiYXNUtBF52fBSmDF8J8",
  get WS_URL() {
    return `${this.WS_URL_BASE}?token=${this.AUTH_TOKEN}`;
  },
  HEARTBEAT_INTERVAL: 30000, // 30 seconds
  RECONNECT_DELAY: 3000, // 3 seconds
  MAX_RECONNECT_ATTEMPTS: 20, // Allow reconnection for ~1 hour
};

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
   * Logs a message to the UI
   * @param {string} message - Log message
   * @param {string} type - Log type (info, error, received, sent)
   */
  log(message, type = "info") {
    if (!State.logsEl) return;

    const logEntry = document.createElement("div");
    logEntry.className = `log-entry ${type}`;

    const timestamp = new Date().toLocaleTimeString();
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
    if (State.sendBtn) State.sendBtn.disabled = !connected;
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

    UIController.updateStatus("connecting", "Connecting...");
    Logger.log(`Connecting to ${CONFIG.WS_URL}...`, "info");

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
          "info"
        );

        this.stopHeartbeat();

        // Show connection time if it was established
        if (State.connectionStartTime) {
          const connectionDuration = Math.round(
            (Date.now() - State.connectionStartTime) / 1000
          );
          Logger.log(`Connection lasted ${connectionDuration} seconds`, "info");
        }

        UIController.updateStatus("disconnected", "Disconnected");
        UIController.updateButtons(false);

        // Auto-reconnect if not manual disconnect and within attempt limit
        if (
          !State.isManualDisconnect &&
          State.reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS
        ) {
          this.scheduleReconnect();
        } else if (State.reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
          Logger.log(
            "Maximum reconnection attempts reached. Please reconnect manually.",
            "error"
          );
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
          "received"
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
   * Sends a custom message
   * @param {string} message - JSON message to send
   */
  send(message) {
    if (!State.ws || State.ws.readyState !== WebSocket.OPEN) {
      Logger.log("Not connected to WebSocket server", "error");
      return false;
    }

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      Logger.log("Please enter a message to send", "error");
      return false;
    }

    try {
      // Validate JSON
      const jsonData = JSON.parse(trimmedMessage);

      // Send the message
      State.ws.send(trimmedMessage);
      Logger.log(`Sent: ${JSON.stringify(jsonData, null, 2)}`, "sent");
      return true;
    } catch (error) {
      Logger.log(`Invalid JSON: ${error.message}`, "error");
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

    const delay = CONFIG.RECONNECT_DELAY * Math.min(State.reconnectAttempts, 5);
    Logger.log(
      `Reconnection attempt ${State.reconnectAttempts}/${
        CONFIG.MAX_RECONNECT_ATTEMPTS
      } in ${delay / 1000}s...`,
      "info"
    );
    UIController.updateStatus(
      "connecting",
      `Reconnecting... (${State.reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})`
    );

    State.reconnectTimer = setTimeout(() => {
      if (
        !State.isManualDisconnect &&
        State.reconnectAttempts <= CONFIG.MAX_RECONNECT_ATTEMPTS
      ) {
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
    "info"
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
