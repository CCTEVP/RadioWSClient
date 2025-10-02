let ws = null;
const statusEl = document.getElementById("status");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("messageInput");
const logsEl = document.getElementById("logs");

// WebSocket connection URL
const WS_URL = "ws://localhost:8080";

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
    };

    ws.onmessage = function (event) {
      try {
        // Try to parse as JSON
        const data = JSON.parse(event.data);
        log(`Received: ${JSON.stringify(data, null, 2)}`, "received");
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
      updateStatus("disconnected", "Disconnected");
      updateButtons(false);
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
    ws.close(1000, "User initiated disconnect");
    ws = null;
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

// BroadSignPlay function that also connects to WebSocket
function BroadSignPlay() {
  log("BroadSignPlay() called - initiating WebSocket connection", "info");
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
