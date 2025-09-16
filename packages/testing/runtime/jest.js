// Jest runtime adapter
// Jest provides all globals automatically

// Re-export jest globals if needed
if (typeof global !== 'undefined' && global.jest) {
  module.exports = {
    describe: global.describe,
    test: global.test,
    it: global.it,
    expect: global.expect,
    beforeAll: global.beforeAll,
    beforeEach: global.beforeEach,
    afterEach: global.afterEach,
    afterAll: global.afterAll
  };
}