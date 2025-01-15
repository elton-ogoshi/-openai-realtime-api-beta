import { RealtimeWebRTC } from '../../lib/webrtc.js';

// Mock RTCPeerConnection and RTCDataChannel for testing
class MockRTCDataChannel {
  constructor() {
    this.readyState = 'connecting';
    this.onmessage = null;
    this._messageQueue = [];
    this.label = 'oai-events';
  }

  send(data) {
    if (this.readyState !== 'open') {
      throw new Error('Data channel not open');
    }
    // Store sent messages for verification
    this._messageQueue.push(JSON.parse(data));
  }

  // Test helper to simulate receiving a message
  _receiveMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  // Test helper to simulate receiving multiple messages
  _receiveMessages(messages) {
    messages.forEach(msg => this._receiveMessage(msg));
  }

  close() {
    this.readyState = 'closed';
  }

  // Test helper to verify sent messages
  _getLastMessage() {
    return this._messageQueue[this._messageQueue.length - 1];
  }

  // Test helper to clear message queue
  _clearMessages() {
    this._messageQueue = [];
  }
}

class MockRTCPeerConnection {
  constructor(config = {}) {
    this.connectionState = 'new';
    this.onconnectionstatechange = null;
    this.ontrack = null;
    this._dataChannel = null;
    this.localDescription = null;
    this.remoteDescription = null;
    this._senders = new Set();
    this._config = config;
  }

  createDataChannel(label) {
    this._dataChannel = new MockRTCDataChannel();
    return this._dataChannel;
  }

  async createOffer() {
    return {
      type: 'offer',
      sdp: 'v=0\r\n' +
           'o=- 123456789 2 IN IP4 127.0.0.1\r\n' +
           's=-\r\n' +
           't=0 0\r\n' +
           'a=group:BUNDLE audio data\r\n' +
           'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' +
           'c=IN IP4 0.0.0.0\r\n' +
           'a=mid:audio\r\n' +
           'a=sendrecv\r\n' +
           'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' +
           'c=IN IP4 0.0.0.0\r\n' +
           'a=mid:data\r\n' +
           'a=sctp-port:5000\r\n'
    };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    // Simulate successful connection after remote description is set
    setTimeout(() => {
      this.connectionState = 'connected';
      this._dataChannel.readyState = 'open';
      if (this.onconnectionstatechange) {
        this.onconnectionstatechange();
      }
    }, 0);
  }

  addTrack(track, stream) {
    const sender = { track, stream };
    this._senders.add(sender);
    return sender;
  }

  getSenders() {
    return Array.from(this._senders);
  }

  close() {
    this.connectionState = 'closed';
    if (this._dataChannel) {
      this._dataChannel.close();
    }
    this._senders.clear();
  }

  // Test helper to simulate connection state changes
  _setConnectionState(state) {
    this.connectionState = state;
    if (this.onconnectionstatechange) {
      this.onconnectionstatechange();
    }
  }

  // Test helper to simulate receiving a track
  _addRemoteTrack(track, stream) {
    if (this.ontrack) {
      this.ontrack({ track, streams: [stream] });
    }
  }
}

