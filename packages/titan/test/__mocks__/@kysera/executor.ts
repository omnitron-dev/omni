/**
 * Mock for @kysera/executor
 */

export const createExecutor = jest.fn().mockImplementation((db, plugins = []) => {
  return {
    ...db,
    __kysera: true,
    __plugins: plugins,
    __rawDb: db,
  };
});

export const createExecutorSync = jest.fn().mockImplementation((db, plugins = []) => {
  return {
    ...db,
    __kysera: true,
    __plugins: plugins,
    __rawDb: db,
  };
});

export const isKyseraExecutor = jest.fn().mockImplementation((value) => {
  return value && value.__kysera === true;
});

export const getPlugins = jest.fn().mockImplementation((executor) => {
  return executor.__plugins || [];
});

export const getRawDb = jest.fn().mockImplementation((executor) => {
  return executor.__rawDb || executor;
});

export const wrapTransaction = jest.fn().mockImplementation((trx, plugins) => {
  return {
    ...trx,
    __kysera: true,
    __plugins: plugins,
    __rawDb: trx,
  };
});

export const applyPlugins = jest.fn().mockImplementation((qb) => qb);

export const validatePlugins = jest.fn();

export const resolvePluginOrder = jest.fn().mockImplementation((plugins) => plugins);

export class PluginValidationError extends Error {
  constructor(message: string, public type: string, public details: unknown) {
    super(message);
    this.name = 'PluginValidationError';
  }
}
