/**
 * ESLint does not run in this monorepo, and has not since the TypeScript 7
 * upgrade.
 *
 * `typescript-eslint` 8.69 refuses to load against TS 7 outright — every
 * package with a `lint` script fails identically with "typescript-eslint does
 * not support TS 7.0", tracked upstream as typescript-eslint#10940. So
 * `turbo lint` reports "5 successful, 5 total" worth of failures on a task
 * nothing depends on: a check that shouts and changes nothing.
 *
 * Two things were tried and are recorded so they are not tried again:
 *
 *   - pnpm scoped overrides (`typescript-eslint>typescript: 6.0.3`) do not
 *     take: the flat `typescript: 7.0.2` override wins, and the install
 *     reports "unmet peer typescript@6.0.3: found 7.0.2" while eslint fails
 *     exactly as before.
 *   - forcing the TS 6 API through an alias would make it parse TS 7 source.
 *     A linter reading the code with an older parser reports syntax it does
 *     not know as errors, which is noise shaped like findings — worse than
 *     silence, because someone has to disprove each one.
 *
 * Waiting on upstream is the honest state. Note also that only 5 of the 28
 * packages declare a `lint` script at all; turning it on for the other 23
 * would produce a first-run finding count nobody has measured, which is a
 * decision to put to a human with that number in hand, not a default.
 */

const globals = require('globals');
const eslintJs = require('@eslint/js');
const eslintTs = require('typescript-eslint');
const importPlugin = require('eslint-plugin-import');
const perfectionistPlugin = require('eslint-plugin-perfectionist');
const unusedImportsPlugin = require('eslint-plugin-unused-imports');
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
