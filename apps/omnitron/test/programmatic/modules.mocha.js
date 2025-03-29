const OMNITRON = require('../..').default;
const should = require('should');

describe('Modules programmatic testing', function () {
  var omnitron;

  after(function (done) {
    omnitron.kill(done);
  });

  it('should instanciate OMNITRON', function () {
    omnitron = new OMNITRON.custom({
      daemon_mode: true,
    });
  });

  it('should install a module', function (done) {
    omnitron.install('pm2-server-monit', function (err, apps) {
      should(err).eql(null);
      should(apps.length).eql(1);
      var omnitron_env = apps[0].omnitron_env;
      should.exist(omnitron_env);
      done();
    });
  });

  it.skip('should run post install command', function (done) {
    var fs = require('fs');
    var ec = {};
    ec.dependencies = new Array();
    ec.dependencies.push('pm2-server-monit');
    ec.post_install = {};
    ec.post_install['pm2-server-monit'] = 'echo "test passed!"';
    fs.appendFileSync('test.json', JSON.stringify(ec));
    omnitron.install('test.json', function () {
      fs.unlinkSync('test.json');
      done();
    });
  });

  it('should list one module', function (done) {
    omnitron.list(function (err, apps) {
      should(err).eql(null);
      should(apps.length).eql(1);
      var omnitron_env = apps[0].omnitron_env;
      should(omnitron_env.status).eql('online');
      done();
    });
  });

  it('should uninstall all modules', function (done) {
    omnitron.uninstall('all', function (err, apps) {
      done();
    });
  });
});
