const p = require('path');

const UxHelpers = require('./helpers');

/**
 * Minimal display via omnitron ls -m
 * @method miniDisplay
 * @param {Object} list process list
 */
module.exports = function (list) {
  list.forEach(function (l) {
    var mode = l.omnitron_env.exec_mode.split('_mode')[0];
    var status = l.omnitron_env.status;
    var key = l.omnitron_env.name || p.basename(l.omnitron_env.pm_exec_path.script);

    console.log('+--- %s', key);
    console.log('namespace : %s', l.omnitron_env.namespace);
    console.log('version : %s', l.omnitron_env.version);
    console.log('pid : %s', l.pid);
    console.log('omnitron id : %s', l.omnitron_env.pm_id);
    console.log('status : %s', status);
    console.log('mode : %s', mode);
    console.log('restarted : %d', l.omnitron_env.restart_time ? l.omnitron_env.restart_time : 0);
    console.log(
      'uptime : %s',
      l.omnitron_env.pm_uptime && status == 'online' ? UxHelpers.timeSince(l.omnitron_env.pm_uptime) : 0
    );
    console.log('memory usage : %s', l.monit ? UxHelpers.bytesToSize(l.monit.memory, 1) : '');
    console.log('error log : %s', l.omnitron_env.pm_err_log_path);
    console.log('watching : %s', l.omnitron_env.watch ? 'yes' : 'no');
    console.log('PID file : %s\n', l.omnitron_env.pm_pid_path);
  });
};
