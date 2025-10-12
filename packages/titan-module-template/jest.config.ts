import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  forceExit: true,
  verbose: true,
  clearMocks: true,
  collectCoverage: false,
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testMatch: ['<rootDir>/test/**/*.spec.ts', '<rootDir>/test/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true,
          module: 'ESNext',
          target: 'ES2022',
          moduleResolution: 'node',
          isolatedModules: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
        useESM: true,
        isolatedModules: true,
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!(@omnitron-dev)/)'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@omnitron-dev/common$': '<rootDir>/../common/src/index.ts',
    '^@omnitron-dev/common/(.*)$': '<rootDir>/../common/src/$1',
    '^@omnitron-dev/nexus$': '<rootDir>/../nexus/src/index.ts',
    '^@omnitron-dev/nexus/(.*)$': '<rootDir>/../nexus/src/$1',
    '^@omnitron-dev/titan$': '<rootDir>/../titan/src/index.ts',
    '^@omnitron-dev/titan/(.*)$': '<rootDir>/../titan/src/$1',
  },
  resolver: 'ts-jest-resolver',
  globals: {},
};

export default config;
