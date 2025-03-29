/**
 * OMNITRON programmatic API tests
 */

var OMNITRON = require('../..').default;
var should = require('should');
var path = require('path');

describe('OMNITRON programmatic calls', function () {
  var omnitron = new OMNITRON.custom({
    cwd: __dirname + '/../fixtures',
  });

  var omnitron_bus = null;
  var proc1 = null;
  var procs = [];

  after(function (done) {
    omnitron.delete('all', function (err, ret) {
      omnitron.kill(done);
    });
  });

  before(function (done) {
    omnitron.connect(function () {
      omnitron.launchBus(function (err, bus) {
        omnitron_bus = bus;

        omnitron.delete('all', function (err, ret) {
          done();
        });
      });
    });
  });

  /**
   * process.on('message', function(packet) {
   *   process.send({
   *     topic : 'process:msg',
   *     data  : {
   *       success : true
   *     }
   *   });
   * });
   */
  it('should start a script', function (done) {
    omnitron.start(
      {
        script: './send-data-process/return-data.js',
      },
      function (err, data) {
        proc1 = data[0];
        should(err).be.null();
        done();
      }
    );
  });

  it('should receive data packet', function (done) {
    omnitron_bus.on('process:msg', function (packet) {
      omnitron_bus.off('process:msg');
      packet.raw.data.success.should.eql(true);
      packet.raw.topic.should.eql('process:msg');
      packet.process.pm_id.should.eql(proc1.omnitron_env.pm_id);
      packet.process.name.should.eql(proc1.omnitron_env.name);
      done();
    });

    omnitron.sendDataToProcessId(
      proc1.omnitron_env.pm_id,
      {
        topic: 'process:msg',
        data: {
          some: 'data',
          hello: true,
        },
      },
      function (err, res) {
        should(err).be.null();
      }
    );
  });

  it('should receive data packet (other input)', function (done) {
    omnitron_bus.on('process:msg', function (packet) {
      omnitron_bus.off('process:msg');
      packet.raw.data.success.should.eql(true);
      packet.raw.topic.should.eql('process:msg');
      packet.process.pm_id.should.eql(proc1.omnitron_env.pm_id);
      packet.process.name.should.eql(proc1.omnitron_env.name);
      done();
    });

    omnitron.sendDataToProcessId(
      {
        id: proc1.omnitron_env.pm_id,
        topic: 'process:msg',
        data: {
          some: 'data',
          hello: true,
        },
      },
      function (err, res) {
        should(err).be.null();
      }
    );
  });
});
