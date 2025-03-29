process.chdir(__dirname);

var omnitron = require('../..').default;
var should = require('should');

describe('Custom actions via CLI/API', function () {
  before(function (done) {
    omnitron.delete('all', function () {
      done();
    });
  });

  after(function (done) {
    omnitron.delete('all', function () {
      done();
    });
  });

  it('should start custom action script', function (done) {
    omnitron.start('./../fixtures/custom_actions/index.js', function () {
      setTimeout(done, 1200);
    });
  });

  it('should trigger message by id', function (done) {
    omnitron.trigger(0, 'ping', function (err, ret) {
      should(err).be.null();
      should(ret.length).eql(1);
      should(ret[0].data.return.pong).eql('hehe');
      done();
    });
  });

  it('should trigger message by name', function (done) {
    omnitron.trigger('index', 'ping', function (err, ret) {
      should(err).be.null();
      should(ret.length).eql(1);
      should(ret[0].data.return.pong).eql('hehe');
      done();
    });
  });

  it('should handle unknown application', function (done) {
    omnitron.trigger('indexxo', 'ping', function (err, ret) {
      should(err).not.be.null();
      done();
    });
  });

  it('should cannot trigger message if unknow id', function (done) {
    omnitron.trigger(10, 'ping', function (err, ret) {
      should(err).not.be.null();
      done();
    });
  });

  it('should cannot trigger message if unknow action name', function (done) {
    omnitron.trigger(0, 'XXXXXXXXXx', function (err, ret) {
      should(err).not.be.null();
      done();
    });
  });

  it('should delete all processes', function (done) {
    omnitron.delete('all', done);
  });

  it('should start app in cluster mode', function (done) {
    omnitron.start(
      {
        script: './../fixtures/custom_actions/index.js',
        instances: '4',
      },
      function () {
        setTimeout(done, 800);
      }
    );
  });

  it('should trigger message by id', function (done) {
    omnitron.trigger(0, 'ping', function (err, ret) {
      should(err).be.null();
      should(ret.length).eql(1);
      should(ret[0].data.return.pong).eql('hehe');
      done();
    });
  });

  it('should trigger message by name', function (done) {
    omnitron.trigger('index', 'ping', function (err, ret) {
      should(err).be.null();
      should(ret.length).eql(4);
      should(ret[0].data.return.pong).eql('hehe');
      done();
    });
  });

  it('should trigger message with params by name', function (done) {
    omnitron.trigger('index', 'param', 'shouldret', function (err, ret) {
      should(err).be.null();
      should(ret.length).eql(4);
      should(ret[0].data.return).eql('shouldret');
      should(ret[3].data.return).eql('shouldret');
      done();
    });
  });
});
