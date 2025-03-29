const OMNITRON = require('../..').default;
const should = require('should');
const exec = require('child_process').exec;
const path = require('path');
const fs = require('fs');

describe('Modules programmatic testing', function () {
  var omnitron;

  var MODULE_FOLDER_MONO = path.join(__dirname, './fixtures/tar-module/mono-app-module');
  var MODULE_FOLDER_MULTI = path.join(__dirname, './fixtures/tar-module/multi-app-module');

  var PACKAGE_MONO = path.join(process.cwd(), 'mono-app-module-v0-23-0.tar.gz');
  var PACKAGE_MULTI = path.join(process.cwd(), 'multi-app-module-v0-1.tar.gz');

  after(function (done) {
    omnitron.kill(done);
  });

  before(function (done) {
    omnitron = new OMNITRON.custom({
      cwd: './fixtures',
    });

    omnitron.uninstall('all', () => done());
  });

  describe('Package', function () {
    before((done) => {
      fs.unlink(PACKAGE_MONO, () => {
        fs.unlink(PACKAGE_MULTI, () => {
          done();
        });
      });
    });

    it('should package tarball for mono app', function (done) {
      omnitron.package(MODULE_FOLDER_MONO, (err) => {
        should(err).be.null();
        should(fs.existsSync(PACKAGE_MONO)).eql(true);
        done();
      });
    });

    it('should package tarball for multi app', function (done) {
      omnitron.package(MODULE_FOLDER_MULTI, (err) => {
        should(err).be.null();
        should(fs.existsSync(PACKAGE_MULTI)).eql(true);
        done();
      });
    });
  });

  describe('MULTI Install', function () {
    it('should install module', function (done) {
      omnitron.install(
        PACKAGE_MULTI,
        {
          tarball: true,
        },
        function (err, apps) {
          should(err).eql(null);
          done();
        }
      );
    });

    it('should have file decompressed in the right folder', function () {
      var target_path = path.join(OMNITRON._conf.DEFAULT_MODULE_PATH, 'multi-app-module');
      fs.readFileSync(path.join(target_path, 'package.json'));
    });

    it('should have boot key present', function (done) {
      var conf = JSON.parse(fs.readFileSync(process.env.HOME + '/.omnitron/module_conf.json'));
      should.exist(conf['tar-modules']['multi-app-module']);
      done();
    });

    it('should have started 2 apps', function (done) {
      omnitron.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(2);
        should(list[0].omnitron_env.version).eql('0.1');
        should(list[0].name).eql('multi-app-module:first_app');
        should(list[1].name).eql('multi-app-module:second_app');
        should(list[1].omnitron_env.version).eql('0.1');
        should(list[0].omnitron_env.status).eql('online');
        should(list[1].omnitron_env.status).eql('online');
        done();
      });
    });
  });

  describe('Reinstall', () => {
    it('should install module', function (done) {
      omnitron.install(
        PACKAGE_MULTI,
        {
          tarball: true,
        },
        function (err, apps) {
          should(err).eql(null);
          done();
        }
      );
    });

    it('should have only 2 apps', function (done) {
      omnitron.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(2);
        should(list[0].omnitron_env.status).eql('online');
        should(list[1].omnitron_env.status).eql('online');
        done();
      });
    });
  });

  describe('Re spawn OMNITRON', () => {
    it('should kill/resurect omnitron', (done) => {
      omnitron.update(function (err) {
        should(err).be.null();
        done();
      });
    });

    it('should have boot key present', function (done) {
      var conf = JSON.parse(fs.readFileSync(process.env.HOME + '/.omnitron/module_conf.json'));
      should.exist(conf['tar-modules']['multi-app-module']);
      done();
    });

    it('should have started 2 apps', function (done) {
      omnitron.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(2);
        should(list[0].omnitron_env.status).eql('online');
        should(list[0].omnitron_env.version).eql('0.1');
        should(list[1].omnitron_env.version).eql('0.1');
        should(list[1].omnitron_env.status).eql('online');
        done();
      });
    });
  });

  describe('CLI UX', () => {
    it('should not delete modules when calling omnitron delete all', (done) => {
      omnitron.delete('all', (err, apps) => {
        should(apps.length).eql(2);
        done();
      });
    });
  });

  describe('Uninstall', () => {
    it('should uninstall multi app module', (done) => {
      omnitron.uninstall('multi-app-module', (err, data) => {
        should(err).be.null();
        done();
      });
    });

    it('should have boot key deleted', function (done) {
      var conf = JSON.parse(fs.readFileSync(process.env.HOME + '/.omnitron/module_conf.json'));
      should.not.exist(conf['tar-modules']['multi-app-module']);
      done();
    });

    it('should have no running apps', function (done) {
      omnitron.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(0);
        done();
      });
    });
  });

  describe('MONO APP', () => {
    it('should install module', function (done) {
      omnitron.install(
        PACKAGE_MONO,
        {
          tarball: true,
        },
        function (err, apps) {
          should(err).eql(null);
          done();
        }
      );
    });

    it('should have file decompressed in the right folder', function () {
      var target_path = path.join(OMNITRON._conf.DEFAULT_MODULE_PATH, 'mono-app-module');
      var pkg_path = path.join(target_path, 'package.json');
      fs.readFileSync(pkg_path);
    });

    it('should have boot key present', function (done) {
      var conf = JSON.parse(fs.readFileSync(process.env.HOME + '/.omnitron/module_conf.json'));
      should.exist(conf['tar-modules']['mono-app-module']);
      done();
    });

    it('should have started 1 app', function (done) {
      omnitron.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(1);
        should(list[0].name).eql('mono_app');
        should(list[0].omnitron_env.version).eql('0.23.0');
        should(list[0].omnitron_env.status).eql('online');
        done();
      });
    });

    it('should uninstall multi app module', (done) => {
      omnitron.uninstall('mono-app-module', (err, data) => {
        should(err).be.null();
        done();
      });
    });

    it('should have boot key deleted', function (done) {
      var conf = JSON.parse(fs.readFileSync(process.env.HOME + '/.omnitron/module_conf.json'));
      should.not.exist(conf['tar-modules']['mono-app-module']);
      done();
    });

    it('should have no running apps', function (done) {
      omnitron.list(function (err, list) {
        should(err).be.null();
        should(list.length).eql(0);
        done();
      });
    });
  });
});
