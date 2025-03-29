process.chdir(__dirname);

var OMNITRON = require('../..').default;
var should = require('should');
var assert = require('assert');

describe('Unique ID verification', function () {
  describe('when starting', function () {
    var _id = null;

    before(function (done) {
      OMNITRON.delete('all', function () {
        done();
      });
    });

    after(function (done) {
      OMNITRON.delete('all', function () {
        done();
      });
    });

    it('should start a script', function (done) {
      OMNITRON.start('../fixtures/child.js', function (err) {
        should(err).be.null();
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          assert(list.length > 0);
          assert(typeof list[0].omnitron_env.unique_id === 'string');
          _id = list[0].omnitron_env.unique_id;
          done();
        });
      });
    });

    it('should stop app by id', function (done) {
      OMNITRON.stop(0, done);
    });

    it('should restart and not changed unique id', function (done) {
      OMNITRON.restart(0, (err) => {
        should(err).be.null();
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          assert(list.length > 0);
          assert(typeof list[0].omnitron_env.unique_id === 'string');
          assert(list[0].omnitron_env.unique_id === _id);
          done();
        });
      });
    });

    it('should generate another unique id for new process', function (done) {
      OMNITRON.start('./../fixtures/child.js', { name: 'toto' }, function (err) {
        assert(!err);
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          assert(list.length === 2);
          assert(typeof list[0].omnitron_env.unique_id === 'string');
          assert(typeof list[1].omnitron_env.unique_id === 'string');
          assert(list[0].omnitron_env.unique_id !== typeof list[1].omnitron_env.unique_id);
          done();
        });
      });
    });

    it('should duplicate a process and have a new id', function (done) {
      OMNITRON.scale('child', 2, function (err) {
        assert(!err);
        OMNITRON.list(function (err, list) {
          should(err).be.null();
          should(list.length).eql(3);
          assert(typeof list[0].omnitron_env.unique_id === 'string');
          assert(typeof list[1].omnitron_env.unique_id === 'string');
          assert(typeof list[2].omnitron_env.unique_id === 'string');
          assert(list[0].omnitron_env.unique_id !== typeof list[1].omnitron_env.unique_id);
          assert(list[1].omnitron_env.unique_id !== typeof list[2].omnitron_env.unique_id);
          assert(list[0].omnitron_env.unique_id !== typeof list[2].omnitron_env.unique_id);
          done();
        });
      });
    });
  });
});
