/**
 * Mock for @kysera/testing
 */

export const testInTransaction = jest.fn().mockImplementation(async (db, fn) => {
  const trx = { isTransaction: true, ...db };
  await fn(trx);
});

export const testWithSavepoints = jest.fn().mockImplementation(async (db, fn) => {
  await fn(db);
});

export const testWithIsolation = jest.fn().mockImplementation(async (db, fn, options) => {
  await fn(db);
});

export const cleanDatabase = jest.fn().mockResolvedValue(undefined);

export const seedDatabase = jest.fn().mockResolvedValue(undefined);

export const snapshotTable = jest.fn().mockResolvedValue([]);

export const countRows = jest.fn().mockResolvedValue(0);

export const waitFor = jest.fn().mockImplementation(async (condition, options) => {
  const result = await condition();
  if (!result) {
    throw new Error('Condition not met');
  }
});

export const createFactory = jest.fn().mockImplementation((defaults) => {
  return (overrides = {}) => ({ ...defaults, ...overrides });
});

export const createMany = jest.fn().mockImplementation((factory, count) => {
  return Array(count).fill(null).map(() => factory());
});

export const createSequenceFactory = jest.fn().mockImplementation((fn) => {
  let seq = 0;
  return () => fn(++seq);
});
