/* eslint-disable */
import { readFileSync } from 'fs';

// Reading the SWC compilation config and remove the "exclude"
// for the test files to be compiled by SWC
const { exclude: _, ...swcJestConfig } = JSON.parse(
  readFileSync(`${__dirname}/.swcrc`, 'utf-8')
);

// disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves.
// If we do not disable this, SWC Core will read .swcrc and won't transform our test files due to "exclude"
if (swcJestConfig.swcrc === undefined) {
  swcJestConfig.swcrc = false;
}


export default {
  displayName: '@devgrid/rest-nest',
  preset: 'ts-jest',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  coverageReporters: ['html'],
  testEnvironmentOptions: {
    customExportConditions: ['node', 'require', 'default'],
  },
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'html'],
  snapshotFormat: { escapeString: true, printBasicPrototype: true },
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  testPathIgnorePatterns: ['node_modules', 'dist'],
  coverageProvider: 'v8',
};
