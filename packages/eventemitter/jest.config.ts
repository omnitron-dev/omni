import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { pathsToModuleNameMapper } from 'ts-jest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tsConfig = JSON.parse(readFileSync(join(__dirname, '..', '..', 'tsconfig.json'), 'utf-8'));

export default {
  preset: 'ts-jest',
  testEnvironment: 'node', // Or 'jsdom' for frontend
  verbose: true, // Show detailed test logs
  clearMocks: true, // Clear mocks between tests
  collectCoverage: true, // Enable code coverage collection
  collectCoverageFrom: ['src/**/*.ts'], // Which files to include in coverage
  coverageDirectory: 'coverage', // Directory for coverage reports
  moduleFileExtensions: ['ts', 'js', 'json'], // Which files to use
  testMatch: ['<rootDir>/test/**/*.test.ts', '<rootDir>/test/**/*.spec.ts'], // Where to find tests
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', {
      tsconfig: {
        allowJs: true,
        esModuleInterop: true,
      }
    }]
  },
  transformIgnorePatterns: [
    'node_modules/(?!@omnitron-dev/.*)'
  ],
  moduleNameMapper: {
    ...pathsToModuleNameMapper(tsConfig.compilerOptions?.paths || {}, { prefix: '<rootDir>/' }),
    '^@omnitron-dev/common$': '<rootDir>/../common/src/index.ts'
  },
};
