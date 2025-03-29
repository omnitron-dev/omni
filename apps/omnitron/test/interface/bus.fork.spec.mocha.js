const OMNITRON = require('../..').default;
const should = require('should');
const Plan = require('../helpers/plan.js');

var PROCESS_ARCH = Object.keys({
  pm_id: 0,
  name: 'app',
  // server: 'server name' - attached in interactor
});

var PROCESS_EVENT = Object.keys({
  event: 'process event name',
  manually: true,
  process: PROCESS_ARCH,
  at: new Date(),
});

var LOG_EVENT = Object.keys({
  data: 'string',
  process: PROCESS_ARCH,
  at: new Date(),
});

var ERROR_EVENT = Object.keys({
  at: new Date(),
  data: {
    stack: '\n',
    message: 'error',
  },
  process: PROCESS_ARCH,
});

var HUMAN_EVENT = Object.keys({
  at: new Date(),
  process: PROCESS_ARCH,
  data: {
    __name: 'event:name',
  },
});

var TRANSACTION_HTTP_EVENT = Object.keys({
  data: {
    url: '/user/root',
    method: 'POST',
    time: 234,
    code: 200,
  },
  at: new Date(),
  process: PROCESS_ARCH,
});

process.on('uncaughtException', function (e) {
  console.log(e.stack);
  process.exit(1);
});

describe('OMNITRON BUS / RPC', function () {
  var omnitron = new OMNITRON.custom({
    cwd: __dirname + '/../fixtures/interface',
  });
  var omnitron_bus;

  after(function (done) {
    omnitron.delete('all', () => done());
  });

  before(function (done) {
    omnitron.connect(function () {
      omnitron.launchBus(function (err, bus) {
        omnitron_bus = bus;
        setTimeout(done, 1000);
      });
    });
  });

  describe('Events', function () {
    afterEach(function (done) {
      omnitron_bus.off('*');

      omnitron.delete('all', function (err, ret) {
        done();
      });
    });

    it('should (process:event) when start process get online event and start event with right properties', function (done) {
      var plan = new Plan(2, done);

      omnitron_bus.on('*', function (event, data) {
        if (event == 'process:event') {
          event.should.eql('process:event');
          data.should.have.properties(PROCESS_EVENT);
          data.process.should.have.properties(PROCESS_ARCH);
          plan.ok(true);
        }
      });

      omnitron.start('./child.js', {}, function (err, data) {
        should(err).be.null();
      });
    });

    it('should (log:out log:err)', function (done) {
      var plan = new Plan(2, done);

      omnitron_bus.on('*', function (event, data) {
        if (event == 'log:out') {
          event.should.eql('log:out');

          data.should.have.properties(LOG_EVENT);
          plan.ok(true);
        }
        if (event == 'log:err') {
          event.should.eql('log:err');

          data.should.have.properties(LOG_EVENT);
          plan.ok(true);
        }
      });

      omnitron.start('./log_out.js', {}, function (err, data) {
        should(err).be.null();
      });
    });

    it('should (process:exception)', function (done) {
      var plan = new Plan(1, done);

      omnitron_bus.on('*', function (event, data) {
        if (event == 'process:exception') {
          data.should.have.properties(ERROR_EVENT);
          data.process.should.have.properties(PROCESS_ARCH);
          plan.ok('true');
        }
      });

      omnitron.start('./process_exception.js', {}, function (err, data) {
        should(err).be.null();
      });
    });

    it('should (human:event)', function (done) {
      omnitron_bus.on('*', function (event, data) {
        if (event == 'human:event') {
          data.should.have.properties(HUMAN_EVENT);
          data.process.should.have.properties(PROCESS_ARCH);
          return done();
        }
      });

      omnitron.start('./human_event.js', {}, function (err, data) {
        should(err).be.null();
      });
    });

    it('should (process:exception) with promise', function (done) {
      var plan = new Plan(1, done);

      omnitron_bus.on('*', function (event, data) {
        console.log(event);
        if (event == 'process:exception') {
          data.should.have.properties(ERROR_EVENT);
          data.process.should.have.properties(PROCESS_ARCH);
          plan.ok(true);
        }
      });

      omnitron.start('./promise_rejection.js', {}, function (err, data) {
        should(err).be.null();
      });
    });
  });
});
