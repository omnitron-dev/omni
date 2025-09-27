/**
 * Application Module Discovery Tests
 *
 * Tests for automatic module discovery, file scanning,
 * and auto-registration features.
 */

import { Application, createApp } from '../../src/application.js';
import { Module, Injectable } from '../../src/decorators/index.js';
import { IModule, IApplication } from '../../src/types.js';
import * as path from 'path';
import * as fs from 'fs';

describe('Application Module Discovery', () => {
  let app: Application;
  let tempDir: string;

  beforeAll(() => {
    // Create temporary directory for test modules
    tempDir = path.join(process.cwd(), 'test', '.tmp-test-modules');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    app = createApp({
      name: 'discovery-test',
      disableGracefulShutdown: true,
      disableCoreModules: true
    });
  });

  afterEach(async () => {
    if (app && app.state !== 'stopped') {
      await app.stop({ force: true });
    }
  });

  describe('Module Auto-discovery', () => {
    it('should discover modules from directory', async () => {
      // Create test module files
      const module1Content = `
class TestDiscoveredModule1 {
  constructor() {
    this.name = 'discovered-1';
    this.version = '1.0.0';
  }
}
TestDiscoveredModule1.__titanModule = true;
TestDiscoveredModule1.__titanModuleMetadata = {};
module.exports = { TestDiscoveredModule1 };
`;

      const module2Content = `
class TestDiscoveredModule2 {
  constructor() {
    this.name = 'discovered-2';
    this.version = '1.0.0';
  }
}
TestDiscoveredModule2.__titanModule = true;
TestDiscoveredModule2.__titanModuleMetadata = {};
module.exports = { TestDiscoveredModule2 };
`;

      fs.writeFileSync(
        path.join(tempDir, 'module1.cjs'),
        module1Content
      );

      fs.writeFileSync(
        path.join(tempDir, 'module2.cjs'),
        module2Content
      );

      await app.discoverModules(tempDir);

      expect(app.hasModule('discovered-1')).toBe(true);
      expect(app.hasModule('discovered-2')).toBe(true);
    });

    it('should discover modules with glob pattern', async () => {
      // Create test module files
      const module1Content = `
class TestDiscoveredModule1 {
  constructor() {
    this.name = 'discovered-1';
    this.version = '1.0.0';
  }
}
TestDiscoveredModule1.__titanModule = true;
TestDiscoveredModule1.__titanModuleMetadata = {};
module.exports = { TestDiscoveredModule1 };
`;

      const module2Content = `
class TestDiscoveredModule2 {
  constructor() {
    this.name = 'discovered-2';
    this.version = '1.0.0';
  }
}
TestDiscoveredModule2.__titanModule = true;
TestDiscoveredModule2.__titanModuleMetadata = {};
module.exports = { TestDiscoveredModule2 };
`;

      fs.writeFileSync(
        path.join(tempDir, 'module1.cjs'),
        module1Content
      );

      fs.writeFileSync(
        path.join(tempDir, 'module2.cjs'),
        module2Content
      );

      await app.discoverModules(path.join(tempDir, '*.cjs'));

      const modules = app.getModules();
      const moduleNames = modules.map(m => m.name);

      expect(moduleNames).toContain('discovered-1');
      expect(moduleNames).toContain('discovered-2');
    });

    it('should skip non-module files', async () => {
      // Create a non-module file
      const nonModuleContent = `
class NotAModule {
  constructor() {
    this.name = 'not-a-module';
  }
}
module.exports = { NotAModule };
`;
      fs.writeFileSync(
        path.join(tempDir, 'not-module.cjs'),
        nonModuleContent
      );

      await app.discoverModules(tempDir);

      expect(app.hasModule('not-a-module')).toBe(false);
    });

    it('should handle discovery errors gracefully', async () => {
      // Create a module with syntax error
      const errorModuleContent = `
class ErrorModule {
  // Syntax error: missing closing brace
`;
      const errorFile = path.join(tempDir, 'error-module.cjs');
      fs.writeFileSync(errorFile, errorModuleContent);

      await expect(app.discoverModules(tempDir)).rejects.toThrow();

      // Clean up the error file to prevent it from affecting other tests
      fs.unlinkSync(errorFile);
    });
  });

  describe('Scan Paths Configuration', () => {
    beforeEach(() => {
      // Clean up any existing test files
      const testFiles = ['module1.cjs', 'module2.cjs', 'error-module.cjs'];
      testFiles.forEach(file => {
        const filePath = path.join(tempDir, file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });

      // Create test module files for scan paths tests
      const module1Content = `class TestDiscoveredModule1 {
  constructor() {
    this.name = 'discovered-1';
    this.version = '1.0.0';
  }
}
TestDiscoveredModule1.__titanModule = true;
TestDiscoveredModule1.__titanModuleMetadata = {};
module.exports = { TestDiscoveredModule1 };`;

      const module2Content = `class TestDiscoveredModule2 {
  constructor() {
    this.name = 'discovered-2';
    this.version = '1.0.0';
  }
}
TestDiscoveredModule2.__titanModule = true;
TestDiscoveredModule2.__titanModuleMetadata = {};
module.exports = { TestDiscoveredModule2 };`;

      fs.writeFileSync(
        path.join(tempDir, 'module1.cjs'),
        module1Content
      );

      fs.writeFileSync(
        path.join(tempDir, 'module2.cjs'),
        module2Content
      );
    });

    it('should scan modules from configured paths', async () => {
      const app = await Application.create({
        scanPaths: [tempDir],
        disableGracefulShutdown: true,
        disableCoreModules: true
      });

      // Modules should be auto-discovered during creation
      expect(app.hasModule('discovered-1')).toBe(true);
      expect(app.hasModule('discovered-2')).toBe(true);

      await app.stop();
    });

    it('should scan multiple paths', async () => {
      const tempDir2 = path.join(process.cwd(), 'test', '.tmp-test-modules-2');
      fs.mkdirSync(tempDir2, { recursive: true });

      try {
        // Create module in second directory
        const module3Content = `class TestDiscoveredModule3 {
  constructor() {
    this.name = 'discovered-3';
  }
}
TestDiscoveredModule3.__titanModule = true;
TestDiscoveredModule3.__titanModuleMetadata = {};
module.exports = { TestDiscoveredModule3 };`;
        fs.writeFileSync(
          path.join(tempDir2, 'module3.cjs'),
          module3Content
        );

        const app = await Application.create({
          scanPaths: [tempDir, tempDir2],
          disableGracefulShutdown: true,
          disableCoreModules: true
        });

        expect(app.hasModule('discovered-1')).toBe(true);
        expect(app.hasModule('discovered-2')).toBe(true);
        expect(app.hasModule('discovered-3')).toBe(true);

        await app.stop();
      } finally {
        fs.rmSync(tempDir2, { recursive: true, force: true });
      }
    });

    it('should exclude paths from scanning', async () => {
      const app = await Application.create({
        scanPaths: [tempDir],
        excludePaths: ['**/module1.cjs'],
        disableGracefulShutdown: true,
        disableCoreModules: true
      });

      expect(app.hasModule('discovered-1')).toBe(false);
      expect(app.hasModule('discovered-2')).toBe(true);

      await app.stop();
    });
  });

  describe('Module Class Detection', () => {
    it('should detect @Module decorated classes', () => {
      @Module({})
      class DecoratedModule implements IModule {
        readonly name = 'decorated';
      }

      const instance = new DecoratedModule();
      expect((instance.constructor as any).__titanModule).toBe(true);
    });

    it('should detect modules by interface implementation', async () => {
      // Module without decorator but implements interface
      class InterfaceModule implements IModule {
        readonly name = 'interface-module';
        readonly version = '1.0.0';

        async onStart(app: IApplication): Promise<void> {
          // Custom start logic
        }
      }

      const module = new InterfaceModule();
      app.use(module);

      await app.start();
      expect(app.hasModule('interface-module')).toBe(true);
    });

    it('should validate discovered modules', async () => {
      // Create invalid module file (missing required properties)
      const invalidModuleContent = `
class InvalidModule {
  // Missing name property
}
InvalidModule.__titanModule = true;
module.exports = { InvalidModule };
`;
      fs.writeFileSync(
        path.join(tempDir, 'invalid-module.cjs'),
        invalidModuleContent
      );

      await expect(app.discoverModules(tempDir)).rejects.toThrow();
    });
  });

  describe('Dynamic Module Loading', () => {
    it('should load modules dynamically at runtime', async () => {
      await app.start();

      // Dynamically create and register module
      class DynamicModule implements IModule {
        readonly name = 'dynamic';
        loaded = false;

        async onStart(): Promise<void> {
          this.loaded = true;
        }
      }

      const module = new DynamicModule();
      await app.registerDynamic(module);

      expect(app.hasModule('dynamic')).toBe(true);
      expect(module.loaded).toBe(true);
    });

    it('should handle dynamic module with dependencies', async () => {
      // Start app with base module
      class BaseModule implements IModule {
        readonly name = 'base';
      }

      app.use(new BaseModule());
      await app.start();

      // Add dynamic module with dependency
      class DynamicWithDep implements IModule {
        readonly name = 'dynamic-dep';
        readonly dependencies = ['base'];
      }

      const module = new DynamicWithDep();
      await app.registerDynamic(module);

      expect(app.hasModule('dynamic-dep')).toBe(true);
    });

    it('should reject dynamic module with missing dependencies', async () => {
      await app.start();

      class DynamicWithMissingDep implements IModule {
        readonly name = 'dynamic-missing';
        readonly dependencies = ['nonexistent'];
      }

      const module = new DynamicWithMissingDep();
      await expect(app.registerDynamic(module)).rejects.toThrow(/nonexistent/);
    });
  });

  describe('Module Factory Pattern', () => {
    it('should create modules from factory functions', async () => {
      const createDatabaseModule = (config: any) => {
        class ConfiguredDatabaseModule implements IModule {
          readonly name = 'database';
          readonly version = '1.0.0';

          getConfig() {
            return config;
          }
        }

        return new ConfiguredDatabaseModule();
      };

      const module = createDatabaseModule({
        host: 'localhost',
        port: 5432
      });

      app.use(module);
      await app.start();

      const retrieved = app.getModule('database') as any;
      expect(retrieved.getConfig()).toEqual({
        host: 'localhost',
        port: 5432
      });
    });

    it('should support async module factories', async () => {
      const createAsyncModule = async () => {
        // Simulate async initialization
        await new Promise(resolve => setTimeout(resolve, 10));

        class AsyncCreatedModule implements IModule {
          readonly name = 'async-created';
        }

        return new AsyncCreatedModule();
      };

      const module = await createAsyncModule();
      app.use(module);

      await app.start();
      expect(app.hasModule('async-created')).toBe(true);
    });
  });

  describe('Module Metadata Discovery', () => {
    it('should discover module metadata', () => {
      @Module({
        providers: [{ provide: 'TEST', useValue: 'test' }],
        exports: ['TEST']
      })
      class MetadataModule implements IModule {
        readonly name = 'metadata-module';
      }

      const module = new MetadataModule();
      const metadata = (module.constructor as any).__titanModuleMetadata;

      expect(metadata).toBeDefined();
      expect(metadata.providers).toBeDefined();
      expect(metadata.exports).toContain('TEST');
    });

    it('should discover service metadata from providers', async () => {
      @Injectable()
      class TestService {
        getValue() {
          return 'service-value';
        }
      }

      @Module({
        providers: [TestService],
        exports: [TestService]
      })
      class ServiceModule implements IModule {
        readonly name = 'service-module';
      }

      const module = new ServiceModule();
      app.use(module);
      await app.start();

      // Service should be available in container
      const service = app.container.resolve(TestService);
      expect(service.getValue()).toBe('service-value');
    });
  });
});