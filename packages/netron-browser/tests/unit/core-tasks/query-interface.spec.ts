/**
 * Tests for query-interface core-task
 */

import { describe, it, expect } from 'vitest';
import {
  CORE_TASK_QUERY_INTERFACE,
  createQueryInterfaceRequest,
  isQueryInterfaceResponse,
  resolveServiceName,
  filterDefinition,
  processQueryInterfaceResponse,
  extractMetadata,
  isFilteredDefinition,
  validateQueryInterfaceRequest,
  buildQueryInterfaceTaskData,
  parseServiceName,
  formatServiceName,
  type QueryInterfaceRequest,
  type QueryInterfaceResponse,
} from '../../../src/core-tasks/query-interface.js';
import { Definition } from '../../../src/core/definition.js';
import { TitanError, ErrorCode } from '../../../src/errors/index.js';

describe('query-interface core-task', () => {
  describe('createQueryInterfaceRequest', () => {
    it('should create a valid request with service name', () => {
      const request = createQueryInterfaceRequest('UserService@1.0.0');

      expect(request).toEqual({
        serviceName: 'UserService@1.0.0',
      });
    });

    it('should create a request for wildcard version', () => {
      const request = createQueryInterfaceRequest('UserService');

      expect(request).toEqual({
        serviceName: 'UserService',
      });
    });
  });

  describe('isQueryInterfaceResponse', () => {
    it('should return true for valid response', () => {
      const response: QueryInterfaceResponse = {
        definition: new Definition('def-1', 'peer-1', {
          name: 'UserService',
          version: '1.0.0',
          properties: {},
          methods: {},
        }),
      };

      expect(isQueryInterfaceResponse(response)).toBe(true);
    });

    it('should return false for invalid response', () => {
      expect(isQueryInterfaceResponse(null)).toBeFalsy();
      expect(isQueryInterfaceResponse(undefined)).toBeFalsy();
      expect(isQueryInterfaceResponse({})).toBeFalsy();
      expect(isQueryInterfaceResponse({ definition: null })).toBeFalsy();
    });

    it('should return true for response with filtered flag', () => {
      const response: QueryInterfaceResponse = {
        definition: new Definition('def-1', 'peer-1', {
          name: 'UserService',
          version: '1.0.0',
          properties: {},
          methods: { getUser: { type: 'User', arguments: [] } },
        }),
        filtered: true,
        resolvedName: 'UserService@1.0.0',
      };

      expect(isQueryInterfaceResponse(response)).toBe(true);
    });
  });

  describe('resolveServiceName', () => {
    it('should return exact match if available', () => {
      const services = new Map([
        ['UserService@1.0.0', {}],
        ['UserService@2.0.0', {}],
      ]);

      const resolved = resolveServiceName('UserService@1.0.0', services);
      expect(resolved).toBe('UserService@1.0.0');
    });

    it('should resolve wildcard to latest version', () => {
      const services = new Map([
        ['UserService@1.0.0', {}],
        ['UserService@1.5.0', {}],
        ['UserService@2.0.0', {}],
      ]);

      const resolved = resolveServiceName('UserService', services);
      expect(resolved).toBe('UserService@2.0.0');
    });

    it('should throw if service not found', () => {
      const services = new Map([['OtherService@1.0.0', {}]]);

      expect(() => resolveServiceName('UserService', services)).toThrow(TitanError);
      expect(() => resolveServiceName('UserService', services)).toThrow(/not found/);
    });

    it('should handle complex version comparison', () => {
      const services = new Map([
        ['UserService@1.0.0', {}],
        ['UserService@1.0.10', {}],
        ['UserService@1.0.2', {}],
      ]);

      const resolved = resolveServiceName('UserService', services);
      expect(resolved).toBe('UserService@1.0.10');
    });
  });

  describe('filterDefinition', () => {
    it('should return full definition when no auth context', () => {
      const metadata = {
        name: 'UserService',
        version: '1.0.0',
        properties: {},
        methods: {
          getUser: { type: 'User', arguments: [] },
          deleteUser: { type: 'void', arguments: [] },
        },
      };

      const filtered = filterDefinition(metadata);
      expect(filtered).toEqual(metadata);
    });

    it('should return full definition with auth context (client-side pass-through)', () => {
      const metadata = {
        name: 'UserService',
        version: '1.0.0',
        properties: {},
        methods: {
          getUser: { type: 'User', arguments: [] },
          deleteUser: { type: 'void', arguments: [] },
        },
      };

      const authContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['user:read'],
      };

      const filtered = filterDefinition(metadata, authContext);
      // Client-side filtering is a pass-through - trusts server
      expect(filtered).toEqual(metadata);
    });
  });

  describe('processQueryInterfaceResponse', () => {
    it('should process valid response', () => {
      const response: QueryInterfaceResponse = {
        definition: new Definition('def-1', 'peer-1', {
          name: 'UserService',
          version: '1.0.0',
          properties: {},
          methods: {},
        }),
      };

      const processed = processQueryInterfaceResponse(response);
      expect(processed).toEqual(response);
    });

    it('should throw for invalid response', () => {
      expect(() => processQueryInterfaceResponse(null)).toThrow(TitanError);
      expect(() => processQueryInterfaceResponse({})).toThrow(/Invalid query interface response/);
    });
  });

  describe('extractMetadata', () => {
    it('should extract metadata from definition', () => {
      const metadata = {
        name: 'UserService',
        version: '1.0.0',
        properties: {},
        methods: {},
      };

      const definition = new Definition('def-1', 'peer-1', metadata);
      const extracted = extractMetadata(definition);

      expect(extracted).toEqual(metadata);
    });
  });

  describe('isFilteredDefinition', () => {
    it('should return true when filtered flag is set', () => {
      const response: QueryInterfaceResponse = {
        definition: new Definition('def-1', 'peer-1', {
          name: 'UserService',
          version: '1.0.0',
          properties: {},
          methods: { getUser: { type: 'User', arguments: [] } },
        }),
        filtered: true,
      };

      expect(isFilteredDefinition(response)).toBe(true);
    });

    it('should return true when no methods or properties', () => {
      const response: QueryInterfaceResponse = {
        definition: new Definition('def-1', 'peer-1', {
          name: 'UserService',
          version: '1.0.0',
          properties: {},
          methods: {},
        }),
      };

      expect(isFilteredDefinition(response)).toBe(true);
    });

    it('should return false for normal definition', () => {
      const response: QueryInterfaceResponse = {
        definition: new Definition('def-1', 'peer-1', {
          name: 'UserService',
          version: '1.0.0',
          properties: {},
          methods: { getUser: { type: 'User', arguments: [] } },
        }),
        filtered: false,
      };

      expect(isFilteredDefinition(response)).toBe(false);
    });
  });

  describe('validateQueryInterfaceRequest', () => {
    it('should validate correct request', () => {
      const request: QueryInterfaceRequest = {
        serviceName: 'UserService@1.0.0',
      };

      expect(() => validateQueryInterfaceRequest(request)).not.toThrow();
    });

    it('should validate wildcard request', () => {
      const request: QueryInterfaceRequest = {
        serviceName: 'UserService',
      };

      expect(() => validateQueryInterfaceRequest(request)).not.toThrow();
    });

    it('should throw for null request', () => {
      expect(() => validateQueryInterfaceRequest(null as any)).toThrow(TitanError);
      expect(() => validateQueryInterfaceRequest(null as any)).toThrow(/Invalid query interface request/);
    });

    it('should throw for missing service name', () => {
      const request = {} as any;

      expect(() => validateQueryInterfaceRequest(request)).toThrow(TitanError);
      expect(() => validateQueryInterfaceRequest(request)).toThrow(/Service name is required/);
    });

    it('should throw for invalid service name format', () => {
      const request: QueryInterfaceRequest = {
        serviceName: 'Invalid Service Name!',
      };

      expect(() => validateQueryInterfaceRequest(request)).toThrow(TitanError);
      expect(() => validateQueryInterfaceRequest(request)).toThrow(/Invalid service name format/);
    });

    it('should allow service names with dots, dashes, and underscores', () => {
      const validNames = ['user.service@1.0.0', 'user-service@1.0.0', 'user_service@1.0.0', 'my.user-service_v2@1.0.0'];

      for (const serviceName of validNames) {
        const request: QueryInterfaceRequest = { serviceName };
        expect(() => validateQueryInterfaceRequest(request)).not.toThrow();
      }
    });
  });

  describe('buildQueryInterfaceTaskData', () => {
    it('should build correct task data', () => {
      const taskData = buildQueryInterfaceTaskData('UserService@1.0.0');

      expect(taskData).toEqual({
        task: CORE_TASK_QUERY_INTERFACE,
        serviceName: 'UserService@1.0.0',
      });
    });

    it('should handle wildcard service names', () => {
      const taskData = buildQueryInterfaceTaskData('UserService');

      expect(taskData).toEqual({
        task: CORE_TASK_QUERY_INTERFACE,
        serviceName: 'UserService',
      });
    });
  });

  describe('parseServiceName', () => {
    it('should parse qualified name with version', () => {
      const parsed = parseServiceName('UserService@1.0.0');

      expect(parsed).toEqual({
        name: 'UserService',
        version: '1.0.0',
        isWildcard: false,
      });
    });

    it('should parse name without version as wildcard', () => {
      const parsed = parseServiceName('UserService');

      expect(parsed).toEqual({
        name: 'UserService',
        version: undefined,
        isWildcard: true,
      });
    });
  });

  describe('formatServiceName', () => {
    it('should format name with version', () => {
      const formatted = formatServiceName('UserService', '1.0.0');
      expect(formatted).toBe('UserService@1.0.0');
    });

    it('should format name without version', () => {
      const formatted = formatServiceName('UserService');
      expect(formatted).toBe('UserService');
    });

    it('should handle undefined version', () => {
      const formatted = formatServiceName('UserService', undefined);
      expect(formatted).toBe('UserService');
    });
  });

  describe('CORE_TASK_QUERY_INTERFACE constant', () => {
    it('should have correct value', () => {
      expect(CORE_TASK_QUERY_INTERFACE).toBe('query_interface');
    });
  });
});
