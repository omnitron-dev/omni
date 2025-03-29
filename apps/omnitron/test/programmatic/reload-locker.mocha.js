process.env.NODE_ENV = 'test';
process.env.OMNITRON_RELOAD_LOCK_TIMEOUT = 2000;

var OMNITRON = require('../..').default;
var should = require('should');
var path = require('path');
var Plan = require('../helpers/plan.js');
var fs = require('fs');
var cst = require('../../dist/constants').default;

process.chdir(__dirname);

describe('Reload locker system', function () {
  var omnitron = new OMNITRON.custom({
    cwd: '../fixtures',
  });

  before(function (done) {
    omnitron.list(done);
  });

  after(function (done) {
    omnitron.kill(done);
  });

  it('should start app', function (done) {
    omnitron.start(
      {
        script: './http.js',
        instances: 2,
      },
      function (err, data) {
        should(err).be.null();

        omnitron.list(function (err, ret) {
          should(err).be.null();
          ret.length.should.eql(2);
          done();
        });
      }
    );
  });

  it('should trigger one reload and forbid the second', function (done) {
    omnitron.reload('all');

    setTimeout(() => {
      fs.statSync(cst.OMNITRON_RELOAD_LOCKFILE);
      var dt = parseInt(fs.readFileSync(cst.OMNITRON_RELOAD_LOCKFILE).toString());

      should(dt).above(0);

      omnitron.reload('all', (err) => {
        should.exists(err);
        if (err) done();
        else done(new Error('should trigger error'));
      });
    }, 100);
  });

  it('should re allow reload when reload finished', function (done) {
    setTimeout(function () {
      omnitron.reload('all', done);
    }, 2000);
  });

  it('should lock file be empty', function () {
    var dt = fs.readFileSync(cst.OMNITRON_RELOAD_LOCKFILE).toString();
    should(dt).eql('');
  });
});
