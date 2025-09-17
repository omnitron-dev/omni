import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { pathsToModuleNameMapper } from 'ts-jest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tsConfig = JSON.parse(readFileSync(join(__dirname, 'tsconfig.test.json'), 'utf-8'));

export default {
  preset: 'ts-jest',
  testEnvironment: 'node', // Or 'jsdom' for frontend
  forceExit: true, // Force Jest to exit after tests
  verbose: true, // Show detailed test logs
  clearMocks: true, // Clear mocks between tests
  // collectCoverage: true, // Enable code coverage collection
  // collectCoverageFrom: ['src/**/*.ts'], // Which files to include in coverage
  // coverageDirectory: 'coverage', // Directory for coverage reports
  moduleFileExtensions: ['ts', 'js', 'json'], // Which files to use
  testMatch: ['<rootDir>/test/**/*.test.ts', '<rootDir>/test/**/*.spec.ts'], // Where to find tests
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest', // Transform TypeScript files
  },
  resolver: '<rootDir>/jest.resolver.cjs',
  moduleNameMapper: {
    ...pathsToModuleNameMapper(tsConfig.compilerOptions?.paths || {}, { prefix: '<rootDir>/' }),
    // Map workspace packages to their source files
    '^@omnitron-dev/common$': '<rootDir>/../common/src',
    '^@omnitron-dev/smartbuffer$': '<rootDir>/../smartbuffer/src',
    '^@omnitron-dev/messagepack$': '<rootDir>/../messagepack/src',
    '^@omnitron-dev/eventemitter$': '<rootDir>/../eventemitter/src',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@omnitron-dev)/)',
  ],
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
      tsconfig: {
        allowJs: true,
        module: 'commonjs',
        moduleResolution: 'node',
      },
    },
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts', '<rootDir>/../../jest.setup.global.ts'],
  testTimeout: 30000, // 30 seconds timeout for tests
};
