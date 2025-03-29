//#4596

process.chdir(__dirname);

process.env.SHOULD_NOT_BE_THERE = 'true';

var OMNITRON = require('../..').default;
var should = require('should');

describe('API checks', function () {
  before(function (done) {
    OMNITRON.delete('all', function () {
      done();
    });
  });

  after(function (done) {
    OMNITRON.kill(done);
  });

  afterEach(function (done) {
    OMNITRON.delete('all', done);
  });

  it('should start app and validate presence of env var', function (done) {
    OMNITRON.start(
      {
        script: './../fixtures/echo.js',
      },
      (err) => {
        should(err).be.null();
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          should(list.length).eql(1);
          should.exists(list[0].omnitron_env.SHOULD_NOT_BE_THERE);
          done();
        });
      }
    );
  });

  it('should start app with filtered env wth array of env to be ignored', function (done) {
    OMNITRON.start(
      {
        script: './../fixtures/echo.js',
        filter_env: ['SHOULD_NOT_BE_THERE'],
      },
      (err) => {
        should(err).be.null();
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          should(list.length).eql(1);
          should.not.exists(list[0].omnitron_env.SHOULD_NOT_BE_THERE);
          done();
        });
      }
    );
  });

  it('should start app with filtered env with string env name to be ignored', function (done) {
    OMNITRON.start(
      {
        script: './../fixtures/echo.js',
        filter_env: 'SHOULD_NOT_BE_THERE',
      },
      (err) => {
        should(err).be.null();
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          should(list.length).eql(1);
          should.not.exists(list[0].omnitron_env.SHOULD_NOT_BE_THERE);
          done();
        });
      }
    );
  });

  it('should start app with filtered env at true to drop all local env', function (done) {
    OMNITRON.start(
      {
        script: './../fixtures/echo.js',
        filter_env: true,
      },
      (err) => {
        should(err).be.null();
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          should(list.length).eql(1);
          should.not.exists(list[0].omnitron_env.SHOULD_NOT_BE_THERE);
          done();
        });
      }
    );
  });
});
