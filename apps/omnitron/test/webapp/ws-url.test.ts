/**
 * Where the console looks for the daemon's event stream.
 *
 * Both deployments — nginx in front of the built console, and the vite dev
 * server — proxy `/ws` on the console's own origin. So the only correct
 * answer is "this origin", and every port the client names itself is a port
 * it can get wrong.
 */

import { describe, it, expect } from 'vitest';

import { resolveWsUrl } from '../../webapp/src/netron/ws-client.js';

describe('resolveWsUrl', () => {
  it('follows the page onto its own port', () => {
    expect(resolveWsUrl({ protocol: 'http:', host: 'localhost:9800' })).toBe('ws://localhost:9800/ws');
  });

  it('follows the dev server, whatever port it took', () => {
    expect(resolveWsUrl({ protocol: 'http:', host: 'localhost:9810' })).toBe('ws://localhost:9810/ws');
  });

  it('names no port when the page is on a default one', () => {
    // This is the case the old code got wrong: an empty `location.port` made
    // it fall back to 9802 and reach past the proxy at a port no such
    // deployment publishes.
    expect(resolveWsUrl({ protocol: 'https:', host: 'console.example.com' })).toBe(
      'wss://console.example.com/ws'
    );
  });

  it('upgrades to wss on an https page', () => {
    // A plaintext ws:// from an https page is blocked by the browser as
    // mixed content, and the block is silent — the socket simply never
    // opens and the console degrades to polling with no error to read.
    expect(resolveWsUrl({ protocol: 'https:', host: 'console.example.com:8443' })).toBe(
      'wss://console.example.com:8443/ws'
    );
  });

  it('stays plaintext on an http page', () => {
    expect(resolveWsUrl({ protocol: 'http:', host: '10.0.0.5:9800' })).toBe('ws://10.0.0.5:9800/ws');
  });
});
