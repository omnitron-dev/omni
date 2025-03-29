process.chdir(__dirname);

var OMNITRON = require('../..').default;
var should = require('should');

describe('API backward compatibility checks', function () {
  describe('Backward compatibility', function () {
    it('should start omnitron in no daemon mode', function (done) {
      OMNITRON.connect(true, function (err) {
        should(OMNITRON.daemon_mode).be.false();
        done();
      });
    });

    it('should be able to start a script', function (done) {
      OMNITRON.start('./../fixtures/child.js', function (err) {
        should(err).be.null();
        done();
      });
    });

    it('should list one process', function (done) {
      OMNITRON.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(1);
        done();
      });
    });

    it('should kill OMNITRON in no daemon', function (done) {
      OMNITRON.kill(done);
    });
  });
});
