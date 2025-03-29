process.env.NODE_ENV = 'test';

var OMNITRON = require('../..').default;
var should = require('should');
var path = require('path');
var Plan = require('../helpers/plan.js');

process.chdir(__dirname);

describe('Cluster programmatic tests', function () {
  var omnitron = new OMNITRON.custom({
    cwd: '../fixtures',
  });

  after(function (done) {
    omnitron.kill(done);
  });

  describe('Start with different instances number parameter', function () {
    afterEach(function (done) {
      omnitron.delete('all', done);
    });

    it('should start 4 processes', function (done) {
      omnitron.start(
        {
          script: './child.js',
          instances: 4,
        },
        function (err, data) {
          should(err).be.null();

          omnitron.list(function (err, ret) {
            should(err).be.null();
            ret.length.should.eql(4);
            done();
          });
        }
      );
    });
  });

  describe('Action methods', function () {
    before(function (done) {
      omnitron.start(
        {
          script: '../fixtures/child.js',
          instances: 4,
        },
        done
      );
    });

    it('should RESTART all apps', function (done) {
      omnitron.restart('all', function (err, data) {
        should(err).be.null();

        omnitron.list(function (err, procs) {
          should(err).be.null();
          procs.length.should.eql(4);
          procs.forEach(function (proc) {
            proc.omnitron_env.restart_time.should.eql(1);
          });
          done();
        });
      });
    });

    it('should RELOAD all apps', function (done) {
      omnitron.reload('all', function (err, data) {
        should(err).be.null();

        omnitron.list(function (err, procs) {
          should(err).be.null();
          procs.length.should.eql(4);
          procs.forEach(function (proc) {
            proc.omnitron_env.restart_time.should.eql(2);
          });
          done();
        });
      });
    });

    it('should GRACEFUL RELOAD all apps', function (done) {
      omnitron.reload('all', function (err, data) {
        should(err).be.null();

        omnitron.list(function (err, procs) {
          should(err).be.null();
          procs.length.should.eql(4);
          procs.forEach(function (proc) {
            proc.omnitron_env.restart_time.should.eql(3);
          });
          done();
        });
      });
    });
  });

  describe('Scaling feature', function () {
    after(function (done) {
      omnitron.delete('all', done);
    });

    before(function (done) {
      omnitron.delete('all', function () {
        omnitron.start(
          {
            script: '../fixtures/child.js',
            instances: 4,
            name: 'child',
          },
          done
        );
      });
    });

    it('should scale up application to 8', function (done) {
      omnitron.scale('child', 8, function (err, procs) {
        should(err).be.null();

        omnitron.list(function (err, procs) {
          should(err).be.null();
          procs.length.should.eql(8);
          done();
        });
      });
    });

    it('should scale down application to 2', function (done) {
      omnitron.scale('child', 2, function (err, procs) {
        should(err).be.null();

        omnitron.list(function (err, procs) {
          should(err).be.null();
          procs.length.should.eql(2);
          done();
        });
      });
    });

    it('should do nothing', function (done) {
      omnitron.scale('child', 2, function (err, procs) {
        should(err).not.be.null();
        done();
      });
    });
  });

  // Skip Becoz Bun
  describe.skip('Listen timeout feature', function () {
    after(function (done) {
      omnitron.delete('all', done);
    });

    it('should start script with 1000ms listen timeout', function (done) {
      omnitron.start(
        {
          script: './child.js',
          listen_timeout: 1000,
          exec_mode: 'cluster',
          instances: 1,
          name: 'child',
        },
        done
      );
    });

    it('should have listen timeout updated', function (done) {
      omnitron.list(function (err, list) {
        should(list[0].omnitron_env.listen_timeout).eql(1000);
        should(list.length).eql(1);
        done();
      });
    });

    it('should take listen_timeout into account', function (done) {
      var called = false;
      var plan = new Plan(3, done);

      setTimeout(function () {
        should(called).be.false();
        plan.ok(true);
      }, 800);

      setTimeout(function () {
        should(called).be.true();
        plan.ok(true);
      }, 2500);

      omnitron.reload('all', function (err, data) {
        called = true;
        plan.ok(true);
      });
    });

    it('should restart script with different listen timeout', function (done) {
      omnitron.restart(
        {
          script: './child.js',
          listen_timeout: 100,
          instances: 1,
          name: 'child',
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

  describe('Kill timeout feature', function () {
    after(function (done) {
      omnitron.delete('all', done);
    });

    it('should start script with 1000ms listen timeout', function (done) {
      omnitron.start(
        {
          script: './cluster/sigint_catcher.js',
          kill_timeout: 1000,
          instances: 1,
          name: 'sigint',
        },
        done
      );
    });

    it('should have listen timeout updated', function (done) {
      omnitron.list(function (err, list) {
        should(list[0].omnitron_env.kill_timeout).eql(1000);
        should(list.length).eql(1);
        done();
      });
    });

    it('should script not be killed before kill timeout', function (done) {
      var called = false;

      setTimeout(function () {
        should(called).be.false();
      }, 800);

      omnitron.reload('sigint', function () {
        called = true;
        done();
      });
    });
  });
});
