const assert = require('assert');
const Utility = require('../../dist/utility.js');

describe('Utility', function () {
  describe('.getCanonicModuleName', function () {
    it('should get null without invalid parameters', function () {
      assert(Utility.getCanonicModuleName() === null);
      assert(Utility.getCanonicModuleName(/aa/) === null);
      assert(Utility.getCanonicModuleName(111) === null);
      assert(Utility.getCanonicModuleName({}) === null);
    });

    it('should works with all notation', function () {
      assert(Utility.getCanonicModuleName('ma-zal/omnitron-slack') === 'omnitron-slack');
      assert(Utility.getCanonicModuleName('omnitron-slack@1.0.0') === 'omnitron-slack');
      assert(Utility.getCanonicModuleName('omnitron-slack-1.0.0.tgz') === 'omnitron-slack');
      assert(Utility.getCanonicModuleName('ma-zal/omnitron-slack') === 'omnitron-slack');
      assert(Utility.getCanonicModuleName('ma-zal/omnitron-slack#own-branch') === 'omnitron-slack');
      assert(Utility.getCanonicModuleName('omnitron-slack') === 'omnitron-slack');
      assert(Utility.getCanonicModuleName('@org/omnitron-slack') === '@org/omnitron-slack');
      assert(Utility.getCanonicModuleName('@org/omnitron-slack@latest') === '@org/omnitron-slack');
      assert(Utility.getCanonicModuleName('git+https://github.com/user/omnitron-slack') === 'omnitron-slack');
      assert(Utility.getCanonicModuleName('git+https://github.com/user/omnitron-slack.git') === 'omnitron-slack');
      assert(Utility.getCanonicModuleName('file:///home/user/omnitron-slack') === 'omnitron-slack');
      assert(Utility.getCanonicModuleName('file://./omnitron-slack') === 'omnitron-slack');
      assert(Utility.getCanonicModuleName('file:///home/user/omnitron-slack/') === 'omnitron-slack');
      assert(Utility.getCanonicModuleName('http-server') === 'http-server');
      assert(Utility.getCanonicModuleName('http://registry.com:12/modules/my-module?test=true') === 'my-module');
      assert(
        Utility.getCanonicModuleName('http://registry.com:12/modules/http-my-module?test=true') === 'http-my-module'
      );
    });
  });
});
