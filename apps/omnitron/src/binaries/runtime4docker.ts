// @ts-nocheck

import path from 'path';
/**
 * Specialized OMNITRON CLI for Containers
 */
import commander from 'commander';

import Log from '../api/log';
import OMNITRON from '../api';
import cst from '../constants';
import pkg from '../../package.json';

const DEFAULT_FAIL_COUNT = 3;

process.env.OMNITRON_DISCRETE_MODE = 'true';

commander
  .version(pkg.version)
  .description('omnitron-runtime is a drop-in replacement Node.js binary for containers')
  .option(
    '-i --instances <number>',
    'launch [number] of processes automatically load-balanced. Increase overall performances and performance stability.'
  )
  .option('--secret [key]', '[MONITORING] OMNITRON plus secret key')
  .option('--no-autostart', 'add an app without automatic start')
  .option('--no-autorestart', 'start an app without automatic restart')
  .option('--stop-exit-codes <exit_codes...>', 'specify a list of exit codes that should skip automatic restart')
  .option(
    '--node-args <node_args>',
    'space delimited arguments to pass to node in cluster mode - e.g. --node-args="--debug=7001 --trace-deprecation"'
  )
  .option('-n --name <name>', 'set a <name> for script')
  .option(
    '--max-memory-restart <memory>',
    'specify max memory amount used to autorestart (in octet or use syntax like 100M)'
  )
  .option('-c --cron <cron_pattern>', 'restart a running process based on a cron pattern')
  .option('--interpreter <interpreter>', 'the interpreter omnitron should use for executing app (bash, python...)')
  .option('--public [key]', '[MONITORING] OMNITRON plus public key')
  .option('--machine-name [name]', '[MONITORING] OMNITRON plus machine name')
  .option('--trace', 'enable transaction tracing with km')
  .option('--v8', 'enable v8 data collecting')
  .option('--format', 'output logs formated like key=val')
  .option('--raw', 'raw output (default mode)')
  .option('--formatted', 'formatted log output |id|app|log')
  .option('--json', 'output logs in json format')
  .option('--delay <seconds>', 'delay start of configuration file by <seconds>', 0)
  .option('--web [port]', 'launch process web api on [port] (default to 9615)')
  .option('--only <application-name>', 'only act on one application of configuration')
  .option('--no-auto-exit', 'do not exit if all processes are errored/stopped or 0 apps launched')
  .option('--env [name]', 'inject env_[name] env variables in process config file')
  .option('--watch', 'watch and restart application on file change')
  .option('--error <path>', 'error log file destination (default disabled)', '/dev/null')
  .option('--output <path>', 'output log file destination (default disabled)', '/dev/null')
  .option('--deep-monitoring', 'enable all monitoring tools (equivalent to --v8 --event-loop-inspector --trace)')
  .allowUnknownOption()
  .usage('app.js');

commander.command('*').action((cmd: string) => {
  Runtime.instanciate(cmd);
});

commander
  .command('start <app.js|json_file>')
  .description('start an application or json ecosystem file')
  .action((cmd: string) => {
    Runtime.instanciate(cmd);
  });

if (process.argv.length == 2) {
  commander.outputHelp();
  process.exit(1);
}

interface RuntimeInterface {
  omnitron: any;
  instanciate(cmd: string): void;
  startLogStreaming(): void;
  startApp(cmd: string, cb: (err: Error | null, obj?: any[]) => void): void;
  exit(code?: number): void;
  autoExitWorker(fail_count?: number): void;
}

const Runtime: RuntimeInterface = {
  omnitron: null,
  instanciate(cmd: string) {
    this.omnitron = new (OMNITRON as any).custom({
      omnitron_home: process.env.OMNITRON_HOME || path.join(process.env.HOME || '', '.omnitron'),
      secret_key: cst.SECRET_KEY || commander.secret,
      public_key: cst.PUBLIC_KEY || commander.public,
      machine_name: cst.MACHINE_NAME || commander.machineName,
      daemon_mode: process.env.OMNITRON_RUNTIME_DEBUG || false,
    });

    this.omnitron.connect((err: Error) => {
      process.on('SIGINT', () => {
        Runtime.exit();
      });

      process.on('SIGTERM', () => {
        Runtime.exit();
      });

      Runtime.startLogStreaming();
      Runtime.startApp(cmd, (err_: Error | null, obj?: any[]) => {
        if (err_) {
          console.error(err_.message || err_);
          Runtime.exit();
        }
      });
    });
  },

  /**
   * Log Streaming Management
   */
  startLogStreaming() {
    if (commander.json === true) Log.jsonStream(this.omnitron, 'all');
    else if (commander.format === true) Log.formatStream(this.omnitron, 'all', false, 'YYYY-MM-DD-HH:mm:ssZZ');
    else Log.stream(this.omnitron, 'all', !commander.formatted, commander.timestamp, true);
  },

  /**
   * Application Startup
   */
  startApp(cmd: string, cb: (err: Error | null, obj?: any[]) => void) {
    function exec(this: any) {
      this.omnitron.start(cmd, commander, (err: Error, obj: any[]) => {
        if (err) return cb(err);
        if (obj && obj.length == 0) return cb(new Error(`0 application started (no apps to run on ${cmd})`));

        if (commander.web) {
          const port = commander.web === true ? cst.WEB_PORT : commander.web;
          Runtime.omnitron.web(port);
        }

        if (commander.autoExit) {
          setTimeout(() => {
            Runtime.autoExitWorker();
          }, 4000);
        }

        // For Testing purpose (allow to auto exit CLI)
        if (process.env.OMNITRON_RUNTIME_DEBUG) Runtime.omnitron.disconnect(() => { });

        return cb(null, obj);
      });
    }
    // via --delay <seconds> option
    setTimeout(exec.bind(this), commander.delay * 1000);
  },

  /**
   * Exit runtime mgmt
   */
  exit(code?: number) {
    if (!this.omnitron) process.exit(1);

    this.omnitron.kill(() => {
      process.exit(code || 0);
    });
  },

  /**
   * Exit current OMNITRON instance if 0 app is online
   * function activated via --auto-exit
   */
  autoExitWorker(fail_count: number = DEFAULT_FAIL_COUNT) {
    const interval = 2000;

    const timer = setTimeout(() => {
      Runtime.omnitron.list((err: Error, apps: any[]) => {
        if (err) {
          console.error('Could not run omnitron list');
          Runtime.autoExitWorker();
          return;
        }

        let appOnline = 0;

        apps.forEach((app) => {
          if (
            !app.omnitron_env.pmx_module &&
            (app.omnitron_env.status === cst.ONLINE_STATUS || app.omnitron_env.status === cst.LAUNCHING_STATUS)
          ) {
            appOnline++;
          }
        });

        if (appOnline === 0) {
          console.log('0 application online, retry =', fail_count);
          if (fail_count <= 0) Runtime.exit(2);
          else Runtime.autoExitWorker(--fail_count);
        }

        Runtime.autoExitWorker();
      });
    }, interval);

    timer.unref();
  },
};

commander.parse(process.argv);
