import { pathsToModuleNameMapper } from 'ts-jest';
import { readFileSync } from 'fs';
import { join } from 'path';

const tsConfig = JSON.parse(readFileSync(join(__dirname, 'tsconfig.json'), 'utf-8'));

export default {
  preset: 'ts-jest',
  testEnvironment: 'node', // Или 'jsdom' для фронтенда
  verbose: true, // Показывать детализированные логи тестов
  clearMocks: true, // Очищать моки между тестами
  // collectCoverage: true, // Включить сбор покрытия кода
  // collectCoverageFrom: ['src/**/*.ts'], // Какие файлы учитывать в покрытии
  // coverageDirectory: 'coverage', // Директория для отчётов покрытия
  moduleFileExtensions: ['ts', 'js', 'json'], // Какие файлы использовать
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.spec.ts'], // Где искать тесты
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest', // Преобразование TypeScript-файлов
  },
  moduleNameMapper: pathsToModuleNameMapper(tsConfig.compilerOptions?.paths || {}, { prefix: '<rootDir>/' }),
};
