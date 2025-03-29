var OMNITRON = require('../..').default;
var should = require('should');

var { Configuration } = require('../../dist/configuration');

describe.skip('Keep state on omnitron update', function () {
  var omnitron;

  before((done) => {
    Configuration.set('omnitron:autodump', 'true', function (err, data) {
      omnitron = new OMNITRON.custom({
        cwd: __dirname + '/../fixtures',
      });

      should.not.exists(err);
      done();
    });
  });

  after((done) => {
    Configuration.set('omnitron:autodump', 'false', function (err, data) {
      should.not.exists(err);
      done();
    });
  });

  describe('Should autosave edits on stop/start/delete', function () {
    after(function (done) {
      omnitron.kill(done);
    });

    before(function (done) {
      omnitron.connect(function () {
        omnitron.delete('all', function () {
          done();
        });
      });
    });

    it('should set autodump to true', function (done) {
      omnitron.set('omnitron:autodump', 'true', function (err, data) {
        should.not.exists(err);
        done();
      });
    });

    it('should start 4 processes', function (done) {
      omnitron.start(
        {
          script: './echo.js',
          instances: 4,
          name: 'echo',
        },
        function (err, data) {
          should(err).be.null();
          done();
        }
      );
    });

    it('should kill omnitron', function (done) {
      omnitron.kill(done);
    });

    it('should resurect with one process stopped', function (done) {
      omnitron.resurrect(() => {
        omnitron.list((err, dt) => {
          if (dt.length == 4) return done();
          return done(new Error('Did not kept process status'));
        });
      });
    });

    it('should stop 1 process', function (done) {
      omnitron.stop(0, done);
    });

    it('should kill omnitron', function (done) {
      omnitron.kill(done);
    });

    it('should resurect with one process stopped', function (done) {
      omnitron.resurrect(() => {
        omnitron.list((err, dt) => {
          if (dt.length == 4 && dt.filter((proc) => proc.omnitron_env.status == 'stopped').length == 1) return done();
          return done(new Error('Did not kept process status'));
        });
      });
    });

    it('should delete and save', function (done) {
      omnitron.delete(0, done);
    });

    it('should kill omnitron', function (done) {
      omnitron.kill(done);
    });

    it('should resurect with one process stopped', function (done) {
      omnitron.resurrect(() => {
        omnitron.list((err, dt) => {
          if (dt.length == 3) return done();
          return done(new Error('Did not kept process status'));
        });
      });
    });
  });
});
