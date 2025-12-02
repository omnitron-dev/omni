/**
 * Tests for HTTP Controller support in Simple API
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { controller, type ControllerRequest, type ControllerResponse, createControllerService } from '@/application/simple';

describe('Simple API - HTTP Controllers', () => {
  describe('controller() function', () => {
    it('should create a controller registration', () => {
      const ctrl = controller('/api/users', {
        async list(req, res) {
          res.json({ users: [] });
        },
      });

      expect(ctrl).toBeDefined();
      expect(ctrl.basePath).toBe('/api/users');
      expect(ctrl.handlers).toBeDefined();
      expect(typeof ctrl.handlers.list).toBe('function');
    });

    it('should normalize base path', () => {
      const ctrl1 = controller('api/users', {
        async list(req, res) {
          res.json({ users: [] });
        },
      });
      expect(ctrl1.basePath).toBe('/api/users');

      const ctrl2 = controller('/api/users', {
        async list(req, res) {
          res.json({ users: [] });
        },
      });
      expect(ctrl2.basePath).toBe('/api/users');
    });

    it('should support multiple handlers', () => {
      const ctrl = controller('/api/users', {
        async list(req, res) {
          res.json({ users: [] });
        },
        async get(req, res) {
          res.json({ user: { id: 1 } });
        },
        async create(req, res) {
          res.status(201).json({ created: true });
        },
      });

      expect(Object.keys(ctrl.handlers)).toHaveLength(3);
      expect(typeof ctrl.handlers.list).toBe('function');
      expect(typeof ctrl.handlers.get).toBe('function');
      expect(typeof ctrl.handlers.create).toBe('function');
    });
  });

  describe('ControllerService', () => {
    it('should create a service from controller registration', () => {
      const ctrl = controller('/api/users', {
        async list(req, res) {
          res.json({ users: [] });
        },
      });

      const ServiceClass = createControllerService(ctrl);
      expect(ServiceClass).toBeDefined();

      const service = new ServiceClass();
      expect(service).toBeDefined();
      expect(typeof service.handleRequest).toBe('function');
    });

    it('should handle JSON responses', async () => {
      const ctrl = controller('/api/users', {
        async list(req, res) {
          res.json({ users: ['Alice', 'Bob'] });
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'GET',
        path: '/api/users/list',
      });

      expect(result.status).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');
      expect(result.body).toEqual({ users: ['Alice', 'Bob'] });
    });

    it('should handle text responses', async () => {
      const ctrl = controller('/api/health', {
        async check(req, res) {
          res.text('OK');
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'GET',
        path: '/api/health/check',
      });

      expect(result.status).toBe(200);
      expect(result.headers['Content-Type']).toBe('text/plain');
      expect(result.body).toBe('OK');
    });

    it('should handle HTML responses', async () => {
      const ctrl = controller('/api/pages', {
        async home(req, res) {
          res.html('<h1>Home</h1>');
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'GET',
        path: '/api/pages/home',
      });

      expect(result.status).toBe(200);
      expect(result.headers['Content-Type']).toBe('text/html');
      expect(result.body).toBe('<h1>Home</h1>');
    });

    it('should handle custom status codes', async () => {
      const ctrl = controller('/api/users', {
        async create(req, res) {
          res.status(201).json({ id: 123, created: true });
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'POST',
        path: '/api/users/create',
        body: { name: 'Alice' },
      });

      expect(result.status).toBe(201);
      expect(result.body).toEqual({ id: 123, created: true });
    });

    it('should handle custom headers', async () => {
      const ctrl = controller('/api/data', {
        async export(req, res) {
          res
            .header('X-Custom-Header', 'custom-value')
            .header('Cache-Control', 'max-age=3600')
            .json({ data: [] });
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'GET',
        path: '/api/data/export',
      });

      expect(result.headers['X-Custom-Header']).toBe('custom-value');
      expect(result.headers['Cache-Control']).toBe('max-age=3600');
    });

    it('should handle request body', async () => {
      const ctrl = controller('/api/users', {
        async create(req, res) {
          res.status(201).json({ created: true, name: req.body.name });
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'POST',
        path: '/api/users/create',
        body: { name: 'Alice', age: 30 },
      });

      expect(result.status).toBe(201);
      expect(result.body).toEqual({ created: true, name: 'Alice' });
    });

    it('should handle query parameters', async () => {
      const ctrl = controller('/api/search', {
        async query(req, res) {
          res.json({ query: req.query.q, page: req.query.page });
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'GET',
        path: '/api/search/query',
        query: { q: 'test', page: '1' },
      });

      expect(result.body).toEqual({ query: 'test', page: '1' });
    });

    it('should handle 404 for unknown handlers', async () => {
      const ctrl = controller('/api/users', {
        async list(req, res) {
          res.json({ users: [] });
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'GET',
        path: '/api/users/unknown',
      });

      expect(result.status).toBe(404);
      expect(result.body.error).toBe('Not Found');
    });

    it('should handle errors in handlers', async () => {
      const ctrl = controller('/api/users', {
        async error(req, res) {
          throw new Error('Something went wrong');
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'GET',
        path: '/api/users/error',
      });

      expect(result.status).toBe(500);
      expect(result.body.error).toBeDefined();
      expect(result.body.message).toBe('Something went wrong');
    });

    it('should handle custom error status codes', async () => {
      const ctrl = controller('/api/users', {
        async notFound(req, res) {
          const error = new Error('User not found') as any;
          error.statusCode = 404;
          throw error;
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'GET',
        path: '/api/users/notFound',
      });

      expect(result.status).toBe(404);
      expect(result.body.message).toBe('User not found');
    });

    it('should send 204 if no response sent', async () => {
      const ctrl = controller('/api/actions', {
        async doSomething(req, res) {
          // Handler doesn't send a response
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'POST',
        path: '/api/actions/doSomething',
      });

      expect(result.status).toBe(204);
      expect(result.body).toBeNull();
    });

    it('should prevent sending response twice', async () => {
      const ctrl = controller('/api/test', {
        async duplicate(req, res) {
          res.json({ first: true });
          res.json({ second: true }); // Should throw
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'GET',
        path: '/api/test/duplicate',
      });

      // Should catch the error and return 500
      expect(result.status).toBe(500);
      expect(result.body.message).toContain('Response already sent');
    });

    it('should handle async handlers', async () => {
      const ctrl = controller('/api/async', {
        async delay(req, res) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          res.json({ delayed: true });
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'GET',
        path: '/api/async/delay',
      });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ delayed: true });
    });

    it('should handle custom send method', async () => {
      const ctrl = controller('/api/custom', {
        async xml(req, res) {
          res.send(200, '<xml>data</xml>', 'application/xml');
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'GET',
        path: '/api/custom/xml',
      });

      expect(result.status).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/xml');
      expect(result.body).toBe('<xml>data</xml>');
    });

    it('should extract handler name from path correctly', async () => {
      const ctrl = controller('/api/v1/users', {
        async list(req, res) {
          res.json({ handler: 'list' });
        },
        async create(req, res) {
          res.json({ handler: 'create' });
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const listResult = await service.handleRequest({
        method: 'GET',
        path: '/api/v1/users/list',
      });
      expect(listResult.body.handler).toBe('list');

      const createResult = await service.handleRequest({
        method: 'POST',
        path: '/api/v1/users/create',
      });
      expect(createResult.body.handler).toBe('create');
    });

    it('should use index handler for base path', async () => {
      const ctrl = controller('/api/home', {
        async index(req, res) {
          res.json({ page: 'home' });
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'GET',
        path: '/api/home',
      });

      expect(result.body.page).toBe('home');
    });
  });

  describe('Request and Response types', () => {
    it('should provide correct request object', async () => {
      let capturedReq: ControllerRequest | null = null;

      const ctrl = controller('/api/test', {
        async capture(req, res) {
          capturedReq = req;
          res.json({ ok: true });
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      await service.handleRequest({
        method: 'POST',
        path: '/api/test/capture',
        query: { foo: 'bar' },
        params: { id: '123' },
        headers: { 'x-custom': 'value' },
        body: { data: 'test' },
      });

      expect(capturedReq).toBeDefined();
      expect(capturedReq!.method).toBe('POST');
      expect(capturedReq!.path).toBe('/api/test/capture');
      expect(capturedReq!.query.foo).toBe('bar');
      expect(capturedReq!.params.id).toBe('123');
      expect(capturedReq!.headers['x-custom']).toBe('value');
      expect(capturedReq!.body.data).toBe('test');
    });

    it('should provide chainable response methods', async () => {
      const ctrl = controller('/api/chain', {
        async test(req, res) {
          res.status(201).header('X-Custom', 'value').json({ chained: true });
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'POST',
        path: '/api/chain/test',
      });

      expect(result.status).toBe(201);
      expect(result.headers['X-Custom']).toBe('value');
      expect(result.body).toEqual({ chained: true });
    });

    it('should support headers() method for bulk setting', async () => {
      const ctrl = controller('/api/headers', {
        async bulk(req, res) {
          res
            .headers({
              'X-Header-1': 'value1',
              'X-Header-2': 'value2',
              'Cache-Control': 'no-cache',
            })
            .json({ ok: true });
        },
      });

      const ServiceClass = createControllerService(ctrl);
      const service = new ServiceClass();

      const result = await service.handleRequest({
        method: 'GET',
        path: '/api/headers/bulk',
      });

      expect(result.headers['X-Header-1']).toBe('value1');
      expect(result.headers['X-Header-2']).toBe('value2');
      expect(result.headers['Cache-Control']).toBe('no-cache');
    });
  });
});
