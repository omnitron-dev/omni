var OMNITRON = require('../..').default;
var should = require('should');
var path = require('path');
var fs = require('fs');

describe('Signal kill (+delayed)', function () {
  var proc1 = null;

  var omnitron = new OMNITRON.custom({
    cwd: __dirname + '/../fixtures',
  });

  after(function (done) {
    omnitron.delete('all', function (err, ret) {
      omnitron.kill(done);
    });
  });

  before(function (done) {
    omnitron.connect(function () {
      omnitron.delete('all', function (err, ret) {
        done();
      });
    });
  });

  describe('with 3000ms OMNITRON_KILL_TIMEOUT (environment variable)', function () {
    it('should set 3000ms to OMNITRON_KILL_TIMEOUT', function (done) {
      process.env.OMNITRON_KILL_TIMEOUT = 3000;

      omnitron.update(function () {
        done();
      });
    });

    it('should start a script', function (done) {
      omnitron.start(
        {
          script: './signals/delayed_sigint.js',
          name: 'delayed-sigint',
        },
        function (err, data) {
          proc1 = data[0];
          should(err).be.null();
          setTimeout(done, 1000);
        }
      );
    });

    it('should stop script after 3000ms', function (done) {
      setTimeout(function () {
        omnitron.list(function (err, list) {
          list[0].omnitron_env.status.should.eql('stopping');
        });
      }, 2500);

      setTimeout(function () {
        omnitron.list(function (err, list) {
          list[0].omnitron_env.status.should.eql('stopped');
          done();
        });
      }, 3500);

      omnitron.stop('delayed-sigint', function (err, app) {
        //done(err);
      });
    });
  });

  describe('with 1000ms OMNITRON_KILL_TIMEOUT (environment variable)', function () {
    it('should set 1000ms to OMNITRON_KILL_TIMEOUT', function (done) {
      process.env.OMNITRON_KILL_TIMEOUT = 1000;

      omnitron.update(function () {
        done();
      });
    });

    it('should start a script', function (done) {
      omnitron.start(
        {
          script: './signals/delayed_sigint.js',
          name: 'delayed-sigint',
        },
        function (err, data) {
          proc1 = data[0];
          should(err).be.null();
          setTimeout(done, 1000);
        }
      );
    });

    it('should stop script after 1000ms', function (done) {
      setTimeout(function () {
        omnitron.list(function (err, list) {
          list[0].omnitron_env.status.should.eql('stopping');
        });
      }, 500);

      setTimeout(function () {
        omnitron.list(function (err, list) {
          list[0].omnitron_env.status.should.eql('stopped');
          done();
        });
      }, 1500);

      omnitron.stop('delayed-sigint', function (err, app) {
        //done(err);
      });
    });
  });

  describe('[CLUSTER MODE] with 1000ms OMNITRON_KILL_TIMEOUT (environment variable)', function () {
    it('should set 1000ms to OMNITRON_KILL_TIMEOUT', function (done) {
      process.env.OMNITRON_KILL_TIMEOUT = 1000;

      omnitron.update(function () {
        done();
      });
    });

    it('should start a script', function (done) {
      omnitron.start(
        {
          script: './signals/delayed_sigint.js',
          name: 'delayed-sigint',
          exec_mode: 'cluster',
        },
        function (err, data) {
          proc1 = data[0];
          should(err).be.null();
          setTimeout(done, 1000);
        }
      );
    });

    it('should stop script after 1000ms', function (done) {
      setTimeout(function () {
        omnitron.list(function (err, list) {
          list[0].omnitron_env.status.should.eql('stopping');
        });
      }, 500);

      setTimeout(function () {
        omnitron.list(function (err, list) {
          list[0].omnitron_env.status.should.eql('stopped');
          done();
        });
      }, 1500);

      omnitron.stop('delayed-sigint', function (err, app) {
        //done(err);
      });
    });

    it('should reload script', function (done) {
      setTimeout(function () {
        omnitron.list(function (err, list) {
          list[0].omnitron_env.status.should.eql('online');
          done();
        });
      }, 1500);

      omnitron.reload('delayed-sigint', function (err, app) {
        //done(err);
      });
    });
  });

  describe('with 4000ms via kill_timeout (json/cli option)', function () {
    it('should set 1000ms to OMNITRON_KILL_TIMEOUT', function (done) {
      process.env.OMNITRON_KILL_TIMEOUT = 1000;

      omnitron.update(function () {
        done();
      });
    });

    it('should start a script with flag kill timeout to 4000ms', function (done) {
      omnitron.start(
        {
          script: './signals/delayed_sigint.js',
          name: 'delayed-sigint',
          exec_mode: 'cluster',
          kill_timeout: 4000,
        },
        function (err, data) {
          proc1 = data[0];
          should(err).be.null();
          setTimeout(done, 1000);
        }
      );
    });

    it('should stop script after 4000ms (and not 1000ms)', function (done) {
      setTimeout(function () {
        omnitron.list(function (err, list) {
          list[0].omnitron_env.status.should.eql('stopping');
        });
      }, 1500);

      setTimeout(function () {
        omnitron.list(function (err, list) {
          list[0].omnitron_env.status.should.eql('stopped');
          done();
        });
      }, 4500);

      omnitron.stop('delayed-sigint', function (err, app) {
        //done(err);
      });
    });

    it('should delete all', function (done) {
      omnitron.delete('all', done);
    });
  });
});

