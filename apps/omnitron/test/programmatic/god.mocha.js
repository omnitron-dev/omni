var OMNITRON = require('../..').default;
var God = require('../../dist/god').default;
var fs = require('fs');
var should = require('should');
var { Common } = require('../../dist/common');
var eachLimit = require('async/eachLimit');

var cst = require('../../dist/constants').default;

// Change to current folder
process.chdir(__dirname);

var omnitron = new OMNITRON.custom();

/**
 * Description
 * @method getConf
 * @return AssignmentExpression
 */
function getConf() {
  var a = Common.prepareAppConf(
    { cwd: process.cwd() },
    {
      script: '../fixtures/echo.js',
      name: 'echo',
      instances: 2,
    }
  );
  return a;
}

function getConf2() {
  return Common.prepareAppConf(
    { cwd: process.cwd() },
    {
      script: '../fixtures/echo2.js',
      instances: 4,
      exec_mode: 'cluster_mode',
      name: 'child',
    }
  );
}

function getConf3() {
  return Common.prepareAppConf(
    { cwd: process.cwd() },
    {
      script: '../fixtures/echo3.js',
      instances: 10,
      exec_mode: 'cluster_mode',
      name: 'child',
    }
  );
}

function getConf4() {
  return Common.prepareAppConf(
    { cwd: process.cwd() },
    {
      script: '../fixtures/args.js',
      args: ['-d', '-a'],
      instances: '1',
      name: 'child',
    }
  );
}

function deleteAll(data, cb) {
  var processes = God.getFormatedProcesses();

  eachLimit(
    processes,
    cst.CONCURRENT_ACTIONS,
    function (proc, next) {
      console.log('Deleting process %s', proc.omnitron_env.pm_id);
      God.deleteProcessId(proc.omnitron_env.pm_id, function () {
        return next();
      });
      return false;
    },
    function (err) {
      if (err) return cb(God.logAndGenerateError(err), {});

      God.clusters_db = null;
      God.clusters_db = {};
      return cb(null, []);
    }
  );
}

