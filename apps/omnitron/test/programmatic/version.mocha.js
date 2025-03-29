const OMNITRON = require('../..').default;
const should = require('should');
const exec = require('child_process').exec;
const path = require('path');
const fs = require('fs');

describe('Modules programmatic testing', function () {
  var omnitron;
  var pkg_path = path.join(__dirname, 'fixtures/version-test/package.json');

  after(function (done) {
    omnitron.delete('all', function () {
      omnitron.kill(done);
    });
  });

  before(function (done) {
    omnitron = new OMNITRON.custom({
      cwd: path.join(__dirname, 'fixtures'),
    });

    var pkg = JSON.parse(fs.readFileSync(pkg_path));
    pkg.version = '1.0.0';
    fs.writeFileSync(pkg_path, JSON.stringify(pkg));

    omnitron.delete('all', () => done());
  });

  it('should start app and find version', function (done) {
    omnitron.start('./version-test/index.js', (err) => {
      omnitron.list(function (err, apps) {
        should(err).be.null();
        var real_version = JSON.parse(
          fs.readFileSync(path.join(__dirname, 'fixtures/version-test/package.json'))
        ).version;
        should(apps[0].omnitron_env.version).equal(real_version);
        done();
      });
    });
  });

  var origin_version;
  it('should update version', function (done) {
    var old = JSON.parse(fs.readFileSync(pkg_path));
    origin_version = old.version;
    old.version = '2.0.0';
    fs.writeFileSync(pkg_path, JSON.stringify(old));
    omnitron.restart('all', function () {
      setTimeout(() => {
        omnitron.list((err, list) => {
          should(list[0].omnitron_env.version).equal('2.0.0');
          done();
        });
      }, 400);
    });
  });

  it('should restore version', function (done) {
    var old = JSON.parse(fs.readFileSync(pkg_path));
    old.version = origin_version;
    fs.writeFileSync(pkg_path, JSON.stringify(old));

    omnitron.restart('all', function () {
      omnitron.list((err, list) => {
        should(list[0].omnitron_env.version).equal(origin_version);
        done();
      });
    });
  });
});
