import { RealtimeEventHandler } from './event_handler.js';
import { RealtimeAPI } from './api.js';
import { RealtimeWebRTC } from './webrtc.js';
import { RealtimeConversation } from './conversation.js';
import { RealtimeUtils } from './utils.js';

export class RealtimeClient extends RealtimeEventHandler {
  constructor({ url, apiKey, dangerouslyAllowAPIKeyInBrowser, debug, transport = 'websocket', ephemeralKey, fetchEphemeralKeyUrl } = {}) {
    super();
    
    // Validate key usage in browser environments
    if (globalThis.document) {
      if (transport === 'webrtc' && !ephemeralKey && !fetchEphemeralKeyUrl) {
        throw new Error('Either ephemeralKey or fetchEphemeralKeyUrl is required for WebRTC transport in browser environments');
      }
      if (transport === 'websocket' && apiKey && !dangerouslyAllowAPIKeyInBrowser) {
        throw new Error('Cannot use standard API key in browser without dangerouslyAllowAPIKeyInBrowser set to true');
      }
    }

    this.ephemeralKey = ephemeralKey;
    this.fetchEphemeralKeyUrl = fetchEphemeralKeyUrl;
    this.defaultSessionConfig = {
      modalities: ['text', 'audio'],
      instructions: '',
      voice: 'verse',
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: null,
      turn_detection: null,
      tools: [],
      tool_choice: 'auto',
      temperature: 0.8,
      max_response_output_tokens: 4096,
    };
    
    // Store the transport type for potential reconnection needs
    this.transport = transport;

    if (transport === 'webrtc') {
      if (!globalThis.document) {
        throw new Error('WebRTC transport is only supported in browser environments');
      }
      this.realtime = new RealtimeWebRTC({ debug });
    } else {
      this.realtime = new RealtimeAPI({
        url,
        apiKey,
        dangerouslyAllowAPIKeyInBrowser,
        debug,
      });
    }
    this.conversation = new RealtimeConversation();
    this._resetConfig();
    this._addAPIEventHandlers();
  }

  _resetConfig() {
    this.sessionCreated = false;
    this.tools = {};
    this.sessionConfig = JSON.parse(JSON.stringify(this.defaultSessionConfig));
    this.inputAudioBuffer = new Int16Array(0);
    return true;
  }

  _addAPIEventHandlers() {
    // Event Logging handlers
    this.realtime.on('client.*', (event) => {
      const realtimeEvent = {
        time: new Date().toISOString(),
        source: 'client',
        event: event,
      };
      this.dispatch('realtime.event', realtimeEvent);
    });
    this.realtime.on('server.*', (event) => {
      const realtimeEvent = {
        time: new Date().toISOString(),
        source: 'server',
        event: event,
      };
      this.dispatch('realtime.event', realtimeEvent);
    });

    // Handles session created event, can optionally wait for it
    this.realtime.on(
      'server.session.created',
      () => (this.sessionCreated = true),
    );

    // Setup for application control flow
    const handler = (event, ...args) => {
      const { item, delta } = this.conversation.processEvent(event, ...args);
      return { item, delta };
    };
    const handlerWithDispatch = (event, ...args) => {
      const { item, delta } = handler(event, ...args);
      if (item) {
        this.dispatch('conversation.updated', { item, delta });
      }
      return { item, delta };
    };
    const callTool = async (tool) => {
      try {
        const jsonArguments = JSON.parse(tool.arguments);
        const toolConfig = this.tools[tool.name];
        if (!toolConfig) {
          throw new Error(`Tool "${tool.name}" has not been added`);
        }
        const result = await toolConfig.handler(jsonArguments);
        this.realtime.send('conversation.item.create', {
          item: {
            type: 'function_call_output',
            call_id: tool.call_id,
            output: JSON.stringify(result),
          },
        });
      } catch (e) {
        this.realtime.send('conversation.item.create', {
          item: {
            type: 'function_call_output',
            call_id: tool.call_id,
            output: JSON.stringify({ error: e.message }),
          },
        });
      }
      this.createResponse();
    };

    // Handlers to update internal conversation state
    this.realtime.on('server.response.created', handler);
    this.realtime.on('server.response.output_item.added', handler);
    this.realtime.on('server.response.content_part.added', handler);
    this.realtime.on('server.input_audio_buffer.speech_started', (event) => {
      handler(event);
      this.dispatch('conversation.interrupted');
    });
    this.realtime.on('server.input_audio_buffer.speech_stopped', (event) =>
      handler(event, this.inputAudioBuffer),
    );

    // Handlers to update application state
    this.realtime.on('server.conversation.item.created', (event) => {
      const { item } = handlerWithDispatch(event);
      this.dispatch('conversation.item.appended', { item });
      if (item.status === 'completed') {
        this.dispatch('conversation.item.completed', { item });
      }
    });
    this.realtime.on('server.conversation.item.truncated', handlerWithDispatch);
    this.realtime.on('server.conversation.item.deleted', handlerWithDispatch);
    this.realtime.on(
      'server.conversation.item.input_audio_transcription.completed',
      handlerWithDispatch,
    );
    this.realtime.on(
      'server.response.audio_transcript.delta',
      handlerWithDispatch,
    );
    this.realtime.on('server.response.audio.delta', handlerWithDispatch);
    this.realtime.on('server.response.text.delta', handlerWithDispatch);
    this.realtime.on(
      'server.response.function_call_arguments.delta',
      handlerWithDispatch,
    );
    this.realtime.on('server.response.output_item.done', async (event) => {
      const { item } = handlerWithDispatch(event);
      if (item.status === 'completed') {
        this.dispatch('conversation.item.completed', { item });
      }
      if (item.formatted.tool) {
        callTool(item.formatted.tool);
      }
    });

    return true;
  }

