import { RealtimeWebRTC } from '../../lib/webrtc.js';
// Set up minimal browser environment mocks
globalThis.document = {};

// Mock Audio API
class MockAudio {
  constructor() {
    this.srcObject = null;
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
}
globalThis.Audio = MockAudio;

// Mock MediaStream API
class MockMediaStream {
  constructor(tracks = []) {
    this._tracks = tracks;
  }
  getTracks() {
    return this._tracks;
  }
  getAudioTracks() {
    return this._tracks.filter(track => track.kind === 'audio');
  }
}
globalThis.MediaStream = MockMediaStream;

// Mock RTCPeerConnection for testing
class MockRTCPeerConnection {
  constructor() {
    this.connectionState = 'new';
    this.onconnectionstatechange = null;
    this.ontrack = null;
    this._dataChannel = null;
    this._senders = new Set();
  }

  addTrack(track, stream) {
    const sender = { track, stream };
    this._senders.add(sender);
    return sender;
  }

  createDataChannel(label) {
    this._dataChannel = {
      readyState: 'connecting',
      onmessage: null,
      send: (data) => console.log('Sent:', JSON.parse(data)),
      close: () => {}
    };
    setTimeout(() => {
      this._dataChannel.readyState = 'open';
    }, 0);
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

globalThis.RTCPeerConnection = MockRTCPeerConnection;
globalThis.fetch = async () => new Response(JSON.stringify({ type: 'answer', sdp: 'mock-sdp-answer' }));

async function runTests() {
  console.log('Starting WebRTC tests...');
  
  // Test 1: Connection establishment
  console.log('\nTest 1: Connection establishment');
  const realtime = new RealtimeWebRTC({ debug: true });
  try {
    await realtime.connect({ ephemeralKey: 'mock-key' });
    console.log('✓ Connection established successfully');
  } catch (error) {
    console.error('✗ Connection failed:', error);
    process.exit(1);
  }

  // Test 2: Event handling
  console.log('\nTest 2: Event handling');
  let eventReceived = false;
  realtime.on('server.test', (event) => {
    console.log('✓ Event received:', event);
    eventReceived = true;
  });
  
  realtime.dc.onmessage({ 
    data: JSON.stringify({ 
      type: 'test',
      data: 'test-data'
    })
  });
  
  if (!eventReceived) {
    console.error('✗ Event handling failed');
    process.exit(1);
  }

  // Test 3: Data channel sending
  console.log('\nTest 3: Data channel sending');
  try {
    realtime.send('client.message', { text: 'Hello' });
    console.log('✓ Message sent successfully');
  } catch (error) {
    console.error('✗ Message sending failed:', error);
    process.exit(1);
  }

  // Test 4: Disconnection
  console.log('\nTest 4: Disconnection');
  realtime.disconnect();
  if (!realtime.isConnected()) {
    console.log('✓ Disconnected successfully');
  } else {
    console.error('✗ Disconnection failed');
    process.exit(1);
  }

  console.log('\nAll tests passed!');
  // Clean up mocks
  delete globalThis.document;
  delete globalThis.Audio;
  delete globalThis.MediaStream;
  delete globalThis.RTCPeerConnection;
  delete globalThis.fetch;
}

// Run the tests
runTests().catch(console.error);
