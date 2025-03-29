//process.env.NODE_ENV ='test';
var OMNITRON = require('../..').default;
var should = require('should');
var path = require('path');

describe('OMNITRON programmatic calls', function () {
  var proc1 = null;
  var procs = [];
  var bus = null;

  var omnitron = new OMNITRON.custom({
    cwd: __dirname + '/../fixtures',
  });

  after(function (done) {
    omnitron.delete('all', function (err, ret) {
      // clean dump file
      omnitron.clearDump(function (err) {
        omnitron.kill(done);
      });
    });
  });

  before(function (done) {
    omnitron.connect(function () {
      omnitron.launchBus(function (err, _bus) {
        bus = _bus;
        omnitron.delete('all', function (err, ret) {
          done();
        });
      });
    });
  });

  it('should start a script', function (done) {
    omnitron.start(
      {
        script: './child.js',
        name: 'child',
        instances: 1,
      },
      function (err, data) {
        proc1 = data[0];
        should(err).be.null();
        done();
      }
    );
  });

  it('should save/dump all processes', function (done) {
    omnitron.dump(function (err, ret) {
      should(err).be.null();
      done();
    });
  });

  it('should delete processes', function (done) {
    omnitron.delete('all', function (err, ret) {
      should(err).be.null();
      omnitron.list(function (err, ret) {
        should(err).be.null();
        ret.length.should.eql(0);
        done();
      });
    });
  });

  it('should not save/dump if 0 processes', function (done) {
    omnitron.dump(function (err, ret) {
      should(err).not.be.null();
      done();
    });
  });

  it('should save/dump if 0 processes AND --FORCE', function (done) {
    omnitron.dump(true, function (err, ret) {
      should(err).be.null();
      done();
    });
  });

  it('should resurrect 0 processes', function (done) {
    omnitron.resurrect(function (err, ret) {
      should(err).be.null();
      omnitron.list(function (err, ret) {
        should(err).be.null();
        ret.length.should.eql(0);
        done();
      });
    });
  });
});
