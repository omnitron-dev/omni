const omnitron = require('../..').default;
const should = require('should');
const path = require('path');
const os = require('os');

describe('OMNITRON instances max bound test', function () {
  var test_path = path.join(__dirname, 'fixtures', 'instances');

  after((done) => {
    omnitron.delete('all', () => {
      done();
    });
  });

  before((done) => {
    omnitron.uninstall('all', () => {
      omnitron.delete('all', () => {
        done();
      });
    });
  });

  it.only('should start maximum number of instances in cluster mode', (done) => {
    omnitron.start(
      {
        script: path.join(test_path, 'http.js'),
        instances: 'max',
      },
      function (err, apps) {
        should(apps.length).eql(os.cpus().length);
        should(apps[0].omnitron_env.exec_mode).eql('cluster_mode');
        if (apps.length > 1) should(apps[1].omnitron_env.exec_mode).eql('cluster_mode');
        done();
      }
    );
  });

  it('should app be in stable mode', (done) => {
    setTimeout(function () {
      omnitron.list(function (err, apps) {
        should(apps[0].omnitron_env.restart_time).eql(0);
        if (apps.length > 1) should(apps[1].omnitron_env.restart_time).eql(0);
        done();
      });
    }, 1000);
  });

  it('should delete all', (done) => {
    omnitron.delete('all', function () {
      done();
    });
  });

  it('should start maximum number of instances in cluster mode', (done) => {
    omnitron.start(
      {
        script: path.join(test_path, 'http.js'),
        instances: 0,
      },
      function (err, apps) {
        should(apps.length).eql(os.cpus().length);
        should(apps[0].omnitron_env.exec_mode).eql('cluster_mode');
        if (apps.length > 1) should(apps[1].omnitron_env.exec_mode).eql('cluster_mode');
        done();
      }
    );
  });

  it('should delete all', (done) => {
    omnitron.delete('all', function () {
      done();
    });
  });

  it('should start 4 instances in cluster mode', (done) => {
    omnitron.start(
      {
        script: path.join(test_path, 'http.js'),
        instances: 4,
      },
      function (err, apps) {
        should(apps.length).eql(4);
        should(apps[0].omnitron_env.exec_mode).eql('cluster_mode');
        should(apps[1].omnitron_env.exec_mode).eql('cluster_mode');
        done();
      }
    );
  });

  it('should start maximum number of instances in fork mode', (done) => {
    omnitron.start(
      {
        script: path.join(test_path, 'echo.js'),
        exec_mode: 'fork',
        instances: 'max',
      },
      function (err, apps) {
        should(apps.length).eql(os.cpus().length);
        should(apps[0].omnitron_env.exec_mode).eql('fork_mode');
        if (apps.length > 1) should(apps[1].omnitron_env.exec_mode).eql('fork_mode');
        done();
      }
    );
  });

  it('should app be in stable mode', (done) => {
    setTimeout(function () {
      omnitron.list(function (err, apps) {
        should(apps[0].omnitron_env.restart_time).eql(0);
        if (apps.length > 1) should(apps[1].omnitron_env.restart_time).eql(0);
        done();
      });
    }, 1000);
  });
});