export async function run() {
  describe('RealtimeWebRTC', ({ debug = false } = {}) => {
    let realtime;
    let mockRTCPeerConnection;
    let mockDataChannel;

    before(async () => {
      // Set up browser environment mocks
      const { setupBrowserMocks } = await import('../mocks/browser.js');
      setupBrowserMocks();
      globalThis.RTCPeerConnection = MockRTCPeerConnection;
    });

    after(async () => {
      const { cleanupBrowserMocks } = await import('../mocks/browser.js');
      cleanupBrowserMocks();
      delete globalThis.RTCPeerConnection;
    });

    beforeEach(() => {
      realtime = new RealtimeWebRTC({ debug });
    });

    afterEach(() => {
      if (realtime.isConnected()) {
        realtime.disconnect();
      }
      if (globalThis.fetch) {
        delete globalThis.fetch;
      }
    });

    test('connects with manual ephemeral key', async () => {
      const mockResponse = new Response(JSON.stringify({ type: 'answer', sdp: 'mock-sdp-answer' }));
      globalThis.fetch = async () => mockResponse;

      await realtime.connect({ ephemeralKey: 'mock-key' });
      assert(realtime.isConnected(), 'Should be connected');
      assert(realtime.pc.connectionState === 'connected', 'Peer connection should be connected');
      assert(realtime.dc.readyState === 'open', 'Data channel should be open');

      delete globalThis.fetch;
    });

    test('automatically fetches ephemeral key if fetchEphemeralKeyUrl is provided', async () => {
      // Mock both the SDP answer and ephemeral key responses
      let fetchCount = 0;
      globalThis.fetch = async (url) => {
        fetchCount++;
        if (url === 'https://my-backend.com/ephemeral') {
          return new Response(JSON.stringify({ ephemeral_key: 'mock-auto-key' }));
        } else {
          return new Response(JSON.stringify({ type: 'answer', sdp: 'mock-sdp-answer' }));
        }
      };

      const client = new RealtimeClient({
        transport: 'webrtc',
        fetchEphemeralKeyUrl: 'https://my-backend.com/ephemeral',
        debug: true
      });

      await client.connect();
      assert(client.ephemeralKey === 'mock-auto-key', 'Should store fetched ephemeral key');
      assert(client.isConnected(), 'Should connect with fetched key');
      assert(fetchCount === 2, 'Should make two fetch calls (key + SDP)');

      delete globalThis.fetch;
    });

    test('handles ephemeral key fetch failures', async () => {
      globalThis.fetch = async (url) => {
        if (url === 'https://my-backend.com/ephemeral') {
          return new Response('Invalid key', { status: 401 });
        }
        return new Response(JSON.stringify({ type: 'answer', sdp: 'mock-sdp-answer' }));
      };

      const client = new RealtimeClient({
        transport: 'webrtc',
        fetchEphemeralKeyUrl: 'https://my-backend.com/ephemeral',
        debug: true
      });

      try {
        await client.connect();
        assert(false, 'Should throw error on key fetch failure');
      } catch (error) {
        assert(error.message.includes('Failed to fetch ephemeral key'), 'Should throw fetch error');
        assert(!client.isConnected(), 'Should not be connected after failure');
      }

      delete globalThis.fetch;
    });

    test('handles invalid ephemeral key response format', async () => {
      globalThis.fetch = async (url) => {
        if (url === 'https://my-backend.com/ephemeral') {
          return new Response(JSON.stringify({ wrong_field: 'value' }));
        }
        return new Response(JSON.stringify({ type: 'answer', sdp: 'mock-sdp-answer' }));
      };

      const client = new RealtimeClient({
        transport: 'webrtc',
        fetchEphemeralKeyUrl: 'https://my-backend.com/ephemeral',
        debug: true
      });

      try {
        await client.connect();
        assert(false, 'Should throw error on invalid response');
      } catch (error) {
        assert(error.message.includes('missing ephemeral_key field'), 'Should throw format error');
        assert(!client.isConnected(), 'Should not be connected after failure');
      }

      delete globalThis.fetch;
    });

    test('requires ephemeral key in browser environment', async () => {
      try {
        await realtime.connect();
        assert(false, 'Should throw error without ephemeral key');
      } catch (error) {
        assert(error.message.includes('Ephemeral key is required'), 'Should require ephemeral key');
      }
    });

    test('handles server events correctly', async () => {
      const mockResponse = new Response(JSON.stringify({ type: 'answer', sdp: 'mock-sdp-answer' }));
      globalThis.fetch = async () => mockResponse;

      await realtime.connect({ ephemeralKey: 'mock-key' });

      let receivedEvent = null;
      realtime.on('server.test.event', (event) => {
        receivedEvent = event;
      });

      const testEvent = {
        event_id: 'evt_123',
        type: 'test.event',
        data: 'test'
      };

      realtime.dc._receiveMessage(testEvent);
      assert(receivedEvent, 'Should receive server event');
      assert(receivedEvent.event_id === testEvent.event_id, 'Event ID should match');
      assert(receivedEvent.type === testEvent.type, 'Event type should match');

      delete globalThis.fetch;
    });

    test('sends client events correctly', async () => {
      const mockResponse = new Response(JSON.stringify({ type: 'answer', sdp: 'mock-sdp-answer' }));
      globalThis.fetch = async () => mockResponse;

      await realtime.connect({ ephemeralKey: 'mock-key' });

      let clientEvent = null;
      realtime.on('client.test.event', (event) => {
        clientEvent = event;
      });

      realtime.send('test.event', { data: 'test' });
      
      const sentEvent = realtime.dc._messageQueue[0];
      assert(sentEvent, 'Should send event');
      assert(sentEvent.type === 'test.event', 'Event type should match');
      assert(sentEvent.data === 'test', 'Event data should match');
      assert(clientEvent, 'Should dispatch client event');
      assert(clientEvent.type === 'test.event', 'Client event type should match');

      delete globalThis.fetch;
    });

    test('handles connection errors', async () => {
      const mockErrorResponse = new Response('Error', { status: 401 });
      globalThis.fetch = async () => mockErrorResponse;

      try {
        await realtime.connect({ ephemeralKey: 'invalid-key' });
        assert(false, 'Should throw error on connection failure');
      } catch (error) {
        assert(error.message.includes('Failed to connect'), 'Should throw connection error');
      }

      delete globalThis.fetch;
    });

    test('handles disconnection', async () => {
      const mockResponse = new Response(JSON.stringify({ type: 'answer', sdp: 'mock-sdp-answer' }));
      globalThis.fetch = async () => mockResponse;

      await realtime.connect({ ephemeralKey: 'mock-key' });
      assert(realtime.isConnected(), 'Should be connected');

      realtime.disconnect();
      assert(!realtime.isConnected(), 'Should be disconnected');
      assert(!realtime.pc, 'Peer connection should be cleaned up');
      assert(!realtime.dc, 'Data channel should be cleaned up');

      delete globalThis.fetch;
    });
  });
}
