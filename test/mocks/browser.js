// Browser environment mocks for testing
export class MockAudioContext {
  constructor() {
    this.state = 'suspended';
    this.sampleRate = 16000;
  }

  createMediaStreamSource() {
    return {
      connect: () => {}
    };
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }

  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

export class MockMediaStream {
  constructor(tracks = []) {
    this._tracks = tracks;
  }

  getTracks() {
    return this._tracks;
  }

  getAudioTracks() {
    return this._tracks.filter(track => track.kind === 'audio');
  }

  addTrack(track) {
    this._tracks.push(track);
  }

  removeTrack(track) {
    const index = this._tracks.indexOf(track);
    if (index !== -1) {
      this._tracks.splice(index, 1);
    }
  }
}

export class MockMediaStreamTrack {
  constructor(kind = 'audio') {
    this.kind = kind;
    this.enabled = true;
    this.muted = false;
    this.readyState = 'live';
  }

  stop() {
    this.readyState = 'ended';
  }

  clone() {
    return new MockMediaStreamTrack(this.kind);
  }
}

export function setupBrowserMocks() {
  // Mock browser environment
  globalThis.document = {};
  globalThis.window = {};
  globalThis.navigator = {
    mediaDevices: {
      getUserMedia: async (constraints) => {
        if (!constraints.audio) {
          throw new Error('Audio constraints required');
        }
        const track = new MockMediaStreamTrack('audio');
        return new MockMediaStream([track]);
      }
    }
  };
  globalThis.AudioContext = MockAudioContext;
  globalThis.MediaStream = MockMediaStream;
  globalThis.MediaStreamTrack = MockMediaStreamTrack;
}

export function cleanupBrowserMocks() {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.navigator;
  delete globalThis.AudioContext;
  delete globalThis.MediaStream;
  delete globalThis.MediaStreamTrack;
}