  isConnected() {
    return this.realtime.isConnected();
  }

  reset() {
    this.disconnect();
    this.clearEventHandlers();
    this.realtime.clearEventHandlers();
    this._resetConfig();
    this._addAPIEventHandlers();
    return true;
  }

  async connect({ ephemeralKey } = {}) {
    if (this.isConnected()) {
      throw new Error(`Already connected, use .disconnect() first`);
    }

    // If ephemeral key is provided in connect(), use it
    if (ephemeralKey) {
      this.ephemeralKey = ephemeralKey;
    }
    
    // For WebRTC, try to fetch ephemeral key if needed
    if (this.transport === 'webrtc') {
      if (!this.ephemeralKey && this.fetchEphemeralKeyUrl) {
        try {
          const response = await fetch(this.fetchEphemeralKeyUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch ephemeral key: ${response.status} ${response.statusText}`);
          }
          const data = await response.json();
          if (!data.ephemeral_key) {
            throw new Error('Response missing ephemeral_key field');
          }
          this.ephemeralKey = data.ephemeral_key;
        } catch (error) {
          throw new Error(`Failed to fetch ephemeral key: ${error.message}`);
        }
      }
      
      if (!this.ephemeralKey) {
        throw new Error('Ephemeral key is required for WebRTC transport');
      }

      await this.realtime.connect({ 
        ephemeralKey: this.ephemeralKey,
        sessionConfig: this.sessionConfig
      });
    } else {
      await this.realtime.connect();
    }
    
    this.updateSession();
    return true;
  }

  async waitForSessionCreated() {
    if (!this.isConnected()) {
      throw new Error(`Not connected, use .connect() first`);
    }
    while (!this.sessionCreated) {
      await new Promise((r) => setTimeout(() => r(), 1));
    }
    return true;
  }

  disconnect() {
    this.sessionCreated = false;
    this.realtime.isConnected() && this.realtime.disconnect();
    this.conversation.clear();
  }

  getTurnDetectionType() {
    return this.sessionConfig.turn_detection?.type || null;
  }

  addTool(definition, handler) {
    if (!definition?.name) {
      throw new Error(`Missing tool name in definition`);
    }
    const name = definition?.name;
    if (this.tools[name]) {
      throw new Error(
        `Tool "${name}" already added. Please use .removeTool("${name}") before trying to add again.`,
      );
    }
    if (typeof handler !== 'function') {
      throw new Error(`Tool "${name}" handler must be a function`);
    }
    this.tools[name] = { definition, handler };
    this.updateSession();
    return this.tools[name];
  }

  removeTool(name) {
    if (!this.tools[name]) {
      throw new Error(`Tool "${name}" does not exist, can not be removed.`);
    }
    delete this.tools[name];
    return true;
  }

  deleteItem(id) {
    this.realtime.send('conversation.item.delete', { item_id: id });
    return true;
  }

  updateSession({
    modalities = void 0,
    instructions = void 0,
    voice = void 0,
    input_audio_format = void 0,
    output_audio_format = void 0,
    input_audio_transcription = void 0,
    turn_detection = void 0,
    tools = void 0,
    tool_choice = void 0,
    temperature = void 0,
    max_response_output_tokens = void 0,
  } = {}) {
    modalities !== void 0 && (this.sessionConfig.modalities = modalities);
    instructions !== void 0 && (this.sessionConfig.instructions = instructions);
    voice !== void 0 && (this.sessionConfig.voice = voice);
    input_audio_format !== void 0 &&
      (this.sessionConfig.input_audio_format = input_audio_format);
    output_audio_format !== void 0 &&
      (this.sessionConfig.output_audio_format = output_audio_format);
    input_audio_transcription !== void 0 &&
      (this.sessionConfig.input_audio_transcription = input_audio_transcription);
    turn_detection !== void 0 &&
      (this.sessionConfig.turn_detection = turn_detection);
    tools !== void 0 && (this.sessionConfig.tools = tools);
    tool_choice !== void 0 && (this.sessionConfig.tool_choice = tool_choice);
    temperature !== void 0 && (this.sessionConfig.temperature = temperature);
    max_response_output_tokens !== void 0 &&
      (this.sessionConfig.max_response_output_tokens = max_response_output_tokens);

    if (this.isConnected()) {
      this.realtime.send('session.update', {
        session: this.sessionConfig,
      });
    }
    return true;
  }
}
