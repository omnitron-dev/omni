const cst = require('../../constants').default;
const chalk = require('ansis');
const Table = require('cli-tableau');

const UxHelpers = require('./helpers');
const { Common } = require('../../common');
const Passwd = require('../../tools/passwd');
const { Configuration } = require('../../configuration');

const CONDENSED_MODE = (process.stdout.columns || 300) < 134;

/**
 * Check if dump file contains same apps that the one managed by OMNITRON
 */
function checkIfProcessAreDumped(list) {
  try {
    var dump_raw = require('fs').readFileSync(cst.DUMP_FILE_PATH);
    var dump = JSON.parse(dump_raw);
    var apps_dumped = dump.map((proc) => proc.name);
    var apps_running = list.filter((proc) => proc.omnitron_env.pmx_module != true).map((proc) => proc.name);
    var diff = apps_dumped.filter((a) => !apps_running.includes(a));
    if (diff.length > 0) {
      Common.warn(
        `Current process list is not synchronized with saved list. App ${chalk.bold(diff.join(' '))} differs. Type 'omnitron save' to synchronize.`
      );
    } else if (apps_dumped.length != apps_running.length) {
      Common.warn(`Current process list is not synchronized with saved list. Type 'omnitron save' to synchronize.`);
    }
  } catch (e) { }
}

var proc_id = 0;

/**
 * List Applications and Modules managed by OMNITRON
 */
