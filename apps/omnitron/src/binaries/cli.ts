// @ts-nocheck
process.env['OMNITRON_USAGE'] = 'CLI';

import chalk from 'ansis';
import semver from 'semver';
import { Command } from 'commander';
import { forEachLimit } from 'async';

import OMNITRON from '../api';
import cst from '../constants';
import * as pkg from '../../package.json';
import { determineSilentCLI } from '../common';
import OMNITRONioHandler from '../api/pm2-plus/PM2IO';

if (cst.IS_BUN === true && semver.lt(process.versions['bun']!, '1.1.25')) {
  throw new Error('OMNITRON cannot run on Bun version < 1.1.25 (cluster support)');
}

determineSilentCLI();

const program = new Command();

let omnitron = new OMNITRON();

OMNITRONioHandler.useOMNITRONClient(omnitron);

program
  .version(pkg.version, '-v, --version', 'show version')
  .option('-s, --silent', 'hide all messages', false)
  .option('--ext <extensions>', 'watch only this file extensions')
  .option('-n, --name <name>', 'set a name for the process in the process list')
  .option('-m, --mini-list', 'display a compacted list without formatting')
  .option('--interpreter <interpreter>', 'set a specific interpreter to use for executing app, default: node')
  .option('--interpreter-args <arguments>', 'set arguments to pass to the interpreter (alias of --node-args)')
  .option('--node-args <node_args>', 'space delimited arguments to pass to node')
  .option('-o, --output <path>', 'specify log file for stdout')
  .option('-e, --error <path>', 'specify log file for stderr')
  .option('-l, --log [path]', 'specify log file which gathers both stdout and stderr')
  .option(
    '--filter-env [envs]',
    'filter out outgoing global values that contain provided strings',
    (v, m) => {
      m.push(v);
      return m;
    },
    []
  )
  .option('--log-type <type>', 'specify log output style (raw by default, json optional)')
  .option('--log-date-format <date format>', 'add custom prefix timestamp to logs')
  .option('--time', 'enable time logging')
  .option('--disable-logs', 'disable all logs storage')
  .option('--env <environment_name>', 'specify which set of environment variables from ecosystem file must be injected')
  .option('-a, --update-env', 'force an update of the environment with restart/reload (-a <=> apply)')
  .option('-f, --force', 'force actions')
  .option('-i, --instances <number>', 'launch [number] instances (for networked app)(load balanced)')
  .option('--parallel <number>', 'number of parallel actions (for restart/reload)')
  .option(
    '--shutdown-with-message',
    "shutdown an application with process.send('shutdown') instead of process.kill(pid, SIGINT)"
  )
  .option('-p, --pid <pid>', 'specify pid file')
  .option('-k, --kill-timeout <delay>', 'delay before sending final SIGKILL signal to process')
  .option('--listen-timeout <delay>', 'listen timeout on application reload')
  .option('--max-memory-restart <memory>', 'Restart the app if an amount of memory is exceeded (in bytes)')
  .option('--restart-delay <delay>', 'specify a delay between restarts (in milliseconds)')
  .option('--exp-backoff-restart-delay <delay>', 'specify a delay between restarts (in milliseconds)')
  .option('-x, --execute-command', 'execute a program using fork system')
  .option('--max-restarts [count]', 'only restart the script COUNT times')
  .option('-u, --user <username>', 'define user when generating startup script')
  .option('--uid <uid>', 'run target script with <uid> rights')
  .option('--gid <gid>', 'run target script with <gid> rights')
  .option('--namespace <ns>', 'start application within specified namespace')
  .option('--cwd <path>', 'run target script from path <cwd>')
  .option('--hp <home path>', 'define home path when generating startup script')
  .option('--wait-ip', 'override systemd script to wait for full internet connectivity to launch omnitron')
  .option('--service-name <name>', 'define service name when generating startup script')
  .option('-c, --cron <cron_pattern>', 'restart a running process based on a cron pattern')
  .option('--cron-restart <cron_pattern>', '(alias) restart a running process based on a cron pattern')
  .option('-w, --write', 'write configuration in local folder')
  .option('--no-daemon', "run omnitron daemon in the foreground if it doesn't exist already")
  .option('--source-map-support', 'force source map support')
  .option('--only <application-name>', 'with json declaration, allow to only act on one application')
  .option('--disable-source-map-support', 'force source map support')
  .option('--wait-ready', 'ask omnitron to wait for ready event from your app')
  .option('--merge-logs', 'merge logs from different instances but keep error and out separated')
  .option(
    '--watch [paths]',
    'watch application folder for changes',
    (v, m) => {
      m.push(v);
      return m;
    },
    []
  )
  .option('--ignore-watch <folders|files>', 'List of paths to ignore (name or regex)')
  .option('--watch-delay <delay>', 'specify a restart delay after changing files (--watch-delay 4 (in sec) or 4000ms)')
  .option('--no-color', 'skip colors')
  .option('--no-vizion', 'start an app without vizion feature (versioning control)')
  .option('--no-autostart', 'add an app without automatic start')
  .option('--no-autorestart', 'start an app without automatic restart')
  .option('--stop-exit-codes <exit_codes...>', 'specify a list of exit codes that should skip automatic restart')
  .option('--no-treekill', 'Only kill the main process, not detached children')
  .option('--trace', 'enable transaction tracing with km')
  .option('--disable-trace', 'disable transaction tracing with km')
  .option('--sort <field_name:sort>', "sort process according to field's name")
  .option('--attach', 'attach logging after your start/restart/stop/reload')
  .option('--v8', 'enable v8 data collecting')
  .option('--event-loop-inspector', 'enable event-loop-inspector dump in pmx')
  .option('--deep-monitoring', 'enable all monitoring tools (equivalent to --v8 --event-loop-inspector --trace)')
  .usage('[cmd] app');

