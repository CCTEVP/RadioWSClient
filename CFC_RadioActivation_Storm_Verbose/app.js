// ============================================================================
// RADIO WEBSOCKET CLIENT - CFC STORM RADIO
// Combined: Image switcher + Overlay features (dots, logs, squares, progress)
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
  RECONNECT_DELAY: 3000, // ms
  HEARTBEAT_INTERVAL: 30000, // 30 seconds
  MAX_RECONNECT_ATTEMPTS: 20,
  CUSTOM_POP_OFFSET: 3000, // Send POP 3000ms before slot ends
  LOGGER_VISIBLE_DURATION: 5000, // ms
  LOGGER_FADE_DURATION: 1000, // ms
  NOW_PLAYING_DURATION: 10000, // ms
  NOW_PLAYING_FADE_DURATION: 500, // ms

  // Image switching (from playerStorm)
  ACTIVE_DISPLAY_DURATION: 10000, // 10 seconds
  STANDBY_IMAGE: "./img/image_01.jpg",
  ACTIVE_IMAGE: "./img/image_02.jpg",
};

// ============================================================================
// 2. STATE MANAGEMENT
// ============================================================================

const State = {
  // BroadSign Properties
  frameId: null,
  adCopyId: null,
  playerId: null,
  slotDuration: null,
  customPopTimeout: null,

  // WebSocket States
  ws: null,
  localWs: null,
  reconnectTimer: null,
  heartbeatTimer: null,
  isManualDisconnect: false,
  connectionStartTime: null,
  reconnectAttempts: 0,

  // Message Data
  messagesReceived: [{ result: "No messages received" }],
  contentId: null,
  contentName: null,
  advertiserId: null,
  advertiserName: null,

  // Timers
  customPopTimer: null,
  nowPlayingTimeout: null,
  imageResetTimer: null, // From playerStorm

  // UI Elements (cached)
  progressBarFill: null,
  squaresContainer: null,
  squares: [],
  wsDot: null,
  displayImage: null, // From playerStorm
};

// ============================================================================
// 3. UTILITY FUNCTIONS
// ============================================================================

/**
 * Safely retrieves a property from BroadSignObject with fallback
 * @param {string} propName - Property name to retrieve
 * @param {*} defaultValue - Default value if property not found
 * @returns {*} Property value or default
 */
function getBroadSignProperty(propName, defaultValue) {
  if (
    typeof window.BroadSignObject === "object" &&
    window.BroadSignObject !== null &&
    Object.prototype.hasOwnProperty.call(window.BroadSignObject, propName)
  ) {
    const value = window.BroadSignObject[propName];
    if (typeof value === "string" && value.trim() !== "") {
      const trimmedValue = value.trim();
      Logger.log(`[INIT] BroadSignObject.${propName} found:`, trimmedValue);
      return trimmedValue;
    }
    if (value !== null && value !== undefined) {
      Logger.log(`[INIT] BroadSignObject.${propName} found:`, value);
      return value;
    }
  }
  return defaultValue;
}

/**
 * Initialize BroadSign configuration from BroadSignObject
 */
function initializeBroadSignConfig() {
  State.frameId = getBroadSignProperty("frame_id", "12343");
  State.adCopyId = getBroadSignProperty("ad_copy_id", "1290113894");
  State.playerId = getBroadSignProperty("player_id", "759244535");
  State.slotDuration = parseInt(
    getBroadSignProperty("expected_slot_duration_ms", "10000"),
    10
  );
  State.customPopTimeout = State.slotDuration - CONFIG.CUSTOM_POP_OFFSET;

  Logger.log(`[INIT] Slot duration set to ${State.slotDuration}ms`);
  Logger.log(
    `[INIT] Custom PoP timeout set to ${State.customPopTimeout}ms (reduced by ${CONFIG.CUSTOM_POP_OFFSET}ms)`
  );
}

/**
 * Initialize DOM element references
 */
