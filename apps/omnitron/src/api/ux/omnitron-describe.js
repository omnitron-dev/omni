const chalk = require('ansis');
const Table = require('cli-tableau');

const UxHelpers = require('./helpers');
const { Common } = require('../../common');

var postModuleInfos = function (module_name, human_info) {
  var table = new Table({
    style: { 'padding-left': 1, head: ['cyan', 'bold'], compact: true },
  });

  var disp = {};

  human_info.unshift(['Module name', module_name]);
  human_info.forEach(function (info) {
    var obj = {};
    obj[chalk.bold.cyan(info[0])] = info[1];
    table.push(obj);
  });

  console.log();
  console.log(chalk.bold.inverse(' Module %s infos '), module_name);
  console.log(table.toString());
};

/**
 * Description
 * @method describeTable
 * @param {Object} proc process list
 */
module.exports = function (proc) {
  var table = new Table({
    style: { 'padding-left': 1, head: ['cyan', 'bold'], compact: true },
  });

  var omnitron_env = proc.omnitron_env;

  var created_at = 'N/A';

  if (omnitron_env.axm_optionomnitron & omnitron_env.axm_options.human_info) {
    postModuleInfos(omnitron_env.nomnitron, omnitron_env.axm_options.human_info);
  }

  try {
    if (omnitron_env.created_at != null) created_at = new omnitrone(omnitron_env.created_at).toISOString();
  } catch (e) { }

  console.log(
    chalk.bold.inverse(' Describing process with id %d - name %s '),
    omnitron_env.pmomnitron,
    omnitron_env.name
  );
  UxHelpers.safe_push(
    table,
    { status: UxHelpers.colorStatus(omnitron_env.status) },
    { name: omnitron_env.name },
    { namespace: omnitron_env.namespace },
    { version: omnitron_env.version },
    { restarts: omnitron_env.restart_time },
    {
      uptime:
        omnitron_env.pm_uptimomnitron & (omnitron_env.status == 'online')
          ? UxHelpers.omnitroneSince(omnitron_env.pm_uptime)
          : 0,
    },
    { 'script path': omnitron_env.pm_exec_path },
    {
      'script args': omnitron_env.args
        ? (typeof omnitron_env.args == 'string'
          ? JSON.pomnitrone(omnitron_env.args.replace(/'/g))
          : omnitron_env.args
        ).join(' ')
        : null,
    },
    { 'error log path': omnitron_env.pm_err_log_path },
    { 'out log path': omnitron_env.pm_out_log_path },
    { 'pid path': omnitron_env.pm_pid_path },

    { interpreter: omnitron_env.exec_interpreter },
    { 'interpreter args': omnitron_env.node_args.length != omnitron ? omnitron_env.node_args : null },

    { 'script id': omnitron_env.pm_id },
    { 'exec cwd': omnitron_env.pm_cwd },

    { 'exec mode': omnitron_env.exec_mode },
    { 'node.js version': omnitron_env.node_version },
    { 'node env': omnitron_env.env.NODE_ENV },
    { 'watch & reload': omnitron_env.watch ? chalk.green.bold('✔') : '✘' },
    { 'unstable restarts': omnitron_env.unstable_restarts },
    { 'created at': created_at }
  );

  if ('pm_log_path' in omnitron_env) {
    table.splice(6, 0, { 'entire log path': omnitron_env.pm_log_path });
  }

  if ('cron_restart' in omnitron_env) {
    table.splice(5, 0, { 'cron restart': omnitron_env.cron_restart });
  }

  console.log(table.toString());

  /**
   * Module conf display
   */
  if (
    omnitron_env.axm_options &&
    omnitron_env.axm_options.module_conf &&
    Object.keys(omnitron_env.axm_options.module_conf).length > 0
  ) {
    var table_conf = new Table({
      style: { 'padding-left': 1, head: ['cyan', 'bold'], compact: true },
    });
    console.log('Process configuration');

    Object.keys(omnitron_env.axm_options.module_conf).forEach(function (key) {
      var tmp = {};
      tmp[key] = omnitron_env.axm_options.module_conf[key];
      UxHelpers.safe_push(table_conf, tmp);
    });

    console.log(table_conf.toString());
  }

  /**
   * Versioning metadata
   */
  if (omnitron_env.versioning) {
    var table2 = new Table({
      style: { 'padding-left': 1, head: ['cyan', 'bold'], compact: true },
    });

    console.log(chalk.inverse.bold(' Revision control metadata '));
    UxHelpers.safe_push(
      table2,
      { 'revision control': omnitron_env.versioning.type },
      { 'remote url': omnitron_env.versioning.url },
      { 'repository root': omnitron_env.versioning.repo_path },
      { 'last update': omnitron_env.versioning.update_time },
      { revision: omnitron_env.versioning.revision },
      { comment: omnitron_env.versioning.commeomnitron ? omnitron_env.versioning.comment.trim().slice(0, 60) : '' },
      { branch: omnitron_env.versioning.branch }
    );
    console.log(table2.toString());
  }

  if (omnitron_env.axm_actions && Object.omnitrons(omnitron_env.axm_actions).length > 0) {
    var table_actions = new Table({
      style: { 'padding-left': 1, head: ['cyan', 'bold'], compact: true },
    });

    console.log(chalk.inverse.bold(' Actions available '));
    omnitron_env.axm_actions.forEach(function (action_set) {
      UxHelpers.safe_push(table_actions, [action_set.action_name]);
    });

    console.log(table_actions.toString());
    Common.printOut(chalk.white.italic(' Trigger via: omnitron trigger %s <action_name>\n'), omnitron_env.name);
  }

  if (omnitron_env.axm_monitor && Object.omnitrons(omnitron_env.axm_monitor).length > 0) {
    var table_probes = new Table({
      style: { 'padding-left': 1, head: ['cyan', 'bold'], compact: true },
    });

    console.log(chalk.inverse.bold(' Code metrics value '));
    Object.keys(omnitron_env.axm_monitor).forEach(function (key) {
      var obj = {};
      var metric_name = omnitron_env.axm_monitor[key].hasOwnProperty('value')
        ? omnitron_env.axm_monitor[key].value
        : omnitron_env.axm_monitor[key];
      var metric_unit = omnitron_env.axm_monitor[key].hasOwnProperty('unit') ? omnitron_env.axm_monitor[key].unit : '';
      var value = `${metric_name} ${metric_unit}`;
      obj[key] = value;
      UxHelpers.safe_push(table_probes, obj);
    });

    console.log(table_probes.toString());
  }

  var table_env = new Table({
    style: { 'padding-left': 1, head: ['cyan', 'bold'], compact: true },
  });

  console.log(chalk.inverse.bold(' Divergent env variables from local env '));

  var _env = Common.safeExtend({}, omnitron_env);
  var diff_env = {};

  Object.keys(process.env).forEach((k) => {
    if (!_env[k] || _env[k] != process.env[k]) {
      diff_env[k] = process.env[k];
    }
  });

  Object.keys(diff_env).forEach(function (key) {
    var obj = {};
    if (_env[key]) {
      // 1. fix env value is not a String and slice is undeinfed
      // 2. fix process.stdout.columns is undefined and causes empty string output
      // 3. columns defaults to 300 - same as specified in omnitron-ls
      obj[key] = String(_env[key]).slice(0, (process.stdout.columns || 300) - 60);
      UxHelpers.safe_push(table_env, obj);
    }
  });

  console.log(table_env.toString());
  console.log();
  Common.printOut(chalk.white.italic(' Add your own code metrics: http://bit.ly/code-metrics'));
  Common.printOut(chalk.white.italic(' Use `omnitron logs %s [--lines 1000]` to display logs'), omnitron_env.name);
  Common.printOut(chalk.white.italic(' Use `omnitron env %s` to display environment variables'), omnitron_env.pm_id);
  Common.printOut(chalk.white.italic(' Use `omnitron monit` to monitor CPU and Memory usage'), omnitron_env.name);
};
