/**
 * ESLint runs against TypeScript 6, deliberately, while the monorepo builds on
 * TypeScript 7.
 *
 * `typescript-eslint` reads `ts.versionMajorMinor` at import time and throws on
 * anything >= 7 (`typescript-eslint does not support TS 7.0`, upstream
 * typescript-eslint#10940). Between the TS 7 upgrade and this note, lint did
 * not run anywhere in the repository.
 *
 * The fix is the one TypeScript 7's own upgrade note recommends: give
 * typescript-eslint the TS 6 API side by side. `tools/lint` is a workspace
 * package whose only job is to declare `typescript@6.0.3`, and the require
 * below reaches into it, so the copy of typescript-eslint that loads here is
 * the one pnpm bound to 6.0.3. Every other package still resolves 7.0.2.
 *
 * Why not a pnpm override — measured three ways, so nobody repeats it:
 * `typescript` is a PEER dependency of typescript-eslint, and pnpm resolves
 * peers from the importer. A scoped override (`typescript-eslint>typescript`)
 * does not take, with or without a flat one; an alias
 * (`npm:typescript@6.0.3`) does not either, because an override matches on the
 * dependency NAME. Only an importer that declares TS 6 itself works, which is
 * what `tools/lint` is.
 *
 * A previous version of this comment recorded a second objection as settled
 * fact: that a TS 6 parser reading TS 7 source would report unknown syntax as
 * errors, "noise shaped like findings". That is false here and was never
 * measured. TypeScript 7.0 is a reimplementation of the same language, not an
 * extension of its grammar: the 6.0.3 parser reads 781 files across titan,
 * testing, netron-browser and prism with ZERO syntax errors. The objection was
 * plausible, unverifiable by reading, and closed the question for a day —
 * which is the more expensive kind of wrong answer, because a bad finding gets
 * re-checked and a bad reason for not trying does not.
 *
 * Delete `tools/lint` and restore the plain require when upstream ships TS 7
 * support.
 *
 * Note that only 5 of the 28 packages declare a `lint` script. Turning it on
 * for the rest is a decision for a human holding the finding count, which is
 * now measurable.
 */

const globals = require('globals');
const eslintJs = require('@eslint/js');
// Resolved from tools/lint, not from the root: that copy is the one pnpm bound
// to TypeScript 6. See the note at the top of this file.
//
// createRequire rather than a path require — typescript-eslint publishes
// `exports` and no `main`, and a require BY PATH does not consult `exports`,
// so the direct form fails to resolve. Resolving the bare specifier from
// tools/lint's context is also the honest expression of what is meant:
// "whatever typescript-eslint that package sees".
const { createRequire } = require('node:module');
const lintRequire = createRequire(require.resolve('./tools/lint/package.json'));
const eslintTs = lintRequire('typescript-eslint');
const importPlugin = require('eslint-plugin-import');
const perfectionistPlugin = require('eslint-plugin-perfectionist');
// Also from tools/lint: this plugin requires @typescript-eslint/eslint-plugin
// at load time (an optional peer), and resolving it from the root pulls in a
// TypeScript-7-bound copy, which prints the unsupported-version error to
// stderr on every run. Lint still worked — the message was pure noise, which
// is the worst kind, since it says the tool is not running while it is.
const unusedImportsPlugin = lintRequire('eslint-plugin-unused-imports');
const reactHooksPlugin = require('eslint-plugin-react-hooks');

// ----------------------------------------------------------------------

/**
 * @rules common
 */
const commonRules = () => ({
  'func-names': 1,
  'no-unused-vars': 0,
  'object-shorthand': 1,
  'no-useless-rename': 1,
  'default-case-last': 2,
  'consistent-return': 2,
  'no-constant-condition': 1,
  'default-case': [2, { commentPattern: '^no default$' }],
  'lines-around-directive': [2, { before: 'always', after: 'always' }],
  'arrow-body-style': [2, 'as-needed', { requireReturnForObjectLiteral: false }],
  // react-hooks
  'react-hooks/rules-of-hooks': 2,
  'react-hooks/exhaustive-deps': 1,
  // typescript
  '@typescript-eslint/no-shadow': 2,
  '@typescript-eslint/no-explicit-any': 0,
  '@typescript-eslint/no-empty-object-type': 0,
  '@typescript-eslint/consistent-type-imports': 0,
  '@typescript-eslint/no-unused-vars': [1, {
    args: 'none',
    varsIgnorePattern: '^_',
    argsIgnorePattern: '^_',
    caughtErrors: 'all',
    caughtErrorsIgnorePattern: '^_'
  }],
});

/**
 * @rules import
 * from 'eslint-plugin-import'.
 * Disabled due to ESLint 9 compatibility issues
 */
const importRules = () => ({
  // Import plugin rules are disabled due to ESLint 9 compatibility
});

