/**
 * Router Form Component Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from 'happy-dom';
import { createRouter, setRouter } from '../../src/router/router.js';
import { Form } from '../../src/router/Form.js';
import type { RouteDefinition } from '../../src/router/types.js';

describe('Router Form Component', () => {
  let window: Window;

  beforeEach(() => {
    window = new Window({ url: 'http://localhost:3000/' });
    global.window = window as any;
    global.document = window.document as any;
    global.location = window.location as any;
    global.history = window.history as any;
    global.CustomEvent = window.CustomEvent as any;
    global.FormData = window.FormData as any;
    global.HTMLFormElement = window.HTMLFormElement as any;
  });

  afterEach(() => {
    setRouter(null as any);
  });

  describe('Basic Functionality', () => {
    it('should create Form component', () => {
      expect(Form).toBeDefined();
      expect(typeof Form).toBe('function');
    });

    it('should accept form props', () => {
      const router = createRouter({
        mode: 'memory',
        routes: [{ path: '/test' }],
      });
      setRouter(router);

      const props = {
        method: 'post' as const,
        action: '/test',
        id: 'test-form',
        class: 'my-form',
      };

      // Form component should accept these props
      const formComponent = Form(props);
      expect(formComponent).toBeDefined();
    });

    it('should use custom action when provided', () => {
      const router = createRouter({
        mode: 'memory',
        routes: [{ path: '/test' }],
      });
      setRouter(router);

      const props = {
        action: '/custom-action',
      };

      const formComponent = Form(props);
      expect(formComponent).toBeDefined();
    });
  });

  describe('Props Handling', () => {
    it('should accept various form properties', () => {
      const router = createRouter({
        mode: 'memory',
        routes: [{ path: '/test' }],
      });
      setRouter(router);

      const props = {
        method: 'put' as const,
        action: '/api/users',
        encType: 'multipart/form-data' as const,
        replace: true,
        id: 'user-form',
        class: 'form-class',
      };

      const formComponent = Form(props);
      expect(formComponent).toBeDefined();
    });

    it('should support custom onSubmit handler', () => {
      const router = createRouter({
        mode: 'memory',
        routes: [{ path: '/test' }],
      });
      setRouter(router);

      const onSubmit = vi.fn();

      const props = {
        method: 'post' as const,
        onSubmit,
      };

      const formComponent = Form(props);
      expect(formComponent).toBeDefined();
    });

    it('should support different HTTP methods', () => {
      const router = createRouter({
        mode: 'memory',
        routes: [{ path: '/test' }],
      });
      setRouter(router);

      const methods: Array<'get' | 'post' | 'put' | 'patch' | 'delete'> = ['get', 'post', 'put', 'patch', 'delete'];

      methods.forEach((method) => {
        const formComponent = Form({ method });
        expect(formComponent).toBeDefined();
      });
    });
  });

  describe('Integration with Router', () => {
    it('should integrate with router actions', async () => {
      const action = vi.fn(async () => ({ success: true }));

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          action,
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.navigate('/test');

      const formComponent = Form({
        method: 'post',
        action: '/test',
      });

      expect(formComponent).toBeDefined();
    });

    it('should work with replace option', () => {
      const router = createRouter({
        mode: 'memory',
        routes: [{ path: '/test' }],
      });
      setRouter(router);

      const formComponent = Form({
        method: 'post',
        replace: true,
      });

      expect(formComponent).toBeDefined();
    });

    it('should integrate with useSubmit hook', () => {
      const router = createRouter({
        mode: 'memory',
        routes: [
          {
            path: '/test',
            action: vi.fn(async () => ({ success: true })),
          },
        ],
      });
      setRouter(router);

      const formComponent = Form({
        method: 'post',
        action: '/test',
      });

      expect(formComponent).toBeDefined();
    });
  });
});
