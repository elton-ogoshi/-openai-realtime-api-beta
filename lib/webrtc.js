import { RealtimeEventHandler } from './event_handler.js';
import { RealtimeUtils } from './utils.js';

export class RealtimeWebRTC extends RealtimeEventHandler {
  /**
   * Create a new RealtimeWebRTC instance
   * @param {{debug?: boolean}} [settings]
   * @returns {RealtimeWebRTC}
   */
  constructor({ debug } = {}) {
    super();
    this.debug = !!debug;
    this.pc = null;
    this.dc = null;
    this.baseUrl = 'https://api.openai.com/v1/realtime';
    this.audioStream = null;
    this.audioElement = null;
  }

  /**
   * Tells us whether or not the WebRTC connection is established
   * @returns {boolean}
   */
  isConnected() {
    return this.pc?.connectionState === 'connected' && this.dc?.readyState === 'open';
  }

  /**
   * Writes WebRTC logs to console
   * @param  {...any} args
   * @returns {true}
   */
  log(...args) {
    const date = new Date().toISOString();
    const logs = [`[WebRTC/${date}]`].concat(args).map((arg) => {
      if (typeof arg === 'object' && arg !== null) {
        return JSON.stringify(arg, null, 2);
      } else {
        return arg;
      }
    });
    if (this.debug) {
      console.log(...logs);
    }
    return true;
  }

  /**
   * Connects to Realtime API WebRTC Server
   * @param {{model?: string, ephemeralKey?: string}} [settings]
   * @returns {Promise<true>}
   */
  async connect({ model = 'gpt-4o-realtime-preview-2024-10-01', ephemeralKey, sessionConfig = {} } = {}) {
    if (this.isConnected()) {
      throw new Error('Already connected');
    }

    // In browser environments, we must use an ephemeral key
    if (globalThis.document && !ephemeralKey) {
      throw new Error('Ephemeral key is required for browser environments');
    }

    // Create and configure the peer connection
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Set up audio if it's enabled in modalities
    if (sessionConfig.modalities?.includes('audio')) {
      // Validate audio format settings
      const validInputFormats = ['pcm16', 'g711_ulaw', 'g711_alaw'];
      const validOutputFormats = ['pcm16', 'g711_ulaw', 'g711_alaw'];
      const validVoices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
      
      const inputFormat = sessionConfig.input_audio_format || 'pcm16';
      const outputFormat = sessionConfig.output_audio_format || 'pcm16';
      const voice = sessionConfig.voice || 'verse';
      
      if (!validInputFormats.includes(inputFormat)) {
        throw new Error(`Invalid input_audio_format: ${inputFormat}`);
      }
      if (!validOutputFormats.includes(outputFormat)) {
        throw new Error(`Invalid output_audio_format: ${outputFormat}`);
      }
      if (!validVoices.includes(voice)) {
        throw new Error(`Invalid voice: ${voice}`);
      }

      try {
        // Configure audio constraints based on format
        const audioConstraints = {
          channelCount: 1,
          sampleRate: 16000, // Required for all formats
          echoCancellation: true,
          noiseSuppression: true
        };

        // Get microphone access with specified constraints
        this.audioStream = await navigator.mediaDevices.getUserMedia({ 
          audio: audioConstraints
        });

        // Add audio track to peer connection
        this.audioStream.getAudioTracks().forEach(track => {
          this.pc.addTrack(track, this.audioStream);
        });

        // Log audio format configuration
        this.log('Audio configured:', {
          inputFormat,
          outputFormat,
          voice,
          constraints: audioConstraints
        });
      } catch (error) {
        console.warn('Failed to get microphone access:', error);
        throw new Error('Microphone access required for audio modality');
      }

      // Handle incoming audio from the model
      this.pc.ontrack = (event) => {
        if (event.track.kind === 'audio') {
          this.audioElement = new Audio();
          this.audioElement.srcObject = new MediaStream([event.track]);
          
          // Configure audio element based on output format
          if (outputFormat === 'pcm16') {
            // PCM16 is the native browser format, no additional configuration needed
          } else if (outputFormat === 'g711_ulaw' || outputFormat === 'g711_alaw') {
            // These formats should be automatically handled by the browser's audio stack
            this.log('Using compressed audio format:', outputFormat);
          }

          this.audioElement.play().catch(error => {
            console.warn('Failed to play audio:', error);
            throw new Error('Audio playback failed');
          });
        }
      };
    }

    // Create the data channel for events
    this.dc = this.pc.createDataChannel('oai-events');
    this.dc.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.log('received:', message.type, message);
        // Use the same dispatch pattern as WebSocket implementation
        this.dispatch(`server.${message.type}`, message);
        this.dispatch('server.*', message);
      } catch (error) {
        this.log('Error processing message:', error);
        this.dispatch('error', {
          type: 'invalid_message',
          message: 'Failed to parse message from server',
          error: error.message
        });
      }
    };

    // Create and set local description
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Get the answer from OpenAI's server
    const response = await fetch(`${this.baseUrl}?model=${model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ephemeralKey}`,
        'Content-Type': 'application/sdp',
        'OpenAI-Beta': 'realtime=v1'
      },
      body: this.pc.localDescription.sdp
    });

    if (!response.ok) {
      throw new Error(`Failed to connect: ${response.status} ${response.statusText}`);
    }

    const answer = {
      type: 'answer',
      sdp: await response.text()
    };

    await this.pc.setRemoteDescription(answer);

    // Wait for connection to be established
    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      const checkConnection = () => {
        if (this.isConnected()) {
          clearTimeout(connectionTimeout);
          this.log('Connected to OpenAI Realtime API via WebRTC');
          
          // Set up connection state change handler
          this.pc.onconnectionstatechange = () => {
            if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') {
              this.disconnect();
              this.dispatch('close', { error: true });
            } else if (this.pc.connectionState === 'closed') {
              this.disconnect();
              this.dispatch('close', { error: false });
            }
          };

          resolve(true);
        } else if (this.pc.connectionState === 'failed') {
          clearTimeout(connectionTimeout);
          reject(new Error('Connection failed'));
        } else {
          setTimeout(checkConnection, 100);
        }
      };

      checkConnection();
    });
  }

  /**
   * Disconnects from Realtime API server
   * @returns {true}
   */
  disconnect() {
    // Clean up audio resources
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.srcObject = null;
      this.audioElement = null;
    }
    
    // Clean up WebRTC resources
    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    return true;
  }

  /**
   * Sends an event to WebRTC data channel and dispatches as "client.{eventName}" and "client.*" events
   * @param {string} eventName
   * @param {{[key: string]: any}} data
   * @returns {true}
   */
  send(eventName, data = {}) {
    if (!this.isConnected()) {
      throw new Error('RealtimeWebRTC is not connected');
    }
    if (typeof data !== 'object') {
      throw new Error('data must be an object');
    }
    const event = {
      event_id: RealtimeUtils.generateId('evt_'),
      type: eventName,
      ...data,
    };
    this.dispatch(`client.${eventName}`, event);
    this.dispatch('client.*', event);
    this.log('sent:', eventName, event);
    try {
      this.dc.send(JSON.stringify(event));
    } catch (error) {
      this.log('Error sending message:', error);
      throw new Error(`Failed to send message: ${error.message}`);
    }
    return true;
  }
}
