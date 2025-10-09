let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let isManualDisconnect = false;
let connectionStartTime = null;
let imageResetTimer = null;

// WebSocket connection URL
const WS_URL = "wss://radiowsserver-763503917257.europe-west1.run.app/";

// Connection keepalive settings
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const RECONNECT_DELAY = 3000; // 3 seconds
const MAX_RECONNECT_ATTEMPTS = 20; // Allow reconnection for ~1 hour
let reconnectAttempts = 0;

// Image display settings
const ACTIVE_DISPLAY_DURATION = 10000; // 10 seconds
const STANDBY_IMAGE = "./img/image_01.jpg";
const ACTIVE_IMAGE = "./img/image_02.jpg";

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("Already connected!");
    return;
  }

  console.log(`Connecting to ${WS_URL}...`);
  updateStatusIndicator("connecting");

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = function (event) {
      console.log("Connected to WebSocket server");

      // Reset reconnection attempts on successful connection
      reconnectAttempts = 0;
      connectionStartTime = Date.now();

      // Update status indicator
      updateStatusIndicator("connected");

      // Start heartbeat
      startHeartbeat();

      // Announce presence metadata
      announcePresence("playerStorm");
    };

    // Handle server ping frames (automatic pong response)
    ws.addEventListener("ping", () => {
      console.log("Server ping received, pong sent automatically");
    });

    ws.onmessage = function (event) {
      try {
        // Try to parse as JSON
        const data = JSON.parse(event.data);

        // Handle different message types from server
        if (data.type === "welcome") {
          console.log(`Server welcome: ${data.message}`);
        } else if (data.type === "broadcast") {
          console.log(`Broadcast from ${data.from}:`, data.data);

          // Check if the broadcast data contains a "post" type message
          if (data.data && data.data.type === "post") {
            handlePostMessage(data.data);
          }
        } else if (data.type === "post") {
          // Direct post message (not wrapped in broadcast)
          handlePostMessage(data);
        } else {
          console.log("Received:", data);
        }
      } catch (e) {
        // If not JSON, log as plain text
        console.log(`Received: ${event.data}`);
      }
    };

    ws.onclose = function (event) {
      const reason = event.wasClean
        ? "Connection closed cleanly"
        : "Connection lost";
      console.log(
        `${reason} (Code: ${event.code}, Reason: ${
          event.reason || "No reason provided"
        })`
      );

      // Update status indicator
      updateStatusIndicator("disconnected");

      // Stop heartbeat
      stopHeartbeat();

      // Show connection time if it was established
      if (connectionStartTime) {
        const connectionDuration = Math.round(
          (Date.now() - connectionStartTime) / 1000
        );
        console.log(`Connection lasted ${connectionDuration} seconds`);
      }

      // Auto-reconnect if not manual disconnect and within attempt limit
      if (!isManualDisconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        scheduleReconnect();
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error(
          "Maximum reconnection attempts reached. Please reconnect manually."
        );
      }
    };

    ws.onerror = function (error) {
      console.error("WebSocket error occurred:", error);
    };
  } catch (error) {
    console.error(`Failed to connect: ${error.message}`);
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
    console.log("Announce sent:", announcement);
  } catch (e) {
    console.error("Failed to send announce:", e.message);
  }
}

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

function startHeartbeat() {
  stopHeartbeat(); // Clear any existing heartbeat

  // Send application-level keepalive messages
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const keepAlive = JSON.stringify({
          type: "keepalive",
          timestamp: new Date().toISOString(),
          clientId: "playerStorm",
        });
        ws.send(keepAlive);
        console.log("Keepalive sent");
      } catch (error) {
        console.error(`Failed to send keepalive: ${error.message}`);
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

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectAttempts++;

  const delay = RECONNECT_DELAY * Math.min(reconnectAttempts, 5); // Exponential backoff, max 15s
  console.log(
    `Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${
      delay / 1000
    }s...`
  );

  reconnectTimer = setTimeout(() => {
    if (!isManualDisconnect && reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      connect();
    }
  }, delay);
}

function handlePostMessage(data) {
  console.log("Post message received:", data);

  const displayImage = document.getElementById("displayImage");
  if (!displayImage) {
    console.error("Display image element not found");
    return;
  }

  // Clear any existing timer
  if (imageResetTimer) {
    clearTimeout(imageResetTimer);
    imageResetTimer = null;
  }

  // Switch to active image
  displayImage.src = ACTIVE_IMAGE;
  console.log(`Switched to active image: ${ACTIVE_IMAGE}`);

  // Schedule return to standby after 10 seconds
  imageResetTimer = setTimeout(() => {
    displayImage.src = STANDBY_IMAGE;
    console.log(`Switched back to standby image: ${STANDBY_IMAGE}`);
    imageResetTimer = null;
  }, ACTIVE_DISPLAY_DURATION);
}

function updateStatusIndicator(status) {
  const indicator = document.getElementById("statusIndicator");
  if (!indicator) return;

  // Remove all status classes
  indicator.classList.remove("connected", "connecting", "disconnected");

  // Add the current status class
  if (status) {
    indicator.classList.add(status);
  }
}

// BroadSignPlay function that also connects to WebSocket
function BroadSignPlay() {
  console.log("BroadSignPlay() called - initiating WebSocket connection");
  isManualDisconnect = false;
  reconnectAttempts = 0;
  connect();
}

// Auto-connect on page load
window.addEventListener("load", () => {
  console.log("Page loaded - auto-connecting to WebSocket");
  BroadSignPlay();
});
