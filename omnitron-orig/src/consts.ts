import os from 'os';
import path from 'path';

export const OMNITRON_DIR = path.join(os.homedir(), '.omnitron');
export const PID_FILE = path.join(OMNITRON_DIR, 'omnitron.pid');
export const LOG_FILE = path.join(OMNITRON_DIR, 'omnitron.log');
export const NODE_PATH = process.execPath; // Path to Node.js binary
export const OMNITRON_SCRIPT = path.resolve(__dirname, '../bin/omnitron.js'); // Main Omnitron CLI script
export const CONFIG_FILE = path.join(OMNITRON_DIR, 'config.json');
export const SYSTEMD_PATH = '/etc/systemd/system/omnitron.service';
export const BIN_PATH = '/usr/local/bin/omnitron';
export const PROCESSES_FILE = path.join(OMNITRON_DIR, 'processes.json');
export const LOG_DIR = path.join(OMNITRON_DIR, 'logs');
export const BOOTSTRAP_SCRIPT = path.resolve(__dirname, 'services/process-manager/bootstrap.js');
