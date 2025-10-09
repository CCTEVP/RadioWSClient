let localWs = null;
let localWsReady = false;
let dynamicFrameId = "12343"; // default
let adCopyId = "1290113894"; // default
// Try to set from BroadSignObject immediately if available
const frameIdInit = getBroadSignProperty("frame_id");
if (typeof frameIdInit === "string" && frameIdInit !== "") {
  dynamicFrameId = frameIdInit;
  console.log("[INIT] BroadSignObject.frame_id found:", dynamicFrameId);
} else {
  console.log("[INIT] BroadSignObject present but frame_id missing or invalid");
}

const adCopyIdInit = getBroadSignProperty("ad_copy_id");
if (typeof adCopyIdInit === "string" && adCopyIdInit !== "") {
  adCopyId = adCopyIdInit;
  console.log("[INIT] BroadSignObject.ad_copy_id found:", adCopyId);
} else {
  console.log(
    "[INIT] BroadSignObject present but ad_copy_id missing or invalid"
  );
}

function hideBlueDot() {
  const dot = document.getElementById("customPopDot");
  if (dot) dot.style.opacity = "0";
}

function showBlueDot() {
  const dot = document.getElementById("customPopDot");
  if (dot) dot.style.opacity = "1";
}

function hideRedDot() {
  const dot = document.getElementById("wsDot");
  if (dot) dot.style.opacity = "0";
}

function showRedDot() {
  const dot = document.getElementById("wsDot");
  if (dot) dot.style.opacity = "1";
}
// Simple WebSocket squares highlighter
// Maps incoming payload advertiser.id to a square (1..10)

const WS_URL = "wss://radiowsserver-763503917257.europe-west1.run.app/";
let ws;
let reconnectTimer = null;
let heartbeatTimer = null;
let isManualDisconnect = false;
let connectionStartTime = null;
const RECONNECT_DELAY = 3000; // ms
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const MAX_RECONNECT_ATTEMPTS = 20; // Allow reconnection for ~1 hour
let reconnectAttempts = 0;

const squaresContainer = document.getElementById("squares");
const squares = squaresContainer
  ? Array.from(squaresContainer.querySelectorAll(".square"))
  : [];
const wsDot = document.getElementById("wsDot");

function connect() {
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      clearTimeout(reconnectTimer);
      console.log("[WS] Connected");
      hideRedDot();

      // Reset reconnection attempts on successful connection
      reconnectAttempts = 0;
      connectionStartTime = Date.now();

      // Wait for response in onmessage
      // Start heartbeat
      startHeartbeat();

      // Announce presence / broadcast metadata
      announcePresence("player");
    };

    // Handle server ping frames (automatic pong response)
    ws.addEventListener("ping", () => {
      console.log("[WS] Server ping received, pong sent automatically");
    });

    ws.onmessage = (evt) => {
      // Wait for response in onmessage
      handleMessage(evt.data);
    };

    ws.onerror = (err) => {
      console.warn("[WS] Error", err);
    };

    ws.onclose = () => {
      console.log("[WS] Closed - will attempt reconnect");

      // Stop heartbeat
      localWs.onmessage = function (event) {
        try {
          const resp = JSON.parse(event.data);
          if (
            resp &&
            resp.rc &&
            resp.rc.action === "custom_pop" &&
            resp.rc.status === "1"
          ) {
            hideBlueDot();
            console.log("[LocalWS] CustomPOP success, blue dot hidden");
          }
        } catch (e) {
          // Ignore parse errors
        }
      };
      stopHeartbeat();

      // Show connection time if it was established
      if (connectionStartTime) {
        const connectionDuration = Math.round(
          (Date.now() - connectionStartTime) / 1000
        );
        console.log(`[WS] Connection lasted ${connectionDuration} seconds`);
      }

      showRedDot();

      // Auto-reconnect if not manual disconnect and within attempt limit
      if (!isManualDisconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        scheduleReconnect();
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn("[WS] Maximum reconnection attempts reached");
      }
    };
  } catch (e) {
    console.error("[WS] Connection exception", e);
    scheduleReconnect();
  }
}