function initializeDOMElements() {
  State.squaresContainer = document.getElementById("squares");
  State.squares = State.squaresContainer
    ? Array.from(State.squaresContainer.querySelectorAll(".square"))
    : [];
  State.wsDot = document.getElementById("wsDot");
  State.displayImage = document.getElementById("displayImage"); // From playerStorm
}

// ============================================================================
// 4. LOGGER MODULE (Console only - no visual logger for compact display)
// ============================================================================

const Logger = {
  /**
   * Logs a message to console only (visual logger disabled for 384x720 display)
   * @param {string} message - Log message
   * @param {*} data - Optional data to log
   */
  log(message, data = null) {
    // Format message with timestamp
    const timestamp = new Date().toISOString().split("T")[1].substring(0, 12);
    let logMessage = `[${timestamp}] ${message}`;

    if (data !== null) {
      if (typeof data === "object") {
        console.log(logMessage, data);
      } else {
        console.log(logMessage, data);
      }
    } else {
      console.log(logMessage);
    }
  },
};

// ============================================================================
// 5. UI CONTROLLERS
// ============================================================================

const UIController = {
  // Status Dots
  dots: {
    hideBlue() {
      const dot = document.getElementById("customPopDot");
      if (dot) dot.style.opacity = "0";
    },

    showBlue() {
      const dot = document.getElementById("customPopDot");
      if (dot) dot.style.opacity = "1";
    },

    hideRed() {
      const dot = document.getElementById("wsDot");
      if (dot) dot.style.opacity = "0";
    },

    showRed() {
      const dot = document.getElementById("wsDot");
      if (dot) dot.style.opacity = "1";
    },
  },

  // Progress Bar
  progressBar: {
    start() {
      if (!State.progressBarFill) {
        State.progressBarFill = document.getElementById("progressBarFill");
      }

      if (State.progressBarFill) {
        // Reset progress bar to 0
        State.progressBarFill.style.transition = "none";
        State.progressBarFill.style.width = "0%";

        // Force reflow to apply the reset
        void State.progressBarFill.offsetWidth;

        // Start animation from 0 to 100% over slotDuration
        State.progressBarFill.style.transition = `width ${State.slotDuration}ms linear`;
        State.progressBarFill.style.width = "100%";

        Logger.log(
          `[PROGRESS] Started progress bar animation for ${State.slotDuration}ms`
        );
      }
    },

    reset() {
      if (State.progressBarFill) {
        State.progressBarFill.style.transition = "none";
        State.progressBarFill.style.width = "0%";
      }
    },
  },

  // Now Playing Display
  nowPlaying: {
    update(content, advertiser) {
      const contentElement = document.getElementById("nowPlayingContent");
      const advertiserElement = document.getElementById("nowPlayingAdvertiser");
      const container = document.getElementById("nowPlayingContainer");

      if (!contentElement || !content) return;

      contentElement.textContent = content;
      advertiserElement.textContent = advertiser;

      if (container) {
        // Clear any existing timeout
        if (State.nowPlayingTimeout) {
          clearTimeout(State.nowPlayingTimeout);
        }

        // Show the container and remove fade-out class
        container.style.display = "block";
        container.classList.remove("fade-out");

        // Schedule fade-out after configured duration
        State.nowPlayingTimeout = setTimeout(() => {
          container.classList.add("fade-out");

          // Restore square appearance at the same time as fade-out starts
          UIController.squares.clearActive();

          // Hide completely after transition completes
          setTimeout(() => {
            container.style.display = "none";
          }, CONFIG.NOW_PLAYING_FADE_DURATION);
        }, CONFIG.NOW_PLAYING_DURATION);
      }

      Logger.log("[UI] Now Playing updated:", { content, advertiser });
    },
  },

  // Advertiser Squares
  squares: {
    highlight(id) {
      // id 1 maps to index 0, etc.
      if (id < 1 || id > State.squares.length) {
        Logger.log(
          `[UI] Advertiser id out of range (1..${State.squares.length}):`,
          id
        );
        return;
      }

      // Clear existing active state
      State.squares.forEach((sq) => sq.classList.remove("active"));

      const target = State.squares[id - 1];
      if (!target) return;

      target.classList.add("active");
      target.classList.remove("pulse");
      // Retrigger pulse animation
      void target.offsetWidth; // force reflow
      target.classList.add("pulse");
    },

    clearActive() {
      // Remove active state from all squares
      State.squares.forEach((sq) => sq.classList.remove("active"));
      Logger.log("[UI] Active square cleared");
    },
  },

  // Image Switcher (from playerStorm)
  images: {
    showActiveImage() {
      if (!State.displayImage) return;

      // Clear any existing timer
      if (State.imageResetTimer) {
        clearTimeout(State.imageResetTimer);
        State.imageResetTimer = null;
      }

      // Switch to active image
      State.displayImage.src = CONFIG.ACTIVE_IMAGE;
      Logger.log(`[IMAGE] Switched to active image: ${CONFIG.ACTIVE_IMAGE}`);

      // Schedule return to standby after configured duration
      State.imageResetTimer = setTimeout(() => {
        this.showStandbyImage();
      }, CONFIG.ACTIVE_DISPLAY_DURATION);
    },

    showStandbyImage() {
      if (!State.displayImage) return;

      State.displayImage.src = CONFIG.STANDBY_IMAGE;
      Logger.log(
        `[IMAGE] Switched back to standby image: ${CONFIG.STANDBY_IMAGE}`
      );
      State.imageResetTimer = null;
    },
  },
};

