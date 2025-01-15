import * as chai from 'chai';
const expect = chai.expect;

import { RealtimeClient } from '../../index.js';

export async function run({ debug = false } = {}) {
  describe('RealtimeClient', () => {
    describe('WebRTC Transport', () => {
      let client;

      beforeEach(() => {
        // Mock browser environment
        globalThis.document = {};
      });

      afterEach(() => {
        delete globalThis.document;
        if (client?.isConnected()) {
          client.disconnect();
        }
      });

      it('requires ephemeral key or fetch URL in browser', () => {
        expect(() => {
          client = new RealtimeClient({
            transport: 'webrtc',
            debug
          });
        }).to.throw(/ephemeralKey.*required/);
      });

      it('connects with manual ephemeral key', async () => {
        client = new RealtimeClient({
          transport: 'webrtc',
          ephemeralKey: 'test-key',
          debug
        });
        
        const isConnected = await client.connect();
        expect(isConnected).to.be.true;
        expect(client.isConnected()).to.be.true;
      });

      it('fetches ephemeral key automatically', async () => {
        const mockResponse = { ephemeral_key: 'auto-key' };
        globalThis.fetch = async () => new Response(JSON.stringify(mockResponse));

        client = new RealtimeClient({
          transport: 'webrtc',
          fetchEphemeralKeyUrl: '/api/key',
          debug
        });

        const isConnected = await client.connect();
        expect(isConnected).to.be.true;
        expect(client.ephemeralKey).to.equal('auto-key');

        delete globalThis.fetch;
      });
    });
  });
}
