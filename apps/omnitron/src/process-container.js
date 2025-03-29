/**`
 * This file wrap target application
 * - redirect stdin, stderr to bus + log files
 * - rename process
 * - pid
 */

const p = require('path');
const cst = require('./constants').default;
const fs = require('fs');
const Url = require('url');

const Utility = require('./utility');
const ProcessUtils = require('./process-utils');

// Load all env-vars from master.
var omnitron_env = JSON.parse(process.env.omnitron_env);
for (var k in omnitron_env) {
  process.env[k] = omnitron_env[k];
}

// Rename process
process.title = process.env.PROCESS_TITLE || 'node ' + omnitron_env.pm_exec_path;

delete process.env.omnitron_env;

/**
 * Main entrance to wrap the desired code
 */
(function ProcessContainer() {
  ProcessUtils.injectModules();

  var stdFile = omnitron_env.pm_log_path;
  var outFile = omnitron_env.pm_out_log_path;
  var errFile = omnitron_env.pm_err_log_path;
  var pidFile = omnitron_env.pm_pid_path;
  var script = omnitron_env.pm_exec_path;

  var original_send = process.send;

  if (typeof process.env.source_map_support != 'undefined' && process.env.source_map_support !== 'false') {
    require('source-map-support').install();
  }

  process.send = function () {
    if (process.connected) original_send.apply(this, arguments);
  };

  //send node version
  if (process.versions && process.versions.node) {
    process.send({
      node_version: process.versions.node,
    });
  }

  if (cst.MODIFY_REQUIRE) require.main.filename = omnitron_env.pm_exec_path;

  // Resets global paths for require()
  require('module')._initPaths();

  try {
    var pid = process.pid;
    if (typeof pid !== 'undefined') fs.writeFileSync(pidFile, process.pid.toString());
  } catch (e) {
    console.error(e.stack || e);
  }

  // Add args to process if args specified on start
  if (process.env.args != null) process.argv = process.argv.concat(omnitron_env.args);

  // stdio, including: out, err and entire (both out and err if necessary).
  var stds = {
    out: outFile,
    err: errFile,
  };
  stdFile && (stds.std = stdFile);

  // uid/gid management
  if (omnitron_env.uid || omnitron_env.gid) {
    try {
      if (process.env.gid) process.setgid(omnitron_env.gid);
      if (omnitron_env.uid) process.setuid(omnitron_env.uid);
    } catch (e) {
      setTimeout(function () {
        console.error('%s on call %s', e.message, e.syscall);
        console.error('%s is not accessible', omnitron_env.uid);
        return process.exit(1);
      }, 100);
    }
  }

  exec(script, stds);
})();

/**
 * Description
 * @method exec
 * @param {} script
 * @param {} stds
 * @return
 */
