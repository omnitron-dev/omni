import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import { table, getBorderCharacters } from 'table';

import { PID_FILE } from './consts';

/**
 * Retrieves the Machine UID from the system.
 */
export function getMachineId(): string {
  try {
    // ✅ Linux/macOS: Try reading `/etc/machine-id`
    if (fs.existsSync('/etc/machine-id')) {
      return fs.readFileSync('/etc/machine-id', 'utf-8').trim();
    }

    // ✅ Linux (DBus fallback): `/var/lib/dbus/machine-id`
    if (fs.existsSync('/var/lib/dbus/machine-id')) {
      return fs.readFileSync('/var/lib/dbus/machine-id', 'utf-8').trim();
    }

    // ✅ Windows: Read Machine GUID from registry
    if (os.platform() === 'win32') {
      // not tested
      try {
        return execSync('wmic csproduct get uuid', { encoding: 'utf-8' })?.split('\n')[1]?.trim() || '';
      } catch (error) {
        console.error('❌ Failed to retrieve Machine ID on Windows:', error);
      }
    }
  } catch (error) {
    console.error('❌ Failed to retrieve Machine ID:', error);
  }

  // ❌ Fallback: Generate a pseudo-unique ID using system info
  return generateFallbackMachineId();
}

/**
 * Generates a fallback Machine ID based on system properties.
 */
function generateFallbackMachineId(): string {
  try {
    const cpuInfo = os.cpus()[0]?.model;
    const macAddress = os.networkInterfaces()?.['eth0']?.[0]?.mac || '00:00:00:00:00:00';
    return Buffer.from(`${cpuInfo}-${macAddress}`).toString('hex').slice(0, 32);
  } catch (error) {
    return '00000000000000000000000000000000'; // Last resort fallback
  }
}

/**
 * Determines if the process is already running in daemon mode.
 */
export function isDaemonProcess(): boolean {
  return process.env.OMNITRON_DAEMON === '1';
}

/**
 * Checks if Omnitron is already running.
 */
export function isDaemonRunning(): boolean {
  try {
    if (!fs.existsSync(PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    try {
      process.kill(pid, 0); // Check if process exists
      return true;
    } catch (error: any) {
      if (error.code === 'ESRCH') {
        return false; // Process does not exist
      }
      throw error; // Re-throw other errors
    }
  } catch (error: any) {
    console.error(`❌ Error checking if Omnitron is running: ${error.message}`);
    return false;
  }
}

export function formatTable(data: Record<string, any>): string {
  const rows = Object.entries(data);

  const config = {
    border: getBorderCharacters('void'),
    columnDefault: {
      paddingLeft: 0,
      paddingRight: 3,
    },
    drawHorizontalLine: () => false,
  };

  return table(rows, config);
}
