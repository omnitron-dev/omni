var OMNITRON = require('../..').default;
var should = require('should');

describe('Call OMNITRON inside OMNITRON', function () {
  var omnitron = new OMNITRON.custom({
    cwd: __dirname + '/../fixtures/inside',
  });

  after(function (done) {
    omnitron.kill(function () {
      done();
    });
  });

  it('should start script that starts a script', function (done) {
    omnitron.start('start_inside.js', function (err) {
      should(err).be.null();
      setTimeout(done, 1500);
    });
  });

  it('should list 2 processes and apps stabilized', function (done) {
    omnitron.list(function (err, list) {
      should(err).be.null();
      should(list.length).eql(2);
      list.forEach(function (proc) {
        should(proc.omnitron_env.restart_time).eql(0);
        should(proc.omnitron_env.status).eql('online');
      });
      done();
    });
  });

  it('should start script that restart script', function (done) {
    omnitron.start('restart_inside.js', function (err) {
      should(err).be.null();
      setTimeout(done, 1500);
    });
  });

  it('should list 3 processes and apps stabilized', function (done) {
    omnitron.list(function (err, list) {
      should(err).be.null();
      should(list.length).eql(3);
      list.forEach(function (proc) {
        if (proc.name == 'echo') {
          should(proc.omnitron_env.restart_time).eql(1);
          should(proc.omnitron_env.status).eql('online');
        } else {
          should(proc.omnitron_env.restart_time).eql(0);
          should(proc.omnitron_env.status).eql('online');
        }
      });
      done();
    });
  });

  it('should start script that reload script', function (done) {
    omnitron.start('reload_inside.js', function (err) {
      should(err).be.null();
      setTimeout(done, 1500);
    });
  });

  it('should list 4 processes and apps stabilized', function (done) {
    omnitron.list(function (err, list) {
      should(err).be.null();
      should(list.length).eql(4);
      list.forEach(function (proc) {
        if (proc.name == 'echo') {
          should(proc.omnitron_env.restart_time).eql(2);
          should(proc.omnitron_env.status).eql('online');
        } else {
          should(proc.omnitron_env.restart_time).eql(0);
          should(proc.omnitron_env.status).eql('online');
        }
      });
      done();
    });
  });
});