// ============================================================================
// 6. WEBSOCKET MODULE (Main Server)
// ============================================================================

const WebSocketController = {
  /**
   * Establishes WebSocket connection to main server
   */
  connect() {
    if (
      State.ws &&
      (State.ws.readyState === WebSocket.OPEN ||
        State.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      State.ws = new WebSocket(CONFIG.WS_URL);

      State.ws.onopen = () => {
        clearTimeout(State.reconnectTimer);
        Logger.log("[WS] Connected");
        UIController.dots.hideRed();

        // Reset reconnection attempts on successful connection
        State.reconnectAttempts = 0;
        State.connectionStartTime = Date.now();

        this.startHeartbeat();
        this.announcePresence("cfc_storm_radio");
      };

      State.ws.addEventListener("ping", () => {
        Logger.log("[WS] Server ping received, pong sent automatically");
      });

      State.ws.onmessage = (evt) => {
        MessageHandler.handleMessage(evt.data);
      };

      State.ws.onerror = (err) => {
        Logger.log("[WS] Error", err);
      };

      State.ws.onclose = () => {
        Logger.log("[WS] Closed - will attempt reconnect");

        this.stopHeartbeat();

        // Show connection time if it was established
        if (State.connectionStartTime) {
          const connectionDuration = Math.round(
            (Date.now() - State.connectionStartTime) / 1000
          );
          Logger.log(`[WS] Connection lasted ${connectionDuration} seconds`);
        }

        UIController.dots.showRed();

        // Auto-reconnect if not manual disconnect and within attempt limit
        if (
          !State.isManualDisconnect &&
          State.reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS
        ) {
          this.scheduleReconnect();
        } else if (State.reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
          Logger.log("[WS] Maximum reconnection attempts reached");
        }
      };
    } catch (e) {
      Logger.log("[WS] Connection exception", e);
      this.scheduleReconnect();
    }
  },

  /**
   * Announces player presence to server
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
      Logger.log("[WS] Announce sent", announcement);
    } catch (e) {
      Logger.log("[WS] Failed to send announce", e);
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
      `[WS] Reconnection attempt ${State.reconnectAttempts}/${
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
            clientId: "cfc_storm_radio",
          });
          State.ws.send(keepAlive);
          Logger.log("[WS] Keepalive sent");
        } catch (error) {
          Logger.log(`[WS] Failed to send keepalive: ${error.message}`);
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
// 7. LOCAL WEBSOCKET MODULE (Custom POP)
// ============================================================================

const LocalWebSocketController = {
  /**
   * Starts timer to send custom POP before slot ends
   */
  startCustomPopTimer() {
    // Clear any existing timer
    if (State.customPopTimer) {
      clearTimeout(State.customPopTimer);
    }

    Logger.log(
      `[TIMER] Starting custom POP timer for ${State.customPopTimeout}ms`
    );
    State.customPopTimer = setTimeout(() => {
      Logger.log(
        `[TIMER] Executing sendCustomPOP after ${State.customPopTimeout}ms`
      );
      this.sendCustomPOP();
    }, State.customPopTimeout);
  },

  /**
   * Builds flattened payload from messages
   */
  buildPayload() {
    const customFieldData = {
      player_id: State.playerId,
      frame_id: State.frameId,
    };

    // Flatten messages array into individual properties (m1_, m2_, etc.)
    State.messagesReceived.forEach((msg, index) => {
      const prefix = `m${index + 1}_`;
      customFieldData[`${prefix}t`] = msg.t || "";
      customFieldData[`${prefix}r`] = msg.r || "";
      customFieldData[`${prefix}a_id`] = msg.a?.i || "";
      customFieldData[`${prefix}a_name`] = msg.a?.n || "";
      customFieldData[`${prefix}c_id`] = msg.c?.i || "";
      customFieldData[`${prefix}c_name`] = msg.c?.n || "";
    });

    return {
      rc: {
        version: "1",
        id: "1",
        action: "custom_pop",
        frame_id: State.frameId,
        content_id: State.adCopyId,
        external_value_1: "RADIO CONTENT ACTIVATED",
        external_value_2: JSON.stringify(customFieldData),
        name: "RADIO CONTENT",
      },
    };
  },

  /**
   * Sends custom POP to local WebSocket
   */
  sendCustomPOP() {
    const payload = this.buildPayload();
    Logger.log("[LocalWS] Preparing to send custom_pop payload:", payload);

    UIController.dots.showBlue();

    // If already open, just send
    if (State.localWs && State.localWs.readyState === WebSocket.OPEN) {
      try {
        State.localWs.send(JSON.stringify(payload));
        Logger.log("[LocalWS] Sent Custom POP");
      } catch (e) {
        Logger.log("[LocalWS] Failed to send Custom POP", e);
      }
      return;
    }

    // If not open, create and send on open
    this.openAndSend(payload);
  },

  /**
   * Opens local WebSocket connection and sends payload
   */
  openAndSend(payload) {
    try {
      State.localWs = new WebSocket(CONFIG.LOCAL_WS_URL);

      State.localWs.onopen = () => {
        try {
          State.localWs.send(JSON.stringify(payload));
          Logger.log("[LocalWS] Sent custom payload (on open)");
        } catch (e) {
          Logger.log("[LocalWS] Failed to send payload (on open)", e);
        }
      };

      State.localWs.onmessage = (event) => {
        this.handleResponse(event.data);
      };

      State.localWs.onerror = (err) => {
        Logger.log("[LocalWS] Error", err);
      };

      State.localWs.onclose = () => {
        Logger.log("[LocalWS] Connection closed");
        State.localWs = null;
      };
    } catch (e) {
      Logger.log("[LocalWS] Exception opening local ws", e);
    }
  },

  /**
   * Handles response from local WebSocket
   */
  handleResponse(data) {
    try {
      const resp = JSON.parse(data);
      Logger.log("[LocalWS] Response received:", resp);

      // Check for successful custom_pop response
      if (
        resp &&
        resp.rc &&
        resp.rc.action === "custom_pop" &&
        resp.rc.status === "1"
      ) {
        UIController.dots.hideBlue();
        Logger.log("[LocalWS] CustomPOP success, blue dot hidden");
      }
    } catch (e) {
      Logger.log("[LocalWS] Failed to parse response", e);
    }
  },
};

// ============================================================================
// 8. MESSAGE HANDLERS
// ============================================================================

const MessageHandler = {
  /**
   * Handles incoming WebSocket messages
   */
  handleMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      Logger.log("[WS] Non-JSON message ignored", raw);
      return;
    }

    // Handle different message types from server
    if (data.type === "welcome") {
      Logger.log(`[WS] Server welcome: ${data.message}`);
      return;
    }

    // Handle broadcast messages (server wraps client messages in broadcast envelope)
    if (data.type === "broadcast") {
      Logger.log(`[WS] Broadcast from ${data.from}`);
      data = data.data; // Extract the actual payload
    }

    // Only process messages where the (unwrapped) type is 'post'
    if (!data || data.type !== "post") {
      return; // Silently ignore other types
    }

    this.handlePostMessage(data);
  },

  /**
   * Handles 'post' type messages
   */
  handlePostMessage(data) {
    // Save the timestamp from the post message before accessing nested data
    const messageTimestamp = data.timestamp;
    const payload = data.data;

    if (!payload) {
      Logger.log("[WS] 'post' message missing data payload", data);
      return;
    }

    // Locate advertiser object (direct or nested one level deep)
    const core = this.extractCore(payload);

    if (!core || !core.advertiser || !core.advertiser.id) {
      Logger.log("[WS] 'post' payload missing advertiser.id", data);
      return;
    }

    // Convert advertiser id string to integer for highlighting
    const advertiserIdValue = parseInt(core.advertiser.id, 10);
    if (!Number.isInteger(advertiserIdValue)) {
      Logger.log("[WS] advertiser.id not a valid integer", core.advertiser.id);
      return;
    }

    // Store message
    this.storeMessage(messageTimestamp, core);

    // Update global state
    State.advertiserId = core.advertiser.id;
    State.advertiserName = core.advertiser.name;
    State.contentId = core.content.id;
    State.contentName = core.content.name;

    Logger.log("[WS] Post data updated:", {
      advertiserId: State.advertiserId,
      advertiserName: State.advertiserName,
      contentId: State.contentId,
      contentName: State.contentName,
    });

    // Update UI: Switch image, highlight square, show now playing
    Logger.log(
      `[WS] Highlighting square for advertiser ID (post): ${advertiserIdValue}`
    );
    UIController.images.showActiveImage(); // From playerStorm
    UIController.squares.highlight(advertiserIdValue);
    UIController.nowPlaying.update(State.contentName, State.advertiserName);
  },

  /**
   * Extracts core data from payload (handles nested structures)
   */
  extractCore(payload) {
    let core = payload;
    if (core && typeof core === "object" && !core.advertiser) {
      for (const k in core) {
        if (core[k] && typeof core[k] === "object" && core[k].advertiser) {
          core = core[k];
          break;
        }
      }
    }
    return core;
  },

  /**
   * Stores message in messagesReceived array
   */
  storeMessage(timestamp, core) {
    State.messagesReceived.push({
      t: timestamp || new Date().toISOString(),
      r: new Date().toISOString(),
      a: {
        i: core.advertiser.id,
        n: core.advertiser.name,
      },
      c: {
        i: core.content.id,
        n: core.content.name,
      },
    });

    Logger.log(
      "[WS] Message stored in messagesReceived array. Total messages:",
      State.messagesReceived.length
    );
    Logger.log("[WS] Current messagesReceived:", State.messagesReceived);
  },
};

// ============================================================================
// 9. INITIALIZATION & LIFECYCLE
// ============================================================================

/**
 * Main initialization function (BroadSignPlay)
 */
function BroadSignPlay() {
  State.isManualDisconnect = false;
  State.reconnectAttempts = 0;

  WebSocketController.connect();
  UIController.progressBar.start();
  LocalWebSocketController.startCustomPopTimer();
}

/**
 * Initialize application on page load
 */
window.addEventListener("load", () => {
  initializeBroadSignConfig();
  initializeDOMElements();
  Logger.log("[INIT] CFC Storm Radio loaded - auto-connecting to WebSocket");
  BroadSignPlay();
});

// ============================================================================
// PUBLIC API
// ============================================================================

window.BroadSignPlay = BroadSignPlay;
window.disconnect = WebSocketController.disconnect.bind(WebSocketController);