function announcePresence(role) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

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
    ws.send(JSON.stringify(announcement));
    console.log("[WS] Announce sent", announcement);
  } catch (e) {
    console.warn("[WS] Failed to send announce", e);
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectAttempts++;

  const delay = RECONNECT_DELAY * Math.min(reconnectAttempts, 5); // Exponential backoff, max 15s
  console.log(
    `[WS] Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${
      delay / 1000
    }s...`
  );

  reconnectTimer = setTimeout(() => {
    if (!isManualDisconnect && reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      connect();
    }
  }, delay);
}

function handleMessage(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.warn("[WS] Non-JSON message ignored", raw);
    return;
  }

  // Handle different message types from server
  if (data.type === "welcome") {
    console.log(`[WS] Server welcome: ${data.message}`);
    return;
  }

  // Handle broadcast messages (server wraps client messages in broadcast envelope)
  if (data.type === "broadcast") {
    console.log(`[WS] Broadcast from ${data.from}`);
    // Extract the actual payload from the broadcast wrapper
    data = data.data;
  }
  // Only process messages where the (unwrapped) type is 'post'
  if (!data || data.type !== "post") {
    // Silently ignore other types (could log if needed)
    return;
  }

  // Expected structure now:
  // {
  //   "type": "post",
  //   "timestamp": "...",
  //   "data": { "advertiser": { "id": "1" | 1, ... }, ... }
  // }
  const payload = data.data;
  if (!payload) {
    console.warn("[WS] 'post' message missing data payload", data);
    return;
  }

  // Locate advertiser object (direct or nested one level deep)
  let core = payload;
  if (core && typeof core === "object" && !core.advertiser) {
    for (const k in core) {
      if (core[k] && typeof core[k] === "object" && core[k].advertiser) {
        core = core[k];
        break;
      }
    }
  }

  if (!core || !core.advertiser || core.advertiser.id == null) {
    console.warn("[WS] 'post' payload missing advertiser.id", data);
    return;
  }

  // Advertiser id may now be a string. Convert to integer.
  let advertiserIdRaw = core.advertiser.id;
  if (typeof advertiserIdRaw === "string")
    advertiserIdRaw = advertiserIdRaw.trim();
  const advertiserId = parseInt(advertiserIdRaw, 10);
  if (!Number.isInteger(advertiserId)) {
    console.warn("[WS] advertiser.id not a valid integer", core.advertiser.id);
    return;
  }

  console.log(
    `[WS] Highlighting square for advertiser ID (post): ${advertiserId}`
  );
  highlightSquare(advertiserId);

  // Update Now Playing display if content.name is available
  if (payload.content && payload.content.name && payload.advertiser.name) {
    updateNowPlaying(payload.content.name, payload.advertiser.name);
  }

  // After highlighting, open local ws://localhost:2326 and send the custom payload
  sendCustomPOP();

  // Utility function to safely retrieve a property from BroadSignObject
  // Local WebSocket logic for sending custom payload after highlight

  function sendCustomPOP() {
    const LOCAL_WS_URL = "ws://localhost:2326";
    const PAYLOAD = {
      rc: {
        version: "1",
        id: "1",
        action: "custom_pop",
        frame_id: dynamicFrameId,
        content_id: adCopyId,
        external_value_1: "radio_content_activated",
        custom_field: "<custom_json>",
        name: "RADIO CONTENT",
      },
    };

    // If already open, just send
    if (localWs && localWs.readyState === WebSocket.OPEN) {
      try {
        localWs.send(JSON.stringify(PAYLOAD));
        console.log("[LocalWS] Sent Custom POP");
      } catch (e) {
        console.warn("[LocalWS] Failed to send Custom POP", e);
      }
      return;
    }

    // If not open, create and send on open
    try {
      localWs = new WebSocket(LOCAL_WS_URL);
      localWs.onopen = function () {
        try {
          localWs.send(JSON.stringify(PAYLOAD));
          console.log("[LocalWS] Sent custom payload (on open)");
        } catch (e) {
          console.warn("[LocalWS] Failed to send payload (on open)", e);
        }
      };
      localWs.onerror = function (err) {
        console.warn("[LocalWS] Error", err);
      };
      localWs.onclose = function () {
        // Optionally, set localWs to null to allow reconnect on next trigger
        localWs = null;
      };
    } catch (e) {
      console.warn("[LocalWS] Exception opening local ws", e);
    }
  }
}
function getBroadSignProperty(propName) {
  if (
    typeof window.BroadSignObject === "object" &&
    window.BroadSignObject !== null &&
    Object.prototype.hasOwnProperty.call(window.BroadSignObject, propName)
  ) {
    const value = window.BroadSignObject[propName];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
    return value;
  }
  return undefined;
}

