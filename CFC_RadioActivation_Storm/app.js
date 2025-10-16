// ============================================================================
// RADIO WEBSOCKET CLIENT - PLAYER STORM
// Image switcher based on WebSocket post messages
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

  HEARTBEAT_INTERVAL: 30000, // 30 seconds
  RECONNECT_DELAY: 3000, // 3 seconds
  MAX_RECONNECT_ATTEMPTS: 20, // Allow reconnection for ~1 hour
  ACTIVE_DISPLAY_DURATION: 10000, // 10 seconds
  STANDBY_IMAGE: "./img/image_01.jpg",
  ACTIVE_IMAGE: "./img/image_02.jpg",
};

// ============================================================================
// 2. STATE MANAGEMENT
// ============================================================================

const State = {
  ws: null,
  heartbeatTimer: null,
  reconnectTimer: null,
  imageResetTimer: null,
  isManualDisconnect: false,
  connectionStartTime: null,
  reconnectAttempts: 0,

  // UI Elements (cached)
  displayImage: null,
  statusIndicator: null,
};

// ============================================================================
// 3. UTILITY FUNCTIONS
// ============================================================================

/**
 * Initialize DOM element references
 */
function initializeDOMElements() {
  State.displayImage = document.getElementById("displayImage");
  State.statusIndicator = document.getElementById("statusIndicator");
}

// ============================================================================
// 4. UI CONTROLLER
// ============================================================================

const UIController = {
  /**
   * Updates connection status indicator
   * @param {string} status - Status class (connecting, connected, disconnected)
   */
  updateStatusIndicator(status) {
    if (!State.statusIndicator) return;

    // Remove all status classes
    State.statusIndicator.classList.remove(
      "connected",
      "connecting",
      "disconnected"
    );

    // Add the current status class
    if (status) {
      State.statusIndicator.classList.add(status);
    }
  },

  /**
   * Switches to active image
   */
  showActiveImage() {
    if (!State.displayImage) return;

    // Clear any existing timer
    if (State.imageResetTimer) {
      clearTimeout(State.imageResetTimer);
      State.imageResetTimer = null;
    }

    // Switch to active image
    State.displayImage.src = CONFIG.ACTIVE_IMAGE;
    console.log(`Switched to active image: ${CONFIG.ACTIVE_IMAGE}`);

    // Schedule return to standby after configured duration
    State.imageResetTimer = setTimeout(() => {
      this.showStandbyImage();
    }, CONFIG.ACTIVE_DISPLAY_DURATION);
  },

  /**
   * Switches to standby image
   */
  showStandbyImage() {
    if (!State.displayImage) return;

    State.displayImage.src = CONFIG.STANDBY_IMAGE;
    console.log(`Switched back to standby image: ${CONFIG.STANDBY_IMAGE}`);
    State.imageResetTimer = null;
  },
};

// ============================================================================
// 5. WEBSOCKET MODULE
// ============================================================================

const WebSocketController = {
  /**
   * Establishes WebSocket connection
   */
  connect() {
    if (State.ws && State.ws.readyState === WebSocket.OPEN) {
      console.log("Already connected!");
      return;
    }

    console.log(`Connecting to ${CONFIG.WS_URL}...`);
    UIController.updateStatusIndicator("connecting");

    try {
      State.ws = new WebSocket(CONFIG.WS_URL);

      State.ws.onopen = () => {
        console.log("Connected to WebSocket server");

        // Reset reconnection attempts on successful connection
        State.reconnectAttempts = 0;
        State.connectionStartTime = Date.now();

        UIController.updateStatusIndicator("connected");
        this.startHeartbeat();
        this.announcePresence("playerStorm");
      };

      State.ws.addEventListener("ping", () => {
        console.log("Server ping received, pong sent automatically");
      });

      State.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      State.ws.onerror = (error) => {
        console.error("WebSocket error occurred:", error);
      };

      State.ws.onclose = (event) => {
        const reason = event.wasClean
          ? "Connection closed cleanly"
          : "Connection lost";
        console.log(
          `${reason} (Code: ${event.code}, Reason: ${
            event.reason || "No reason provided"
          })`
        );

        UIController.updateStatusIndicator("disconnected");
        this.stopHeartbeat();

        // Show connection time if it was established
        if (State.connectionStartTime) {
          const connectionDuration = Math.round(
            (Date.now() - State.connectionStartTime) / 1000
          );
          console.log(`Connection lasted ${connectionDuration} seconds`);
        }

        // Auto-reconnect if not manual disconnect and within attempt limit
        if (
          !State.isManualDisconnect &&
          State.reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS
        ) {
          this.scheduleReconnect();
        } else if (State.reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
          console.error(
            "Maximum reconnection attempts reached. Please reconnect manually."
          );
        }
      };
    } catch (error) {
      console.error(`Failed to connect: ${error.message}`);
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
        console.log(`Server welcome: ${data.message}`);
      } else if (data.type === "broadcast") {
        console.log(`Broadcast from ${data.from}:`, data.data);

        // Check if the broadcast data contains a "post" type message
        if (data.data && data.data.type === "post") {
          MessageHandler.handlePostMessage(data.data);
        }
      } else if (data.type === "post") {
        // Direct post message (not wrapped in broadcast)
        MessageHandler.handlePostMessage(data);
      } else {
        console.log("Received:", data);
      }
    } catch (e) {
      // If not JSON, log as plain text
      console.log(`Received: ${rawData}`);
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
      console.log("Announce sent:", announcement);
    } catch (e) {
      console.error("Failed to send announce:", e.message);
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
            clientId: "playerStorm",
          });
          State.ws.send(keepAlive);
          console.log("Keepalive sent");
        } catch (error) {
          console.error(`Failed to send keepalive: ${error.message}`);
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
    console.log(
      `Reconnection attempt ${State.reconnectAttempts}/${
        CONFIG.MAX_RECONNECT_ATTEMPTS
      } in ${delay / 1000}s...`
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
// 6. MESSAGE HANDLER
// ============================================================================

const MessageHandler = {
  /**
   * Handles post-type messages
   * @param {object} data - Post message data
   */
  handlePostMessage(data) {
    console.log("Post message received:", data);

    if (!State.displayImage) {
      console.error("Display image element not found");
      return;
    }

    // Switch to active image
    UIController.showActiveImage();
  },
};

// ============================================================================
// 7. PUBLIC API
// ============================================================================

/**
 * BroadSignPlay function that also connects to WebSocket
 */
function BroadSignPlay() {
  console.log("BroadSignPlay() called - initiating WebSocket connection");
  State.isManualDisconnect = false;
  State.reconnectAttempts = 0;
  WebSocketController.connect();
}

/**
 * Manually disconnect from WebSocket
 */
function disconnect() {
  WebSocketController.disconnect();
}

// ============================================================================
// 8. INITIALIZATION
// ============================================================================

/**
 * Initialize application on page load
 */
window.addEventListener("load", () => {
  initializeDOMElements();
  console.log("Page loaded - auto-connecting to WebSocket");
  BroadSignPlay();
});

// Expose public functions to window
window.BroadSignPlay = BroadSignPlay;
window.disconnect = disconnect;
