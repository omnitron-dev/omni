process.chdir(__dirname);

const OMNITRON = require('../..').default;
const should = require('should');

describe('API checks', function () {
  describe('OMNITRON API case#1', function () {
    before(function (done) {
      OMNITRON.delete('all', function () {
        done();
      });
    });

    after(function (done) {
      OMNITRON.kill(done);
    });

    it('should instanciate a new omnitron with old api', function () {
      should.exists(OMNITRON.omnitron_home);
      should(OMNITRON.daemon_mode).be.true();
      OMNITRON.cwd.should.eql(process.cwd());
    });

    it('should connect to OMNITRON', function (done) {
      OMNITRON.connect(done);
    });

    it('should start a script', function (done) {
      OMNITRON.start('./../fixtures/child.js', function (err) {
        should(err).be.null();
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          should(list.length).eql(1);
          done();
        });
      });
    });

    it('should stop app by id', function (done) {
      OMNITRON.stop(0, done);
    });

    it('should start app by id', function (done) {
      OMNITRON.restart(0, done);
    });

    it('should fail if starting same script again', function (done) {
      OMNITRON.start('./../fixtures/child.js', function (err) {
        should(err).not.be.null();
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          should(list.length).eql(1);
          done();
        });
      });
    });

    it('should FORCE starting same script again', function (done) {
      OMNITRON.start('./../fixtures/child.js', { force: true }, function (err) {
        should(err).be.null();
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          should(list.length).eql(2);
          done();
        });
      });
    });

    it('should delete ALL', function (done) {
      OMNITRON.delete('all', function (err) {
        should(err).be.null();
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          should(list.length).eql(0);
          done();
        });
      });
    });
  });

  describe('OMNITRON API case#2 (JSON style)', function () {
    before(function (done) {
      OMNITRON.delete('all', function () {
        done();
      });
    });

    after(function (done) {
      OMNITRON.kill(done);
    });

    it('should start script in cluster mode, 4 instances', function (done) {
      OMNITRON.start(
        {
          script: './../fixtures/child.js',
          instances: 4,
          name: 'http-test',
        },
        function (err) {
          should(err).be.null();
          OMNITRON.list(function (err, list) {
            should(err).be.null();
            should(list.length).eql(4);
            done();
          });
        }
      );
    });

    it('should stop app', function (done) {
      OMNITRON.stop('http-test', function (err, procs) {
        should(err).be.null();
        procs.length.should.eql(4);
        OMNITRON.list(function (err, list) {
          should(list.length).eql(4);
          list.forEach(function (proc) {
            proc.omnitron_env.status.should.eql('stopped');
          });
          done();
        });
      });
    });

    it('should restart all apps', function (done) {
      OMNITRON.restart('http-test', function (err, procs) {
        should(err).be.null();
        OMNITRON.list(function (err, list) {
          should(list.length).eql(4);
          list.forEach(function (proc) {
            proc.omnitron_env.status.should.eql('online');
          });
          done();
        });
      });
    });
  });

  describe('Should keep environment variables', function () {
    it('should start app with treekill', function (done) {
      OMNITRON.start(
        {
          script: './../fixtures/child.js',
          instances: 1,
          treekill: false,
          name: 'http-test',
        },
        function (err) {
          should(err).be.null();
          OMNITRON.list(function (err, list) {
            should(err).be.null();
            should(list.length).eql(1);
            should(list[0].omnitron_env.treekill).be.false;
            done();
          });
        }
      );
    });

    it('should restart app and treekill still at false', function (done) {
      OMNITRON.restart('http-test', function () {
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          should(list.length).eql(1);
          should(list[0].omnitron_env.treekill).be.false;
          done();
        });
      });
    });
  });

  describe('Issue #2337', function () {
    before(function (done) {
      OMNITRON.delete('all', function () {
        done();
      });
    });

    after(function (done) {
      OMNITRON.kill(done);
    });

    it('should start two app with same name', function (done) {
      OMNITRON.start(
        {
          script: './../fixtures/child.js',
          instances: 2,
          exec_mode: 'fork',
          name: 'http-test',
        },
        function (err) {
          should(err).be.null();
          OMNITRON.list(function (err, list) {
            should(err).be.null();
            list.forEach(function (proc) {
              proc.omnitron_env.exec_mode.should.eql('fork_mode');
            });
            should(list.length).eql(2);
            done();
          });
        }
      );
    });

    it('should stop first app', function (done) {
      OMNITRON.stop(0, done);
    });

    it('should force start a 3rd script', function (done) {
      OMNITRON.start(
        './../fixtures/child.js',
        {
          force: true,
          name: 'toto',
        },
        function () {
          OMNITRON.list(function (err, list) {
            list.length.should.eql(3);
            done();
          });
        }
      );
    });
  });

  describe('OMNITRON auto connect feature', function () {
    after(function (done) {
      OMNITRON.kill(function () {
        done();
      });
    });

    it('should instanciate a new omnitron with old api', function () {
      should.exists(OMNITRON.omnitron_home);
      should(OMNITRON.daemon_mode).be.true();
      OMNITRON.cwd.should.eql(process.cwd());
    });

    it('should be able to start a script without connect', function (done) {
      OMNITRON.start('./../fixtures/child.js', function (err) {
        should(err).be.null();
        done();
      });
    });

    it('should do random commands', function (done) {
      OMNITRON.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(1);
        OMNITRON.delete('all', function (err) {
          should(err).be.null();
          OMNITRON.list(function (err, list) {
            should(err).be.null();
            should(list.length).eql(0);
            done();
          });
        });
      });
    });
  });

  describe('Custom OMNITRON instance', function () {
    var omnitron;

    after(function (done) {
      omnitron.kill(done);
    });

    it('should create new custom OMNITRON instance', function () {
      omnitron = new OMNITRON.custom({
        daemon_mode: true,
      });
      should.exists(omnitron.omnitron_home);
      should(omnitron.daemon_mode).be.true();
      omnitron.cwd.should.eql(process.cwd());
    });

    it('should be able to start a script without connect', function (done) {
      omnitron.start('./../fixtures/child.js', function (err) {
        should(err).be.null();
        done();
      });
    });

    it('should do random commands', function (done) {
      omnitron.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(1);
        omnitron.delete('all', function (err) {
          should(err).be.null();
          omnitron.list(function (err, list) {
            should(err).be.null();
            should(list.length).eql(0);
            done();
          });
        });
      });
    });
  });

  describe('Should start omnitron in do daemon mode', function () {
    var omnitron;

    after(function (done) {
      omnitron.kill(done);
    });

    it('should create new custom OMNITRON instance', function () {
      omnitron = new OMNITRON.custom({
        daemon_mode: false,
      });

      should.exists(omnitron.omnitron_home);
      should(omnitron.daemon_mode).be.false();
      omnitron.cwd.should.eql(process.cwd());
    });
  });

  describe('Launch modules', function () {
    const Modularizer = require('../../dist/api/modules/modularizer');
    const module = 'pm2-server-monit';

    after(function (done) {
      Modularizer.uninstall(OMNITRON, module, done);
    });

    it('Should start up modules', function (done) {
      OMNITRON.connect(true, function (err) {
        should(err).be.null();

        Modularizer.install(OMNITRON, module, function () {
          OMNITRON.stop(module, function () {
            should(err).be.null();

            OMNITRON.launchModules(function (err) {
              should(err).be.null();

              OMNITRON.list(function (err, list) {
                should(err).be.null();
                should(list[0].name).eql(module);
                should(list[0].omnitron_env.status).eql('online');
                done();
              });
            });
          });
        });
      });
    });
  });
});