describe('God', function () {
  before(function (done) {
    omnitron.connect(function () {
      deleteAll({}, function (err, dt) {
        done();
      });
    });
  });

  it('should have right properties', function () {
    God.should.have.property('configuration');
    God.should.have.property('prepare');
    God.should.have.property('ping');
    God.should.have.property('dumpProcessList');
    God.should.have.property('getProcesses');
    God.should.have.property('getMonitorData');
    God.should.have.property('getFormatedProcesses');
    God.should.have.property('checkProcess');
    God.should.have.property('reloadLogs');
    God.should.have.property('stopProcessId');
    God.should.have.property('sendSignalToProcessId');
    God.should.have.property('sendSignalToProcessName');
  });

  describe('One process', function () {
    var proc, pid;

    it('should fork one process', function (done) {
      God.prepare(getConf(), function (err, procs) {
        should(err).be.null();
        procs[0].omnitron_env.status.should.be.equal('online');
        var a = God.getFormatedProcesses();
        God.getFormatedProcesses().length.should.equal(2);
        done();
      });
    });
  });

  describe('Process State Machine', function () {
    var clu, pid;

    before(function (done) {
      deleteAll({}, function (err, dt) {
        done();
      });
    });
    it('should start a process', function (done) {
      God.prepare(getConf(), function (err, procs) {
        clu = procs[0];

        pid = clu.pid;
        procs[0].omnitron_env.status.should.be.equal('online');
        done();
      });
    });

    it('should stop a process and keep in database on state stopped', function (done) {
      God.stopProcessId(clu.omnitron_env.pm_id, function (err, proc) {
        proc.omnitron_env.status.should.be.equal('stopped');
        God.checkProcess(proc.pid).should.be.equal(false);
        done();
      });
    });

    it('should restart the same process and set it as state online and be up', function (done) {
      God.restartProcessId({ id: clu.omnitron_env.pm_id }, function (err, dt) {
        var proc = God.findProcessById(clu.omnitron_env.pm_id);
        proc.omnitron_env.status.should.be.equal('online');
        God.checkProcess(proc.process.pid).should.be.equal(true);
        done();
      });
    });

    it('should stop and delete a process id', function (done) {
      var old_pid = clu.pid;
      God.deleteProcessId(clu.omnitron_env.pm_id, function (err, dt) {
        var proc = God.findProcessById(clu.omnitron_env.pm_id);
        God.checkProcess(old_pid).should.be.equal(false);
        God.getFormatedProcesses().length.should.be.equal(1);
        done();
      });
    });
  });

  describe('Reload - cluster', function () {
    before(function (done) {
      deleteAll({}, function (err, dt) {
        done();
      });
    });

    it('should launch app', function (done) {
      God.prepare(getConf2(), function (err, procs) {
        var processes = God.getFormatedProcesses();

        setTimeout(function () {
          processes.length.should.equal(4);
          processes.forEach(function (proc) {
            proc.omnitron_env.restart_time.should.eql(0);
          });
          done();
        }, 100);
      });
    });
  });

  describe('Multi launching', function () {
    before(function (done) {
      deleteAll({}, function (err, dt) {
        done();
      });
    });

    afterEach(function (done) {
      deleteAll({}, function (err, dt) {
        done();
      });
    });

    it('should launch multiple processes depending on CPUs available', function (done) {
      God.prepare(
        Common.prepareAppConf(
          { cwd: process.cwd() },
          {
            script: '../fixtures/echo.js',
            name: 'child',
            instances: 3,
          }
        ),
        function (err, procs) {
          God.getFormatedProcesses().length.should.equal(3);
          procs.length.should.equal(3);
          done();
        }
      );
    });

    it('should start maximum processes depending on CPU numbers', function (done) {
      God.prepare(getConf3(), function (err, procs) {
        God.getFormatedProcesses().length.should.equal(10);
        procs.length.should.equal(10);
        done();
      });
    });

    it('should dump process list', function (done) {
      God.prepare(
        Common.prepareAppConf(
          { cwd: process.cwd() },
          {
            script: '../fixtures/echo.js',
            name: 'child',
            instances: 3,
          }
        ),
        function (err, procs) {
          God.getFormatedProcesses().length.should.equal(3);
          procs.length.should.equal(3);

          God.dumpProcessList(function (err) {
            should(err).be.null();
            var apps = fs.readFileSync(cst.DUMP_FILE_PATH);
            apps = JSON.parse(apps);
            apps.length.should.equal(3);
            done();
          });
        }
      );
    });

    it('should handle arguments', function (done) {
      God.prepare(getConf4(), function (err, procs) {
        setTimeout(function () {
          God.getFormatedProcesses()[0].omnitron_env.restart_time.should.eql(0);
          done();
        }, 500);
      });
    });
  });

  it('should report omnitron version', function (done) {
    God.getVersion({}, function (err, version) {
      version.should.not.be.null();
      done();
    });
  });

  it('should get monitor data', function (done) {
    var f = require('child_process').fork('../fixtures/echo.js');

    var processes = [
      // stopped status
      {
        omnitron_env: { status: cst.STOPPED_STATUS },
      },
      // axm pid
      {
        omnitron_env: {
          status: cst.ONLINE_STATUS,
          axm_options: { pid: process.pid },
        },
      },
      // axm pid is NaN
      {
        omnitron_env: {
          status: cst.ONLINE_STATUS,
          axm_options: { pid: 'notanumber' },
        },
      },
      {
        omnitron_env: {
          status: cst.ONLINE_STATUS,
        },
        pid: f.pid,
      },
    ];

    // mock
    var g = {
      getFormatedProcesses: function () {
        return processes;
      },
    };

    require('../../dist/god/action-methods').default(g);

    g.getMonitorData({}, function (err, procs) {
      should(err).be.null();
      procs.length.should.be.equal(processes.length);
      procs[0].monit.should.be.deepEqual({ memory: 0, cpu: 0 });
      procs[1].monit.memory.should.be.greaterThan(0);
      procs[2].monit.should.be.deepEqual({ memory: 0, cpu: 0 });
      procs[3].monit.memory.should.be.greaterThan(0);
      f.kill();
      done();
    });
  });
});
