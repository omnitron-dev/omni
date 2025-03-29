// @ts-nocheck

process.env.OMNITRON_NO_INTERACTION = 'true';
// Do not print banner
process.env.OMNITRON_DISCRETE_MODE = 'true';

import os from 'os';
import path from 'path';
import chalk from 'chalk';
import commander from 'commander';
import { exec, ExecException } from 'child_process';

import Log from '../api/log';
import OMNITRON from '../api';
import cst from '../constants';
import fmt from '../tools/fmt';
import pkg from '../../package.json';

commander
  .version(pkg.version)
  .description('omnitron-dev monitor for any file changes and automatically restart it')
  .option('--raw', 'raw log output')
  .option('--timestamp', 'print timestamp')
  .option(
    '--node-args <node_args>',
    'space delimited arguments to pass to node in cluster mode - e.g. --node-args="--debug=7001 --trace-deprecation"'
  )
  .option('--ignore [files]', 'files to ignore while watching')
  .option('--post-exec [cmd]', 'execute extra command after change detected')
  .option('--silent-exec', 'do not output result of post command', false)
  .option('--test-mode', 'debug mode for test suit')
  .option('--interpreter <interpreter>', 'the interpreter omnitron should use for executing app (bash, python...)')
  .option('--env [name]', 'select env_[name] env variables in process config file')
  .option('--auto-exit', 'exit if all processes are errored/stopped or 0 apps launched')
  .usage('omnitron-dev app.js');

const omnitron = new (OMNITRON as any).custom({
  omnitron_home: path.join(
    os.homedir ? os.homedir() : process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE || '',
    '.omnitron-dev'
  ),
});

omnitron.connect(() => {
  commander.parse(process.argv);
});

function postExecCmd(command: string, cb?: (err: ExecException | null) => void) {
  const exec_cmd = exec(command);

  if (commander.silentExec !== true) {
    exec_cmd.stdout?.on('data', (data: string) => {
      process.stdout.write(data);
    });

    exec_cmd.stderr?.on('data', (data: string) => {
      process.stderr.write(data);
    });
  }

  exec_cmd.on('close', () => {
    if (cb) cb(null);
  });

  exec_cmd.on('error', (err: ExecException) => {
    console.error(err.stack || err);
  });
}

function run(cmd: string, opts: any) {
  let timestamp: string | boolean = opts.timestamp;

  opts.watch = true;
  opts.autostart = true;
  opts.autorestart = true;
  opts.restart_delay = 1000;
  if (opts.autoExit) autoExit();

  if (opts.ignore) {
    opts.ignore_watch = opts.ignore.split(',');
    opts.ignore_watch.push('node_modules');
  }

  if (timestamp === true) timestamp = 'YYYY-MM-DD-HH:mm:ss';

  omnitron.start(cmd, opts, (err: Error, procs: any[]) => {
    if (err) {
      console.error(err);
      omnitron.destroy(() => {
        process.exit(0);
      });
      return false;
    }

    if (opts.testMode) {
      return omnitron.disconnect(() => {
        console.log('disconnected succesfully from omnitron-dev');
      });
    }

    fmt.title('OMNITRON development mode');
    fmt.field(
      'Apps started',
      procs.map((p: any) => p.omnitron_env.name)
    );
    fmt.field('Processes started', chalk.bold(procs.length));
    fmt.field('Watch and Restart', chalk.green('Enabled'));
    fmt.field('Ignored folder', opts.ignore_watch || 'node_modules');
    if (opts.postExec) fmt.field('Post restart cmd', opts.postExec);
    fmt.sep();

    setTimeout(() => {
      omnitron.launchBus((err: Error, bus: any) => {
        bus.on('process:event', (packet: any) => {
          if (packet.event == 'online') {
            if (opts.postExec) postExecCmd(opts.postExec);
          }
        });
      });
    }, 1000);

    Log.devStream(omnitron, 'all', opts.raw, timestamp, false);

    process.on('SIGINT', () => {
      console.log('>>>>> [OMNITRON DEV] Stopping current development session');
      omnitron.delete('all', () => {
        omnitron.destroy(() => {
          process.exit(0);
        });
      });
    });
  });
}

commander.command('*').action((cmd: string, opts: any) => {
  run(cmd, commander);
});

commander
  .command('start <file|json_file>')
  .description('start target config file/script in development mode')
  .action((cmd: string, opts: any) => {
    run(cmd, commander);
  });

function exitOMNITRON() {
  if (omnitron && omnitron.connected == true) {
    console.log(chalk.green.bold('>>> Exiting OMNITRON'));
    omnitron.kill(() => {
      process.exit(0);
    });
  } else process.exit(0);
}

function autoExit(final?: boolean) {
  setTimeout(() => {
    omnitron.list((err: Error, apps: any[]) => {
      if (err) console.error(err.stack || err);

      let online_count = 0;

      apps.forEach((app: any) => {
        if (app.omnitron_env.status == cst.ONLINE_STATUS || app.omnitron_env.status == cst.LAUNCHING_STATUS)
          online_count++;
      });

      if (online_count == 0) {
        console.log('0 application online, exiting');
        if (final == true) process.exit(1);
        else autoExit(true);
        return false;
      }
      autoExit(false);
    });
  }, 3000);
}

if (process.argv.length == 2) {
  commander.outputHelp();
  exitOMNITRON();
}
