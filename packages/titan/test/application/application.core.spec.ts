/**
 * Application Core Tests
 *
 * Tests for core application functionality including creation,
 * initialization, basic operations, and DI container integration.
 */

import { createToken } from '@nexus';
import { Application, createApp, APPLICATION_TOKEN, startApp } from '../../src/application.js';
import { ApplicationState, ApplicationEvent, IApplicationOptions } from '../../src/types.js';
import { SimpleModule, FailingModule, SlowModule } from '../fixtures/test-modules.js';
import { createMinimalApplication, createWebApplication } from '../fixtures/test-applications.js';

describe('Application Core', () => {
  let app: Application;

  afterEach(async () => {
    if (app && app.state === ApplicationState.Started) {
      await app.stop();
    }
  });

  describe('Creation and Initialization', () => {
    it('should create application with default options', () => {
      app = createApp();

      expect(app).toBeInstanceOf(Application);
      expect(app.name).toBe('titan-app');
      expect(app.version).toBe('1.0.0');
      expect(app.state).toBe(ApplicationState.Created);
      expect(app.container).toBeDefined();
    });

    it('should create application with custom options', () => {
      const options: IApplicationOptions = {
        name: 'test-app',
        version: '2.0.0',
        debug: true,
        config: { key: 'value' }
      };

      app = createApp(options);

      expect(app.name).toBe('test-app');
      expect(app.version).toBe('2.0.0');
      expect(app.debug).toBe(true);
      expect(app.getConfig()).toEqual({ key: 'value' });
    });

    it('should register application in container', () => {
      app = createApp();
      const registered = app.container.resolve(APPLICATION_TOKEN);
      expect(registered).toBe(app);
    });

    it('should provide environment information', () => {
      app = createApp();
      const env = app.environment;

      expect(env).toBeDefined();
      expect(env.nodeVersion).toBeDefined();
      expect(env.platform).toBeDefined();
      expect(env.pid).toBe(process.pid);
    });

    it('should provide metrics information', () => {
      app = createApp();
      const metrics = app.metrics;

      expect(metrics).toBeDefined();
      expect(metrics.startupTime).toBe(0);
      expect(metrics.modules).toBe(0);
      expect(metrics.uptime).toBe(0);
    });

    it('should handle creation with minimal options', () => {
      app = createMinimalApplication();

      expect(app).toBeInstanceOf(Application);
      expect(app.name).toBe('minimal');
      expect(app.state).toBe(ApplicationState.Created);
    });
  });

  describe('Lifecycle Management', () => {
    it('should start and stop application', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const module = new SimpleModule();
      app.use(module);

      expect(app.state).toBe(ApplicationState.Created);

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
      expect(app.isStarted).toBe(true);
      expect(module.startCalled).toBe(true);

      await app.stop();
      expect(app.state).toBe(ApplicationState.Stopped);
      expect(app.isStarted).toBe(false);
      expect(module.stopCalled).toBe(true);
    });

    it('should emit lifecycle events', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const events: string[] = [];

      app.on(ApplicationEvent.Starting, () => events.push('starting'));
      app.on(ApplicationEvent.Started, () => events.push('started'));
      app.on(ApplicationEvent.Stopping, () => events.push('stopping'));
      app.on(ApplicationEvent.Stopped, () => events.push('stopped'));

      await app.start();
      await app.stop();

      expect(events).toEqual(['starting', 'started', 'stopping', 'stopped']);
    });

    it('should handle restart', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const module = new SimpleModule();
      app.use(module);

      await app.start();
      expect(module.startCalled).toBe(true);
      module.startCalled = false;

      await app.restart();
      expect(app.state).toBe(ApplicationState.Started);
      expect(module.startCalled).toBe(true);
    });

    it('should prevent starting when already started', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      await app.start();

      await expect(app.start()).rejects.toThrow('Application is already started or starting');
    });

    it('should prevent starting from failed state', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new FailingModule('start'));

      await expect(app.start()).rejects.toThrow('Module failure');
      expect(app.state).toBe(ApplicationState.Failed);

      await expect(app.start()).rejects.toThrow('Cannot start from failed state');
    });

    it('should handle stopping when not started', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      // Should not throw
      await app.stop();
      expect(app.state).toBe(ApplicationState.Created);
    });

    it('should handle startApp helper', async () => {
      app = await startApp({
        disableGracefulShutdown: true,
        disableCoreModules: true
      });

      expect(app).toBeInstanceOf(Application);
      expect(app.state).toBe(ApplicationState.Started);

      await app.stop();
    });

    it('should track uptime correctly', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      expect(app.metrics.uptime).toBe(0);

      await app.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      const uptime = app.metrics.uptime;
      expect(uptime).toBeGreaterThan(0);
      expect(uptime).toBeLessThan(1000); // Less than 1 second

      await app.stop();
    });
  });

  describe('State Transitions', () => {
    it('should transition through states correctly', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const states: ApplicationState[] = [];

      // Track state changes
      const originalSetState = (app as any).setState.bind(app);
      (app as any).setState = (state: ApplicationState) => {
        states.push(state);
        return originalSetState(state);
      };

      await app.start();
      await app.stop();

      expect(states).toEqual([
        ApplicationState.Starting,
        ApplicationState.Started,
        ApplicationState.Stopping,
        ApplicationState.Stopped
      ]);
    });

    it('should maintain state consistency through operations', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      // Initial state
      expect(app.state).toBe(ApplicationState.Created);
      expect(app.isStarted).toBe(false);

      // Start
      const startPromise = app.start();
      expect(app.state).toBe(ApplicationState.Starting);
      await startPromise;
      expect(app.state).toBe(ApplicationState.Started);
      expect(app.isStarted).toBe(true);

      // Stop
      const stopPromise = app.stop();
      expect(app.state).toBe(ApplicationState.Stopping);
      await stopPromise;
      expect(app.state).toBe(ApplicationState.Stopped);
      expect(app.isStarted).toBe(false);
    });

    it('should handle rapid state changes', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      await app.start();

      // Rapid stop/start
      const operations = [];
      for (let i = 0; i < 5; i++) {
        operations.push(
          app.stop().then(() => app.start())
        );
      }

      await Promise.all(operations);
      expect(app.state).toBe(ApplicationState.Started);

      await app.stop();
    });
  });

  describe('Error Handling', () => {
    it('should handle module startup failure', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new FailingModule('start', 'Startup failed'));

      await expect(app.start()).rejects.toThrow('Startup failed');
      expect(app.state).toBe(ApplicationState.Failed);
    });

    it('should handle module stop failure', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new FailingModule('stop', 'Stop failed'));

      await app.start();

      // Stop should complete despite error
      await app.stop();
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should handle module registration failure', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new FailingModule('register', 'Registration failed'));

      await expect(app.start()).rejects.toThrow('Registration failed');
      expect(app.state).toBe(ApplicationState.Failed);
    });

    it('should emit error events', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const errors: Error[] = [];

      app.on(ApplicationEvent.Error, (error: Error) => errors.push(error));
      app.use(new FailingModule('start', 'Test error'));

      await expect(app.start()).rejects.toThrow('Test error');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Test error');
    });

    it('should handle errors in event handlers gracefully', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      app.on(ApplicationEvent.Started, () => {
        throw new Error('Handler error');
      });

      // Should not throw
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);

      await app.stop();
    });

    it('should handle timeout in module operations', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new SlowModule(2000)); // 2 second delay

      // Start with timeout
      const startPromise = app.start();
      await expect(startPromise).resolves.not.toThrow();

      // Stop with timeout
      await expect(app.stop({ timeout: 100 })).rejects.toThrow('timed out');
    });
  });

  describe('Application Helpers', () => {
    it('should check if module exists', async () => {
      app = createWebApplication();

      expect(app.has(APPLICATION_TOKEN)).toBe(true);
      expect(app.has(createToken('NonExistent'))).toBe(false);
    });

    it('should provide correct metrics', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const module1 = new SimpleModule();
      const module2 = new SimpleModule();
      module2.name = 'simple2';

      app.use(module1);
      app.use(module2);

      await app.start();

      const metrics = app.metrics;
      expect(metrics.modules).toBe(2);
      expect(metrics.startupTime).toBeGreaterThan(0);

      await app.stop();
    });

    it('should handle force shutdown', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new SlowModule(5000)); // Very slow module

      await app.start();

      // Force shutdown should complete quickly
      const start = Date.now();
      await app.stop({ force: true });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should create multiple independent applications', async () => {
      const app1 = createApp({ name: 'app1', disableGracefulShutdown: true, disableCoreModules: true });
      const app2 = createApp({ name: 'app2', disableGracefulShutdown: true, disableCoreModules: true });

      expect(app1).not.toBe(app2);
      expect(app1.name).toBe('app1');
      expect(app2.name).toBe('app2');
      expect(app1.container).not.toBe(app2.container);

      await app1.start();
      expect(app1.state).toBe(ApplicationState.Started);
      expect(app2.state).toBe(ApplicationState.Created);

      await app2.start();
      expect(app1.state).toBe(ApplicationState.Started);
      expect(app2.state).toBe(ApplicationState.Started);

      await app1.stop();
      expect(app1.state).toBe(ApplicationState.Stopped);
      expect(app2.state).toBe(ApplicationState.Started);

      await app2.stop();
    });
  });
});