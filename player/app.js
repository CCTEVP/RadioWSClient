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
      if (wsDot) wsDot.classList.add("hidden");

      // Reset reconnection attempts on successful connection
      reconnectAttempts = 0;
      connectionStartTime = Date.now();

      // Start heartbeat
      startHeartbeat();
    };

    // Handle server ping frames (automatic pong response)
    ws.addEventListener("ping", () => {
      console.log("[WS] Server ping received, pong sent automatically");
    });

    ws.onmessage = (evt) => {
      handleMessage(evt.data);
    };

    ws.onerror = (err) => {
      console.warn("[WS] Error", err);
    };

    ws.onclose = () => {
      console.log("[WS] Closed - will attempt reconnect");

      // Stop heartbeat
      stopHeartbeat();

      // Show connection time if it was established
      if (connectionStartTime) {
        const connectionDuration = Math.round(
          (Date.now() - connectionStartTime) / 1000
        );
        console.log(`[WS] Connection lasted ${connectionDuration} seconds`);
      }

      if (wsDot) wsDot.classList.remove("hidden");

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

  // Now handle the actual message content
  // Server structure: broadcast.data contains the original client message
  // Expected client message structure:
  // {
  //   "type": "ping",
  //   "timestamp": "...",
  //   "data": {
  //       "content": {"id":6564, "name":"Florida"},
  //       "advertiser": {"id":1, "name":"Mc Donalds"}
  //   }
  // }

  const payload = data && data.data;
  if (!payload) {
    console.warn("[WS] Message missing data payload", data);
    return;
  }

  // Look for advertiser info in the payload
  let core = payload;
  if (core && typeof core === "object" && !("advertiser" in core)) {
    // Try to locate nested object with advertiser
    for (const k in core) {
      if (core[k] && typeof core[k] === "object" && "advertiser" in core[k]) {
        core = core[k];
        break;
      }
    }
  }

  if (!core || !core.advertiser || typeof core.advertiser.id !== "number") {
    console.warn("[WS] Payload missing advertiser.id", data);
    return;
  }

  const advertiserId = core.advertiser.id;
  console.log(`[WS] Highlighting square for advertiser ID: ${advertiserId}`);
  highlightSquare(advertiserId);
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
