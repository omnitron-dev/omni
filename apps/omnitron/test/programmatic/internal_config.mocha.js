const OMNITRON = require('../..').default;
const should = require('should');

describe('Internal OMNITRON configuration', function () {
  var omnitron;

  before(function () {
    omnitron = new OMNITRON.custom();
  });

  it('should set omnitron:registry', function (done) {
    omnitron.set('omnitron:registry', 'http://thing.com', done);
  });

  it('should new instance have the configuration', function () {
    var pm3 = new OMNITRON.custom();

    pm3.connect(() => {
      should(omnitron.user_conf.registry).eql('http://thing.com');
    });
  });
});
