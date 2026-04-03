// Vitest runtime adapter
// Vitest provides all globals automatically when globals: true

// Re-export vitest globals if needed
if (typeof globalThis !== 'undefined' && globalThis.vi) {
  module.exports = {
    describe: globalThis.describe,
    test: globalThis.test,
    it: globalThis.it,
    expect: globalThis.expect,
    beforeAll: globalThis.beforeAll,
    beforeEach: globalThis.beforeEach,
    afterEach: globalThis.afterEach,
    afterAll: globalThis.afterAll,
  };
}
