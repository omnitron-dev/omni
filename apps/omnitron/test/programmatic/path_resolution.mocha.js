const path = require('path');
process.chdir(path.join(__dirname, '../fixtures'));

const OMNITRON = require('../../dist').default;
const should = require('should');

describe('Path resolution in configuration file', function () {
  this.timeout(4000);
  before(function (done) {
    OMNITRON.delete('all', function () {
      done();
    });
  });

  afterEach(function (done) {
    OMNITRON.delete('all', function () {
      done();
    });
  });

  it('should resolve paths (home)', function (done) {
    OMNITRON.start('./path-resolution/ecosystem.config.js', function (err, proc) {
      should(proc[0].omnitron_env.pm_err_log_path).eql(path.join(process.env.HOME, 'echo-err.log'));
      should(proc[0].omnitron_env.pm_out_log_path).eql(path.join(process.env.HOME, 'echo-out.log'));
      should(proc[0].omnitron_env.pm_pid_path).eql(path.join(process.env.HOME, 'echo-pid.log'));
      done();
    });
  });

  it('should resolve paths (local)', function (done) {
    OMNITRON.start('./path-resolution/ecosystem2.config.js', function (err, proc) {
      should(proc[0].omnitron_env.pm_err_log_path).eql(path.join(process.cwd(), 'echo-err.log'));
      should(proc[0].omnitron_env.pm_out_log_path).eql(path.join(process.cwd(), 'echo-out.log'));
      should(proc[0].omnitron_env.pm_pid_path).eql(path.join(process.cwd(), 'echo-pid.log'));
      done();
    });
  });

  it('should auto prefix log path on cluster mode', function (done) {
    OMNITRON.start('./path-resolution/ecosystem3.config.js', function (err, proc) {
      should(proc[0].omnitron_env.pm_err_log_path).eql(path.join(process.cwd(), 'echo-err-0.log'));
      should(proc[0].omnitron_env.pm_out_log_path).eql(path.join(process.cwd(), 'echo-out-0.log'));

      should(proc[1].omnitron_env.pm_err_log_path).eql(path.join(process.cwd(), 'echo-err-1.log'));
      should(proc[1].omnitron_env.pm_out_log_path).eql(path.join(process.cwd(), 'echo-out-1.log'));
      done();
    });
  });
});
