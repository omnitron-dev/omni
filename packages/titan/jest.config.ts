import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  forceExit: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/**/__tests__/**',
    '!src/**/__mocks__/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  coverageThreshold: {
    global: {
      branches: 48,
      functions: 52,
      lines: 57,
      statements: 57
    }
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@omnitron-dev/nexus$': '<rootDir>/../../packages/nexus/src/index.ts',
    '^@omnitron-dev/eventemitter$': '<rootDir>/../../packages/eventemitter/src/index.ts',
    '^@omnitron-dev/common$': '<rootDir>/../../packages/common/src/index.ts'
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true
      },
      diagnostics: {
        warnOnly: true
      }
    }]
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@omnitron-dev)/)'
  ],
  extensionsToTreatAsEsm: ['.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/bun/'
  ],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts']
};

export default config;