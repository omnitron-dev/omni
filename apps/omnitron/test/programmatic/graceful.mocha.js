process.env.NODE_ENV = 'test';

var OMNITRON = require('../..').default;
var should = require('should');
var path = require('path');
var Plan = require('../helpers/plan.js');
var sexec = require('../../dist/tools/sexec.js');

process.chdir(__dirname);

describe('Wait ready / Graceful start / restart', function () {
  this.retries(2);

  var omnitron = new OMNITRON.custom({
    cwd: '../fixtures/listen-timeout/',
  });

  before(function (done) {
    omnitron.delete('all', function () {
      done();
    });
  });

  describe('(FORK) Listen timeout feature', function () {
    this.timeout(10000);

    after(function (done) {
      omnitron.delete('all', done);
    });

    it('should force script to set as ready after forced listen_timeout', function (done) {
      omnitron.start({
        script: './wait-ready.js',
        listen_timeout: 1000,
        wait_ready: true,
        name: 'echo',
      });

      setTimeout(function () {
        omnitron.list(function (err, apps) {
          should(apps[0].omnitron_env.status).eql('launching');
        });
      }, 800);

      setTimeout(function () {
        omnitron.list(function (err, apps) {
          should(apps[0].omnitron_env.status).eql('online');
          done();
        });
      }, 1500);
    });

    it('should have listen timeout updated', function (done) {
      omnitron.list(function (err, list) {
        should(list[0].omnitron_env.wait_ready).eql(true);
        done();
      });
    });

    it('should take listen timeout into account', function (done) {
      var called = false;
      var plan = new Plan(4, done);

      setTimeout(function () {
        should(called).be.false();
        plan.ok(true);
      }, 300);

      setTimeout(function () {
        should(called).be.true();
        plan.ok(true);

        omnitron.list((err, apps) => {
          should(apps[0].omnitron_env.wait_ready).eql(true);
          plan.ok(true);
        });
      }, 1500);

      omnitron.reload('all', function (err, data) {
        called = true;
        plan.ok(true);
      });
    });

    it('should restart script with different listen timeout', function (done) {
      omnitron.restart(
        {
          script: './echo.js',
          listen_timeout: 100,
          instances: 1,
          name: 'echo',
        },
        done
      );
    });

    it('should have listen timeout updated', function (done) {
      omnitron.list(function (err, list) {
        should(list[0].omnitron_env.listen_timeout).eql(100);
        should(list.length).eql(1);
        done();
      });
    });

    it('should be reloaded after 100ms', function (done) {
      var called = false;

      setTimeout(function () {
        should(called).be.true();
        done();
      }, 500);

      omnitron.reload('all', function (err, data) {
        called = true;
      });
    });
  });

  describe('(CLUSTER) Listen timeout feature', function () {
    this.timeout(10000);

    after(function (done) {
      omnitron.delete('all', done);
    });

    it('should force script to set as ready after forced listen_timeout', function (done) {
      omnitron.start({
        script: './wait-ready.js',
        listen_timeout: 1000,
        wait_ready: true,
        instances: 1,
        exec_mode: 'cluster',
        name: 'http',
      });

      setTimeout(function () {
        omnitron.list(function (err, apps) {
          should(apps[0].omnitron_env.status).eql('launching');
        });
      }, 500);

      setTimeout(function () {
        omnitron.list(function (err, apps) {
          should(apps[0].omnitron_env.status).eql('online');
          done();
        });
      }, 1500);
    });

    it('should take listen timeout into account', function (done) {
      var called = false;
      var plan = new Plan(4, done);

      setTimeout(function () {
        should(called).be.false();
        plan.ok(true);
      }, 500);

      setTimeout(function () {
        should(called).be.true();
        plan.ok(true);

        omnitron.list((err, apps) => {
          should(apps[0].omnitron_env.wait_ready).eql(true);
          plan.ok(true);
        });
      }, 1500);

      omnitron.reload('all', function (err, data) {
        called = true;
        plan.ok(true);
      });
    });
  });

  describe('(Cluster): Wait ready feature', function () {
    this.timeout(10000);

    after(function (done) {
      omnitron.delete('all', done);
    });

    it('Should send SIGINT right after ready and not wait for listen timeout', function (done) {
      const plan = new Plan(2, done);

      omnitron.start(
        {
          script: './wait-ready.js',
          listen_timeout: 5000,
          wait_ready: true,
          instances: 1,
          exec_mode: 'cluster',
          name: 'echo',
        },
        (error, result) => {
          if (error) {
            return done(error);
          }
          const oldPid = result[0].process.pid;
          plan.ok(typeof oldPid !== 'undefined');

          omnitron.reload('echo', {}, done);
          setTimeout(function () {
            sexec(`ps -eo pid | grep -w ${oldPid}`, (err, res) => {
              plan.ok(err === 1);
            });
          }, 2000);
        }
      );
    });
  });
});
