import * as chai from 'chai';
const expect = chai.expect;

import { RealtimeClient } from '../../index.js';

export async function run({ debug = false } = {}) {
  describe('RealtimeClient (Node.js)', () => {
    let client;
    let realtimeEvents = [];

    it('Should instantiate the RealtimeClient', () => {
      client = new RealtimeClient({
        apiKey: process.env.OPENAI_API_KEY,
        debug,
      });

      client.updateSession({
        instructions:
          `You always, ALWAYS reference San Francisco` +
          ` by name in every response. Always include the phrase "San Francisco".` +
          ` This is for testing so stick to it!`,
      });
      client.on('realtime.event', (realtimeEvent) =>
        realtimeEvents.push(realtimeEvent),
      );

      expect(client).to.exist;
      expect(client.realtime).to.exist;
      expect(client.conversation).to.exist;
      expect(client.realtime.apiKey).to.equal(process.env.OPENAI_API_KEY);
    });

    describe('turn_end_mode: "client_decision"', () => {
      it('Should connect to the RealtimeClient', async () => {
        const isConnected = await client.connect();

        expect(isConnected).to.equal(true);
        expect(client.isConnected()).to.equal(true);
      });

      it('Should receive "session.created" and send "session.update"', async () => {
        await client.waitForSessionCreated();

        expect(realtimeEvents.length).to.equal(2);

        const clientEvent1 = realtimeEvents[0];

        expect(clientEvent1.source).to.equal('client');
        expect(clientEvent1.event.type).to.equal('session.update');

        const serverEvent1 = realtimeEvents[1];

        expect(serverEvent1.source).to.equal('server');
        expect(serverEvent1.event.type).to.equal('session.created');

        console.log(`[Session ID] ${serverEvent1.event.session.id}`);
      });

      it('Should send a simple hello message (text)', () => {
        const content = [{ type: 'input_text', text: `How are you?` }];

        client.sendUserMessageContent(content);

        expect(realtimeEvents.length).to.equal(4);

        const itemEvent = realtimeEvents[2];

        expect(itemEvent.source).to.equal('client');
        expect(itemEvent.event.type).to.equal('conversation.item.create');

        const responseEvent = realtimeEvents[3];

        expect(responseEvent).to.exist;
        expect(responseEvent.source).to.equal('client');
        expect(responseEvent.event.type).to.equal('response.create');
      });

      it('Should waitForNextItem to receive "conversation.item.created" from user', async function () {
        this.timeout(10_000);

        const { item } = await client.waitForNextItem();

        expect(item).to.exist;
        expect(item.type).to.equal('message');
        expect(item.role).to.equal('user');
        expect(item.status).to.equal('completed');
        expect(item.formatted.text).to.equal(`How are you?`);
      });

      it('Should waitForNextItem to receive "conversation.item.created" from assistant', async function () {
        this.timeout(10_000);

        const { item } = await client.waitForNextItem();

        expect(item).to.exist;
        expect(item.type).to.equal('message');
        expect(item.role).to.equal('assistant');
        expect(item.status).to.equal('in_progress');
        expect(item.formatted.text).to.equal(``);
      });

      it('Should waitForNextCompletedItem to receive completed item from assistant', async function () {
        this.timeout(10_000);

        const { item } = await client.waitForNextCompletedItem();

        expect(item).to.exist;
        expect(item.type).to.equal('message');
        expect(item.role).to.equal('assistant');
        expect(item.status).to.equal('completed');
        expect(item.formatted.transcript.toLowerCase()).to.contain(
          'san francisco',
        );
      });

      it('Should close the RealtimeClient connection', async () => {
        client.disconnect();

        expect(client.isConnected()).to.equal(false);
      });
    });
  });

  describe('RealtimeClient (Browser/WebRTC)', () => {
    let client;
    let realtimeEvents = [];

    before(async () => {
      // Mock browser environment
      globalThis.document = {};
      globalThis.RTCPeerConnection = class MockRTCPeerConnection {
        constructor() { this.connectionState = 'new'; }
        createDataChannel() { return { readyState: 'open' }; }
      };
    });

    after(async () => {
      delete globalThis.document;
      delete globalThis.RTCPeerConnection;
    });

    beforeEach(() => {
      realtimeEvents = [];
    });

    afterEach(() => {
      if (client?.isConnected()) {
        client.disconnect();
      }
      delete globalThis.fetch;
    });

    it('Should require ephemeralKey or fetchEphemeralKeyUrl for WebRTC in browser', () => {
      expect(() => new RealtimeClient({ transport: 'webrtc' }))
        .to.throw('Either ephemeralKey or fetchEphemeralKeyUrl is required');
    });

    it('Should automatically fetch ephemeral key when using fetchEphemeralKeyUrl', async () => {
      // Mock both the SDP answer and ephemeral key responses
      let fetchCount = 0;
      globalThis.fetch = async (url) => {
        fetchCount++;
        if (url === '/api/ephemeral') {
          return new Response(JSON.stringify({ ephemeral_key: 'mock-auto-key' }));
        }
        return new Response(JSON.stringify({ type: 'answer', sdp: 'mock-sdp-answer' }));
      };

      client = new RealtimeClient({
        transport: 'webrtc',
        fetchEphemeralKeyUrl: '/api/ephemeral',
        debug: true
      });

      client.on('realtime.event', (event) => realtimeEvents.push(event));

      await client.connect();
      expect(client.ephemeralKey).to.equal('mock-auto-key');
      expect(client.isConnected()).to.be.true;
      expect(fetchCount).to.equal(2); // One for key, one for SDP
    });

    it('Should handle ephemeral key fetch failures', async () => {
      globalThis.fetch = async (url) => {
        if (url === '/api/ephemeral') {
          return new Response('Unauthorized', { status: 401 });
        }
        return new Response(JSON.stringify({ type: 'answer', sdp: 'mock-sdp-answer' }));
      };

      client = new RealtimeClient({
        transport: 'webrtc',
        fetchEphemeralKeyUrl: '/api/ephemeral',
        debug: true
      });

      try {
        await client.connect();
        expect.fail('Should throw error on key fetch failure');
      } catch (error) {
        expect(error.message).to.include('Failed to fetch ephemeral key');
        expect(client.isConnected()).to.be.false;
      }
    });

    it('Should support manual ephemeral key provision', async () => {
      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ type: 'answer', sdp: 'mock-sdp-answer' }));
      };

      client = new RealtimeClient({
        transport: 'webrtc',
        ephemeralKey: 'manual-key',
        debug: true
      });

      await client.connect();
      expect(client.ephemeralKey).to.equal('manual-key');
      expect(client.isConnected()).to.be.true;
    });
  });
}
