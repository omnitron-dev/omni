/**
 * @omnitron-dev/aether-babel-plugin
 *
 * Optional Babel plugin for compile-time optimizations in Aether applications.
 *
 * This plugin provides opt-in performance optimizations:
 * - Template Cloning: Convert static JSX to cloneable templates
 * - Dead Code Elimination: Remove provably unreachable code
 * - Static Hoisting: Hoist static values to module scope
 *
 * @example
 * // .babelrc
 * {
 *   "plugins": [
 *     ["@omnitron-dev/aether-babel-plugin", {
 *       "optimizations": {
 *         "templateCloning": true,
 *         "deadCodeElimination": true,
 *         "staticHoisting": true
 *       }
 *     }]
 *   ]
 * }
 */

import { declare } from '@babel/helper-plugin-utils';
import type { PluginObj, PluginPass } from '@babel/core';
import { templateCloning } from './optimizations/template-cloning';
import { deadCodeElimination } from './optimizations/dead-code';
import { staticHoisting } from './optimizations/static-hoisting';

export interface PluginOptions {
  optimizations?: {
    /** Enable template cloning optimization (default: false) */
    templateCloning?: boolean;
    /** Enable dead code elimination (default: false) */
    deadCodeElimination?: boolean;
    /** Enable static hoisting (default: false) */
    staticHoisting?: boolean;
  };
  /** Minimum number of elements to create a template (default: 3) */
  minElementsForTemplate?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

export interface PluginState extends PluginPass {
  opts: PluginOptions;
  templateCount: number;
  hoistedCount: number;
  eliminatedCount: number;
}

export default declare<PluginOptions, PluginObj<PluginState>>((api, options) => {
  api.assertVersion(7);

  const opts: PluginOptions = {
    optimizations: {
      templateCloning: options.optimizations?.templateCloning ?? false,
      deadCodeElimination: options.optimizations?.deadCodeElimination ?? false,
      staticHoisting: options.optimizations?.staticHoisting ?? false,
    },
    minElementsForTemplate: options.minElementsForTemplate ?? 3,
    verbose: options.verbose ?? false,
  };

  return {
    name: '@omnitron-dev/aether-babel-plugin',

    pre(state: PluginState) {
      // Initialize counters
      state.templateCount = 0;
      state.hoistedCount = 0;
      state.eliminatedCount = 0;
    },

    visitor: {
      Program: {
        exit(path, state: PluginState) {
          if (opts.verbose) {
            console.log(
              `[@omnitron-dev/aether-babel-plugin] Optimizations applied:
  - Templates created: ${state.templateCount}
  - Static values hoisted: ${state.hoistedCount}
  - Dead code blocks eliminated: ${state.eliminatedCount}`
            );
          }
        },
      },

      JSXElement(path, state: PluginState) {
        // Apply optimizations in order
        if (opts.optimizations?.templateCloning) {
          templateCloning(path, state, opts);
        }

        if (opts.optimizations?.deadCodeElimination) {
          deadCodeElimination(path, state, opts);
        }

        if (opts.optimizations?.staticHoisting) {
          staticHoisting(path, state, opts);
        }
      },
    },

    post(state: PluginState) {
      // Cleanup if needed
    },
  };
});