function listModulesAndAppsManaged(list, commander) {
  var name_col_size = 11;

  if (list && list.length > 0)
    name_col_size = list.reduce((p, c) => (p.name.length > c.name.length ? p : c)).name.length + 5;

  var id_width = Math.max(2 + (Math.max(...list.map((l) => String(l.omnitron_env.pm_id || 0).length)) || 0), 4);

  var app_head = {
    id: id_width,
    name: name_col_size,
    namespace: 13,
    version: 9,
    mode: 9,
    pid: 10,
    uptime: 8,
    '↺': 6,
    status: 11,
    cpu: 10,
    mem: 10,
    user: 10,
    watching: 10,
  };

  var mod_head = {
    id: id_width,
    module: 30,
    version: 15,
    pid: 10,
    status: 10,
    '↺': 6,
    cpu: 10,
    mem: 10,
    user: 10,
  };

  if (CONDENSED_MODE) {
    app_head = {
      id: id_width,
      name: 20,
      mode: 10,
      '↺': 6,
      status: 11,
      cpu: 10,
      memory: 10,
    };

    mod_head = {
      id: id_width,
      name: 20,
      status: 10,
      cpu: 10,
      mem: 10,
    };
  }

  var app_table = new Table({
    head: Object.keys(app_head),
    colWidths: Object.keys(app_head).map((k) => app_head[k]),
    colAligns: ['left'],
    style: { 'padding-left': 1, head: ['cyan', 'bold'], compact: true },
  });

  var module_table = new Table({
    head: Object.keys(mod_head),
    colWidths: Object.keys(mod_head).map((k) => mod_head[k]),
    colAligns: ['left'],
    style: { 'padding-left': 1, head: ['cyan', 'bold'], compact: true },
  });

  var sortField = 'name',
    sortOrder = 'asc',
    sort,
    fields = {
      name: 'omnitron_env.name',
      namespace: 'omnitron_env.namespace',
      pid: 'pid',
      id: 'pm_id',
      cpu: 'monit.cpu',
      memory: 'monit.memory',
      uptime: 'omnitron_env.pm_uptime',
      status: 'omnitron_env.status',
    };

  if (commander && commander.sort) {
    sort = commander.sort.split(':');

    if (fields[sort[0].toLowerCase()]) {
      sortField = sort[0].toLowerCase();
      sortOrder = sort.length === 2 ? sort[1] : 'asc';
    }
  }

  list.sort(function (a, b) {
    var fieldA = UxHelpers.getNestedProperty(fields[sortField], a);
    var fieldB = UxHelpers.getNestedProperty(fields[sortField], b);

    if (sortOrder === 'desc') {
      if (fieldA > fieldB) return -1;
      if (fieldA < fieldB) return 1;
    } else {
      if (fieldA < fieldB) return -1;
      if (fieldA > fieldB) return 1;
    }
    return 0;
  });

  list.forEach(function (l) {
    var obj = {};

    if (l.omnitron_env.pm_id > proc_id) {
      proc_id = l.omnitron_env.pm_id;
    }

    var mode = l.omnitron_env.exec_mode;
    var status = l.omnitron_env.status;
    var key = l.omnitron_env.pm_id;
    key = chalk.bold.cyan(key);

    if (l.omnitron_env.axm_options) {
      var is_tracing_enabled = false;

      if (
        l.omnitron_env.axm_options.tracing &&
        typeof l.omnitron_env.axm_options.tracing == 'boolean' &&
        l.omnitron_env.axm_options.tracing == true
      )
        is_tracing_enabled = true;

      if (
        l.omnitron_env.axm_options.tracing &&
        l.omnitron_env.axm_options.tracing.enabled &&
        typeof l.omnitron_env.axm_options.tracing.enabled == 'boolean' &&
        l.omnitron_env.axm_options.tracing.enabled == true
      )
        is_tracing_enabled = true;

      if (is_tracing_enabled == true) l.omnitron_env.name = chalk.green('☵') + ' ' + l.omnitron_env.name;

      if (l.omnitron_env._km_monitored) l.omnitron_env.name = chalk.bold.green('◉') + ' ' + l.omnitron_env.name;
    }

    if (l.omnitron_env.pmx_module == true) {
      if (l.omnitron_env.name == 'pm2-sysmonit') return;
      // omnitron ls for Modules
      obj[key] = [];

      obj[key].push(l.name);

      // Module version + PID
      if (!CONDENSED_MODE) {
        var pid = l.omnitron_env.axm_options.pid ? l.omnitron_env.axm_options.pid : l.pid;
        obj[key].push(l.omnitron_env.version || 'N/A', pid);
      }

      // Status
      obj[key].push(UxHelpers.colorStatus(status));

      // Restart
      if (!CONDENSED_MODE) obj[key].push(l.omnitron_env.restart_time ? l.omnitron_env.restart_time : 0);

      // CPU + Memory
      obj[key].push(l.monit ? l.monit.cpu + '%' : 'N/A', l.monit ? UxHelpers.bytesToSize(l.monit.memory, 1) : 'N/A');

      // User
      if (!CONDENSED_MODE) {
        if (l.omnitron_env.uid && typeof l.omnitron_env.uid == 'number') {
          // Resolve user id to username
          let users = Passwd.getUsers();
          Object.keys(users).forEach(function (username) {
            var user = users[username];
            if (user.userId == l.omnitron_env.uid) {
              l.omnitron_env.uid = user.username;
            }
          });
        }
        obj[key].push(chalk.bold(l.omnitron_env.uid || l.omnitron_env.username));
      }

      UxHelpers.safe_push(module_table, obj);
    } else {
      // omnitron ls for Applications
      obj[key] = [];

      // OMNITRON ID
      obj[key].push(l.omnitron_env.name);

      // Namespace
      if (!CONDENSED_MODE) obj[key].push(l.omnitron_env.namespace);

      // Version
      if (!CONDENSED_MODE) obj[key].push(l.omnitron_env.version);

      // Exec mode
      obj[key].push(mode == 'fork_mode' ? chalk.inverse.bold('fork') : chalk.blue.bold('cluster'));

      // PID
      if (!CONDENSED_MODE) obj[key].push(l.pid);

      // Uptime
      if (!CONDENSED_MODE)
        obj[key].push(
          l.omnitron_env.pm_uptime && status == 'online' ? UxHelpers.timeSince(l.omnitron_env.pm_uptime) : 0
        );

      // Restart
      obj[key].push(l.omnitron_env.restart_time ? l.omnitron_env.restart_time : 0);

      // Status
      obj[key].push(UxHelpers.colorStatus(status));

      // CPU
      obj[key].push(l.monit ? l.monit.cpu + '%' : 'N/A');

      // Memory
      obj[key].push(l.monit ? UxHelpers.bytesToSize(l.monit.memory, 1) : 'N/A');

      // User
      if (!CONDENSED_MODE) {
        if (l.omnitron_env.uid && typeof l.omnitron_env.uid == 'number') {
          // Resolve user id to username
          let users = Passwd.getUsers();
          Object.keys(users).forEach(function (username) {
            var user = users[username];
            if (user.userId == l.omnitron_env.uid) {
              l.omnitron_env.uid = user.username;
            }
          });
        }
        obj[key].push(chalk.bold(l.omnitron_env.uid || l.omnitron_env.username));
      }

      // Watch status
      if (!CONDENSED_MODE) obj[key].push(l.omnitron_env.watch ? chalk.green.bold('enabled') : chalk.gray('disabled'));

      UxHelpers.safe_push(app_table, obj);
    }
  });

  // Print Applications Managed
  console.log(app_table.toString());

  // Print Modules Managed
  if (module_table.length > 0) {
    console.log(chalk.bold(`Module${module_table.length > 1 ? 's' : ''}`));
    console.log(module_table.toString());
  }

  proc_id++;
}

