import fs from 'fs';
import { pick } from 'es-toolkit';
import { spawn, execSync } from 'child_process';

import { Runtime } from '../runtime';
import { loadConfig } from '../config';
import { CoreService, ProcessManager } from '../services';
import { isDaemonProcess, isDaemonRunning } from '../utils';
import { PID_FILE, LOG_FILE, NODE_PATH, CONFIG_FILE, OMNITRON_DIR, OMNITRON_SCRIPT } from '../consts';

/**
 * Ensures that `~/.omnitron` directory exists.
 */
function ensureOmnitronDir(): void {
  try {
    if (!fs.existsSync(OMNITRON_DIR)) {
      fs.mkdirSync(OMNITRON_DIR, { recursive: true });
    }
  } catch (error: any) {
    console.error(`❌ Error ensuring Omnitron directory: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Runs the Omnitron daemon core (child process).
 */
async function runDaemonCore(): Promise<void> {
  console.log('🚀 Omnitron daemon process started...');

  const config = loadConfig();

  const netron = Runtime.get().getNetron(
    pick(config, [
      'id',
      'listenHost',
      'listenPort',
      'taskTimeout',
      'taskOverwriteStrategy',
      'connectTimeout',
      'requestTimeout',
      'streamTimeout',
    ])
  );
  await netron.start();
  console.log('🚀 Netron started.');
  await netron.peer.exposeService(new CoreService());
  console.log('🚀 Service CoreService exposed.');
  const processManager = new ProcessManager();
  // Load processes from config and restore them
  await processManager.init();
  await netron.peer.exposeService(processManager);
  console.log('🚀 Service ProcessManager exposed.');

  process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught exception:', err);
    cleanupAndExit(1);
  });

  process.on('SIGTERM', () => {
    console.log('🛑 Omnitron received SIGTERM, exiting...');
    cleanupAndExit(0);
  });

  process.on('SIGINT', () => {
    console.log('🛑 Omnitron received SIGINT, exiting...');
    cleanupAndExit(0);
  });

  process.on('exit', (code) => {
    cleanupAndExit(code);
  });

  async function cleanupAndExit(code: number | null): Promise<void> {
    await Runtime.get().getNetron().stop();
    console.log('🛑 Netron successfully stopped.');

    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    console.log('🛑 Omnitron successfully stopped.');
    process.exit(code !== null ? code : 0);
  }
}

/**
 * Starts Omnitron as a background process.
 */
function startDaemon(): void {
  ensureOmnitronDir();

  if (isDaemonRunning()) {
    console.log('✅ Omnitron is already running.');
    process.exit(1);
  }

  console.log('🚀 Starting Omnitron in daemon mode...');

  try {
    const out = fs.openSync(LOG_FILE, 'a');
    const err = fs.openSync(LOG_FILE, 'a');

    const child = spawn(NODE_PATH, [OMNITRON_SCRIPT, 'daemon'], {
      detached: true,
      stdio: ['ignore', out, err],
      env: { ...process.env, OMNITRON_DAEMON: '1' },
    });

    if (child.pid !== undefined) {
      fs.writeFileSync(PID_FILE, child.pid.toString());
      console.log(`📄 Config: ${CONFIG_FILE}`);
      console.log(`📄 Logs: ${LOG_FILE}`);
      console.log(`✅ Omnitron started with PID: ${child.pid}`);
    } else {
      throw new Error('Child process PID is undefined.');
    }

    child.unref();
  } catch (error: any) {
    console.error(`❌ Failed to start Omnitron: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Stops Omnitron if running.
 */
function stopDaemon(): void {
  if (!fs.existsSync(PID_FILE)) {
    console.log('❌ Omnitron is not running.');
    return;
  }

  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    process.kill(pid);
    fs.unlinkSync(PID_FILE);
    console.log(`🛑 Omnitron (PID: ${pid}) has been stopped.`);
  } catch (error: any) {
    console.error(`❌ Failed to stop Omnitron: ${error.message}`);
  }
}

/**
 * Shows the status of Omnitron.
 */
function showStatus(): void {
  try {
    if (isDaemonRunning()) {
      console.log('✅ Omnitron is running.');
    } else {
      console.log('❌ Omnitron is not running.');
    }
  } catch (error: any) {
    console.error(`❌ Error showing status: ${error.message}`);
  }
}

/**
 * Shows the last 20 lines of logs.
 */
function showLogs(): void {
  if (!fs.existsSync(LOG_FILE)) {
    console.log('❌ No logs found.');
    return;
  }

  try {
    const logs = execSync(`tail -n 20 ${LOG_FILE}`).toString();
    console.log(logs);
  } catch (error: any) {
    console.error(`❌ Failed to read logs: ${error.message}`);
  }
}

/**
 * Follows logs in real-time.
 */
function followLogs(): void {
  if (!fs.existsSync(LOG_FILE)) {
    console.log('❌ No logs found.');
    return;
  }

  console.log('📡 Following Omnitron logs...');
  try {
    execSync(`tail -f ${LOG_FILE}`, { stdio: 'inherit' });
  } catch (error: any) {
    console.error(`❌ Failed to follow logs: ${error.message}`);
  }
}

/**
 * Main function for executing the daemon command.
 */
export default function daemon(options: { stop?: boolean; status?: boolean; logs?: boolean; follow?: boolean }): void {
  try {
    if (isDaemonProcess()) {
      runDaemonCore();
      return;
    }

    if (options.stop) {
      stopDaemon();
    } else if (options.status) {
      showStatus();
    } else if (options.logs) {
      showLogs();
    } else if (options.follow) {
      followLogs();
    } else {
      startDaemon();
    }
  } catch (error: any) {
    console.error(`❌ Error executing daemon command: ${error.message}`);
  }
}
