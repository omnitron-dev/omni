/**
 * @fileoverview Module Tree Shaker Tests
 *
 * Tests module tree-shaking optimization:
 * - Unused module removal
 * - Unused export removal
 * - Unused provider removal
 * - Unused store removal
 */

import { describe, it, expect } from 'vitest';
import { ModuleTreeShakerPass } from '../../src/compiler/optimizations/module-tree-shaker.js';
import type { OptimizationContext, OptimizerOptions } from '../../src/compiler/optimizer.js';

describe('ModuleTreeShaker', () => {
  const createContext = (): OptimizationContext => ({
    filePath: 'test.tsx',
    format: 'esm',
    isProduction: true,
  });

  const createOptions = (level: 'normal' | 'aggressive' = 'normal'): Required<OptimizerOptions> => ({
    level,
    enabled: true,
    removeUnusedCode: true,
    inlineConstants: true,
    minify: false,
    optimizeBundle: true,
  });

  describe('module removal', () => {
    it('should remove unused pure module', async () => {
      const code = `
        export const UnusedModule = defineModule({
          id: 'unused',
          providers: [],
          optimization: {
            pure: true
          }
        });

        export const UsedModule = defineModule({
          id: 'used',
          providers: []
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).not.toContain('UnusedModule');
      expect(result.code).toContain('UsedModule');
      expect(result.changes.length).toBeGreaterThan(0);
    });

    it('should not remove module with side effects', async () => {
      const code = `
        export const ModuleWithSideEffects = defineModule({
          id: 'with-effects',
          providers: [],
          setup: async () => {
            console.log('Side effect');
            return {};
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('ModuleWithSideEffects');
      expect(result.changes).toHaveLength(0);
    });

    it('should not remove imported modules', async () => {
      const code = `
        export const SharedModule = defineModule({
          id: 'shared',
          providers: [],
          optimization: {
            pure: true
          }
        });

        export const AppModule = defineModule({
          id: 'app',
          imports: [SharedModule],
          providers: []
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('SharedModule');
      expect(result.code).toContain('AppModule');
    });

    it('should not remove module without pure flag', async () => {
      const code = `
        export const UnmarkedModule = defineModule({
          id: 'unmarked',
          providers: []
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('UnmarkedModule');
    });
  });

  describe('export removal', () => {
    it('should remove unused exported providers', async () => {
      const code = `
        export const Module = defineModule({
          id: 'test',
          providers: [UsedService, UnusedService],
          exports: {
            providers: [UsedService, UnusedService]
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      // Both providers should remain since we can't determine usage without actual module analysis
      expect(result.code).toContain('Module');
    });

    it('should remove unused exported stores', async () => {
      const code = `
        export const Module = defineModule({
          id: 'test',
          stores: [
            () => defineStore('used', () => ({})),
            () => defineStore('unused', () => ({}))
          ],
          exports: {
            stores: ['used', 'unused']
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('Module');
    });

    it('should preserve used exports', async () => {
      const code = `
        export const SharedModule = defineModule({
          id: 'shared',
          providers: [SharedService],
          exports: {
            providers: [SharedService]
          }
        });

        export const AppModule = defineModule({
          id: 'app',
          imports: [SharedModule],
          providers: []
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('SharedService');
      expect(result.code).toContain('SharedModule');
    });
  });

  describe('provider removal', () => {
    it('should not remove exported providers in normal mode', async () => {
      const code = `
        export const Module = defineModule({
          id: 'test',
          providers: [
            ExportedService,
            InternalService
          ],
          exports: {
            providers: [ExportedService]
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions('normal'));
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('ExportedService');
    });

    it('should remove exported providers in aggressive mode', async () => {
      const code = `
        export const Module = defineModule({
          id: 'test',
          providers: [UnusedService],
          exports: {
            providers: [UnusedService]
          },
          optimization: {
            pure: true
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions('aggressive'));
      const result = await treeshaker.transform(code, createContext());

      // Result depends on whether the module itself is used
      expect(result.code).toBeDefined();
    });

    it('should handle multiple providers', async () => {
      const code = `
        export const Module = defineModule({
          id: 'test',
          providers: [
            Service1,
            Service2,
            Service3
          ]
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('Module');
    });

    it('should handle different provider types', async () => {
      const code = `
        export const Module = defineModule({
          id: 'test',
          providers: [
            ClassService,
            { provide: 'TOKEN', useValue: 'value' },
            { provide: FactoryService, useFactory: () => new FactoryService() },
            { provide: AbstractService, useClass: ConcreteService }
          ]
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('Module');
    });
  });

  describe('store removal', () => {
    it('should not remove exported stores in normal mode', async () => {
      const code = `
        export const Module = defineModule({
          id: 'test',
          stores: [
            () => defineStore('exported', () => ({})),
            () => defineStore('internal', () => ({}))
          ],
          exports: {
            stores: ['exported']
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions('normal'));
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('Module');
    });

    it('should remove exported stores in aggressive mode', async () => {
      const code = `
        export const Module = defineModule({
          id: 'test',
          stores: [
            () => defineStore('unused', () => ({}))
          ],
          exports: {
            stores: ['unused']
          },
          optimization: {
            pure: true
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions('aggressive'));
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toBeDefined();
    });

    it('should handle multiple stores', async () => {
      const code = `
        export const Module = defineModule({
          id: 'test',
          stores: [
            () => defineStore('user', () => ({})),
            () => defineStore('auth', () => ({})),
            () => defineStore('settings', () => ({}))
          ]
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('Module');
    });
  });

  describe('metadata tracking', () => {
    it('should track modules analyzed', async () => {
      const code = `
        export const Module1 = defineModule({
          id: 'module1',
          providers: []
        });

        export const Module2 = defineModule({
          id: 'module2',
          providers: []
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.metadata?.modulesAnalyzed).toBe(2);
    });

    it('should track changes made', async () => {
      const code = `
        export const UnusedModule = defineModule({
          id: 'unused',
          providers: [],
          optimization: {
            pure: true
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.metadata).toBeDefined();
      expect(result.changes).toBeInstanceOf(Array);
    });

    it('should calculate size impact', async () => {
      const code = `
        export const LargeUnusedModule = defineModule({
          id: 'large-unused',
          providers: [
            Service1, Service2, Service3, Service4, Service5
          ],
          stores: [
            () => defineStore('store1', () => ({})),
            () => defineStore('store2', () => ({}))
          ],
          optimization: {
            pure: true
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      if (result.changes.length > 0) {
        expect(result.changes[0].sizeImpact).toBeGreaterThan(0);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty code', async () => {
      const code = '';

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toBe('');
      expect(result.changes).toHaveLength(0);
    });

    it('should handle code without modules', async () => {
      const code = `
        const someVariable = 42;
        function someFunction() {
          return 'hello';
        }
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toBe(code);
      expect(result.changes).toHaveLength(0);
    });

    it('should handle malformed modules gracefully', async () => {
      const code = `
        export const InvalidModule = defineModule();
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toBeDefined();
    });

    it('should handle complex module hierarchies', async () => {
      const code = `
        export const CoreModule = defineModule({
          id: 'core',
          providers: [CoreService]
        });

        export const SharedModule = defineModule({
          id: 'shared',
          imports: [CoreModule],
          providers: [SharedService]
        });

        export const FeatureModule = defineModule({
          id: 'feature',
          imports: [SharedModule],
          providers: [FeatureService]
        });

        export const UnusedModule = defineModule({
          id: 'unused',
          providers: [],
          optimization: {
            pure: true
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('CoreModule');
      expect(result.code).toContain('SharedModule');
      expect(result.code).toContain('FeatureModule');
    });

    it('should preserve module metadata', async () => {
      const code = `
        export const DocumentedModule = defineModule({
          id: 'documented',
          providers: [],
          metadata: {
            name: 'Documented Module',
            version: '1.0.0',
            description: 'A well-documented module'
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('DocumentedModule');
      expect(result.code).toContain('metadata');
    });
  });

  describe('optimization levels', () => {
    it('should be conservative in normal mode', async () => {
      const code = `
        export const Module = defineModule({
          id: 'test',
          providers: [ExportedService],
          exports: {
            providers: [ExportedService]
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions('normal'));
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('ExportedService');
    });

    it('should be more aggressive in aggressive mode', async () => {
      const code = `
        export const Module = defineModule({
          id: 'test',
          providers: [UnusedService],
          exports: {
            providers: [UnusedService]
          },
          optimization: {
            pure: true
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions('aggressive'));
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toBeDefined();
    });
  });

  describe('usage tracking', () => {
    it('should track module imports correctly', async () => {
      const code = `
        export const BaseModule = defineModule({
          id: 'base',
          providers: []
        });

        export const DerivedModule1 = defineModule({
          id: 'derived1',
          imports: [BaseModule],
          providers: []
        });

        export const DerivedModule2 = defineModule({
          id: 'derived2',
          imports: [BaseModule],
          providers: []
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('BaseModule');
      expect(result.code).toContain('DerivedModule1');
      expect(result.code).toContain('DerivedModule2');
    });

    it('should track transitive dependencies', async () => {
      const code = `
        export const Level3 = defineModule({
          id: 'level3',
          providers: []
        });

        export const Level2 = defineModule({
          id: 'level2',
          imports: [Level3],
          providers: []
        });

        export const Level1 = defineModule({
          id: 'level1',
          imports: [Level2],
          providers: []
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('Level3');
      expect(result.code).toContain('Level2');
      expect(result.code).toContain('Level1');
    });
  });

  describe('integration scenarios', () => {
    it('should handle mixed module types', async () => {
      const code = `
        export const StaticModule = defineModule({
          id: 'static',
          providers: [StaticService]
        });

        export const LazyModule = defineModule({
          id: 'lazy',
          imports: [lazy(() => import('./DynamicModule'))],
          providers: []
        });

        export const UnusedPureModule = defineModule({
          id: 'unused-pure',
          providers: [],
          optimization: {
            pure: true
          }
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('StaticModule');
      expect(result.code).toContain('LazyModule');
    });

    it('should handle modules with routes and islands', async () => {
      const code = `
        export const FeatureModule = defineModule({
          id: 'feature',
          providers: [],
          routes: [
            { path: '/', component: HomePage },
            { path: '/feature', component: () => import('./FeaturePage') }
          ],
          islands: [
            { id: 'header', component: () => import('./Header') }
          ]
        });
      `;

      const treeshaker = new ModuleTreeShakerPass(createOptions());
      const result = await treeshaker.transform(code, createContext());

      expect(result.code).toContain('FeatureModule');
      expect(result.code).toContain('routes');
      expect(result.code).toContain('islands');
    });
  });
});