function beginCommandProcessing() {
  omnitron.getVersion((err, remote_version) => {
    if (!err && pkg.version != remote_version) {
      console.log('');
      console.log(chalk.red.bold('>>>> In-memory OMNITRON is out-of-date, do:\n>>>> $ omnitron update'));
      console.log('In memory OMNITRON version:', chalk.blue.bold(remote_version));
      console.log('Local OMNITRON version:', chalk.blue.bold(pkg.version));
      console.log('');
    }
  });
  program.parse(process.argv);
}

const _arr = process.argv.indexOf('--') > -1 ? process.argv.slice(0, process.argv.indexOf('--')) : process.argv;

if (_arr.indexOf('log') > -1) {
  process.argv[_arr.indexOf('log')] = 'logs';
}

if (_arr.indexOf('--no-daemon') > -1) {
  //
  // Start daemon if it does not exist
  //
  // Function checks if --no-daemon option is present,
  // and starts daemon in the same process if it does not exist
  //
  console.log('omnitron launched in no-daemon mode (you can add DEBUG="*" env variable to get more messages)');

  const omnitronNoDaeamon = new OMNITRON({
    daemon_mode: false,
  });

  omnitronNoDaeamon.connect(() => {
    omnitron = omnitronNoDaeamon;
    beginCommandProcessing();
  });
} else if (_arr.indexOf('startup') > -1 || _arr.indexOf('unstartup') > -1) {
  setTimeout(() => {
    program.parse(process.argv);
  }, 100);
} else {
  omnitron.connect(() => {
    beginCommandProcessing();
  });
}

/**
 * @todo to remove at some point once it's fixed in official program.js
 * https://github.com/tj/program.js/issues/475
 *
 * Patch program.js Variadic feature
 */
function patchprogramArg(cmd: string) {
  let argsIndex;
  if ((argsIndex = program.rawArgs.indexOf('--')) >= 0) {
    const optargs = program.rawArgs.slice(argsIndex + 1);
    cmd = cmd.slice(0, cmd.indexOf(optargs[0]));
  }
  return cmd;
}

