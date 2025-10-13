/**
 * Tests for Dynamic Imports Handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DynamicImportsHandler,
  createDynamicImportsHandler,
  type DynamicImportsConfig,
  type DynamicImport,
} from '../../src/build/dynamic-imports.js';

describe('DynamicImportsHandler', () => {
  let handler: DynamicImportsHandler;

  beforeEach(() => {
    handler = new DynamicImportsHandler({
      chunkNames: 'auto',
      lazyBoundaries: true,
      routeBasedSplitting: true,
    });
  });

  describe('detectImports', () => {
    it('should detect simple dynamic import', () => {
      const code = `
        const Component = () => {
          const load = () => import('./Component.tsx');
        };
      `;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports).toHaveLength(1);
      expect(imports[0].specifier).toBe('./Component.tsx');
      expect(imports[0].parentModule).toBe('src/App.tsx');
    });

    it('should detect multiple dynamic imports', () => {
      const code = `
        import('./A.js');
        import('./B.js');
        import('./C.js');
      `;

      const imports = handler.detectImports(code, 'src/main.ts');

      expect(imports).toHaveLength(3);
      expect(imports[0].specifier).toBe('./A.js');
      expect(imports[1].specifier).toBe('./B.js');
      expect(imports[2].specifier).toBe('./C.js');
    });

    it('should parse magic comments', () => {
      const code = `
        import(/* webpackChunkName: "my-chunk" */ './Component.tsx');
      `;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports[0].magicComments.chunkName).toBe('my-chunk');
      expect(imports[0].chunkName).toBe('my-chunk');
    });

    it('should parse preload magic comment', () => {
      const code = `
        import(/* webpackPreload: true */ './Critical.tsx');
      `;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports[0].magicComments.preload).toBe(true);
      expect(imports[0].strategy).toBe('preload');
    });

    it('should parse prefetch magic comment', () => {
      const code = `
        import(/* webpackPrefetch: true */ './Feature.tsx');
      `;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports[0].magicComments.prefetch).toBe(true);
      expect(imports[0].strategy).toBe('prefetch');
    });

    it('should parse eager mode magic comment', () => {
      const code = `
        import(/* webpackMode: "eager" */ './Inline.tsx');
      `;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports[0].magicComments.mode).toBe('eager');
      expect(imports[0].strategy).toBe('eager');
    });

    it('should detect route imports', () => {
      const code = `
        const routes = [
          { path: '/home', component: () => import('./routes/Home.tsx') },
          { path: '/about', component: () => import('./routes/About.tsx') },
        ];
      `;

      const imports = handler.detectImports(code, 'src/router.ts');

      expect(imports).toHaveLength(2);
      expect(imports[0].isRoute).toBe(true);
      expect(imports[1].isRoute).toBe(true);
      expect(imports[0].chunkName).toContain('route-');
    });

    it('should detect component imports', () => {
      const handlerWithComponents = new DynamicImportsHandler({
        componentSplitting: true,
      });

      const code = `
        const LazyComponent = () => import('./components/Heavy.tsx');
      `;

      const imports = handlerWithComponents.detectImports(code, 'src/App.tsx');

      expect(imports[0].isComponent).toBe(true);
      expect(imports[0].chunkName).toContain('component-');
    });

    it('should calculate correct position and line numbers', () => {
      const code = `
        const a = 1;
        const b = 2;
        import('./test.js');
        const c = 3;
      `;

      const imports = handler.detectImports(code, 'src/test.ts');

      expect(imports[0].position.line).toBe(4); // Line 4 because of leading newline
      expect(imports[0].position.start).toBeGreaterThan(0);
      expect(imports[0].position.end).toBeGreaterThan(imports[0].position.start);
    });
  });

  describe('transform', () => {
    it('should transform dynamic import with chunk name', () => {
      const code = `import('./Component.tsx')`;

      const result = handler.transform(code, 'src/App.tsx');

      expect(result.code).toContain('webpackChunkName');
      expect(result.imports).toHaveLength(1);
    });

    it('should add retry logic when enabled', () => {
      const code = `import('./Component.tsx')`;

      const result = handler.transform(code, 'src/App.tsx');

      expect(result.code).toContain('__importWithRetry');
    });

    it('should not add duplicate retry logic', () => {
      const code = `
        function __importWithRetry() {}
        import('./Component.tsx')
      `;

      const result = handler.transform(code, 'src/App.tsx');

      const matches = result.code.match(/function __importWithRetry/g);
      expect(matches).toHaveLength(1);
    });

    it('should add preload hint for configured modules', () => {
      const handlerWithPreload = new DynamicImportsHandler({
        preload: ['./Critical.tsx'],
      });

      const code = `import('./Critical.tsx')`;

      const result = handlerWithPreload.transform(code, 'src/App.tsx');

      expect(result.code).toContain('webpackPreload: true');
      expect(result.stats.preloadImports).toBe(1);
    });

    it('should add prefetch hint for configured modules', () => {
      const handlerWithPrefetch = new DynamicImportsHandler({
        prefetch: ['./Feature.tsx'],
      });

      const code = `import('./Feature.tsx')`;

      const result = handlerWithPrefetch.transform(code, 'src/App.tsx');

      expect(result.code).toContain('webpackPrefetch: true');
      expect(result.stats.prefetchImports).toBe(1);
    });

    it('should support preload predicate function', () => {
      const handlerWithPredicate = new DynamicImportsHandler({
        preload: (id: string) => id.includes('critical'),
      });

      const code = `import('./critical/Module.tsx')`;

      const result = handlerWithPredicate.transform(code, 'src/App.tsx');

      expect(result.stats.preloadImports).toBe(1);
    });

    it('should calculate statistics correctly', () => {
      const code = `
        import(/* webpackPreload: true */ './A.tsx');
        import(/* webpackPrefetch: true */ './B.tsx');
        import('./C.tsx');
      `;

      const result = handler.transform(code, 'src/App.tsx');

      expect(result.stats.totalImports).toBe(3);
      expect(result.stats.preloadImports).toBe(1);
      expect(result.stats.prefetchImports).toBe(1);
      expect(result.stats.lazyImports).toBe(1);
    });
  });

  describe('chunk naming', () => {
    it('should auto-generate chunk name from file path', () => {
      const code = `import('./features/UserProfile.tsx')`;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports[0].chunkName).toBe('userprofile');
    });

    it('should generate route-based chunk names', () => {
      const code = `import('./routes/Dashboard.tsx')`;

      const imports = handler.detectImports(code, 'src/router.ts');

      expect(imports[0].chunkName).toBe('route-dashboard');
    });

    it('should generate component-based chunk names', () => {
      const handlerWithComponents = new DynamicImportsHandler({
        componentSplitting: true,
      });

      const code = `import('./components/DataTable.tsx')`;

      const imports = handlerWithComponents.detectImports(code, 'src/App.tsx');

      expect(imports[0].chunkName).toBe('component-datatable');
    });

    it('should generate library-based chunk names', () => {
      const code = `import('lodash')`;

      const imports = handler.detectImports(code, 'src/utils.ts');

      expect(imports[0].chunkName).toBe('lib-lodash');
    });

    it('should handle scoped packages', () => {
      const code = `import('@scope/package')`;

      const imports = handler.detectImports(code, 'src/utils.ts');

      expect(imports[0].chunkName).toBe('lib-scope-package');
    });

    it('should support custom chunk name function', () => {
      const handlerWithCustomNaming = new DynamicImportsHandler({
        chunkNames: (id: string) => `custom-${id.split('/').pop()}`,
      });

      const code = `import('./Feature.tsx')`;

      const imports = handlerWithCustomNaming.detectImports(code, 'src/App.tsx');

      expect(imports[0].chunkName).toContain('custom-');
    });

    it('should sanitize chunk names', () => {
      const code = `import('./features/User@Profile#Special!.tsx')`;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports[0].chunkName).toMatch(/^[a-z0-9-]+$/);
      expect(imports[0].chunkName).not.toContain('@');
      expect(imports[0].chunkName).not.toContain('#');
      expect(imports[0].chunkName).not.toContain('!');
    });
  });

  describe('import map', () => {
    it('should build import map', () => {
      const code = `
        import('./A.tsx');
        import('./B.tsx');
      `;

      handler.transform(code, 'src/App.tsx');
      const importMap = handler.getImportMap();

      expect(importMap.modules.size).toBeGreaterThan(0);
      expect(importMap.chunks.size).toBeGreaterThan(0);
    });

    it('should track preload chunks in import map', () => {
      const code = `import(/* webpackPreload: true */ './Critical.tsx')`;

      handler.transform(code, 'src/App.tsx');
      const importMap = handler.getImportMap();

      expect(importMap.preload.size).toBe(1);
    });

    it('should track prefetch chunks in import map', () => {
      const code = `import(/* webpackPrefetch: true */ './Feature.tsx')`;

      handler.transform(code, 'src/App.tsx');
      const importMap = handler.getImportMap();

      expect(importMap.prefetch.size).toBe(1);
    });

    it('should generate preload HTML tags', () => {
      const code = `import(/* webpackPreload: true */ './Critical.tsx')`;

      const result = handler.transform(code, 'src/App.tsx');
      const chunkIds = Array.from(result.importMap.preload);
      const tags = handler.generatePreloadTags(chunkIds);

      expect(tags.length).toBeGreaterThan(0);
      expect(tags[0]).toContain('<link rel="preload"');
      expect(tags[0]).toContain('as="script"');
    });

    it('should generate prefetch HTML tags', () => {
      const code = `import(/* webpackPrefetch: true */ './Feature.tsx')`;

      const result = handler.transform(code, 'src/App.tsx');
      const chunkIds = Array.from(result.importMap.prefetch);
      const tags = handler.generatePreloadTags(chunkIds);

      expect(tags.length).toBeGreaterThan(0);
      expect(tags[0]).toContain('<link rel="prefetch"');
    });

    it('should generate import map JSON', () => {
      const code = `import('./Component.tsx')`;

      handler.transform(code, 'src/App.tsx');
      const json = handler.generateImportMapJSON();

      expect(json).toBeDefined();
      expect(() => JSON.parse(json)).not.toThrow();

      const parsed = JSON.parse(json);
      expect(parsed.imports).toBeDefined();
    });
  });

  describe('configuration', () => {
    it('should support disabling lazy boundaries', () => {
      const handlerNoBoundaries = new DynamicImportsHandler({
        lazyBoundaries: false,
      });

      expect(handlerNoBoundaries).toBeDefined();
    });

    it('should support disabling retry logic', () => {
      const handlerNoRetry = new DynamicImportsHandler({
        retryOnFailure: false,
      });

      const code = `import('./Component.tsx')`;
      const result = handlerNoRetry.transform(code, 'src/App.tsx');

      expect(result.code).not.toContain('__importWithRetry');
    });

    it('should support custom retry configuration', () => {
      const handlerCustomRetry = new DynamicImportsHandler({
        retryOnFailure: true,
        maxRetries: 5,
        retryDelay: 2000,
      });

      const code = `import('./Component.tsx')`;
      const result = handlerCustomRetry.transform(code, 'src/App.tsx');

      expect(result.code).toContain('retries = 5');
      expect(result.code).toContain('delay = 2000');
    });

    it('should support disabling route-based splitting', () => {
      const handlerNoRoutes = new DynamicImportsHandler({
        routeBasedSplitting: false,
      });

      const code = `import('./routes/Home.tsx')`;
      const imports = handlerNoRoutes.detectImports(code, 'src/router.ts');

      expect(imports[0].isRoute).toBe(false);
    });

    it('should support library chunking', () => {
      const handlerWithLib = new DynamicImportsHandler({
        libraryChunking: true,
      });

      const code = `import('react')`;
      const imports = handlerWithLib.detectImports(code, 'src/App.tsx');

      expect(imports[0].chunkName).toContain('lib-');
    });
  });

  describe('edge cases', () => {
    it('should handle imports with single quotes', () => {
      const code = `import('./Component.tsx')`;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports).toHaveLength(1);
    });

    it('should handle imports with double quotes', () => {
      const code = `import("./Component.tsx")`;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports).toHaveLength(1);
    });

    it('should handle imports with backticks', () => {
      const code = 'import(`./Component.tsx`)';

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports).toHaveLength(1);
    });

    it('should handle imports with whitespace', () => {
      const code = `import(  './Component.tsx'  )`;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports).toHaveLength(1);
    });

    it('should handle empty code', () => {
      const code = '';

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports).toHaveLength(0);
    });

    it('should handle code without imports', () => {
      const code = `
        const foo = 'bar';
        console.log('no imports here');
      `;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports).toHaveLength(0);
    });

    it('should handle multiline imports', () => {
      const code = `
        import(
          './Component.tsx'
        )
      `;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports).toHaveLength(1);
    });
  });

  describe('utilities', () => {
    it('should clear cached data', () => {
      const code = `import('./Component.tsx')`;

      handler.transform(code, 'src/App.tsx');
      expect(handler.getImports().size).toBeGreaterThan(0);

      handler.clear();
      expect(handler.getImports().size).toBe(0);
      expect(handler.getImportMap().modules.size).toBe(0);
    });

    it('should get all detected imports', () => {
      const code = `import('./A.tsx')`;

      handler.detectImports(code, 'src/App.tsx');
      const imports = handler.getImports();

      expect(imports.size).toBe(1);
      expect(imports.has('src/App.tsx')).toBe(true);
    });

    it('should create handler with factory function', () => {
      const config: DynamicImportsConfig = {
        chunkNames: 'manual',
      };

      const newHandler = createDynamicImportsHandler(config);

      expect(newHandler).toBeInstanceOf(DynamicImportsHandler);
    });
  });

  describe('complex scenarios', () => {
    it('should handle mixed import strategies', () => {
      const code = `
        import(/* webpackPreload: true */ './Critical.tsx');
        import(/* webpackPrefetch: true */ './Feature.tsx');
        import('./Lazy.tsx');
        import(/* webpackMode: "eager" */ './Inline.tsx');
      `;

      const result = handler.transform(code, 'src/App.tsx');

      expect(result.stats.totalImports).toBe(4);
      expect(result.stats.preloadImports).toBe(1);
      expect(result.stats.prefetchImports).toBe(1);
      expect(result.stats.lazyImports).toBe(1);
    });

    it('should handle nested dynamic imports', () => {
      const code = `
        const loadFeature = () => {
          return import('./Feature.tsx').then(module => {
            return module.default().then(() => import('./SubFeature.tsx'));
          });
        };
      `;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports).toHaveLength(2);
    });

    it('should handle conditional dynamic imports', () => {
      const code = `
        if (condition) {
          import('./A.tsx');
        } else {
          import('./B.tsx');
        }
      `;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports).toHaveLength(2);
    });

    it('should handle dynamic imports in arrays', () => {
      const code = `
        const components = [
          () => import('./A.tsx'),
          () => import('./B.tsx'),
          () => import('./C.tsx'),
        ];
      `;

      const imports = handler.detectImports(code, 'src/App.tsx');

      expect(imports).toHaveLength(3);
    });
  });
});
