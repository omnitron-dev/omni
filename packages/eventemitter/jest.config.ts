import type { JestConfigWithTsJest } from 'ts-jest';

const config: JestConfigWithTsJest = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  forceExit: true,
  verbose: true,
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/runtime/',
  ],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true,
          module: 'esnext',
          moduleResolution: 'node',
          isolatedModules: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
        useESM: true,
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@noble|@omnitron-dev|@devgrid)/)',
  ],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^(\\.{1,2}/.*)\\.ts$': '$1',
    '^@omnitron-dev/testing$': '<rootDir>/../testing/src/index.ts',
    '^@omnitron-dev/testing/(.*)$': '<rootDir>/../testing/src/$1',
    '^@omnitron-dev/common$': '<rootDir>/../common/src/index.ts',
    '^@omnitron-dev/common/(.*)$': '<rootDir>/../common/src/$1',
  },
  resolver: 'ts-jest-resolver',
};

export default config;
