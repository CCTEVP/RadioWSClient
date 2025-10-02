// Simple WebSocket squares highlighter
// Maps incoming payload advertiser.id to a square (1..10)

const WS_URL = "ws://localhost:8080";
let ws;
let reconnectTimer = null;
const RECONNECT_DELAY = 3000; // ms

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
    };

    ws.onmessage = (evt) => {
      handleMessage(evt.data);
    };

    ws.onerror = (err) => {
      console.warn("[WS] Error", err);
    };

    ws.onclose = () => {
      console.log("[WS] Closed - will attempt reconnect");
      scheduleReconnect();
    };
  } catch (e) {
    console.error("[WS] Connection exception", e);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
}

function handleMessage(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.warn("Non-JSON message ignored", raw);
    return;
  }

  // Expected structure:
  // {
  //   "type": "ping",
  //   "timestamp": "...",
  //   "data": {
  //       {
  //          "content": {"id":6564, "name":"Florida"},
  //          "advertiser": {"id":1, "name":"Mc Donalds"}
  //       }
  //   }
  // }
  // NOTE: Provided payload shows data containing an anonymous object inside braces.
  // We interpret it as data containing an object with `content` and `advertiser`.

  const payload = data && data.data;

  // If payload is wrapped strangely (e.g., { { ... } }), attempt to unwrap by finding first object with advertiser
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
    console.warn("Payload missing advertiser.id", data);
    return;
  }

  const advertiserId = core.advertiser.id;
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

// Expose a manual trigger similar to BroadSignPlay style if needed
function BroadSignPlay() {
  connect();
}
window.BroadSignPlay = BroadSignPlay;