//
// Start command
//
program
  .command('start')
  .argument('[name|namespace|file|ecosystem|id...]')
  // .option('--watch', 'Watch folder for changes')
  .option('--fresh', 'Rebuild Dockerfile')
  .option('--daemon', 'Run container in Daemon mode (debug purposes)')
  .option('--container', 'Start application in container mode')
  .option('--dist', 'with --container; change local Dockerfile to containerize all files in current directory')
  .option('--image-name [name]', 'with --dist; set the exported image name')
  .option('--node-version [major]', 'with --container, set a specific major Node.js version')
  .option('--dockerdaemon', 'for debugging purpose')
  .description('start and daemonize an app')
  .action((cmd, cmdOpts, prg: Command) => {
    const opts = {
      ...cmdOpts,
      ...prg.parent?.opts(),
      rawArgs: prg.parent?.rawArgs,
      // args: prg.parent?.args,
    };
    if (opts.container == true && opts.dist == true) {
      omnitron.dockerMode(cmd, opts, 'distribution');
      return;
    } else if (opts.container == true) {
      omnitron.dockerMode(cmd, opts, 'development');
      return;
    }

    if (cmd == '-') {
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c: any) => {
        process.stdin.pause();
        omnitron._startJson(c, opts, 'restartProcessId', 'pipe');
      });
    } else {
      // program.js patch
      cmd = patchprogramArg(cmd);
      if (cmd.length === 0) {
        cmd = [cst.APP_CONF_DEFAULT_FILE];
      }
      let acc: any[] = [];
      forEachLimit(
        cmd,
        1,
        (script, next) => {
          omnitron.start(script, opts, (err, apps) => {
            acc = acc.concat(apps);
            next(err);
          });
        },
        (err, dt) => {
          if (
            err &&
            err.message &&
            (err.message.includes('Script not found') === true ||
              err.message.includes('NOT AVAILABLE IN PATH') === true)
          ) {
            omnitron.exitCli(1);
          } else omnitron.speedList(err ? 1 : 0, acc);
        }
      );
    }
  });

program
  .command('trigger <id|proc_name|namespace|all> <action_name> [params]')
  .description('trigger process action')
  .action((pm_id, action_name, params) => {
    omnitron.trigger(pm_id, action_name, params);
  });

program
  .command('deploy <file|environment>')
  .description('deploy your json')
  .action((cmd, cmdOpts, prg: Command) => {
    const opts = {
      ...cmdOpts,
      ...prg.parent?.opts(),
      rawArgs: prg.parent?.rawArgs,
      // args: prg.parent?.args,
    };
    omnitron.deploy(cmd, opts);
  });

program
  .command('startOrRestart <json>')
  .description('start or restart JSON file')
  .action((file, cmdOpts, prg: Command) => {
    const opts = {
      ...cmdOpts,
      ...prg.parent?.opts(),
      rawArgs: prg.parent?.rawArgs,
      // args: prg.parent?.args,
    };
    omnitron._startJson(file, opts, 'restartProcessId');
  });

program
  .command('startOrReload <json>')
  .description('start or gracefully reload JSON file')
  .action((file, cmdOpts, prg: Command) => {
    const opts = {
      ...cmdOpts,
      ...prg.parent?.opts(),
      rawArgs: prg.parent?.rawArgs,
      // args: prg.parent?.args,
    };
    omnitron._startJson(file, opts, 'reloadProcessId');
  });

program
  .command('pid [app_name]')
  .description('return pid of [app_name] or all')
  .action((app) => {
    omnitron.getPID(app);
  });

program
  .command('create')
  .description('return pid of [app_name] or all')
  .action(() => {
    omnitron.boilerplate();
  });

program
  .command('startOrGracefulReload <json>')
  .description('start or gracefully reload JSON file')
  .action((file, cmdOpts, prg: Command) => {
    const opts = {
      ...cmdOpts,
      ...prg.parent?.opts(),
      rawArgs: prg.parent?.rawArgs,
      // args: prg.parent?.args,
    };
    omnitron._startJson(file, opts, 'reloadProcessId');
  });

//
// Stop specific id
//
program
  .command('stop')
  .argument('<id|name|namespace|all|json|stdin...>')
  .option('--watch', 'Stop watching folder for changes')
  .description('stop a process')
  .action((param) => {
    forEachLimit(
      param,
      1,
      (script, next) => {
        omnitron.stop(script, next);
      },
      (err) => {
        omnitron.speedList(err ? 1 : 0);
      }
    );
  });

