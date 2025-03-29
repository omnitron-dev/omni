process.chdir(__dirname);

process.env.OMNITRON_RELOAD_LOCK_TIMEOUT = 1000;

var OMNITRON = require('../..').default;

var should = require('should');

describe('Lazy API usage', function () {
  it('should start a script without passing any args', function (done) {
    OMNITRON.start('./../fixtures/child.js', done);
  });

  it('should list one process', function (done) {
    OMNITRON.list(function (err, procs) {
      procs.length.should.eql(1);
      done();
    });
  });

  it('should fail to start script', function (done) {
    OMNITRON.start('./../fixtures/child.js', function (err) {
      should.exists(err);
      done();
    });
  });

  it('should list one process', function (done) {
    OMNITRON.list(function (err, procs) {
      procs.length.should.eql(1);
      done();
    });
  });

  it('should reload', function (done) {
    OMNITRON.reload('child', function (err) {
      should.not.exists(err);
      done();
    });
  });

  it('should process been restarted', function (done) {
    OMNITRON.list(function (err, procs) {
      procs.length.should.eql(1);
      procs[0].omnitron_env.restart_time.should.eql(1);
      done();
    });
  });

  it('should restart', function (done) {
    OMNITRON.restart('./../fixtures/child.js');
    setTimeout(function () {
      done();
    }, 300);
  });

  it('should process been restarted', function (done) {
    OMNITRON.list(function (err, procs) {
      procs.length.should.eql(1);
      procs[0].omnitron_env.restart_time.should.eql(2);
      done();
    });
  });

  it('should stop', function (done) {
    OMNITRON.stop('./../fixtures/child.js');
    setTimeout(function () {
      done();
    }, 300);
  });

  it('should process been stopped', function (done) {
    OMNITRON.list(function (err, procs) {
      procs.length.should.eql(1);
      procs[0].omnitron_env.status.should.eql('stopped');
      done();
    });
  });

  it('should delete', function (done) {
    OMNITRON.delete('./../fixtures/child.js');
    setTimeout(function () {
      done();
    }, 300);
  });

  it('should list 0 procs', function (done) {
    OMNITRON.list(function (err, procs) {
      procs.length.should.eql(0);
      done();
    });
  });
});
