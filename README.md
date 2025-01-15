# OpenAI Realtime API Beta Client

A client library for interacting with OpenAI's Realtime API.

## Installation

```bash
npm install @openai/realtime-api-beta
```

## Node.js (server-side) quickstart

```javascript
import { RealtimeClient } from '@openai/realtime-api-beta';

// Create a new client instance
const client = new RealtimeClient({
  apiKey: process.env.OPENAI_API_KEY,
  debug: true,
});

// Connect to Realtime API
// For WebSocket transport:
await client.connect();
// For WebRTC transport with audio:
await client.connect({
  sessionConfig: {
    modalities: ['text', 'audio'],
    input_audio_format: 'pcm16',
    output_audio_format: 'pcm16',
    voice: 'alloy'
  }
});

// Send a item and triggers a generation
client.sendUserMessageContent([{ type: 'input_text', text: `How are you?` }]);
```

## Browser (front-end) quickstart

You can use this client directly from the browser in e.g. React or Vue apps. For browser environments, we recommend using the WebRTC transport with ephemeral keys for secure authentication:

```javascript
import { RealtimeClient } from '@openai/realtime-api-beta';

// Using WebRTC transport with automatic ephemeral key fetching (recommended for browsers)
const client = new RealtimeClient({
  transport: 'webrtc',
  fetchEphemeralKeyUrl: '/api/ephemeral-key' // Your backend endpoint that returns ephemeral keys
});

// Alternative: Using WebRTC transport with manual ephemeral key (if you handle key fetching yourself)
const client = new RealtimeClient({
  transport: 'webrtc',
  ephemeralKey: 'your-ephemeral-key' // Get this from your backend
});

// Alternative: WebSocket transport (not recommended)
// WARNING: API keys are at risk if you connect to OpenAI directly from the browser
const client = new RealtimeClient({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowAPIKeyInBrowser: true,
});
```

To use WebRTC transport securely:
1. Generate an ephemeral key on your backend using the OpenAI REST API
2. Pass this key to your frontend
3. Use it to initialize the client with WebRTC transport

The ephemeral key expires after one minute, providing better security for browser environments.

When using `fetchEphemeralKeyUrl`, your backend endpoint must return a JSON response in the following format:
```json
{
  "ephemeral_key": "your-ephemeral-key-here"
}
```

The client will automatically fetch a new ephemeral key from this endpoint when connecting. If the fetch fails or the response format is invalid, an error will be thrown.

## Audio Configuration

When using audio features, especially with WebRTC transport, you can configure various audio settings:

```javascript
client.updateSession({
  // Available audio formats
  input_audio_format: 'pcm16', // or 'g711_ulaw', 'g711_alaw'
  output_audio_format: 'pcm16', // or 'g711_ulaw', 'g711_alaw'
  
  // Available voices
  voice: 'verse', // or 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer'
});
```

## Architecture

The client is composed of three main primitives:

1. [`RealtimeClient`](./lib/client.js)
   - Primary abstraction for interfacing with the API
   - Manages session configuration and conversation history
   - Provides event handlers for common use cases
1. [`RealtimeConversation`](./lib/conversation.js)
   - Stores client-side conversation cache
   - These events send item deltas and conversation history
1. [`RealtimeAPI`](./lib/api.js)
   - Exists on client instance as `client.realtime`
   - Supports both WebSocket and WebRTC transports (WebRTC recommended for browser environments)
   - Use this for connecting to the API, authenticating, and sending items
   - There is **no item validation**, you will have to rely on the API specification directly
   - Dispatches events as `server.{event_name}` and `client.{event_name}`, respectively
