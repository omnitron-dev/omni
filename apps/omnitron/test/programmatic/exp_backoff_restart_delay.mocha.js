process.env.EXP_BACKOFF_RESET_TIMER = 500;
process.env.OMNITRON_WORKER_INTERVAL = 100;

const OMNITRON = require('../..').default;
const path = require('path');
const should = require('should');

describe('Exponential backoff feature', function () {
  var omnitron;
  var test_path = path.join(__dirname, 'fixtures', 'exp-backoff');

  after(function (done) {
    omnitron.delete('all', function () {
      omnitron.kill(done);
    });
  });

  before(function (done) {
    omnitron = new OMNITRON.custom({
      cwd: test_path,
    });

    omnitron.delete('all', () => done());
  });

  it('should set exponential backoff restart', (done) => {
    omnitron.start(
      {
        script: path.join(test_path, 'throw-stable.js'),
        exp_backoff_restart_delay: 100,
      },
      (err, apps) => {
        should(err).be.null();
        should(apps[0].omnitron_env.exp_backoff_restart_delay).eql(100);
        done();
      }
    );
  });

  it('should have set the prev_restart delay', (done) => {
    setTimeout(() => {
      omnitron.list((err, procs) => {
        should(procs[0].omnitron_env.prev_restart_delay).be.aboveOrEqual(100);
        done();
      });
    }, 800);
  });

  it('should have incremented the prev_restart delay', (done) => {
    setTimeout(() => {
      omnitron.list((err, procs) => {
        should(procs[0].omnitron_env.prev_restart_delay).be.above(100);
        done();
      });
    }, 500);
  });

  it('should reset prev_restart_delay if application has reach stable uptime', (done) => {
    setTimeout(() => {
      omnitron.list((err, procs) => {
        should(procs[0].omnitron_env.prev_restart_delay).be.eql(0);
        done();
      });
    }, 3000);
  });
});
