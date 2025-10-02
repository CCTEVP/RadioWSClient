let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let isManualDisconnect = false;
let connectionStartTime = null;
const statusEl = document.getElementById("status");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("messageInput");
const logsEl = document.getElementById("logs");

// WebSocket connection URL
const WS_URL = "wss://radiowsserver-763503917257.europe-west1.run.app/";

// Connection keepalive settings
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const RECONNECT_DELAY = 3000; // 3 seconds
const MAX_RECONNECT_ATTEMPTS = 20; // Allow reconnection for ~1 hour
let reconnectAttempts = 0;

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    log("Already connected!", "info");
    return;
  }

  updateStatus("connecting", "Connecting...");
  log(`Connecting to ${WS_URL}...`, "info");

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = function (event) {
      log("Connected to WebSocket server", "info");
      updateStatus("connected", "Connected");
      updateButtons(true);

      // Reset reconnection attempts on successful connection
      reconnectAttempts = 0;
      connectionStartTime = Date.now();

      // Start heartbeat
      startHeartbeat();
    };

    // Handle server ping frames (automatic pong response)
    ws.addEventListener("ping", () => {
      log("Server ping received, pong sent automatically", "info");
    });

    ws.onmessage = function (event) {
      try {
        // Try to parse as JSON
        const data = JSON.parse(event.data);

        // Handle different message types from server
        if (data.type === "welcome") {
          log(`Server welcome: ${data.message}`, "info");
        } else if (data.type === "broadcast") {
          log(
            `Broadcast from ${data.from}: ${JSON.stringify(
              data.data,
              null,
              2
            )}`,
            "received"
          );
        } else {
          log(`Received: ${JSON.stringify(data, null, 2)}`, "received");
        }
      } catch (e) {
        // If not JSON, log as plain text
        log(`Received: ${event.data}`, "received");
      }
    };

    ws.onclose = function (event) {
      const reason = event.wasClean
        ? "Connection closed cleanly"
        : "Connection lost";
      log(
        `${reason} (Code: ${event.code}, Reason: ${
          event.reason || "No reason provided"
        })`,
        "info"
      );

      // Stop heartbeat
      stopHeartbeat();

      // Show connection time if it was established
      if (connectionStartTime) {
        const connectionDuration = Math.round(
          (Date.now() - connectionStartTime) / 1000
        );
        log(`Connection lasted ${connectionDuration} seconds`, "info");
      }

      updateStatus("disconnected", "Disconnected");
      updateButtons(false);

      // Auto-reconnect if not manual disconnect and within attempt limit
      if (!isManualDisconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        scheduleReconnect();
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        log(
          "Maximum reconnection attempts reached. Please reconnect manually.",
          "error"
        );
      }
    };

    ws.onerror = function (error) {
      log(`WebSocket error occurred`, "error");
      console.error("WebSocket error:", error);
    };
  } catch (error) {
    log(`Failed to connect: ${error.message}`, "error");
    updateStatus("disconnected", "Connection Failed");
    updateButtons(false);
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

function sendMessage() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log("Not connected to WebSocket server", "error");
    return;
  }

  const message = messageInput.value.trim();
  if (!message) {
    log("Please enter a message to send", "error");
    return;
  }

  try {
    // Validate JSON
    const jsonData = JSON.parse(message);

    // Send the message
    ws.send(message);
    log(`Sent: ${JSON.stringify(jsonData, null, 2)}`, "sent");
  } catch (error) {
    log(`Invalid JSON: ${error.message}`, "error");
  }
}

function updateStatus(status, text) {
  statusEl.className = `status ${status}`;
  statusEl.textContent = text;
}

function updateButtons(connected) {
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  sendBtn.disabled = !connected;
}

function log(message, type = "info") {
  const logEntry = document.createElement("div");
  logEntry.className = `log-entry ${type}`;

  const timestamp = new Date().toLocaleTimeString();
  logEntry.innerHTML = `
    <span class="timestamp">[${timestamp}]</span> ${message}
  `;

  logsEl.appendChild(logEntry);
  logsEl.scrollTop = logsEl.scrollHeight;
}

function clearLogs() {
  logsEl.innerHTML = "";
}

function startHeartbeat() {
  stopHeartbeat(); // Clear any existing heartbeat

  // The server handles ping/pong automatically, but we can still send occasional
  // application-level keepalive messages to ensure the connection stays active
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        // Send a lightweight keepalive message
        const keepAlive = JSON.stringify({
          type: "keepalive",
          timestamp: new Date().toISOString(),
          clientId: "control",
        });
        ws.send(keepAlive);
        log("Keepalive sent", "info");
      } catch (error) {
        log(`Failed to send keepalive: ${error.message}`, "error");
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
  log(
    `Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${
      delay / 1000
    }s...`,
    "info"
  );
  updateStatus(
    "connecting",
    `Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
  );

  reconnectTimer = setTimeout(() => {
    if (!isManualDisconnect && reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      connect();
    }
  }, delay);
}

// BroadSignPlay function that also connects to WebSocket
function BroadSignPlay() {
  log("BroadSignPlay() called - initiating WebSocket connection", "info");
  isManualDisconnect = false;
  reconnectAttempts = 0;
  connect();
}

// Handle Enter key in textarea (Ctrl+Enter to send)
messageInput.addEventListener("keydown", function (event) {
  if (event.ctrlKey && event.key === "Enter") {
    sendMessage();
  }
});

// Auto-connect on page load (optional)
// window.addEventListener('load', connect);