/**
 * @rules unused imports
 * from 'eslint-plugin-unused-imports'.
 */
const unusedImportsRules = () => ({
  'unused-imports/no-unused-imports': 1,
  'unused-imports/no-unused-vars': [
    0,
    { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
  ],
});

/**
 * @rules sort or imports/exports
 * from 'eslint-plugin-perfectionist'.
 */
const sortImportsRules = () => {
  return {
    'perfectionist/sort-named-imports': [1, { type: 'line-length', order: 'asc' }],
    'perfectionist/sort-named-exports': [1, { type: 'line-length', order: 'asc' }],
    'perfectionist/sort-exports': [
      1,
      {
        order: 'asc',
        type: 'line-length',
        groupKind: 'values-first',
      },
    ],
    'perfectionist/sort-imports': [
      2,
      {
        order: 'asc',
        ignoreCase: true,
        type: 'line-length',
        environment: 'node',
        maxLineLength: undefined,
        newlinesBetween: 'always',
        internalPattern: ['^src/.+'],
        groups: [
          'style',
          'side-effect',
          'type',
          ['builtin', 'external'],
          'internal',
          ['parent', 'sibling', 'index'],
          ['parent-type', 'sibling-type', 'index-type'],
          'object',
          'unknown',
        ],
      },
    ],
  };
};

/**
 * Custom ESLint configuration.
 */
const customConfig = {
  plugins: {
    '@typescript-eslint': eslintTs.plugin,
    'unused-imports': unusedImportsPlugin,
    perfectionist: perfectionistPlugin,
    'react-hooks': reactHooksPlugin,
  },
  rules: {
    ...commonRules(),
    ...importRules(),
    ...unusedImportsRules(),
    // ...sortImportsRules(),
  },
};

// ----------------------------------------------------------------------

module.exports = [
  // Ignore all these directories and files
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/out/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/jest.setup.ts',
      '**/jest.setup.global.ts',
      'packages/rotif/**', // Temporarily ignore rotif as it has been moved
      'scripts/**',
      'experiments/**',
      '**/examples/**', // Ignore examples
      '**/test/**/fixtures/**', // Ignore test fixtures
      '**/test/**/helpers/**', // Ignore test helpers
      '**/e2e/**', // Ignore e2e tests
      '**/benchmark/**', // Ignore benchmark files (not in tsconfig project)
      '**/test/utils/docker-test-manager.{d.ts,js,js.map,d.ts.map}', // Ignore generated docker test files
      'packages/titan/globalSetup.ts', // Vitest setup files — not part of tsconfig project
      'packages/titan/vitest.setup.ts',
      '**/test/**/chaos-engineering.spec.ts', // Uses syntax the non-project parser cannot handle
      '**/test/utils/wheel-timer.spec.ts'
    ]
  },
  // Base configuration
  {
    files: ['packages/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/web/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/shared/**/*.{js,mjs,cjs,ts,jsx,tsx}'],
    languageOptions: {
      parser: eslintTs.parser,
      parserOptions: {
        project: ['./packages/*/tsconfig.json', './apps/*/tsconfig*.json'],
        tsconfigRootDir: __dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
  },
  // Recommended JavaScript rules
  {
    files: ['packages/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/web/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/shared/**/*.{js,mjs,cjs,ts,jsx,tsx}'],
    ...eslintJs.configs.recommended,
  },
  // Recommended TypeScript rules
  ...eslintTs.configs.recommended.map(config => ({
    ...config,
    files: ['packages/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/web/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/shared/**/*.{js,mjs,cjs,ts,jsx,tsx}']
  })),
  // Our custom configuration (should be last to override previous rules)
  {
    files: ['packages/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/web/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/shared/**/*.{js,mjs,cjs,ts,jsx,tsx}'],
    ...customConfig,
  },
  // Special configuration for packages/titan with @nexus alias
  {
    files: ['packages/titan/**/*.{js,mjs,cjs,ts,jsx,tsx}'],
    rules: {
      // import/no-unresolved disabled due to ESLint 9 compatibility issues
    }
  },
  // Configuration for test files
  {
    files: [
      'packages/*/test/**/*.{js,mjs,cjs,ts,jsx,tsx,spec.ts}',
      'packages/*/__tests__/**/*.{js,mjs,cjs,ts,jsx,tsx}',
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.spec.ts'
    ],
    languageOptions: {
      parser: eslintTs.parser,
      parserOptions: {
        // Don't require TypeScript project for test files since they're often excluded from tsconfig
        project: false,
      },
      globals: { ...globals.browser, ...globals.node, ...globals.jest },
    },
    ...customConfig,
    rules: {
      ...customConfig.rules,
      '@typescript-eslint/no-shadow': 0, // Allow variable shadowing in tests
      'consistent-return': 0, // Allow inconsistent returns in tests
      'no-useless-catch': 0, // Allow catch blocks for testing
    },
  },
];
