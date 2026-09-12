/**
 * Async / correctness audit — a SCAN, not a gate.
 *
 * The type-aware rules the default config does not enable. Run per package;
 * the whole repo at once OOMs even at 8 GB.
 *
 *   NODE_OPTIONS='--max-old-space-size=8192' \
 *     npx eslint --config ./eslint.audit.cjs "packages/<pkg>/src/**\/*.ts"
 */
// Same resolution the real config uses: typescript-eslint throws on TS >= 7,
// and `tools/lint` is the workspace package pnpm bound to TypeScript 6. See
// the note at the top of eslint.config.cjs.
const { createRequire } = require('node:module');
const lintRequire = createRequire(require.resolve('./tools/lint/package.json'));
const eslintTs = lintRequire('typescript-eslint');
const base = require('./eslint.config.cjs');

module.exports = [
  ...base,
  {
    files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}', 'apps/*/webapp/src/**/*.{ts,tsx}'],
    // Some packages keep specs beside the code (titan-auth/src/*.spec.ts). The
    // base config sets `project: false` for those, so a type-aware rule cannot
    // run on them and errors out the whole run if asked to.
    ignores: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
    plugins: { '@typescript-eslint': eslintTs.plugin },
    rules: {
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksConditionals: true, checksVoidReturn: false, checksSpreads: true },
      ],
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true, ignoreIIFE: true }],
      '@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: true }],
    },
  },
];
