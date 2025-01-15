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
    this._messageQueue.push(JSON.parse(data));
  }

  _receiveMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  close() {
    this.readyState = 'closed';
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
    this._config = config;
  }

  createDataChannel(label) {
    this._dataChannel = new MockRTCDataChannel();
    return this._dataChannel;
  }

  async createOffer() {
    return {
      type: 'offer',
      sdp: 'mock-sdp-offer'
    };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    setTimeout(() => {
      this.connectionState = 'connected';
      this._dataChannel.readyState = 'open';
      if (this.onconnectionstatechange) {
        this.onconnectionstatechange();
      }
    }, 0);
  }

  close() {
    this.connectionState = 'closed';
    if (this._dataChannel) {
      this._dataChannel.close();
    }
  }
}

export async function run({ debug = false } = {}) {
  describe('RealtimeWebRTC', () => {
    let realtime;
    let mockRTCPeerConnection;

    beforeEach(() => {
      globalThis.document = {};
      globalThis.RTCPeerConnection = MockRTCPeerConnection;
      realtime = new RealtimeWebRTC({ debug });
    });

    afterEach(() => {
      delete globalThis.document;
      delete globalThis.RTCPeerConnection;
      if (realtime.isConnected()) {
        realtime.disconnect();
      }
    });

    it('requires ephemeral key in browser', async () => {
      try {
        await realtime.connect();
        expect.fail('Should throw error');
      } catch (error) {
        expect(error.message).to.include('Ephemeral key is required');
      }
    });

    it('connects with ephemeral key', async () => {
      const mockResponse = new Response(JSON.stringify({ type: 'answer', sdp: 'mock-sdp' }));
      globalThis.fetch = async () => mockResponse;

      await realtime.connect({ ephemeralKey: 'test-key' });
      expect(realtime.isConnected()).to.be.true;

      delete globalThis.fetch;
    });

    it('handles connection errors', async () => {
      const mockErrorResponse = new Response('Error', { status: 401 });
      globalThis.fetch = async () => mockErrorResponse;

      try {
        await realtime.connect({ ephemeralKey: 'invalid-key' });
        expect.fail('Should throw error');
      } catch (error) {
        expect(error.message).to.include('Failed to connect');
      }

      delete globalThis.fetch;
    });
  });
}
