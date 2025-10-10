/**
 * Tests for query_interface core-task
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { query_interface } from '../../../src/netron/core-tasks/query-interface.js';
import type { Definition } from '../../../src/netron/definition.js';
import type { AuthContext } from '../../../src/netron/auth/types.js';
import { TitanError, ErrorCode } from '../../../src/errors/index.js';

describe('query_interface core-task', () => {
  let remotePeer: any;
  let mockNetron: any;
  let mockAuthzManager: any;
  let mockLogger: any;
  let servicesMap: Map<string, any>; // Map of ServiceStub objects

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    servicesMap = new Map();

    mockAuthzManager = {
      canAccessService: jest.fn(),
      filterDefinition: jest.fn(),
    };

    mockNetron = {
      authorizationManager: mockAuthzManager,
      services: servicesMap, // Services are now on Netron, not peer
      logger: mockLogger,
    };

    remotePeer = {
      netron: mockNetron,
      logger: mockLogger,
      getAuthContext: jest.fn(),
    } as any;
  });

  // Helper function to create mock ServiceStub
  function createMockServiceStub(definition: Definition) {
    return {
      definition,
      peer: {},
      instance: {},
    };
  }

  describe('service discovery', () => {
    it('should return service definition when found', async () => {
      const serviceName = 'userService@1.0.0';
      const definition: Definition = {
        id: 'def-123',
        peerId: 'peer-123',
        parentId: '',
        meta: {
          name: 'userService',
          version: '1.0.0',
          properties: {},
          methods: {
            getUser: { type: 'function', transports: [] },
            updateUser: { type: 'function', transports: [] },
          },
          transports: [],
        },
      };

      servicesMap.set(serviceName, createMockServiceStub(definition));
      mockAuthzManager.canAccessService.mockReturnValue(true);
      mockAuthzManager.filterDefinition.mockReturnValue(definition.meta);

      const result = await query_interface(remotePeer, serviceName);

      expect(result).toEqual(definition);
      expect(mockAuthzManager.canAccessService).toHaveBeenCalledWith(serviceName, undefined);
    });

    it('should throw error when service not found', async () => {
      const serviceName = 'nonexistent@1.0.0';

      await expect(query_interface(remotePeer, serviceName)).rejects.toThrow(TitanError);

      try {
        await query_interface(remotePeer, serviceName);
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.NOT_FOUND);
        expect(error.message).toContain('Service \'nonexistent@1.0.0\' not found');
        // availableServices removed from error details for security (commit 2d3767b)
        expect(error.details.serviceName).toBe(serviceName);
      }
    });
  });

  describe('authorization checks', () => {
    it('should check user authorization to access service', async () => {
      const serviceName = 'adminService@1.0.0';
      const definition: Definition = {
        id: 'def-456',
        peerId: 'peer-123',
        parentId: '',
        meta: {
          name: 'adminService',
          version: '1.0.0',
          properties: {},
          methods: {
            deleteUser: { type: 'function', transports: [] },
          },
          transports: [],
        },
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['admin'],
        permissions: ['admin:delete'],
      };

      servicesMap.set(serviceName, createMockServiceStub(definition));
      remotePeer.getAuthContext.mockReturnValue(authContext);
      mockAuthzManager.canAccessService.mockReturnValue(true);
      mockAuthzManager.filterDefinition.mockReturnValue(definition.meta);

      await query_interface(remotePeer, serviceName);

      expect(mockAuthzManager.canAccessService).toHaveBeenCalledWith(serviceName, authContext);
    });

    it('should deny access when user lacks permissions', async () => {
      const serviceName = 'adminService@1.0.0';
      const definition: Definition = {
        id: 'def-456',
        peerId: 'peer-123',
        parentId: '',
        meta: {
          name: 'adminService',
          version: '1.0.0',
          properties: {},
          methods: {},
          transports: [],
        },
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: ['read:documents'],
      };

      servicesMap.set(serviceName, createMockServiceStub(definition));
      remotePeer.getAuthContext.mockReturnValue(authContext);
      mockAuthzManager.canAccessService.mockReturnValue(false);

      await expect(query_interface(remotePeer, serviceName)).rejects.toThrow(TitanError);

      try {
        await query_interface(remotePeer, serviceName);
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.FORBIDDEN);
        expect(error.message).toContain('Access denied');
        expect(mockLogger.warn).toHaveBeenCalled();
      }
    });

    it('should handle unauthenticated users', async () => {
      const serviceName = 'publicService@1.0.0';
      const definition: Definition = {
        id: 'def-789',
        peerId: 'peer-123',
        parentId: '',
        meta: {
          name: 'publicService',
          version: '1.0.0',
          properties: {},
          methods: {
            getInfo: { type: 'function', transports: [] },
          },
          transports: [],
        },
      };

      servicesMap.set(serviceName, createMockServiceStub(definition));
      remotePeer.getAuthContext.mockReturnValue(undefined);
      mockAuthzManager.canAccessService.mockReturnValue(true);
      mockAuthzManager.filterDefinition.mockReturnValue(definition.meta);

      const result = await query_interface(remotePeer, serviceName);

      expect(result).toBeDefined();
      expect(mockAuthzManager.canAccessService).toHaveBeenCalledWith(serviceName, undefined);
    });
  });

  describe('definition filtering', () => {
    it('should filter methods based on user permissions', async () => {
      const serviceName = 'userService@1.0.0';
      const fullDefinition: Definition = {
        id: 'def-123',
        peerId: 'peer-123',
        parentId: '',
        meta: {
          name: 'userService',
          version: '1.0.0',
          properties: {},
          methods: {
            getUser: { type: 'function', transports: [] },
            updateUser: { type: 'function', transports: [] },
            deleteUser: { type: 'function', transports: [] },
          },
          transports: [],
        },
      };

      const filteredMeta = {
        ...fullDefinition.meta,
        methods: {
          getUser: { type: 'function', transports: [] },
          updateUser: { type: 'function', transports: [] },
          // deleteUser removed due to permissions
        },
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: ['read:users', 'write:users'],
      };

      servicesMap.set(serviceName, createMockServiceStub(fullDefinition));
      remotePeer.getAuthContext.mockReturnValue(authContext);
      mockAuthzManager.canAccessService.mockReturnValue(true);
      mockAuthzManager.filterDefinition.mockReturnValue(filteredMeta);

      const result = await query_interface(remotePeer, serviceName);

      expect(result?.meta).toEqual(filteredMeta);
      expect(mockAuthzManager.filterDefinition).toHaveBeenCalledWith(
        serviceName,
        fullDefinition.meta,
        authContext,
      );
    });

    it('should throw error when filtering results in null (no access)', async () => {
      const serviceName = 'restrictedService@1.0.0';
      const definition: Definition = {
        id: 'def-999',
        peerId: 'peer-123',
        parentId: '',
        meta: {
          name: 'restrictedService',
          version: '1.0.0',
          properties: {},
          methods: {
            secretMethod: { type: 'function', transports: [] },
          },
          transports: [],
        },
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['guest'],
        permissions: [],
      };

      servicesMap.set(serviceName, createMockServiceStub(definition));
      remotePeer.getAuthContext.mockReturnValue(authContext);
      mockAuthzManager.canAccessService.mockReturnValue(true);
      mockAuthzManager.filterDefinition.mockReturnValue(null);

      await expect(query_interface(remotePeer, serviceName)).rejects.toThrow(TitanError);

      try {
        await query_interface(remotePeer, serviceName);
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.FORBIDDEN);
        expect(error.details.reason).toContain('no access to any methods');
      }
    });
  });

  describe('without authorization manager', () => {
    it('should return full definition when no auth configured', async () => {
      const serviceName = 'publicService@1.0.0';
      const definition: Definition = {
        id: 'def-public',
        peerId: 'peer-123',
        parentId: '',
        meta: {
          name: 'publicService',
          version: '1.0.0',
          properties: {},
          methods: {
            getData: { type: 'function', transports: [] },
          },
          transports: [],
        },
      };

      const peerWithoutAuth = {
        netron: {
          services: new Map([[serviceName, createMockServiceStub(definition)]]),
        },
        logger: mockLogger,
        getAuthContext: jest.fn(),
      } as any;

      const result = await query_interface(peerWithoutAuth, serviceName);

      expect(result).toEqual(definition);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ serviceName }),
        expect.stringContaining('No authorization configured'),
      );
    });
  });

  describe('logging', () => {
    it('should log successful queries with method count', async () => {
      const serviceName = 'testService@1.0.0';
      const definition: Definition = {
        id: 'def-test',
        peerId: 'peer-123',
        parentId: '',
        meta: {
          name: 'testService',
          version: '1.0.0',
          properties: {},
          methods: {
            method1: { type: 'function', transports: [] },
            method2: { type: 'function', transports: [] },
            method3: { type: 'function', transports: [] },
          },
          transports: [],
        },
      };

      const filteredMeta = {
        ...definition.meta,
        methods: {
          method1: { type: 'function', transports: [] },
          method2: { type: 'function', transports: [] },
        },
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      servicesMap.set(serviceName, createMockServiceStub(definition));
      remotePeer.getAuthContext.mockReturnValue(authContext);
      mockAuthzManager.canAccessService.mockReturnValue(true);
      mockAuthzManager.filterDefinition.mockReturnValue(filteredMeta);

      await query_interface(remotePeer, serviceName);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName,
          userId: 'user123',
          methodCount: 2,
          originalMethodCount: 3,
        }),
        'Service interface queried successfully',
      );
    });

    it('should log access denials', async () => {
      const serviceName = 'restrictedService@1.0.0';
      const definition: Definition = {
        id: 'def-restricted',
        peerId: 'peer-123',
        parentId: '',
        meta: {
          name: 'restrictedService',
          version: '1.0.0',
          properties: {},
          methods: {},
          transports: [],
        },
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['guest'],
        permissions: [],
      };

      servicesMap.set(serviceName, createMockServiceStub(definition));
      remotePeer.getAuthContext.mockReturnValue(authContext);
      mockAuthzManager.canAccessService.mockReturnValue(false);

      try {
        await query_interface(remotePeer, serviceName);
      } catch {
        // Expected
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName,
          userId: 'user123',
          roles: ['guest'],
        }),
        'Access denied to service',
      );
    });
  });
});
