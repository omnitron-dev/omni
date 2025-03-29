const path = require('path');

const APPS = {};

/**
 * Description
 * @method forkOMNITRON
 * @return omnitron
 */
APPS.forkOMNITRON = function (cb) {
  const omnitron = require('child_process').fork('lib/Satan.js', [], {
    env: process.env,
    silent: process.env.DEBUG ? false : true,
  });

  omnitron.unref();

  omnitron.on('message', function () {
    return cb(null, omnitron);
  });
};

APPS.startSomeApps = function (omnitron, cb) {
  omnitron.start(
    {
      script: './events/custom_action.js',
      name: 'custom-action',
    },
    cb
  );
};

/**
 * Description
 * @method launchApp
 * @param {} iomnitron
 * @param {} script
 * @param {} name
 * @param {} cb
 * @return
 */
APPS.launchApp = function (iomnitron, script, name, cb) {
  iomnitron.rpc.prepare(
    {
      pm_exec_path: path.resolve(process.cwd(), 'test/fixtures/' + script),
      pm_err_log_path: path.resolve(process.cwd(), 'test/' + name + 'err.log'),
      pm_out_log_path: path.resolve(process.cwd(), 'test/' + name + '.log'),
      pm_pid_path: path.resolve(process.cwd(), 'test/child'),
      exec_mode: 'cluster_mode',
      name: name,
    },
    cb
  );
};

/**
 * Description
 * @method launchAppFork
 * @param {} iomnitron
 * @param {} script
 * @param {} name
 * @param {} cb
 * @return
 */
APPS.launchAppFork = function (iomnitron, script, name, cb) {
  iomnitron.rpc.prepare(
    {
      pm_exec_path: path.resolve(process.cwd(), 'test/fixtures/' + script),
      pm_err_log_path: path.resolve(process.cwd(), 'test/errLogasdasd.log'),
      pm_out_log_path: path.resolve(process.cwd(), 'test/outLogasdasd.log'),
      pm_pid_path: path.resolve(process.cwd(), 'test/child'),
      exec_mode: 'fork_mode',
      name: name,
    },
    cb
  );
};

module.exports = APPS;