//
// Stop All processes
//
program
  .command('restart')
  .argument('<id|name|namespace|all|json|stdin...>')
  .option('--watch', 'Toggle watching folder for changes')
  .description('restart a process')
  .action((param, cmdOpts, prg: Command) => {
    const opts = {
      ...cmdOpts,
      ...prg.parent?.opts(),
      rawArgs: prg.parent?.rawArgs,
      // args: prg.parent?.args,
    };
    // program.js patch
    param = patchprogramArg(param);
    let acc: any[] = [];
    forEachLimit(
      param,
      1,
      (script, next) => {
        omnitron.restart(script, opts, (err, apps) => {
          acc = acc.concat(apps);
          next(err);
        });
      },
      (err) => {
        omnitron.speedList(err ? 1 : 0, acc);
      }
    );
  });

//
// Scale up/down a process in cluster mode
//
program
  .command('scale <app_name> <number>')
  .description('scale up/down a process in cluster mode depending on total_number param')
  .action((app_name, number) => {
    omnitron.scale(app_name, number);
  });

//
// snapshot OMNITRON
//
program
  .command('profile:mem [time]')
  .description('Sample OMNITRON heap memory')
  .action((time) => {
    omnitron.profile('mem', time);
  });

//
// snapshot OMNITRON
//
program
  .command('profile:cpu [time]')
  .description('Profile OMNITRON cpu')
  .action((time) => {
    omnitron.profile('cpu', time);
  });

//
// Reload process(es)
//
program
  .command('reload')
  .argument('<id|name|namespace|all>')
  .description('reload processes (note that its for app using HTTP/HTTPS)')
  .action((omnitron_id, cmdOpts, prg: Command) => {
    const opts = {
      ...cmdOpts,
      ...prg.parent?.opts(),
      rawArgs: prg.parent?.rawArgs,
      // args: prg.parent?.args,
    };
    omnitron.reload(omnitron_id, opts);
  });

program
  .command('id <name>')
  .description('get process id by name')
  .action((name) => {
    omnitron.getProcessIdByName(name);
  });

// Inspect a process
program
  .command('inspect <name>')
  .description('inspect a process')
  .action((cmd, cmdOpts, prg: Command) => {
    const opts = {
      ...cmdOpts,
      ...prg.parent?.opts(),
      rawArgs: prg.parent?.rawArgs,
      // args: prg.parent?.args,
    };
    omnitron.inspect(cmd, opts);
  });

//
// Stop and delete a process by name from database
//
program
  .command('delete')
  .argument('<name|id|namespace|script|all|json|stdin...>')
  .alias('del')
  .description('stop and delete a process from omnitron process list')
  .action((name) => {
    if (name == '-') {
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (param) => {
        process.stdin.pause();
        omnitron.delete(param.toString(), 'pipe');
      });
    } else
      forEachLimit(
        name,
        1,
        (script, next) => {
          omnitron.delete(script, '', next);
        },
        (err) => {
          omnitron.speedList(err ? 1 : 0);
        }
      );
  });

//
// Send system signal to process
//
program
  .command('sendSignal <signal> <omnitron_id|name>')
  .description('send a system signal to the target process')
  .action((signal, omnitron_id) => {
    if (isNaN(parseInt(omnitron_id))) {
      console.log(cst.PREFIX_MSG + 'Sending signal to process name ' + omnitron_id);
      omnitron.sendSignalToProcessName(signal, omnitron_id);
    } else {
      console.log(cst.PREFIX_MSG + 'Sending signal to process id ' + omnitron_id);
      omnitron.sendSignalToProcessId(signal, omnitron_id);
    }
  });

//
// Stop and delete a process by name from database
//
program
  .command('ping')
  .description('ping omnitron daemon - if not up it will launch it')
  .action(() => {
    omnitron.ping();
  });

program
  .command('update')
  .description('(alias) update in-memory OMNITRON with local OMNITRON')
  .action(() => {
    omnitron.update();
  });

/**
 * Module specifics
 */
program
  .command('install <module|git:// url>')
  .alias('module:install')
  .option('--tarball', 'is local tarball')
  .option('--install', 'run yarn install before starting module')
  .option('--docker', 'is docker container')
  .option('--v1', 'install module in v1 manner (do not use it)')
  .option('--safe [time]', 'keep module backup, if new module fail = restore with previous')
  .description('install or update a module and run it forever')
  .action((plugin_name, cmdOpts, prg: Command) => {
    const opts = {
      ...cmdOpts,
      ...prg.parent?.opts(),
      rawArgs: prg.parent?.rawArgs,
      // args: prg.parent?.args,
    };

    // Object.assign(program, opts);
    omnitron.install(plugin_name, opts);
  });

