import { describe, it, expect } from 'vitest';
import {
  Packet as BrowserPacket,
  TYPE_CALL,
  TYPE_PING,
  createPacket as createBrowserPacket,
  encodePacket as encodeBrowserPacket,
  decodePacket as decodeBrowserPacket,
} from '../../src/packet/index.js';

// Import Titan's packet system for compatibility testing
import {
  Packet as TitanPacket,
  TYPE_CALL as TITAN_TYPE_CALL,
  TYPE_PING as TITAN_TYPE_PING,
  createPacket as createTitanPacket,
  encodePacket as encodeTitanPacket,
  decodePacket as decodeTitanPacket,
} from '@omnitron-dev/titan/netron';

// SHARED-PROTO: Definition + Reference are now ONE shared class (from
// @omnitron-dev/netron-protocol), re-exported by both titan and netron-browser.
// A cross-impl serialize round-trip proves the wire-level consequence.
import { Definition, Reference } from '@omnitron-dev/netron-protocol';

describe('Packet Protocol Compatibility', () => {
  describe('Type Constants', () => {
    it('should have matching packet type constants', () => {
      expect(TYPE_CALL).toBe(TITAN_TYPE_CALL);
      expect(TYPE_PING).toBe(TITAN_TYPE_PING);
    });
  });

  describe('Browser → Titan Compatibility', () => {
    it('should decode browser-encoded packet in Titan', () => {
      const browserPacket = createBrowserPacket(1, 1, TYPE_CALL, {
        method: 'test',
        args: [1, 2, 3],
      });

      const encoded = encodeBrowserPacket(browserPacket);
      const titanPacket = decodeTitanPacket(Buffer.from(encoded));

      expect(titanPacket.id).toBe(browserPacket.id);
      expect(titanPacket.getType()).toBe(browserPacket.getType());
      expect(titanPacket.getImpulse()).toBe(browserPacket.getImpulse());
      expect(titanPacket.data).toEqual(browserPacket.data);
    });

    it('should handle complex data structures', () => {
      const complexData = {
        string: 'test',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: {
          key: 'value',
          deep: { deeper: 'value' },
        },
        date: new Date('2025-01-01T00:00:00Z'),
      };

      const browserPacket = createBrowserPacket(2, 1, TYPE_CALL, complexData);
      const encoded = encodeBrowserPacket(browserPacket);
      const titanPacket = decodeTitanPacket(Buffer.from(encoded));

      expect(titanPacket.data).toEqual(complexData);
    });
  });

  describe('Titan → Browser Compatibility', () => {
    it('should decode titan-encoded packet in browser', () => {
      const titanPacket = createTitanPacket(3, 1, TITAN_TYPE_CALL, {
        service: 'TestService',
        method: 'testMethod',
        args: ['arg1', 'arg2'],
      });

      const encoded = encodeTitanPacket(titanPacket);
      const browserPacket = decodeBrowserPacket(new Uint8Array(encoded));

      expect(browserPacket.id).toBe(titanPacket.id);
      expect(browserPacket.getType()).toBe(titanPacket.getType());
      expect(browserPacket.getImpulse()).toBe(titanPacket.getImpulse());
      expect(browserPacket.data).toEqual(titanPacket.data);
    });

    it('should handle ping packets', () => {
      const titanPacket = createTitanPacket(4, 1, TITAN_TYPE_PING, null);
      const encoded = encodeTitanPacket(titanPacket);
      const browserPacket = decodeBrowserPacket(new Uint8Array(encoded));

      expect(browserPacket.getType()).toBe(TYPE_PING);
      expect(browserPacket.data).toBe(null);
    });

    it('should handle error responses', () => {
      const errorData = {
        code: 500,
        message: 'Internal Server Error',
        details: { reason: 'test error' },
      };

      const titanPacket = createTitanPacket(5, 0, TITAN_TYPE_CALL, errorData);
      titanPacket.setError(1);

      const encoded = encodeTitanPacket(titanPacket);
      const browserPacket = decodeBrowserPacket(new Uint8Array(encoded));

      expect(browserPacket.getError()).toBe(1);
      expect(browserPacket.data).toEqual(errorData);
    });
  });

  describe('Round-trip Compatibility', () => {
    it('should maintain data integrity through browser → titan → browser', () => {
      const originalData = {
        id: 'test-123',
        values: [1, 2, 3, 4, 5],
        metadata: { type: 'test', timestamp: Date.now() },
      };

      // Browser encodes
      const browserPacket1 = createBrowserPacket(6, 1, TYPE_CALL, originalData);
      const browserEncoded = encodeBrowserPacket(browserPacket1);

      // Titan decodes
      const titanPacket = decodeTitanPacket(Buffer.from(browserEncoded));

      // Titan encodes
      const titanEncoded = encodeTitanPacket(titanPacket);

      // Browser decodes
      const browserPacket2 = decodeBrowserPacket(new Uint8Array(titanEncoded));

      expect(browserPacket2.data).toEqual(originalData);
    });

    it('should maintain data integrity through titan → browser → titan', () => {
      const originalData = {
        service: 'UserService',
        method: 'getUser',
        args: [{ id: 123 }],
      };

      // Titan encodes
      const titanPacket1 = createTitanPacket(7, 1, TITAN_TYPE_CALL, originalData);
      const titanEncoded = encodeTitanPacket(titanPacket1);

      // Browser decodes
      const browserPacket = decodeBrowserPacket(new Uint8Array(titanEncoded));

      // Browser encodes
      const browserEncoded = encodeBrowserPacket(browserPacket);

      // Titan decodes
      const titanPacket2 = decodeTitanPacket(Buffer.from(browserEncoded));

      expect(titanPacket2.data).toEqual(originalData);
    });
  });

  describe('Binary Format Compatibility', () => {
    it('should produce identical binary output for same packet', () => {
      const data = { test: 'compatibility' };

      const browserPacket = createBrowserPacket(8, 1, TYPE_CALL, data);
      const titanPacket = createTitanPacket(8, 1, TITAN_TYPE_CALL, data);

      const browserEncoded = encodeBrowserPacket(browserPacket);
      const titanEncoded = encodeTitanPacket(titanPacket);

      // Convert both to Uint8Array for comparison
      const browserArray = new Uint8Array(browserEncoded);
      const titanArray = new Uint8Array(titanEncoded);

      expect(browserArray).toEqual(titanArray);
    });
  });

  describe('Shared-type Compatibility (SHARED-PROTO)', () => {
    const meta = {
      name: 'UserService',
      version: '1.0.0',
      properties: { id: { type: 'string', readonly: true } },
      methods: { getUser: { type: 'User', arguments: [{ index: 0, type: 'string' }] } },
    };

    it('round-trips a Definition titan → browser (one shared class)', () => {
      const def = new Definition('def-abc', 'peer-1', meta);
      const titanPacket = createTitanPacket(20, 1, TITAN_TYPE_CALL, { definition: def });
      const encoded = encodeTitanPacket(titanPacket);
      const browserPacket = decodeBrowserPacket(new Uint8Array(encoded));

      const decoded = browserPacket.data.definition;
      expect(decoded).toBeInstanceOf(Definition);
      expect(decoded.id).toBe('def-abc');
      expect(decoded.peerId).toBe('peer-1');
      expect(decoded.meta).toEqual(meta);
    });

    it('round-trips a Definition browser → titan', () => {
      const def = new Definition('def-xyz', 'peer-2', meta);
      const browserPacket = createBrowserPacket(21, 1, TYPE_CALL, { definition: def });
      const encoded = encodeBrowserPacket(browserPacket);
      const titanPacket = decodeTitanPacket(Buffer.from(encoded));

      const decoded = titanPacket.data.definition;
      expect(decoded).toBeInstanceOf(Definition);
      expect(decoded.id).toBe('def-xyz');
      expect(decoded.meta).toEqual(meta);
    });

    it('round-trips a Reference cross-impl', () => {
      const ref = new Reference('def-abc');
      const titanPacket = createTitanPacket(22, 1, TITAN_TYPE_CALL, { ref });
      const encoded = encodeTitanPacket(titanPacket);
      const browserPacket = decodeBrowserPacket(new Uint8Array(encoded));

      const decoded = browserPacket.data.ref;
      expect(decoded).toBeInstanceOf(Reference);
      expect(decoded.defId).toBe('def-abc');
    });
  });

  describe('Flag Compatibility', () => {
    it('should maintain all flag bits correctly', () => {
      const browserPacket = createBrowserPacket(9, 1, TYPE_CALL, 'test');
      browserPacket.setError(1);

      const encoded = encodeBrowserPacket(browserPacket);
      const titanPacket = decodeTitanPacket(Buffer.from(encoded));

      expect(titanPacket.getImpulse()).toBe(1);
      expect(titanPacket.getType()).toBe(TYPE_CALL);
      expect(titanPacket.getError()).toBe(1);
    });
  });
});
