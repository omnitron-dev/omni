/**
 * Integration tests for auth-aware query-interface functionality
 *
 * These tests demonstrate the full flow of service discovery with
 * authorization and permission filtering.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createQueryInterfaceRequest,
  isQueryInterfaceResponse,
  resolveServiceName,
  isFilteredDefinition,
  type QueryInterfaceResponse,
} from '../../../src/core-tasks/query-interface.js';
import { Definition } from '../../../src/core/definition.js';
import type { ServiceMetadata } from '../../../src/core/types.js';

describe('query-interface integration', () => {
  describe('Service Discovery Flow', () => {
    let availableServices: Map<string, any>;

    beforeEach(() => {
      // Setup mock service registry
      availableServices = new Map([
        ['UserService@1.0.0', {}],
        ['UserService@1.5.0', {}],
        ['UserService@2.0.0', {}],
        ['AdminService@1.0.0', {}],
        ['PublicService@1.0.0', {}],
      ]);
    });

    it('should resolve exact service version', () => {
      const request = createQueryInterfaceRequest('UserService@1.5.0');
      const resolvedName = resolveServiceName(request.serviceName, availableServices);

      expect(resolvedName).toBe('UserService@1.5.0');
    });

    it('should resolve wildcard to latest version', () => {
      const request = createQueryInterfaceRequest('UserService');
      const resolvedName = resolveServiceName(request.serviceName, availableServices);

      expect(resolvedName).toBe('UserService@2.0.0');
    });

    it('should handle multiple services with version resolution', () => {
      const services = ['UserService', 'AdminService', 'PublicService'];

      for (const serviceName of services) {
        const request = createQueryInterfaceRequest(serviceName);
        const resolvedName = resolveServiceName(request.serviceName, availableServices);

        expect(resolvedName).toBeTruthy();
        expect(resolvedName).toContain('@');
      }
    });
  });

  describe('Auth-Aware Service Discovery', () => {
    it('should handle public service - full access', () => {
      const publicServiceMeta: ServiceMetadata = {
        name: 'PublicService',
        version: '1.0.0',
        properties: {},
        methods: {
          getPublicInfo: {
            type: 'PublicInfo',
            arguments: [],
          },
          getPublicData: {
            type: 'Data[]',
            arguments: [],
          },
        },
      };

      const definition = new Definition('def-public', 'peer-1', publicServiceMeta);

      const response: QueryInterfaceResponse = {
        definition,
        filtered: false,
        resolvedName: 'PublicService@1.0.0',
      };

      expect(isQueryInterfaceResponse(response)).toBe(true);
      expect(isFilteredDefinition(response)).toBe(false);
      expect(Object.keys(response.definition.meta.methods).length).toBe(2);
    });

    it('should handle authenticated service - filtered methods', () => {
      // Simulate server returning filtered definition for authenticated user
      const userServiceMeta: ServiceMetadata = {
        name: 'UserService',
        version: '1.0.0',
        properties: {},
        methods: {
          // User can only see these methods based on their permissions
          getUser: {
            type: 'User',
            arguments: [{ index: 0, type: 'string' }],
          },
          updateUser: {
            type: 'User',
            arguments: [
              { index: 0, type: 'string' },
              { index: 1, type: 'UserUpdate' },
            ],
          },
          // Methods like deleteUser, banUser are filtered out
        },
      };

      const definition = new Definition('def-user', 'peer-1', userServiceMeta);

      const response: QueryInterfaceResponse = {
        definition,
        filtered: true, // Server indicates this was filtered
        resolvedName: 'UserService@1.0.0',
      };

      expect(isQueryInterfaceResponse(response)).toBe(true);
      expect(isFilteredDefinition(response)).toBe(true);
      expect(response.filtered).toBe(true);

      // Verify filtered methods
      const methods = Object.keys(response.definition.meta.methods);
      expect(methods).toContain('getUser');
      expect(methods).toContain('updateUser');
      expect(methods).not.toContain('deleteUser');
      expect(methods).not.toContain('banUser');
    });

    it('should handle admin service - full access for admin', () => {
      const adminServiceMeta: ServiceMetadata = {
        name: 'AdminService',
        version: '1.0.0',
        properties: {},
        methods: {
          getUser: {
            type: 'User',
            arguments: [{ index: 0, type: 'string' }],
          },
          updateUser: {
            type: 'User',
            arguments: [
              { index: 0, type: 'string' },
              { index: 1, type: 'UserUpdate' },
            ],
          },
          deleteUser: {
            type: 'void',
            arguments: [{ index: 0, type: 'string' }],
          },
          banUser: {
            type: 'void',
            arguments: [{ index: 0, type: 'string' }],
          },
          getAllUsers: {
            type: 'User[]',
            arguments: [],
          },
        },
      };

      const definition = new Definition('def-admin', 'peer-1', adminServiceMeta);

      const response: QueryInterfaceResponse = {
        definition,
        filtered: false, // Admin sees everything
        resolvedName: 'AdminService@1.0.0',
      };

      expect(isQueryInterfaceResponse(response)).toBe(true);
      expect(response.filtered).toBe(false);

      // Verify all admin methods are accessible
      const methods = Object.keys(response.definition.meta.methods);
      expect(methods).toContain('getUser');
      expect(methods).toContain('updateUser');
      expect(methods).toContain('deleteUser');
      expect(methods).toContain('banUser');
      expect(methods).toContain('getAllUsers');
      expect(methods.length).toBe(5);
    });

    it('should handle no access - empty methods', () => {
      // Simulate server returning definition with no accessible methods
      const restrictedServiceMeta: ServiceMetadata = {
        name: 'RestrictedService',
        version: '1.0.0',
        properties: {},
        methods: {}, // All methods filtered out
      };

      const definition = new Definition('def-restricted', 'peer-1', restrictedServiceMeta);

      const response: QueryInterfaceResponse = {
        definition,
        filtered: true,
        resolvedName: 'RestrictedService@1.0.0',
      };

      expect(isQueryInterfaceResponse(response)).toBe(true);
      expect(isFilteredDefinition(response)).toBe(true);
      expect(Object.keys(response.definition.meta.methods).length).toBe(0);
    });
  });

  describe('Role-Based Method Filtering Scenarios', () => {
    it('should demonstrate guest user scenario', () => {
      // Guest user - only public methods
      const guestServiceMeta: ServiceMetadata = {
        name: 'ContentService',
        version: '1.0.0',
        properties: {},
        methods: {
          getPublicPosts: {
            type: 'Post[]',
            arguments: [],
          },
          getPublicPost: {
            type: 'Post',
            arguments: [{ index: 0, type: 'string' }],
          },
        },
      };

      const definition = new Definition('def-guest', 'peer-1', guestServiceMeta);

      const response: QueryInterfaceResponse = {
        definition,
        filtered: true,
        resolvedName: 'ContentService@1.0.0',
      };

      const methods = Object.keys(response.definition.meta.methods);
      expect(methods.every((m) => m.includes('Public'))).toBe(true);
    });

    it('should demonstrate regular user scenario', () => {
      // Regular user - public + own content methods
      const userServiceMeta: ServiceMetadata = {
        name: 'ContentService',
        version: '1.0.0',
        properties: {},
        methods: {
          getPublicPosts: {
            type: 'Post[]',
            arguments: [],
          },
          getPublicPost: {
            type: 'Post',
            arguments: [{ index: 0, type: 'string' }],
          },
          getMyPosts: {
            type: 'Post[]',
            arguments: [],
          },
          createPost: {
            type: 'Post',
            arguments: [{ index: 0, type: 'PostCreate' }],
          },
          updateMyPost: {
            type: 'Post',
            arguments: [
              { index: 0, type: 'string' },
              { index: 1, type: 'PostUpdate' },
            ],
          },
          deleteMyPost: {
            type: 'void',
            arguments: [{ index: 0, type: 'string' }],
          },
        },
      };

      const definition = new Definition('def-user', 'peer-1', userServiceMeta);

      const response: QueryInterfaceResponse = {
        definition,
        filtered: true,
        resolvedName: 'ContentService@1.0.0',
      };

      const methods = Object.keys(response.definition.meta.methods);
      expect(methods).toContain('getPublicPosts');
      expect(methods).toContain('getMyPosts');
      expect(methods).toContain('createPost');
      // Should not have admin methods
      expect(methods).not.toContain('deleteAnyPost');
      expect(methods).not.toContain('banUser');
    });

    it('should demonstrate moderator scenario', () => {
      // Moderator - public + own + moderation methods
      const moderatorServiceMeta: ServiceMetadata = {
        name: 'ContentService',
        version: '1.0.0',
        properties: {},
        methods: {
          getPublicPosts: {
            type: 'Post[]',
            arguments: [],
          },
          getPublicPost: {
            type: 'Post',
            arguments: [{ index: 0, type: 'string' }],
          },
          getMyPosts: {
            type: 'Post[]',
            arguments: [],
          },
          createPost: {
            type: 'Post',
            arguments: [{ index: 0, type: 'PostCreate' }],
          },
          updateMyPost: {
            type: 'Post',
            arguments: [
              { index: 0, type: 'string' },
              { index: 1, type: 'PostUpdate' },
            ],
          },
          deleteMyPost: {
            type: 'void',
            arguments: [{ index: 0, type: 'string' }],
          },
          hidePost: {
            type: 'void',
            arguments: [{ index: 0, type: 'string' }],
          },
          flagPost: {
            type: 'void',
            arguments: [
              { index: 0, type: 'string' },
              { index: 1, type: 'string' },
            ],
          },
          getFlaggedPosts: {
            type: 'Post[]',
            arguments: [],
          },
        },
      };

      const definition = new Definition('def-moderator', 'peer-1', moderatorServiceMeta);

      const response: QueryInterfaceResponse = {
        definition,
        filtered: true,
        resolvedName: 'ContentService@1.0.0',
      };

      const methods = Object.keys(response.definition.meta.methods);
      expect(methods).toContain('hidePost');
      expect(methods).toContain('flagPost');
      expect(methods).toContain('getFlaggedPosts');
      // Should not have full admin methods
      expect(methods).not.toContain('deleteAnyPost');
      expect(methods).not.toContain('banUser');
    });

    it('should demonstrate admin scenario - full access', () => {
      // Admin - all methods
      const adminServiceMeta: ServiceMetadata = {
        name: 'ContentService',
        version: '1.0.0',
        properties: {},
        methods: {
          getPublicPosts: {
            type: 'Post[]',
            arguments: [],
          },
          getPublicPost: {
            type: 'Post',
            arguments: [{ index: 0, type: 'string' }],
          },
          getMyPosts: {
            type: 'Post[]',
            arguments: [],
          },
          createPost: {
            type: 'Post',
            arguments: [{ index: 0, type: 'PostCreate' }],
          },
          updateMyPost: {
            type: 'Post',
            arguments: [
              { index: 0, type: 'string' },
              { index: 1, type: 'PostUpdate' },
            ],
          },
          deleteMyPost: {
            type: 'void',
            arguments: [{ index: 0, type: 'string' }],
          },
          hidePost: {
            type: 'void',
            arguments: [{ index: 0, type: 'string' }],
          },
          flagPost: {
            type: 'void',
            arguments: [
              { index: 0, type: 'string' },
              { index: 1, type: 'string' },
            ],
          },
          getFlaggedPosts: {
            type: 'Post[]',
            arguments: [],
          },
          deleteAnyPost: {
            type: 'void',
            arguments: [{ index: 0, type: 'string' }],
          },
          getAllPosts: {
            type: 'Post[]',
            arguments: [],
          },
          banUser: {
            type: 'void',
            arguments: [{ index: 0, type: 'string' }],
          },
        },
      };

      const definition = new Definition('def-admin', 'peer-1', adminServiceMeta);

      const response: QueryInterfaceResponse = {
        definition,
        filtered: false, // Admin sees everything
        resolvedName: 'ContentService@1.0.0',
      };

      const methods = Object.keys(response.definition.meta.methods);
      expect(methods).toContain('deleteAnyPost');
      expect(methods).toContain('getAllPosts');
      expect(methods).toContain('banUser');
      expect(methods.length).toBe(12); // All methods accessible
    });
  });

  describe('Version Resolution with Auth', () => {
    it('should resolve to latest accessible version', () => {
      const availableServices = new Map([
        ['UserService@1.0.0', {}],
        ['UserService@2.0.0', {}],
        ['UserService@3.0.0', {}],
      ]);

      // User requests UserService without version
      const request = createQueryInterfaceRequest('UserService');
      const resolvedName = resolveServiceName(request.serviceName, availableServices);

      // Should resolve to latest version (3.0.0)
      expect(resolvedName).toBe('UserService@3.0.0');

      // Server would then filter the definition based on user permissions
      const response: QueryInterfaceResponse = {
        definition: new Definition('def-user', 'peer-1', {
          name: 'UserService',
          version: '3.0.0',
          properties: {},
          methods: {
            getUser: { type: 'User', arguments: [] },
          },
        }),
        filtered: true,
        resolvedName: 'UserService@3.0.0',
      };

      expect(response.resolvedName).toBe(resolvedName);
      expect(isFilteredDefinition(response)).toBe(true);
    });
  });
});
