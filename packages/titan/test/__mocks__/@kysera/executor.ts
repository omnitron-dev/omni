/**
 * Mock for @kysera/executor
 */

import { vi } from 'vitest';

export const createExecutor = vi.fn().mockImplementation((db, plugins = []) => ({
  ...db,
  __kysera: true,
  __plugins: plugins,
  __rawDb: db,
}));

export const createExecutorSync = vi.fn().mockImplementation((db, plugins = []) => ({
  ...db,
  __kysera: true,
  __plugins: plugins,
  __rawDb: db,
}));

export const isKyseraExecutor = vi.fn().mockImplementation((value) => value && value.__kysera === true);

export const getPlugins = vi.fn().mockImplementation((executor) => executor.__plugins || []);

export const getRawDb = vi.fn().mockImplementation((executor) => executor.__rawDb || executor);

export const wrapTransaction = vi.fn().mockImplementation((trx, plugins) => ({
  ...trx,
  __kysera: true,
  __plugins: plugins,
  __rawDb: trx,
}));

export const applyPlugins = vi.fn().mockImplementation((qb) => qb);

export const validatePlugins = vi.fn();

export const resolvePluginOrder = vi.fn().mockImplementation((plugins) => plugins);

export class PluginValidationError extends Error {
  constructor(
    message: string,
    public type: string,
    public details: unknown
  ) {
    super(message);
    this.name = 'PluginValidationError';
  }
}

export const INTERCEPTED_METHODS = [
  'selectFrom',
  'insertInto',
  'updateTable',
  'deleteFrom',
  'with',
  'transaction',
] as const;

export const destroyExecutor = vi.fn().mockResolvedValue(undefined);

export const isRepositoryLike = vi
  .fn()
  .mockImplementation((obj: unknown) => obj !== null && typeof obj === 'object' && 'tableName' in (obj as any));
