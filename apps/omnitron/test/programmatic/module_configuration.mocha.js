process.env.NODE_ENV = 'test';

const OMNITRON = require('../..').default;
const should = require('should');
const fs = require('fs');

process.chdir(__dirname);

describe('Module default flush configuration', function () {
  this.timeout(30000);

  before(function (done) {
    OMNITRON.unset('omnitron-logrotate', done);
  });

  it('should install a module', function (done) {
    OMNITRON.install('omnitron-logrotate', function () {
      setTimeout(done, 1000);
    });
  });

  it('should module configuration have module options', function (done) {
    var conf = require(process.env.HOME + '/.omnitron/module_conf.json');
    should(conf['omnitron-logrotate'].max_size).eql('10M');
    should(conf['omnitron-logrotate'].retain).eql('all');
    should(conf['omnitron-logrotate'].rotateModule).eql(true);
    done();
  });

  it('should change configuration', function (done) {
    OMNITRON.set('omnitron-logrotate.max_size', '20M', done);
  });

  it('should have right value', function () {
    var conf = JSON.parse(fs.readFileSync(process.env.HOME + '/.omnitron/module_conf.json'));
    should(conf['omnitron-logrotate'].max_size).eql('20M');
  });

  it('should re install a module and not override previous set value', function () {
    var conf = JSON.parse(fs.readFileSync(process.env.HOME + '/.omnitron/module_conf.json'));
    should(conf['omnitron-logrotate'].max_size).eql('20M');
  });

  it('should uninstall module', function (done) {
    OMNITRON.uninstall('omnitron-logrotate', done);
  });
});
