# Dynamic Campaigns WebSocket Client

A simple HTML5 WebSocket client for connecting to and communicating with a WebSocket server running on `ws://localhost:8080`.

## Features

- **Real-time Connection**: Connect/disconnect to WebSocket server with visual status indicators
- **JSON Messaging**: Send and receive JSON payloads with syntax validation
- **Message Logging**: View all sent and received messages with timestamps
- **User-friendly Interface**: Clean, responsive design with color-coded message types
- **Error Handling**: Comprehensive error handling and connection state management

## Usage

1. **Start your WebSocket server** on `localhost:8080`

2. **Open the client**:

   - Simply open `index.html` in your web browser
   - Or serve it through a local web server if needed

3. **Connect to the server**:

   - Click the "Connect" button
   - The status indicator will show connection state

4. **Send JSON messages**:

   - Enter valid JSON in the text area
   - Click "Send Message" or use `Ctrl+Enter`
   - Example messages are provided in the textarea

5. **Monitor communication**:
   - All sent and received messages appear in the logs section
   - Messages are color-coded: blue for sent, green for received, red for errors

## Message Format

The client expects and sends JSON messages. Example formats:

### Basic Ping Message

```json
{
  "type": "ping",
  "timestamp": "2025-10-02T00:00:00Z",
  "data": {
    "message": "Hello WebSocket Server"
  }
}
```

### Campaign Request Message

```json
{
  "type": "campaign_request",
  "data": {
    "userId": "12345",
    "campaignType": "dynamic",
    "parameters": {
      "location": "US",
      "category": "technology"
    }
  }
}
```

## Technical Details

- **WebSocket URL**: `ws://localhost:8080`
- **Protocol**: Native HTML5 WebSocket API
- **Message Format**: JSON
- **Browser Compatibility**: Modern browsers supporting WebSocket API

## File Structure

```
dn-dynamic-campaigns-ws-client/
├── index.html          # Main WebSocket client interface
└── README.md          # This documentation file
```

## Keyboard Shortcuts

- `Ctrl+Enter` in the message textarea: Send message

## Status Indicators

- **🟢 Connected**: Successfully connected to WebSocket server
- **🟡 Connecting**: Attempting to establish connection
- **🔴 Disconnected**: Not connected to server

## Error Handling

The client handles various error scenarios:

- Connection failures
- Invalid JSON messages
- Server disconnections
- Network issues

All errors are logged with timestamps in the message logs section.
