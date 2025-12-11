/**
 * Mock for @kysera/debug
 */

export const withDebug = jest.fn().mockImplementation((db, options = {}) => {
  return db;
});

export const formatSQL = jest.fn().mockImplementation((sql) => sql);

export class QueryProfiler {
  constructor(options: any = {}) {}

  start(): void {}
  stop(): void {}
  getMetrics(): any {
    return {
      queryCount: 0,
      totalTime: 0,
      slowQueries: [],
    };
  }
}
