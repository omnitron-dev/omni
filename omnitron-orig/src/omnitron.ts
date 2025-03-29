#!/usr/bin/env node

import path from 'path';
import { Command } from 'commander';

import { Runtime } from './runtime';
import { loadConfig } from './config';
import { isDaemonRunning } from './utils';

const program = new Command();

program.version('1.0.0').description('Omnitron Process Manager');

// Функция инициализации, выполняемая перед каждой командой
async function initialize() {
  if (!isDaemonRunning()) {
    console.log('❌ Omnitron is not running.');
    process.exit(1);
  }

  try {
    const config = await loadConfig(true);
    const netron = Runtime.get().getNetron();
    const peer = await netron.connect(`ws://${config.listenHost}:${config.listenPort}`);
    Runtime.get().set('peer', peer);
  } catch (error: any) {
    console.error(`❌ Failed to connect to Omnitron: ${error.message}`);
    process.exit(1);
  }
}

program
  .command('startup')
  .description('Install Omnitron as a systemd service')
  .option('--unmount', 'Remove systemd service')
  .action(async (options) => {
    await import(path.join(__dirname, 'commands/startup.js')).then((cmd) => cmd.default(options));
  });

program
  .command('daemon')
  .description('Run Omnitron as a daemon process')
  .option('--stop', 'Stop the running Omnitron daemon')
  .option('--status', 'Check if Omnitron is running')
  .option('--logs', 'Show last 20 lines of Omnitron logs')
  .option('--follow', 'Follow Omnitron logs in real-time')
  .action(async (options) => {
    await import(path.join(__dirname, 'commands/daemon.js')).then((cmd) => cmd.default(options));
  });

const pm = program.command('pm').description('Process management');

pm.command('start <app>')
  .description('Start a process with advanced options')
  .option('--env <key=value...>', 'Set environment variables for the process')
  .option('--instances <number>', 'Number of instances for cluster mode', '1')
  .option('--cluster', 'Enable cluster mode')
  .option('--exec-mode <mode>', 'Execution mode: fork, cluster, exec', 'fork')
  .option('--autorestart', 'Automatically restart the process on failure', true)
  .option('--max-restarts <number>', 'Max restarts before giving up', '5')
  .option('--restart-delay <ms>', 'Delay before restarting process', '1000')
  .option('--max-memory-restart <size>', 'Restart process if memory exceeds limit (e.g., 512M)')
  .option('--log <path>', 'Path for log output')
  .option('--error-log <path>', 'Path for error log output')
  .option('--interpreter <cmd>', 'Specify interpreter (e.g., node, python3, bash)')
  .option('--args <args...>', 'Additional arguments to pass to the process')
  .option('--cwd <path>', 'Set working directory for the process')
  .option('--uid <uid>', 'Run process as a specific user (Linux only)')
  .option('--gid <gid>', 'Run process as a specific group (Linux only)')
  .action(async (app, options) => {
    await initialize();
    await import(path.join(__dirname, 'commands/process-manager/start.js')).then((cmd) => cmd.default(app, options));
    await Runtime.get().get('peer').disconnect();
  });

// 🟢 Остановка процесса
pm.command('stop <app>')
  .description('Stop a running process')
  .option('-f, --force', 'Force stop the process')
  .action(async (app, options) => {
    await initialize();
    await import(path.join(__dirname, 'commands/stop.js')).then((cmd) => cmd.default(app, options));
    await Runtime.get().get('peer').disconnect();
  });

// 🟢 Перезапуск процесса
pm.command('restart <app>')
  .description('Restart a process (stop + start)')
  .option('-f, --force', 'Force restart')
  .action(async (app, options) => {
    await initialize();
    await import(path.join(__dirname, 'commands/restart.js')).then((cmd) => cmd.default(app, options));
    await Runtime.get().get('peer').disconnect();
  });

// 🟢 Перезапуск без остановки
pm.command('reload <app>')
  .description('Reload a process without stopping it')
  .option('-t, --timeout <seconds>', 'Set reload timeout', '5')
  .action(async (app, options) => {
    await initialize();
    await import(path.join(__dirname, 'commands/reload.js')).then((cmd) => cmd.default(app, options));
  });

// 🟢 Список процессов
pm.command('list')
  .description('List all running processes')
  .option('-d, --details', 'Show detailed information about processes')
  .option('-r, --raw', 'Show raw JSON output')
  .action(async (options) => {
    await initialize();
    await import(path.join(__dirname, 'commands/list.js')).then((cmd) => cmd.default(options));
    await Runtime.get().get('peer').disconnect();
  });

// 🟢 Конфигурация Omnitron
program
  .command('info')
  .description('Show Omnitron daemon information')
  .option('--json', 'Output information in JSON format')
  .action(async (options) => {
    await initialize();
    await import(path.join(__dirname, 'commands/info.js')).then((cmd) => cmd.default(options));
    await Runtime.get().get('peer').disconnect();
  });

program.parse(process.argv);
