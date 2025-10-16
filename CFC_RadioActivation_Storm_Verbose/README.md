# CFC Storm Radio - Combined Player

This is a hybrid WebSocket client that combines features from both `/player` and `/playerStorm`, **optimized for 384x720 displays**.

## Display Optimization

**Screen Size**: 384x720 pixels

- Compact UI elements (smaller dots and squares)
- "Now Playing" positioned at bottom-center
- Visual logger removed (console logging only)
- All text sizes optimized for readability on narrow display

## Features

### From playerStorm:

- **Image Switching**: Automatically swaps between standby (`image_01.jpg`) and active (`image_02.jpg`) images based on incoming WebSocket messages
- **Auto-reset**: Returns to standby image after 10 seconds

### From player:

- **10 Advertiser Squares**: Compact visual indicators (top-right) that highlight based on `advertiser.id` from incoming messages
- **Now Playing Display**: Shows content name and advertiser name (bottom-center) with fade-out animation
- **Connection Status Dots**:
  - Red dot (bottom-left): Shows when disconnected from WebSocket server
  - Blue dot (bottom-right): Shows when sending CustomPOP to local WebSocket
- **Progress Bar**: Green progress bar at the bottom of the screen
- **Console Logging**: Verbose logging to browser console (visual logger removed for compact display)
- **Custom POP Integration**: Sends custom Proof-of-Play to local BroadSign WebSocket

## Configuration

Edit `app.js` to configure:

```javascript
const CONFIG = {
  WS_URL_BASE:
    "wss://radiowsserver-763503917257.europe-west1.run.app/room/radio",
  AUTH_TOKEN: "your-token-here",

  // Image paths
  STANDBY_IMAGE: "./img/image_01.jpg",
  ACTIVE_IMAGE: "./img/image_02.jpg",

  // Timings
  ACTIVE_DISPLAY_DURATION: 10000, // How long to show active image (ms)
  NOW_PLAYING_DURATION: 10000, // How long to show "now playing" (ms)
  CUSTOM_POP_OFFSET: 3000, // Send POP 3000ms before slot ends
};
```

## How It Works

When a WebSocket `post` message is received:

1. **Image switches** from standby to active
2. **Square highlights** based on `advertiser.id` (1-10)
3. **"Now Playing"** appears showing content and advertiser
4. **Progress bar** animates over the slot duration
5. After 10 seconds:
   - Image returns to standby
   - "Now Playing" fades out
   - Square returns to normal

## Files

- `index.html` - HTML structure with image display and overlay elements
- `app.js` - Combined logic from both players
- `styles.css` - Combined styles from both players
- `img/image_01.jpg` - Standby/default image
- `img/image_02.jpg` - Active/triggered image

## Usage

1. Replace images in `/img` folder with your own
2. Update AUTH_TOKEN in `app.js` if needed
3. Open `index.html` in a browser or deploy to your signage system
4. Connect to WebSocket and send `post` messages

## BroadSign Integration

This client is designed to work with BroadSign digital signage. It:

- Reads BroadSign frame/player properties
- Sends custom POPs to local BroadSign WebSocket (port 2326)
- Integrates with slot timing for synchronized playback

## Differences from Original Players

**vs /player:**

- Uses full-screen image switching instead of static background
- No background image overlay

**vs /playerStorm:**

- Adds all verbose overlay features (squares, logs, dots, progress bar)
- Adds BroadSign Custom POP integration
- Adds "Now Playing" display
- More comprehensive logging

## Client ID

This client announces itself as `cfc_storm_radio` to the WebSocket server.
