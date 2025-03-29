// @ts-nocheck
import path from 'path';
import { Command } from 'commander';

import Log from '../api/log';
import OMNITRON from '../api';
import cst from '../constants';
import pkg from '../../package.json';

let omnitron: any;

// Do not print banner
process.env.OMNITRON_DISCRETE_MODE = 'true';

const commander = new Command();

commander
  .version(pkg.version)
  .description('omnitron-runtime is an automatic pmx injection that runs in simulated no-daemon environment')
  .option('--auto-manage', 'keep application online after command exit')
  .option(
    '--fast-boot',
    'boot app faster by keeping omnitron runtime online in background (effective at second exit/start)'
  )
  .option('--web [port]', 'launch process web api on [port] default to 9615')
  .option('--secret [key]', 'OMNITRON plus secret key')
  .option('--public [key]', 'OMNITRON plus public key')
  .option('--machine-name [name]', 'OMNITRON plus machine name')
  .option('--env [name]', 'select env_[name] env variables in process config file')
  .option('--watch', 'Watch and Restart')
  .option('-i --instances <number>', 'launch [number] instances with load-balancer')
  .usage('omnitron-runtime app.js');

commander.command('*').action((cmd: string) => {
  omnitron = new (OMNITRON as any).custom({
    omnitron_home: path.join(process.env.HOME || '', '.pm3'),
    secret_key: cst.SECRET_KEY || commander.secret,
    public_key: cst.PUBLIC_KEY || commander.public,
    machine_name: cst.MACHINE_NAME || commander.machineName,
  });

  omnitron.connect(() => {
    if (commander.web) {
      const port: number | string = commander.web === true ? cst.WEB_PORT : commander.web;
      omnitron.web(port);
    }

    omnitron.start(cmd, commander, (err: Error, obj: any[]) => {
      if (process.env.OMNITRON_RUNTIME_DEBUG) {
        return omnitron.disconnect(() => { });
      }

      if (err) {
        console.error(err);
        return process.exit(1);
      }

      const pm_id: number = obj[0].omnitron_env.pm_id;

      if (commander.instances == undefined) {
        return omnitron.attach(pm_id, () => {
          exitOMNITRON();
        });
      }

      if (commander.json === true) Log.jsonStream(omnitron, pm_id);
      else if (commander.format === true) Log.formatStream(omnitron, pm_id, false, 'YYYY-MM-DD-HH:mm:ssZZ');
      else Log.stream(omnitron, 'all', true);
    });
  });
});

if (process.argv.length == 2) {
  commander.outputHelp();
  process.exit(1);
}

process.on('SIGINT', () => {
  exitOMNITRON();
});

process.on('SIGTERM', () => {
  exitOMNITRON();
});

commander.parse(process.argv);

function exitOMNITRON() {
  console.log('Exited at %s', new Date());
  if (commander.autoManage) process.exit(0);

  if (commander.fastBoot) {
    omnitron.delete('all', () => {
      process.exit(0);
    });
    return;
  }

  omnitron.kill(() => {
    process.exit(0);
  });
}