describe('Message kill (signal behavior override via OMNITRON_KILL_USE_MESSAGE, +delayed)', function () {
  var proc1 = null;
  var appName = 'delayedsend';

  process.env.OMNITRON_KILL_USE_MESSAGE = true;

  var omnitron = new OMNITRON.custom({
    cwd: __dirname + '/../fixtures',
  });

  after(function (done) {
    omnitron.delete('all', function (err, ret) {
      omnitron.kill(done);
    });
  });

  before(function (done) {
    omnitron.connect(function () {
      omnitron.delete('all', function (err, ret) {
        done();
      });
    });
  });

  describe.only('with 1000ms OMNITRON_KILL_TIMEOUT (environment variable)', function () {
    it('should set 1000ms to OMNITRON_KILL_TIMEOUT', function (done) {
      process.env.OMNITRON_KILL_TIMEOUT = 1000;

      omnitron.update(function () {
        done();
      });
    });

    it('should start a script', function (done) {
      omnitron.start(
        {
          script: './signals/delayed_send.js',
          error_file: 'error-echo.log',
          out_file: 'out-echo.log',
          name: appName,
        },
        function (err, data) {
          proc1 = data[0];
          should(err).be.null();
          setTimeout(done, 1000);
        }
      );
    });

    it('should stop script after 1000ms', function (done) {
      setTimeout(function () {
        console.log('CALLED1');
        omnitron.describe(appName, function (err, list) {
          console.log('CALLED1FINI');
          should(err).be.null();
          list[0].omnitron_env.status.should.eql('stopping');
        });
      }, 500);

      setTimeout(function () {
        console.log('CALLED2');
        omnitron.describe(appName, function (err, list) {
          console.log('CALLED2FINI');
          should(err).be.null();
          list[0].omnitron_env.status.should.eql('stopped');
          done();
        });
      }, 1500);

      omnitron.stop(appName, function (err, app) {
        //done(err);
      });
    });

    it('should read shutdown message', function (done) {
      var out_file = proc1.omnitron_env.pm_out_log_path;
      fs.readFileSync(out_file).toString().should.containEql('shutdown message');
      done();
    });

    it('should delete all', function (done) {
      omnitron.delete('all', done);
    });
  });

  describe('[CLUSTER MODE] with 1000ms OMNITRON_KILL_TIMEOUT (environment variable)', function () {
    it('should set 1000ms to OMNITRON_KILL_TIMEOUT', function (done) {
      process.env.OMNITRON_KILL_TIMEOUT = 1000;

      omnitron.update(function () {
        done();
      });
    });

    it('should start a script', function (done) {
      omnitron.start(
        {
          script: './signals/delayed_send.js',
          name: appName,
          exec_mode: 'cluster',
        },
        function (err, data) {
          proc1 = data[0];
          should(err).be.null();
          setTimeout(done, 1000);
        }
      );
    });

    it('should stop script after 1000ms', function (done) {
      setTimeout(function () {
        omnitron.describe(appName, function (err, list) {
          should(err).be.null();
          list[0].omnitron_env.status.should.eql('stopping');
        });
      }, 500);

      setTimeout(function () {
        omnitron.describe(appName, function (err, list) {
          should(err).be.null();
          list[0].omnitron_env.status.should.eql('stopped');
          done();
        });
      }, 1500);

      omnitron.stop(appName, function (err, app) {
        //done(err);
      });
    });

    it('should reload script', function (done) {
      setTimeout(function () {
        omnitron.describe(appName, function (err, list) {
          should(err).be.null();
          list[0].omnitron_env.status.should.eql('online');
          done();
        });
      }, 1500);

      omnitron.reload(appName, function (err, app) {
        //done(err);
      });
    });

    it('should read shutdown message', function (done) {
      var out_file = proc1.omnitron_env.pm_out_log_path;
      fs.readFileSync(out_file).toString().should.containEql('shutdown message');
      done();
    });
  });
});
