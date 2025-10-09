let ws = null;
let localWs = null;
const statusEl = document.getElementById("status");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const logsEl = document.getElementById("logs");

// WebSocket connection URLs
const WS_URL = "wss://radiowsserver-763503917257.europe-west1.run.app/";
const LOCAL_WS_URL = "ws://localhost:2326";

// Payload to send to local WebSocket
const RADIO_CONTENT_PAYLOAD = {
  rc: {
    version: "1",
    id: "1",
    action: "play_now",
    name: "RadioContent",
    "max-duration": "10",
  },
};

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    log("Already connected to remote server!", "info");
    return;
  }

  updateStatus("connecting", "Connecting to remote server...");
  log(`Connecting to ${WS_URL}...`, "info");

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = function (event) {
      log("Connected to remote WebSocket server", "info");
      updateStatus("connected", "Connected to remote server");
      updateButtons(true);

      // Announce presence to remote server
      announcePresence("agent");
    };

    ws.onmessage = function (event) {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        log(
          `Received non-JSON remote message ignored: ${event.data}`,
          "received"
        );
        return; // Do not trigger local actions for non-JSON
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
      log(`Received from remote: ${JSON.stringify(data, null, 2)}`, "received");

      // Only react when the (possibly unwrapped) message is a post
      if (inner && inner.type === "post") {
        log(
          "Trigger: 'post' message received - ensuring local WebSocket communication",
          "info"
        );
        handleIncomingPayload(inner);
      } else {
        // Optional: comment out if too noisy
        // log(`Ignoring remote message type '${inner && inner.type}'`, 'info');
      }
    };

    ws.onclose = function (event) {
      const reason = event.wasClean
        ? "Remote connection closed cleanly"
        : "Remote connection lost";
      log(
        `${reason} (Code: ${event.code}, Reason: ${
          event.reason || "No reason provided"
        })`,
        "info"
      );
      updateStatus("disconnected", "Disconnected from remote server");
      updateButtons(false);
    };

    ws.onerror = function (error) {
      log(`Remote WebSocket error occurred`, "error");
      console.error("Remote WebSocket error:", error);
    };
  } catch (error) {
    log(`Failed to connect to remote server: ${error.message}`, "error");
    updateStatus("disconnected", "Remote connection failed");
    updateButtons(false);
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
    location: { href: location.href },
  };

  try {
    ws.send(JSON.stringify(announcement));
    log("Announce sent: " + JSON.stringify(announcement), "sent");
  } catch (e) {
    log("Failed to send announce: " + e.message, "error");
  }
}

function handleIncomingPayload(postMessage) {
  // postMessage is the unwrapped object with type 'post'.
  log(
    "Post message received - connecting to local WebSocket if needed...",
    "info"
  );
  connectToLocalWebSocket();
}

function connectToLocalWebSocket() {
  if (localWs && localWs.readyState === WebSocket.OPEN) {
    // If already connected, just send the payload
    sendRadioContentPayload();
    return;
  }

  log(`Connecting to local WebSocket at ${LOCAL_WS_URL}...`, "info");

  try {
    localWs = new WebSocket(LOCAL_WS_URL);

    localWs.onopen = function (event) {
      log("Connected to local WebSocket server", "info");
      // Send the radio content payload immediately upon connection
      sendRadioContentPayload();
    };

    localWs.onmessage = function (event) {
      try {
        const data = JSON.parse(event.data);
        log(
          `Received from local: ${JSON.stringify(data, null, 2)}`,
          "local-received"
        );
      } catch (e) {
        log(`Received from local: ${event.data}`, "local-received");
      }
    };

    localWs.onclose = function (event) {
      const reason = event.wasClean
        ? "Local connection closed cleanly"
        : "Local connection lost";
      log(
        `${reason} (Code: ${event.code}, Reason: ${
          event.reason || "No reason provided"
        })`,
        "info"
      );
    };

    localWs.onerror = function (error) {
      log(`Local WebSocket error occurred`, "error");
      console.error("Local WebSocket error:", error);
    };
  } catch (error) {
    log(`Failed to connect to local server: ${error.message}`, "error");
  }
}

function sendRadioContentPayload() {
  if (!localWs || localWs.readyState !== WebSocket.OPEN) {
    log("Local WebSocket not connected - cannot send payload", "error");
    return;
  }

  try {
    const payloadString = JSON.stringify(RADIO_CONTENT_PAYLOAD);
    localWs.send(payloadString);
    log(
      `Sent to local WebSocket: ${JSON.stringify(
        RADIO_CONTENT_PAYLOAD,
        null,
        2
      )}`,
      "sent"
    );
  } catch (error) {
    log(`Failed to send payload to local WebSocket: ${error.message}`, "error");
  }
}

function disconnect() {
  if (ws) {
    ws.close(1000, "User initiated disconnect");
    ws = null;
  }

  if (localWs) {
    localWs.close(1000, "User initiated disconnect");
    localWs = null;
  }
}

function updateStatus(status, text) {
  statusEl.className = `status ${status}`;
  statusEl.textContent = text;
}

function updateButtons(connected) {
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
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

// Auto-connect on page load
window.addEventListener("load", function () {
  log("Agent starting - auto-connecting to remote server...", "info");
  connect();
});
