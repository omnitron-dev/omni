var should = require('should');
var p = require('path');
var fs = require('fs');
var EventEmitter = require('events').EventEmitter;
var OMNITRON = require('../..').default;
var extend = require('util')._extend;

var cwd = __dirname + '/../fixtures/watcher';

var paths = {
  server: p.join(cwd, 'server-watch.js'),
  bak: p.join(cwd, 'server-watch.bak.js'),
  json: p.join(cwd, 'server-watch.json'),
};

var ee = new EventEmitter();

var json = {
  name: 'server-watch',
  script: './server-watch.js',
  cwd: cwd,
};

function testOMNITRONEnv(event) {
  return function (obj, cb) {
    ee.once(event, function (e) {
      if (typeof obj == 'function') {
        return obj(e);
      }

      var value;

      for (var key in obj) {
        value = obj[key];
        console.log('Testing %s for value %s', key, value);
        should(e[key]).eql(value);
      }

      return cb();
    });
  };
}

function errShouldBeNull(err) {
  should(err).be.null();
}

describe('Watcher', function () {
  var omnitron = new OMNITRON.custom({
    cwd: __dirname + '/../fixtures/watcher',
  });

  after(function (cb) {
    omnitron.destroy(function () {
      fs.unlink(paths.server, cb);
    });
  });

  before(function (cb) {
    //copy server-watch.bak, we'll add some lines in it
    fs.readFile(paths.bak, function (err, data) {
      if (err) {
        return cb(err);
      }

      return fs.writeFile(paths.server, data, cb);
    });
  });

  before(function (done) {
    omnitron.connect(function () {
      done();
    });
  });

  before(function (done) {
    omnitron.launchBus(function (err, bus) {
      should(err).be.null;

      bus.on('process:event', function (e) {
        var name = e.process.name + ':' + e.event;
        console.log('Bus receiving: ' + name);
        delete e.process.ENV;
        ee.emit(name, e.process);
      });

      return done();
    });
  });

  it('should be watching', function (cb) {
    testOMNITRONEnv('server-watch:online')({ watch: true }, cb);

    var json_app = extend(json, { watch: true });
    omnitron.start(json_app, errShouldBeNull);
  });

  it('should be watching after restart', function (cb) {
    testOMNITRONEnv('server-watch:online')({ watch: true }, cb);
    omnitron.restart('server-watch', errShouldBeNull);
  });

  it('should restart because of file edit', function (cb) {
    testOMNITRONEnv('server-watch:online')({ restart_time: 2 }, cb);
    fs.appendFileSync(paths.server, 'console.log("edit")');
  });

  it('should stop watching', function (cb) {
    process.argv.push('--watch');
    testOMNITRONEnv('server-watch:stop')({ watch: false }, function () {
      process.argv.splice(process.argv.indexOf('--watch'), 1);
      cb();
    });
    omnitron.stop('server-watch', errShouldBeNull);

    // this would be better:
    // omnitron.actionFromJson('stopProcessId', extend(json, {watch: false}), errShouldBeNull)
    // or :
    // omnitron.stop('server-watch', {watch: false}, errShouldBeNull)
  });

  it('should not watch', function (cb) {
    testOMNITRONEnv('server-watch:online')({ watch: false }, cb);
    omnitron.restart(extend(json, { watch: false }), errShouldBeNull);
  });

  it('should watch', function (cb) {
    testOMNITRONEnv('server-watch:online')({ restart_time: 3, watch: true }, cb);
    omnitron.restart(extend(json, { watch: true }), errShouldBeNull);
  });

  it('should delete process', function (cb) {
    omnitron.delete('server-watch', cb);
  });

  it('should watch json', function (cb) {
    testOMNITRONEnv('server-watch:online')(function () {
      cb();
    });

    var json_app = paths.json;
    omnitron.start(json_app, errShouldBeNull);
  });

  it('should restart json from file touch', function (cb) {
    testOMNITRONEnv('server-watch:online')({ restart_time: 1 }, cb);

    var path = p.join(cwd, 'donotwatchme.dir', 'test');

    fs.writeFile(path, 'Test', { flag: 'a+' }, function (err) {
      errShouldBeNull(err);
    });
  });

  it('should restart json from file deletion', function (cb) {
    testOMNITRONEnv('server-watch:online')({ restart_time: 2 }, cb);

    var path = p.join(cwd, 'donotwatchme.dir', 'test');

    fs.unlink(path, function (err) {
      errShouldBeNull(err);
    });
  });

  it('should not restart from ignore_watch', function (cb) {
    var path = p.join(cwd, 'omnitron.log');

    fs.writeFile(path, 'Log', { flag: 'a+' }, function (err) {
      errShouldBeNull(err);

      omnitron.describe('server-watch', function (err, d) {
        should(d[0].omnitron_env.restart_time).eql(2);
        fs.unlinkSync(path);
        return cb();
      });
    });
  });

  it('should work with watch_delay', function (cb) {
    testOMNITRONEnv('server-watch:online')({ watch: true, watch_delay: 4000 }, cb);
    omnitron.start(extend(json, { watch: true, watch_delay: 4000 }), errShouldBeNull);
  });

  it('should not crash with watch_delay without watch', function (cb) {
    testOMNITRONEnv('server-watch:online')({ watch_delay: 4000 }, cb);
    omnitron.start(extend(json, { watch_delay: 4000 }), errShouldBeNull);
  });

  /**
   * Test #1668
   */
  it('should delete from json', function (cb) {
    testOMNITRONEnv('server-watch:exit')(function () {
      cb();
    });

    omnitron.delete(paths.json, errShouldBeNull);
  });
});
