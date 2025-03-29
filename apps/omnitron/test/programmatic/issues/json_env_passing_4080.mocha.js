const OMNITRON = require('../../..').default;
const should = require('should');

describe('Programmatic log feature test', function () {
  var proc1 = null;
  var procs = [];

  var omnitron = new OMNITRON.custom({
    cwd: __dirname + '/../fixtures/json-env-passing',
  });

  before(function (done) {
    omnitron.delete('all', function () {
      done();
    });
  });

  after(function (done) {
    omnitron.delete('all', function () {
      omnitron.disconnect(done);
    });
  });

  it('should start a process with object as environment variable', function (done) {
    omnitron.start(
      {
        script: 'echo.js',
        env: {
          NORMAL: 'STR',
          JSONTEST: { si: 'si' },
        },
        env_production: {
          NODE_ENV: 'production',
        },
      },
      function (err, procs) {
        should(err).be.null();
        should(procs.length).eql(1);
        done();
      }
    );
  });

  it('should retrieve environment variable stringified', function (done) {
    omnitron.list((err, procs) => {
      should(procs[0].omnitron_env.JSONTEST).eql('{"si":"si"}');
      should(procs[0].omnitron_env.NORMAL).eql('STR');
      done();
    });
  });
});
