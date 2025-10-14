/**
 * Tests for Module System
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { defineModule, compileModule, bootstrapModule } from '../../../src/di/module.js';
import { Injectable } from '../../../src/di/injectable.js';
import { InjectionToken } from '../../../src/di/tokens.js';

describe('Module System', () => {
  describe('defineModule', () => {
    it('should create a module', () => {
      const module = defineModule({
        id: 'test',
      });

      expect(module.id).toBe('test');
      expect(module.definition).toBeDefined();
    });

    it('should include providers', () => {
      @Injectable()
      class TestService {}

      const module = defineModule({
        id: 'test',
        providers: [TestService],
      });

      expect(module.definition.providers).toContain(TestService);
    });

    it('should include imports', () => {
      const ImportedModule = defineModule({ id: 'imported' });

      const module = defineModule({
        id: 'test',
        imports: [ImportedModule],
      });

      expect(module.definition.imports).toContain(ImportedModule);
    });

    it('should include exports', () => {
      @Injectable()
      class TestService {}

      const module = defineModule({
        id: 'test',
        providers: [TestService],
        exportProviders: [TestService],
      });

      expect(module.definition.exportProviders).toContain(TestService);
    });

    it('should include metadata', () => {
      const module = defineModule({
        id: 'test',
        metadata: {
          name: 'Test Module',
          version: '1.0.0',
        },
      });

      expect(module.definition.metadata?.name).toBe('Test Module');
      expect(module.definition.metadata?.version).toBe('1.0.0');
    });
  });

  describe('compileModule', () => {
    it('should compile module into container', () => {
      @Injectable()
      class TestService {
        value = 42;
      }

      const module = defineModule({
        id: 'test',
        providers: [TestService],
      });

      const container = compileModule(module);

      expect(container.has(TestService)).toBe(true);
      const instance = container.get(TestService);
      expect(instance.value).toBe(42);
    });

    it('should register value providers', () => {
      const API_URL = new InjectionToken<string>('API_URL');

      const module = defineModule({
        id: 'test',
        providers: [{ provide: API_URL, useValue: 'https://api.example.com' }],
      });

      const container = compileModule(module);

      expect(container.has(API_URL)).toBe(true);
      expect(container.get(API_URL)).toBe('https://api.example.com');
    });

    it('should handle imported modules', () => {
      @Injectable()
      class SharedService {
        value = 'shared';
      }

      const SharedModule = defineModule({
        id: 'shared',
        providers: [SharedService],
        exportProviders: [SharedService],
      });

      const AppModule = defineModule({
        id: 'app',
        imports: [SharedModule],
      });

      const container = compileModule(AppModule);

      expect(container.has(SharedService)).toBe(true);
      expect(container.get(SharedService).value).toBe('shared');
    });

    it('should handle module hierarchy', () => {
      @Injectable()
      class CoreService {
        name = 'core';
      }

      @Injectable()
      class FeatureService {
        name = 'feature';
      }

      const CoreModule = defineModule({
        id: 'core',
        providers: [CoreService],
        exportProviders: [CoreService],
      });

      const FeatureModule = defineModule({
        id: 'feature',
        providers: [FeatureService],
        exportProviders: [FeatureService],
      });

      const AppModule = defineModule({
        id: 'app',
        imports: [CoreModule, FeatureModule],
      });

      const container = compileModule(AppModule);

      expect(container.has(CoreService)).toBe(true);
      expect(container.has(FeatureService)).toBe(true);
      expect(container.get(CoreService).name).toBe('core');
      expect(container.get(FeatureService).name).toBe('feature');
    });
  });

  describe('bootstrapModule', () => {
    it('should bootstrap module without component', () => {
      @Injectable()
      class AppService {
        value = 'app';
      }

      const AppModule = defineModule({
        id: 'app',
        providers: [AppService],
      });

      const { container, component } = bootstrapModule(AppModule);

      expect(container).toBeDefined();
      expect(container.has(AppService)).toBe(true);
      expect(component).toBeUndefined();
    });

    it('should bootstrap module with component', () => {
      @Injectable()
      class AppComponent {
        name = 'App';
      }

      const AppModule = defineModule({
        id: 'app',
        providers: [AppComponent],
        bootstrap: AppComponent,
      });

      const { container, component } = bootstrapModule(AppModule);

      expect(container).toBeDefined();
      expect(component).toBeDefined();
      expect(component.name).toBe('App');
    });

    it('should make services available to bootstrap component', () => {
      @Injectable()
      class ConfigService {
        apiUrl = 'https://api.example.com';
      }

      @Injectable({ deps: [ConfigService] })
      class AppComponent {
        constructor(public config: ConfigService) {}
      }

      const AppModule = defineModule({
        id: 'app',
        providers: [ConfigService, AppComponent],
        bootstrap: AppComponent,
      });

      const { component } = bootstrapModule(AppModule);

      expect(component.config).toBeInstanceOf(ConfigService);
      expect(component.config.apiUrl).toBe('https://api.example.com');
    });
  });

  describe('Module patterns', () => {
    it('should support shared module pattern', () => {
      @Injectable()
      class ButtonComponent {
        type = 'button';
      }

      @Injectable()
      class CardComponent {
        type = 'card';
      }

      const SharedModule = defineModule({
        id: 'shared',
        components: [ButtonComponent, CardComponent],
        exports: [ButtonComponent, CardComponent],
      });

      const FeatureModule = defineModule({
        id: 'feature',
        imports: [SharedModule],
      });

      expect(FeatureModule.definition.imports).toContain(SharedModule);
    });

    it('should support core module pattern', () => {
      @Injectable()
      class AuthService {
        name = 'auth';
      }

      @Injectable()
      class LoggerService {
        name = 'logger';
      }

      const CoreModule = defineModule({
        id: 'core',
        providers: [AuthService, LoggerService],
        exportProviders: [AuthService, LoggerService],
      });

      const AppModule = defineModule({
        id: 'app',
        imports: [CoreModule],
      });

      const container = compileModule(AppModule);

      expect(container.has(AuthService)).toBe(true);
      expect(container.has(LoggerService)).toBe(true);
    });

    it('should support feature module pattern', () => {
      @Injectable()
      class BlogService {
        name = 'blog';
      }

      const BlogModule = defineModule({
        id: 'blog',
        providers: [BlogService],
      });

      const AppModule = defineModule({
        id: 'app',
        imports: [BlogModule],
      });

      expect(AppModule.definition.imports).toContain(BlogModule);
    });
  });
});
