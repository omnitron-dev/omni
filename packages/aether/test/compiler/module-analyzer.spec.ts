/**
 * @fileoverview Module Analyzer Tests
 *
 * Tests module analyzer functionality:
 * - Module detection in AST
 * - Metadata extraction (imports, providers, stores, routes, islands)
 * - Dependency graph generation
 * - Optimization opportunity detection
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { ModuleAnalyzer, analyzeModules } from '../../src/compiler/optimizations/module-analyzer.js';

/**
 * Helper to create TypeScript source file from code
 */
function createSourceFile(code: string): ts.SourceFile {
  return ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
}

describe('ModuleAnalyzer', () => {
  describe('module detection', () => {
    it('should detect defineModule() calls', () => {
      const code = `
        const TestModule = defineModule({
          id: 'test-module',
          providers: []
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules).toHaveLength(1);
      expect(result.modules[0].id).toBe('test-module');
    });

    it('should detect multiple modules', () => {
      const code = `
        const Module1 = defineModule({
          id: 'module1',
          providers: []
        });

        const Module2 = defineModule({
          id: 'module2',
          providers: []
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules).toHaveLength(2);
      expect(result.modules[0].id).toBe('module1');
      expect(result.modules[1].id).toBe('module2');
    });

    it('should ignore non-defineModule calls', () => {
      const code = `
        const notAModule = someOtherFunction({
          id: 'not-a-module',
          providers: []
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules).toHaveLength(0);
    });

    it('should handle empty module definition', () => {
      const code = `
        const EmptyModule = defineModule({
          id: 'empty-module'
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules).toHaveLength(1);
      expect(result.modules[0].providers).toHaveLength(0);
      expect(result.modules[0].stores).toHaveLength(0);
    });
  });

  describe('imports extraction', () => {
    it('should extract static imports', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          imports: [CoreModule, UtilsModule],
          providers: []
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].imports).toHaveLength(2);
      expect(result.modules[0].imports[0].source).toBe('CoreModule');
      expect(result.modules[0].imports[0].isDynamic).toBe(false);
      expect(result.modules[0].imports[1].source).toBe('UtilsModule');
    });

    it('should detect dynamic imports', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          imports: [
            CoreModule,
            () => import('./LazyModule')
          ],
          providers: []
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].imports).toHaveLength(2);
      expect(result.modules[0].imports[0].isDynamic).toBe(false);
      expect(result.modules[0].imports[1].isDynamic).toBe(true);
    });

    it('should detect lazy() imports', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          imports: [
            lazy(() => import('./LazyModule'))
          ],
          providers: []
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].imports).toHaveLength(1);
      expect(result.modules[0].imports[0].isDynamic).toBe(true);
      expect(result.modules[0].imports[0].source).toBe('lazy');
    });
  });

  describe('providers extraction', () => {
    it('should extract class providers', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: [UserService, AuthService]
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].providers).toHaveLength(2);
      expect(result.modules[0].providers[0].name).toBe('UserService');
      expect(result.modules[0].providers[0].type).toBe('class');
      expect(result.modules[0].providers[1].name).toBe('AuthService');
    });

    it('should extract value providers', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: [
            { provide: 'API_URL', useValue: 'https://api.example.com' }
          ]
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].providers).toHaveLength(1);
      expect(result.modules[0].providers[0].name).toBe('API_URL');
      expect(result.modules[0].providers[0].type).toBe('value');
    });

    it('should extract factory providers', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: [
            { provide: LoggerService, useFactory: () => new LoggerService() }
          ]
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].providers).toHaveLength(1);
      expect(result.modules[0].providers[0].name).toBe('LoggerService');
      expect(result.modules[0].providers[0].type).toBe('factory');
    });

    it('should extract useClass providers', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: [
            { provide: AbstractService, useClass: ConcreteService }
          ]
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].providers).toHaveLength(1);
      expect(result.modules[0].providers[0].name).toBe('AbstractService');
      expect(result.modules[0].providers[0].type).toBe('class');
    });

    it('should extract existing providers', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: [
            { provide: 'Logger', useExisting: ConsoleLogger }
          ]
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].providers).toHaveLength(1);
      expect(result.modules[0].providers[0].name).toBe('Logger');
      expect(result.modules[0].providers[0].type).toBe('existing');
    });
  });

  describe('stores extraction', () => {
    it('should extract store factories', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          stores: [
            () => defineStore('user', () => ({ users: [] })),
            () => defineStore('auth', () => ({ token: null }))
          ]
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].stores).toHaveLength(2);
      expect(result.modules[0].stores[0].id).toContain('store_');
      expect(result.modules[0].stores[1].id).toContain('store_');
    });

    it('should handle empty stores array', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          stores: []
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].stores).toHaveLength(0);
    });
  });

  describe('routes extraction', () => {
    it('should extract route definitions', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          routes: [
            { path: '/', component: HomePage },
            { path: '/about', component: AboutPage }
          ]
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].routes).toHaveLength(2);
      expect(result.modules[0].routes[0].path).toBe('/');
      expect(result.modules[0].routes[1].path).toBe('/about');
    });

    it('should detect lazy route components', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          routes: [
            { path: '/', component: () => import('./HomePage') },
            { path: '/about', component: AboutPage }
          ]
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].routes[0].isLazy).toBe(true);
      expect(result.modules[0].routes[1].isLazy).toBe(false);
    });

    it('should handle nested route paths', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          routes: [
            { path: '/users/:id', component: UserDetailPage },
            { path: '/posts/:postId/comments/:commentId', component: CommentPage }
          ]
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].routes).toHaveLength(2);
      expect(result.modules[0].routes[0].path).toBe('/users/:id');
      expect(result.modules[0].routes[1].path).toBe('/posts/:postId/comments/:commentId');
    });
  });

  describe('islands extraction', () => {
    it('should extract island definitions', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          islands: [
            { id: 'header', component: () => import('./Header'), strategy: 'immediate' },
            { id: 'footer', component: () => import('./Footer'), strategy: 'idle' }
          ]
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].islands).toHaveLength(2);
      expect(result.modules[0].islands[0].id).toBe('header');
      expect(result.modules[0].islands[0].strategy).toBe('immediate');
      expect(result.modules[0].islands[1].id).toBe('footer');
      expect(result.modules[0].islands[1].strategy).toBe('idle');
    });

    it('should default to idle strategy', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          islands: [
            { id: 'widget', component: () => import('./Widget') }
          ]
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].islands[0].strategy).toBe('idle');
    });
  });

  describe('exports extraction', () => {
    it('should extract exported providers', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: [Service1, Service2, Service3],
          exports: {
            providers: [Service1, Service2]
          }
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].exports).toBeDefined();
      expect(result.modules[0].exports?.providers).toHaveLength(2);
      expect(result.modules[0].exports?.providers).toContain('Service1');
      expect(result.modules[0].exports?.providers).toContain('Service2');
    });

    it('should extract exported stores', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          stores: [() => defineStore('user', () => ({}))],
          exports: {
            stores: ['user']
          }
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].exports).toBeDefined();
      expect(result.modules[0].exports?.stores).toHaveLength(1);
      expect(result.modules[0].exports?.stores).toContain('user');
    });
  });

  describe('optimization hints extraction', () => {
    it('should extract optimization hints', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: [],
          optimization: {
            preloadModules: ['core', 'utils'],
            prefetchModules: ['admin'],
            lazyBoundary: true,
            splitChunk: true,
            inline: false,
            sideEffects: false,
            pure: true,
            priority: 'high'
          }
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      const opt = result.modules[0].optimization;
      expect(opt).toBeDefined();
      expect(opt?.preloadModules).toEqual(['core', 'utils']);
      expect(opt?.prefetchModules).toEqual(['admin']);
      expect(opt?.lazyBoundary).toBe(true);
      expect(opt?.splitChunk).toBe(true);
      expect(opt?.inline).toBe(false);
      expect(opt?.sideEffects).toBe(false);
      expect(opt?.pure).toBe(true);
      expect(opt?.priority).toBe('high');
    });

    it('should default sideEffects to true', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: [],
          optimization: {}
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].optimization?.sideEffects).toBe(true);
    });

    it('should default priority to normal', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: [],
          optimization: {}
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].optimization?.priority).toBe('normal');
    });
  });

  describe('side effects detection', () => {
    it('should detect modules with lifecycle hooks', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: [],
          setup: async () => {
            console.log('Setting up');
            return {};
          }
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].hasSideEffects).toBe(true);
    });

    it('should mark modules without lifecycle as no side effects', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: []
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].hasSideEffects).toBe(false);
    });
  });

  describe('size estimation', () => {
    it('should estimate module size based on contents', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: [Service1, Service2],
          stores: [() => store1(), () => store2()],
          routes: [{ path: '/', component: Home }],
          islands: [{ id: 'header', component: () => import('./Header') }]
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].estimatedSize).toBeGreaterThan(5000);
      expect(result.modules[0].estimatedSize).toBeLessThan(50000);
    });

    it('should estimate small size for minimal modules', () => {
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: []
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].estimatedSize).toBe(5000);
    });

    it('should estimate large size for complex modules', () => {
      const providers = Array.from({ length: 10 }, (_, i) => `Service${i}`).join(', ');
      const code = `
        const Module = defineModule({
          id: 'test',
          providers: [${providers}],
          stores: [() => store1(), () => store2(), () => store3()],
          routes: [
            { path: '/', component: Home },
            { path: '/about', component: About },
            { path: '/contact', component: Contact }
          ]
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules[0].estimatedSize).toBeGreaterThan(20000);
    });
  });

  describe('dependency graph', () => {
    it('should build dependency graph', () => {
      const code = `
        const Module1 = defineModule({
          id: 'module1',
          imports: [Module2, Module3],
          providers: []
        });

        const Module2 = defineModule({
          id: 'module2',
          providers: []
        });

        const Module3 = defineModule({
          id: 'module3',
          imports: [Module2],
          providers: []
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.dependencies.has('module1')).toBe(true);
      expect(result.dependencies.get('module1')).toContain('Module2');
      expect(result.dependencies.get('module1')).toContain('Module3');
    });

    it('should track module usages', () => {
      const code = `
        const CoreModule = defineModule({
          id: 'core',
          providers: []
        });

        const Module1 = defineModule({
          id: 'module1',
          imports: [CoreModule],
          providers: []
        });

        const Module2 = defineModule({
          id: 'module2',
          imports: [CoreModule],
          providers: []
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.usages.has('CoreModule')).toBe(true);
      expect(result.usages.get('CoreModule')).toHaveLength(2);
      expect(result.usages.get('CoreModule')).toContain('module1');
      expect(result.usages.get('CoreModule')).toContain('module2');
    });
  });

  describe('optimization opportunities', () => {
    it('should identify tree-shaking opportunity for pure modules', () => {
      const code = `
        const Module = defineModule({
          id: 'pure-module',
          providers: [],
          optimization: {
            pure: true
          }
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      const treeShakeOpp = result.opportunities.find((opp) => opp.type === 'tree-shake');
      expect(treeShakeOpp).toBeDefined();
      expect(treeShakeOpp?.moduleId).toBe('pure-module');
      expect(treeShakeOpp?.impact).toBe('high');
    });

    it('should identify inline opportunity for small modules', () => {
      const code = `
        const Module = defineModule({
          id: 'small-module',
          providers: [],
          optimization: {
            inline: true
          }
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      const inlineOpp = result.opportunities.find((opp) => opp.type === 'inline');
      expect(inlineOpp).toBeDefined();
      expect(inlineOpp?.moduleId).toBe('small-module');
      expect(inlineOpp?.impact).toBe('medium');
    });

    it('should identify split opportunity for lazy boundaries', () => {
      const code = `
        const Module = defineModule({
          id: 'lazy-module',
          providers: [],
          optimization: {
            lazyBoundary: true
          }
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      const splitOpp = result.opportunities.find((opp) => opp.type === 'split');
      expect(splitOpp).toBeDefined();
      expect(splitOpp?.moduleId).toBe('lazy-module');
      expect(splitOpp?.impact).toBe('high');
    });

    it('should identify preload opportunity for high priority modules', () => {
      const code = `
        const Module = defineModule({
          id: 'critical-module',
          providers: [],
          optimization: {
            priority: 'high'
          }
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      const preloadOpp = result.opportunities.find((opp) => opp.type === 'preload');
      expect(preloadOpp).toBeDefined();
      expect(preloadOpp?.moduleId).toBe('critical-module');
      expect(preloadOpp?.impact).toBe('medium');
    });

    it('should identify merge opportunity for small single-use modules', () => {
      const code = `
        const SmallModule = defineModule({
          id: 'small',
          providers: []
        });

        const ParentModule = defineModule({
          id: 'parent',
          imports: [SmallModule],
          providers: []
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      const mergeOpp = result.opportunities.find(
        (opp) => opp.type === 'merge' && opp.moduleId === 'small'
      );
      expect(mergeOpp).toBeDefined();
      expect(mergeOpp?.impact).toBe('low');
    });
  });

  describe('edge cases', () => {
    it('should handle malformed module definitions gracefully', () => {
      const code = `
        const InvalidModule = defineModule();
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules).toHaveLength(0);
    });

    it('should handle modules without ID', () => {
      const code = `
        const NoIdModule = defineModule({
          providers: []
        });
      `;

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules).toHaveLength(0);
    });

    it('should handle empty source file', () => {
      const code = '';

      const sourceFile = createSourceFile(code);
      const result = analyzeModules(sourceFile);

      expect(result.modules).toHaveLength(0);
      expect(result.dependencies.size).toBe(0);
      expect(result.opportunities).toHaveLength(0);
    });
  });
});
