'use strict';

const os = require('os');

const constants = require('../constants');
const pkg = require('../../../package.json');

const hostname = os.hostname();
const platform = os.platform();
const username =
  process.env.SUDO_USER ||
  process.env.C9_USER ||
  process.env.LOGNAME ||
  process.env.USER ||
  process.env.LNAME ||
  process.env.USERNAME;

module.exports = class DataRetriever {
  /**
   * Normalize each process metdata
   * @param {Object} processes process list extracted from omnitron daemon
   * @param {Object} conf interactor configuration
   */
  static status(processes, conf) {
    processes = processes || [];
    const formattedProcs = processes
      .filter((proc) => !proc.omnitron_env.name.match(/_old_/))
      .map((proc) =>
        // proc.omnitron_env.axm_actions = proc.omnitron_env.axm_actions.concat(conf.OMNITRON_REMOTE_METHOD_ALLOWED.map(method => {
        //   return {action_name: method, action_type: 'internal'}
        // }))

        ({
          pid: proc.pid,
          name: proc.omnitron_env.name,
          interpreter: proc.omnitron_env.exec_interpreter,
          args: proc.omnitron_env.node_args,
          path: proc.omnitron_env.pm_exec_path,
          restart_time: proc.omnitron_env.restart_time,
          created_at: proc.omnitron_env.created_at,
          exec_mode: proc.omnitron_env.exec_mode,
          pm_uptime: proc.omnitron_env.pm_uptime,
          status: proc.omnitron_env.status,
          pm_id: proc.omnitron_env.pm_id,
          unique_id: proc.omnitron_env.unique_id,

          cpu: Math.floor(proc.monit.cpu) || 0,
          memory: Math.floor(proc.monit.memory) || 0,

          versioning: proc.omnitron_env.versioning || null,

          node_env: proc.omnitron_env.NODE_ENV || null,

          axm_actions: proc.omnitron_env.axm_actions || [],
          axm_monitor: proc.omnitron_env.axm_monitor || {},
          //axm_options: proc.omnitron_env.axm_options || {},
          axm_options: {},
          axm_dynamic: proc.omnitron_env.dynamic || {},
        })
      );

    return {
      process: formattedProcs,
      server: {
        username,
        hostname,
        uptime: os.uptime(),
        platform,
        omnitron_version: conf.OMNITRON_VERSION,
        omnitron_agent_version: pkg.version,
        node_version: process.version,
        unique_id: constants.UNIQUE_SERVER_ID,
        //loadavg: os.loadavg(),
        //total_mem: os.totalmem(),
        //free_mem: os.freemem(),
        //cpu: cpuMeta,
        //type: os.type(),
        //interaction: conf.REVERSE_INTERACT,
      },
    };
  }
};