program
  .command('module:update <module|git:// url>')
  .option('--tarball', 'is local tarball')
  .description('update a module and run it forever')
  .action((plugin_name, cmdOpts, prg: Command) => {
    const opts = {
      ...cmdOpts,
      ...prg.parent?.opts(),
      rawArgs: prg.parent?.rawArgs,
      // args: prg.parent?.args,
    };
    // Object.assign(program, opts);
    omnitron.install(plugin_name, opts);
  });

program
  .command('module:generate [app_name]')
  .description('Generate a sample module in current folder')
  .action((app_name) => {
    omnitron.generateModuleSample(app_name);
  });

program
  .command('uninstall <module>')
  .alias('module:uninstall')
  .description('stop and uninstall a module')
  .action((plugin_name) => {
    omnitron.uninstall(plugin_name);
  });

program
  .command('package [target]')
  .description('Check & Package TAR type module')
  .action((target) => {
    omnitron.package(target);
  });

program
  .command('publish [folder]')
  .option('--npm', 'publish on npm')
  .alias('module:publish')
  .description('Publish the module you are currently on')
  .action((folder, opts) => {
    omnitron.publish(folder, opts);
  });

program
  .command('set [key] [value]')
  .description('sets the specified config <key> <value>')
  .action((key, value) => {
    omnitron.set(key, value);
  });

program
  .command('multiset <value>')
  .description('multiset eg "key1 val1 key2 val2')
  .action((str) => {
    omnitron.multiset(str);
  });

program
  .command('get [key]')
  .description('get value for <key>')
  .action((key) => {
    omnitron.get(key);
  });

program
  .command('conf [key] [value]')
  .description('get / set module config values')
  .action((key, value) => {
    omnitron.get();
  });

program
  .command('config <key> [value]')
  .description('get / set module config values')
  .action((key, value) => {
    omnitron.conf(key, value);
  });

program
  .command('unset <key>')
  .description('clears the specified config <key>')
  .action((key) => {
    omnitron.unset(key);
  });

program
  .command('report')
  .description('give a full omnitron report for https://github.com/Unitech/omnitron/issues')
  .action((key) => {
    omnitron.report();
  });

//
// OMNITRON I/O
//
program
  .command('link [secret] [public] [name]')
  .option('--info-node [url]', 'set url info node')
  .description('link with the omnitron monitoring dashboard')
  .action(omnitron.linkManagement.bind(omnitron));

program
  .command('unlink')
  .description('unlink with the omnitron monitoring dashboard')
  .action(() => {
    omnitron.unlink();
  });

program
  .command('monitor [name]')
  .description('monitor target process')
  .action((name) => {
    if (name === undefined) {
      plusHandler();
    } else {
      omnitron.monitorState('monitor', name);
    }
  });

program
  .command('unmonitor [name]')
  .description('unmonitor target process')
  .action((name) => {
    omnitron.monitorState('unmonitor', name);
  });

program
  .command('open')
  .description('open the omnitron monitoring dashboard')
  .action((name) => {
    omnitron.openDashboard();
  });

function plusHandler(command?: string, opts?: any) {
  if (opts && opts.infoNode) {
    process.env.KEYMETRICS_NODE = opts.infoNode;
  }

  return OMNITRONioHandler.launch(command, opts);
}

program
  .command('plus [command] [option]')
  .alias('register')
  .option('--info-node [url]', 'set url info node for on-premise omnitron plus')
  .option('-d --discrete', 'silent mode')
  .option('-a --install-all', 'install all modules (force yes)')
  .description('enable omnitron plus')
  .action(plusHandler);

program
  .command('login')
  .description('Login to omnitron plus')
  .action(() => plusHandler('login'));

program
  .command('logout')
  .description('Logout from omnitron plus')
  .action(() => plusHandler('logout'));

//
// Save processes to file
//
program
  .command('dump')
  .alias('save')
  .option('--force', 'force deletion of dump file, even if empty')
  .description('dump all processes for resurrecting them later')
  .action(() => {
    omnitron.dump(program.force);
  });