// Container display
function containersListing(sys_infos) {
  var stacked_docker = (process.stdout.columns || 100) < 140;

  var docker_head = {
    id: 4,
    image: 50,
    status: 10,
    '↺': 6,
    cpu: 10,
    mem: 10,
    'net I/O ⇵': 11,
    'fs I/O ⇵': 11,
  };

  if (stacked_docker) {
    docker_head = {
      id: 4,
      image: 25,
      status: 10,
      cpu: 10,
      mem: 10,
    };
  }

  var docker_table = new Table({
    colWidths: Object.keys(docker_head).map((k) => docker_head[k]),
    head: Object.keys(docker_head),
    colAligns: ['left'],
    style: { 'padding-left': 1, head: ['cyan', 'bold'], compact: true },
  });

  sys_infos.containers.forEach((c) => {
    var cpu = c.stats.cpu_percent;
    var mem = c.stats.mem_percent == 0 ? '0' : c.stats.mem_percent;
    var id = chalk.bold.cyan(proc_id++);
    var state = UxHelpers.colorStatus(c.state);

    if (stacked_docker) docker_table.push([id, c.image, state, `${cpu}%`, `${mem}mb`]);
    else {
      docker_table.push([
        id,
        c.image,
        state,
        c.restartCount,
        `${cpu == 0 ? '0' : cpu}%`,
        `${mem}mb`,
        `${c.stats.netIO.rx}/${isNaN(c.stats.netIO.tx) == true ? '0.0' : c.stats.netIO.tx}`,
        `${c.stats.blockIO.r}/${c.stats.blockIO.w}`,
      ]);
    }
  });

  console.log(chalk.bold(`Container${sys_infos.containers.length > 1 ? 's' : ''}`));
  console.log(docker_table.toString());
}

/**
 * High resource processes
 */
function listHighResourcesProcesses(sys_infos) {
  const CPU_MIN_SHOW = 60;
  const MEM_MIN_SHOW = 30;

  var sys_proc_head = ['id', 'cmd', 'pid', 'cpu', 'mem', 'uid'];

  var sys_proc_table = new Table({
    colWidths: [4, CONDENSED_MODE ? 29 : 77, 10, 10, 10, 8],
    head: sys_proc_head,
    colAligns: ['left'],
    style: { 'padding-left': 1, head: ['cyan', 'bold'], compact: true },
  });

  sys_infos.processes.cpu_sorted = sys_infos.processes.cpu_sorted.filter(
    (proc) =>
      proc.cpu > CPU_MIN_SHOW && proc.cmd.includes('node') === false && proc.cmd.includes('God Daemon') === false
  );

  sys_infos.processes.cpu_sorted.forEach((proc) => {
    var cpu = `${UxHelpers.colorizedMetric(proc.cpu, 40, 70, '%')}`;
    var mem = `${UxHelpers.colorizedMetric(proc.memory, 40, 70, '%')}`;
    var cmd = proc.cmd;
    sys_proc_table.push([chalk.bold.cyan(proc_id++), cmd, proc.pid, cpu, mem, proc.uid]);
  });

  sys_infos.processes.mem_sorted = sys_infos.processes.mem_sorted.filter(
    (proc) => proc.memory > MEM_MIN_SHOW && proc.cmd.includes('node') == false
  );

  sys_infos.processes.mem_sorted.forEach((proc) => {
    var cpu = `${UxHelpers.colorizedMetric(proc.cpu, 40, 70, '%')}`;
    var mem = `${UxHelpers.colorizedMetric(proc.memory, 40, 70, '%')}`;
    var cmd = proc.cmd;
    // if (proc.cmd.length > 50)
    //   cmd = '…' + proc.cmd.slice(proc.cmd.length - 48, proc.cmd.length)
    sys_proc_table.push([chalk.bold.cyan(proc_id++), cmd, proc.pid, cpu, mem, proc.uid]);
  });

  if (sys_infos.processes.cpu_sorted.length >= 1 || sys_infos.processes.mem_sorted.length >= 1) {
    console.log(chalk.bold('Intensive Processes'));
    console.log(sys_proc_table.toString());
  }
}

