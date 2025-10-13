const globals = require('globals');
const eslintJs = require('@eslint/js');
const eslintTs = require('typescript-eslint');
const importPlugin = require('eslint-plugin-import');
const perfectionistPlugin = require('eslint-plugin-perfectionist');
const unusedImportsPlugin = require('eslint-plugin-unused-imports');

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
      '**/e2e/**' // Ignore e2e tests
    ]
  },
  // Base configuration
  {
    files: ['packages/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}'],
    languageOptions: {
      parser: eslintTs.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
  },
  // Recommended JavaScript rules
  {
    files: ['packages/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}'],
    ...eslintJs.configs.recommended,
  },
  // Recommended TypeScript rules
  ...eslintTs.configs.recommended.map(config => ({
    ...config,
    files: ['packages/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}']
  })),
  // Our custom configuration (should be last to override previous rules)
  {
    files: ['packages/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}', 'apps/*/src/**/*.{js,mjs,cjs,ts,jsx,tsx}'],
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
    files: ['packages/*/test/**/*.{js,mjs,cjs,ts,jsx,tsx,spec.ts}', 'packages/*/__tests__/**/*.{js,mjs,cjs,ts,jsx,tsx}'],
    languageOptions: {
      parser: eslintTs.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
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