let nowPlayingTimeout = null;

function updateNowPlaying(content, advertiser) {
  const nowPlayingContentElement = document.getElementById("nowPlayingContent");
  const nowPlayingAdvertiserElement = document.getElementById(
    "nowPlayingAdvertiser"
  );
  const nowPlayingContainer = document.getElementById("nowPlayingContainer");
  if (nowPlayingContentElement && content) {
    nowPlayingContentElement.textContent = content;
    nowPlayingAdvertiserElement.textContent = advertiser;
    if (nowPlayingContainer) {
      // Clear any existing timeout
      if (nowPlayingTimeout) {
        clearTimeout(nowPlayingTimeout);
      }

      // Show the container and remove fade-out class
      nowPlayingContainer.style.display = "block";
      nowPlayingContainer.classList.remove("fade-out");

      // Schedule fade-out after 10 seconds
      nowPlayingTimeout = setTimeout(() => {
        nowPlayingContainer.classList.add("fade-out");
        // Hide completely after transition completes (0.5s)
        setTimeout(() => {
          nowPlayingContainer.style.display = "none";
        }, 500);
      }, 10000);
    }
    console.log("[UI] Now Playing updated:", content, advertiser);
  }
}

function highlightSquare(id) {
  // id 1 maps to index 0, etc.
  if (id < 1 || id > squares.length) {
    console.warn("Advertiser id out of range (1.." + squares.length + "):", id);
    return;
  }

  // Clear existing active state
  squares.forEach((sq) => sq.classList.remove("active"));

  const target = squares[id - 1];
  if (!target) return;

  target.classList.add("active");
  target.classList.remove("pulse");
  // retrigger pulse animation
  void target.offsetWidth; // force reflow
  target.classList.add("pulse");
}

function startHeartbeat() {
  stopHeartbeat(); // Clear any existing heartbeat

  // Send lightweight keepalive messages (server handles native ping/pong)
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        // Send a lightweight keepalive message
        const keepAlive = JSON.stringify({
          type: "keepalive",
          timestamp: new Date().toISOString(),
          clientId: "player",
        });
        ws.send(keepAlive);
        console.log("[WS] Keepalive sent");
      } catch (error) {
        console.error(`[WS] Failed to send keepalive: ${error.message}`);
      }
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// Add disconnect function for manual disconnection
function disconnect() {
  if (ws) {
    isManualDisconnect = true;
    stopHeartbeat();
    clearTimeout(reconnectTimer);
    ws.close(1000, "User initiated disconnect");
    ws = null;
    connectionStartTime = null;

    // Reset manual disconnect flag after a delay
    setTimeout(() => {
      isManualDisconnect = false;
    }, 1000);
  }
}

// Expose a manual trigger similar to BroadSignPlay style if needed
function BroadSignPlay() {
  isManualDisconnect = false;
  reconnectAttempts = 0;
  connect();
}
window.BroadSignPlay = BroadSignPlay;
window.disconnect = disconnect;
