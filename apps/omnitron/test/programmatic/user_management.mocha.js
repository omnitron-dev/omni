process.env.NODE_ENV = 'test';
process.chdir(__dirname);

var OMNITRON = require('../..').default;
var should = require('should');

describe('User management', function () {
  before(function (done) {
    OMNITRON.delete('all', function () {
      done();
    });
  });

  after(function (done) {
    OMNITRON.kill(done);
  });

  it('should fail with unknown user', function (done) {
    OMNITRON.start(
      './../fixtures/child.js',
      {
        user: 'toto',
      },
      function (err) {
        should(err.message).match(/cannot be found/);

        OMNITRON.list(function (err, list) {
          should(err).be.null();
          should(list.length).eql(0);
          done();
        });
      }
    );
  });

  it('should succeed with known user', function (done) {
    OMNITRON.start(
      './../fixtures/child.js',
      {
        user: process.env.USER,
      },
      function (err) {
        should(err).be.null();
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          should(list.length).eql(1);
          should.exist(list[0].omnitron_env.uid);
          should.exist(list[0].omnitron_env.gid);
          OMNITRON.delete('all', done);
        });
      }
    );
  });

  it('should succeed with known user via uid field', function (done) {
    OMNITRON.start(
      './../fixtures/child.js',
      {
        uid: process.env.USER,
      },
      function (err) {
        should(err).be.null();
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          should.exist(list[0].omnitron_env.uid);
          should.exist(list[0].omnitron_env.gid);
          should(list.length).eql(1);
          OMNITRON.delete('all', done);
        });
      }
    );
  });
});