//
// Delete dump file
//
program
  .command('cleardump')
  .description('Create empty dump file')
  .action(() => {
    omnitron.clearDump();
  });

//
// Save processes to file
//
program
  .command('send <pm_id> <line>')
  .description('send stdin to <pm_id>')
  .action((pm_id, line) => {
    omnitron.sendLineToStdin(pm_id, line);
  });

//
// Attach to stdin/stdout
// Not TTY ready
//
program
  .command('attach <pm_id> [command separator]')
  .description('attach stdin/stdout to application identified by <pm_id>')
  .action((pm_id, separator) => {
    omnitron.attach(pm_id, separator);
  });

//
// Resurrect
//
program
  .command('resurrect')
  .description('resurrect previously dumped processes')
  .action(() => {
    console.log(cst.PREFIX_MSG + 'Resurrecting');
    omnitron.resurrect();
  });

//
// Set omnitron to startup
//
program
  .command('unstartup [platform]')
  .description('disable the omnitron startup hook')
  .action((platform, cmdOpts, prg: Command) => {
    const opts = {
      ...cmdOpts,
      ...prg.parent?.opts(),
      rawArgs: prg.parent?.rawArgs,
      // args: prg.parent?.args,
    };
    omnitron.uninstallStartup(platform, opts);
  });

//
// Set omnitron to startup
//
program
  .command('startup [platform]')
  .description('enable the omnitron startup hook')
  .action((platform, cmdOpts, prg: Command) => {
    const opts = {
      ...cmdOpts,
      ...prg.parent?.opts(),
      rawArgs: prg.parent?.rawArgs,
      // args: prg.parent?.args,
    };
    omnitron.startup(platform, opts);
  });

//
// Logrotate
//
program
  .command('logrotate')
  .description('copy default logrotate configuration')
  .action(() => {
    omnitron.logrotate(program);
  });

//
// Sample generate
//

program
  .command('ecosystem [mode]')
  .alias('init')
  .description('generate a process conf file. (mode = null or simple)')
  .action((mode) => {
    omnitron.generateSample(mode);
  });

program
  .command('reset <name|id|all>')
  .description('reset counters for process')
  .action((proc_id) => {
    omnitron.reset(proc_id);
  });

program
  .command('describe <name|id>')
  .description('describe all parameters of a process')
  .action((proc_id) => {
    omnitron.describe(proc_id);
  });

program
  .command('desc <name|id>')
  .description('(alias) describe all parameters of a process')
  .action((proc_id) => {
    omnitron.describe(proc_id);
  });

program
  .command('info <name|id>')
  .description('(alias) describe all parameters of a process')
  .action((proc_id) => {
    omnitron.describe(proc_id);
  });

program
  .command('show <name|id>')
  .description('(alias) describe all parameters of a process')
  .action((proc_id) => {
    omnitron.describe(proc_id);
  });

program
  .command('env <id>')
  .description('list all environment variables of a process id')
  .action((proc_id) => {
    omnitron.env(proc_id);
  });

//
// List command
//
program
  .command('list')
  .alias('ls')
  .description('list all processes')
  .action(() => {
    omnitron.list(program);
  });

program
  .command('l')
  .description('(alias) list all processes')
  .action(() => {
    omnitron.list();
  });

program
  .command('ps')
  .description('(alias) list all processes')
  .action(() => {
    omnitron.list();
  });

program
  .command('status')
  .description('(alias) list all processes')
  .action(() => {
    omnitron.list();
  });

// List in raw json
program
  .command('jlist')
  .description('list all processes in JSON format')
  .action(() => {
    omnitron.jlist();
  });

program
  .command('sysmonit')
  .description('start system monitoring daemon')
  .action(() => {
    omnitron.launchSysMonitoring();
  });

program
  .command('slist')
  .alias('sysinfos')
  .option('-t --tree', 'show as tree')
  .description('list system infos in JSON')
  .action((opts) => {
    omnitron.slist(opts.tree);
  });

// List in prettified Json
program
  .command('prettylist')
  .description('print json in a prettified JSON')
  .action(() => {
    omnitron.jlist(true);
  });

//
// Dashboard command
//
program
  .command('monit')
  .description('launch termcaps monitoring')
  .action(() => {
    omnitron.dashboard();
  });

