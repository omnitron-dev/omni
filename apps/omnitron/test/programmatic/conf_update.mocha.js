const OMNITRON = require('../..').default;
const should = require('should');

process.chdir(__dirname);

describe('Modules programmatic testing', function () {
  var omnitron;

  after(function (done) {
    omnitron.kill(done);
  });

  it('should instanciate OMNITRON', function () {
    omnitron = new OMNITRON.custom({
      cwd: '../fixtures',
    });
  });

  it('should start 4 processes', function (done) {
    omnitron.start(
      {
        script: './echo.js',
        instances: 4,
        uid: process.env.USER,
        force: true,
      },
      function (err, procs) {
        should(err).eql(null);
        should(procs.length).eql(4);
        should(procs[0].omnitron_env.uid).eql(process.env.USER);
        done();
      }
    );
  });

  it('should start 4 processes', function (done) {
    omnitron.restart(
      'echo',
      {
        uid: process.env.USER,
      },
      function (err, procs) {
        console.log(JSON.stringify(procs[0].omnitron_env, '', 2));
        should(err).eql(null);
        should(procs.length).eql(4);
        should(procs[0].omnitron_env.uid).eql(process.env.USER);
        done();
      }
    );
  });
});