function exec(script, stds) {
  if (p.extname(script) == '.ts' || p.extname(script) == '.tsx') {
    try {
      require('ts-node/register');
    } catch (e) {
      console.error('Failed to load Typescript interpreter:', e.message || e);
    }
  }

  process.on('message', function (msg) {
    if (msg.type === 'log:reload') {
      for (var k in stds) {
        if (typeof stds[k] == 'object' && !isNaN(stds[k].fd)) {
          if (stds[k].destroy) stds[k].destroy();
          else if (stds[k].end) stds[k].end();
          else if (stds[k].close) stds[k].close();
          stds[k] = stds[k]._file;
        }
      }
      Utility.startLogging(stds, function (err) {
        if (err) return console.error('Failed to reload logs:', err.stack);
        console.log('Reloading log...');
      });
    }
  });

  var dayjs = null;

  if (omnitron_env.log_date_format) dayjs = require('dayjs');

  Utility.startLogging(stds, function (err) {
    if (err) {
      process.send({
        type: 'process:exception',
        data: {
          message: err.message,
          syscall: 'ProcessContainer.startLogging',
        },
      });
      throw err;
      return;
    }

    process.stderr.write = (function (write) {
      return function (string, encoding, cb) {
        var log_data = null;

        // Disable logs if specified
        if (omnitron_env.disable_logs === true) {
          return cb ? cb() : false;
        }

        if (omnitron_env.log_type && omnitron_env.log_type === 'json') {
          log_data =
            JSON.stringify({
              message: string.toString(),
              timestamp:
                omnitron_env.log_date_format && dayjs
                  ? dayjs().format(omnitron_env.log_date_format)
                  : new Date().toISOString(),
              type: 'err',
              process_id: omnitron_env.pm_id,
              app_name: omnitron_env.name,
            }) + '\n';
        } else if (omnitron_env.log_date_format && dayjs)
          log_data = `${dayjs().format(omnitron_env.log_date_format)}: ${string.toString()}`;
        else log_data = string.toString();

        process.send({
          type: 'log:err',
          topic: 'log:err',
          data: log_data,
        });

        if (
          Utility.checkPathIsNull(omnitron_env.pm_err_log_path) &&
          (!omnitron_env.pm_log_path || Utility.checkPathIsNull(omnitron_env.pm_log_path))
        )
          return cb ? cb() : false;

        stds.std && stds.std.write && stds.std.write(log_data, encoding);
        stds.err && stds.err.write && stds.err.write(log_data, encoding, cb);
      };
    })(process.stderr.write);

    process.stdout.write = (function (write) {
      return function (string, encoding, cb) {
        var log_data = null;

        // Disable logs if specified
        if (omnitron_env.disable_logs === true) {
          return cb ? cb() : false;
        }

        if (omnitron_env.log_type && omnitron_env.log_type === 'json') {
          log_data =
            JSON.stringify({
              message: string.toString(),
              timestamp:
                omnitron_env.log_date_format && dayjs
                  ? dayjs().format(omnitron_env.log_date_format)
                  : new Date().toISOString(),
              type: 'out',
              process_id: omnitron_env.pm_id,
              app_name: omnitron_env.name,
            }) + '\n';
        } else if (omnitron_env.log_date_format && dayjs)
          log_data = `${dayjs().format(omnitron_env.log_date_format)}: ${string.toString()}`;
        else log_data = string.toString();

        process.send({
          type: 'log:out',
          data: log_data,
        });

        if (
          Utility.checkPathIsNull(omnitron_env.pm_out_log_path) &&
          (!omnitron_env.pm_log_path || Utility.checkPathIsNull(omnitron_env.pm_log_path))
        )
          return cb ? cb() : null;

        stds.std && stds.std.write && stds.std.write(log_data, encoding);
        stds.out && stds.out.write && stds.out.write(log_data, encoding, cb);
      };
    })(process.stdout.write);

    function getUncaughtExceptionListener(listener) {
      return function uncaughtListener(err) {
        var error = err && err.stack ? err.stack : err;

        if (listener === 'unhandledRejection') {
          error =
            'You have triggered an unhandledRejection, you may have forgotten to catch a Promise rejection:\n' + error;
        }

        logError(['std', 'err'], error);

        // Notify master that an uncaughtException has been catched
        try {
          if (err) {
            var errObj = {};

            Object.getOwnPropertyNames(err).forEach(function (key) {
              errObj[key] = err[key];
            });
          }

          process.send({
            type: 'log:err',
            topic: 'log:err',
            data: '\n' + error + '\n',
          });
          process.send({
            type: 'process:exception',
            data: errObj !== undefined ? errObj : { message: 'No error but ' + listener + ' was caught!' },
          });
        } catch (e) {
          logError(['std', 'err'], "Channel is already closed can't broadcast error:\n" + e.stack);
        }

        if (
          !process.listeners(listener).filter(function (listener) {
            return listener !== uncaughtListener;
          }).length
        ) {
          if (listener == 'uncaughtException') {
            process.emit('disconnect');
            process.exit(cst.CODE_UNCAUGHTEXCEPTION);
          }
        }
      };
    }

    process.on('uncaughtException', getUncaughtExceptionListener('uncaughtException'));
    process.on('unhandledRejection', getUncaughtExceptionListener('unhandledRejection'));

    // Change dir to fix process.cwd
    process.chdir(omnitron_env.pm_cwd || process.env.PWD || p.dirname(script));

    if (ProcessUtils.isESModule(script) === true) import(Url.pathToFileURL(process.env.pm_exec_path));
    else {
      if (cst.IS_BUN) {
        require(script);
      } else {
        require('module')._load(script, null, true);
      }
    }

    function logError(types, error) {
      try {
        types.forEach(function (type) {
          stds[type] && typeof stds[type].write == 'function' && stds[type].write(error + '\n');
        });
      } catch (e) {}
    }
  });
}