program
  .command('imonit')
  .description('launch legacy termcaps monitoring')
  .action(() => {
    omnitron.monit();
  });

program
  .command('dashboard')
  .alias('dash')
  .description('launch dashboard with monitoring and logs')
  .action(() => {
    omnitron.dashboard();
  });

//
// Flushing command
//

program
  .command('flush [api]')
  .description('flush logs')
  .action((api) => {
    omnitron.flush(api);
  });

//
// Reload all logs
//
program
  .command('reloadLogs')
  .description('reload all logs')
  .action(() => {
    omnitron.reloadLogs();
  });

//
// Log streaming
//
program
  .command('logs [id|name|namespace]')
  .option('--json', 'json log output')
  .option('--format', 'formated log output')
  .option('--raw', 'raw output')
  .option('--err', 'only shows error output')
  .option('--out', 'only shows standard output')
  .option('--lines <n>', 'output the last N lines, instead of the last 15 by default')
  .option('--timestamp [format]', 'add timestamps (default format YYYY-MM-DD-HH:mm:ss)')
  .option('--nostream', 'print logs without launching the log stream')
  .option('--highlight [value]', 'highlights the given value')
  .description('stream logs file. Default stream all logs')
  .action((id, cmd) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Logs = require('../api/log');

    if (!id) id = 'all';

    let line = 15;
    let raw = false;
    let exclusive: string | boolean = false;
    let timestamp = false;
    let highlight = false;

    if (!isNaN(parseInt(cmd.lines))) {
      line = parseInt(cmd.lines);
    }

    if (cmd.parent.rawArgs.indexOf('--raw') !== -1) raw = true;

    if (cmd.timestamp) timestamp = typeof cmd.timestamp === 'string' ? cmd.timestamp : 'YYYY-MM-DD-HH:mm:ss';

    if (cmd.highlight) highlight = typeof cmd.highlight === 'string' ? cmd.highlight : false;

    if (cmd.out === true) exclusive = 'out';

    if (cmd.err === true) exclusive = 'err';

    if (cmd.nostream === true) omnitron.printLogs(id, line, raw, timestamp, exclusive);
    else if (cmd.json === true) Logs.jsonStream(omnitron, id);
    else if (cmd.format === true) Logs.formatStream(omnitron, id, false, 'YYYY-MM-DD-HH:mm:ssZZ', exclusive, highlight);
    else omnitron.streamLogs(id, line, raw, timestamp, exclusive, highlight);
  });

//
// Kill
//
program
  .command('kill')
  .description('kill daemon')
  .action(() => {
    omnitron.killDaemon(() => {
      process.exit(cst.SUCCESS_EXIT);
    });
  });

//
// Update repository for a given app
//

program
  .command('pull <name> [commit_id]')
  .description('updates repository for a given app')
  .action((omnitron_name, commit_id) => {
    if (commit_id !== undefined) {
      omnitron._pullCommitId({
        omnitron_name,
        commit_id,
      });
    } else omnitron.pullAndRestart(omnitron_name);
  });

//
// Update repository to the next commit for a given app
//
program
  .command('forward <name>')
  .description('updates repository to the next commit for a given app')
  .action((omnitron_name) => {
    omnitron.forward(omnitron_name);
  });

//
// Downgrade repository to the previous commit for a given app
//
program
  .command('backward <name>')
  .description('downgrades repository to the previous commit for a given app')
  .action((omnitron_name) => {
    omnitron.backward(omnitron_name);
  });

//
// Launch a http server that expose a given path on given port
//
program
  .command('serve [path] [port]')
  .alias('expose')
  .option('--port [port]', 'specify port to listen to')
  .option('--spa', 'always serving index.html on inexistant sub path')
  .option('--basic-auth-username [username]', 'set basic auth username')
  .option('--basic-auth-password [password]', 'set basic auth password')
  .option('--monitor [frontend-app]', 'frontend app monitoring (auto integrate snippet on html files)')
  .description('serve a directory over http via port')
  .action((path, port, cmd) => {
    omnitron.serve(path, port || cmd.port, cmd, program);
  });

program.command('autoinstall').action(() => {
  omnitron.autoinstall();
});
