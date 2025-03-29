process.env.NODE_ENV = 'test';
process.env.OMNITRON_WORKER_INTERVAL = 1000;

var OMNITRON = require('../..').default;
var should = require('should');
var path = require('path');

// Change to current folder

describe('Max memory restart programmatic', function () {
  var proc1 = null;
  var procs = [];
  var omnitron = new OMNITRON.custom({
    cwd: __dirname + '/../fixtures/json-reload/',
  });

  after(function (done) {
    omnitron.kill(done);
  });

  afterEach(function (done) {
    omnitron.delete('all', function () {
      setTimeout(done, 300);
    });
  });

  before(function (done) {
    omnitron.connect(function () {
      done();
    });
  });

  describe('Max memory limit', function () {
    it('should restart process based on memory limit (UGLY WAY)', function (done) {
      omnitron.start(
        './big-array.js',
        {
          maxMemoryRestart: '10M',
        },
        function (err, data) {
          should(err).be.null();

          setTimeout(function () {
            omnitron.list(function (err, ret) {
              should(err).be.null();
              ret[0].omnitron_env.restart_time.should.not.eql(0);
              done();
            });
          }, 3000);
        }
      );
    });

    it('should restart process based on memory limit (JSON WAY)', function (done) {
      omnitron.start(
        {
          script: './big-array.js',
          max_memory_restart: '10M',
        },
        function (err, data) {
          should(err).be.null();

          setTimeout(function () {
            omnitron.list(function (err, ret) {
              should(err).be.null();
              ret[0].omnitron_env.restart_time.should.not.eql(0);
              done();
            });
          }, 3000);
        }
      );
    });

    it('should restart CLUSTER process based on memory limit (JSON WAY)', function (done) {
      omnitron.start(
        {
          script: './../big-array-listen.js',
          max_memory_restart: '10M',
          exec_mode: 'cluster',
        },
        function (err, data) {
          should(err).be.null();

          setTimeout(function () {
            omnitron.list(function (err, ret) {
              should(err).be.null();
              ret[0].omnitron_env.restart_time.should.not.eql(0);
              done();
            });
          }, 3000);
        }
      );
    });
  });
});