/**
 * Sys info line
 */
function miniMonitBar(sys_infos) {
  let sys_metrics = sys_infos.omnitron_env.axm_monitor;

  let cpu = sys_metrics['CPU Usage'];

  if (typeof cpu == 'undefined') return;

  var sys_summary_line = `${chalk.bold.cyan('host metrics')} `;
  sys_summary_line += `| ${chalk.bold('cpu')}: ${UxHelpers.colorizedMetric(cpu.value, 40, 70, '%')}`;

  let temp = sys_metrics['CPU Temperature'].value;
  if (temp && temp != '-1') {
    sys_summary_line += ` ${UxHelpers.colorizedMetric(temp, 50, 70, 'º')}`;
  }

  let mem_total = sys_metrics['RAM Total'].value;
  let mem_available = sys_metrics['RAM Available'].value;

  if (mem_total) {
    var perc_mem_usage = ((mem_available / mem_total) * 100).toFixed(1);
    sys_summary_line += ` | ${chalk.bold('mem free')}: ${UxHelpers.colorizedMetric(perc_mem_usage, 30, 10, '%')} `;
  }

  let interfaces = Object.keys(sys_metrics)
    .filter((m) => m.includes('net') && m != 'net:default')
    .map((i) => i.split(':')[2])
    .filter((iface, i, self) => self.indexOf(iface) === i);

  interfaces.forEach((iface) => {
    if (!sys_metrics[`net:rx_5:${iface}`]) return;
    sys_summary_line += `| ${chalk.bold(iface)}: `;
    sys_summary_line += `⇓ ${UxHelpers.colorizedMetric(sys_metrics[`net:rx_5:${iface}`].value, 10, 20, 'mb/s')} `;
    sys_summary_line += `⇑ ${UxHelpers.colorizedMetric(sys_metrics[`net:tx_5:${iface}`].value, 10, 20, 'mb/s')} `;
  });

  if (CONDENSED_MODE == false) {
    let read = sys_metrics['Disk Reads'].value;
    let write = sys_metrics['Disk Writes'].value;

    sys_summary_line += `| ${chalk.bold('disk')}: ⇓ ${UxHelpers.colorizedMetric(read, 10, 20, 'mb/s')}`;
    sys_summary_line += ` ⇑ ${UxHelpers.colorizedMetric(write, 10, 20, 'mb/s')} `;

    let disks = Object.keys(sys_metrics)
      .filter((m) => m.includes('fs:'))
      .map((i) => i.split(':')[2])
      .filter((iface, i, self) => self.indexOf(iface) === i);
    var disk_nb = 0;

    disks.forEach((fs) => {
      let use = sys_metrics[`fs:use:${fs}`].value;
      if (use > 60) sys_summary_line += `${chalk.gray(fs)} ${UxHelpers.colorizedMetric(use, 80, 90, '%')} `;
    });
  }

  sys_summary_line += '|';
  console.log(sys_summary_line);
}

/**
 * omnitron ls
 * @method dispAsTable
 * @param {Object} list
 * @param {Object} system informations (via omnitron sysmonit/omnitron sysinfos)
 */
module.exports = function (list, commander) {
  var omnitron_conf = Configuration.getSync('omnitron');

  if (!list) return console.log('list empty');

  listModulesAndAppsManaged(list, commander);

  let sysmonit = list.filter((proc) => proc.name == 'pm2-sysmonit');
  if (sysmonit && sysmonit[0]) miniMonitBar(sysmonit[0]);

  // Disable warning message of process list not saved
  //checkIfProcessAreDumped(list)
};
