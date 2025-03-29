import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

import { BIN_PATH, PID_FILE, NODE_PATH, SYSTEMD_PATH, OMNITRON_SCRIPT } from '../consts';

/**
 * Checks if systemd is available on the system.
 */
function checkSystemd(): void {
  try {
    execSync('systemctl --version', { stdio: 'ignore' });
  } catch (error: any) {
    console.error('❌ Systemd is not available. This command is intended only for Ubuntu/Debian.');
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Creates the shell script `/usr/local/bin/omnitron` to correctly run Omnitron.
 */
function createShellScript(): void {
  const scriptContent = `#!/bin/bash
if [[ $# -eq 0 ]]; then
  ${NODE_PATH} ${OMNITRON_SCRIPT} daemon
else
  ${NODE_PATH} ${OMNITRON_SCRIPT} "$@"
fi
`;

  fs.writeFileSync(BIN_PATH, scriptContent, { mode: 0o755 });
  console.log(`✅ Created shell script: ${BIN_PATH}`);
}

/**
 * Creates a systemd service file for Omnitron.
 */
function createSystemdService(): void {
  const serviceContent = `
[Unit]
Description=Omnitron Process Manager
After=network.target

[Service]
Type=forking
PIDFile=${PID_FILE}
ExecStart=${BIN_PATH} daemon
ExecStop=${BIN_PATH} daemon --stop
Restart=always
User=${os.userInfo().username}
WorkingDirectory=${path.resolve(__dirname, '../')}
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal
SyslogIdentifier=omnitron

[Install]
WantedBy=multi-user.target
`;

  fs.writeFileSync(SYSTEMD_PATH, serviceContent);
  console.log(`✅ Created systemd unit file: ${SYSTEMD_PATH}`);

  // Reload systemd and enable the service
  execSync('systemctl daemon-reload');
  execSync('systemctl enable omnitron');
  execSync('systemctl start omnitron');

  console.log('🚀 Omnitron is now installed as a systemd service and started!');
}

/**
 * Removes the systemd service and the shell script.
 */
function removeSystemdService(): void {
  if (!fs.existsSync(SYSTEMD_PATH)) {
    console.log('❌ Omnitron is not installed as a systemd service.');
    return;
  }

  execSync('systemctl stop omnitron');
  execSync('systemctl disable omnitron');
  fs.unlinkSync(SYSTEMD_PATH);
  if (fs.existsSync(BIN_PATH)) fs.unlinkSync(BIN_PATH);
  execSync('systemctl daemon-reload');

  console.log('🗑️ Omnitron has been removed from systemd and stopped.');
}

/**
 * Main function for executing the startup command.
 */
export default function startup(options: { unmount?: boolean }): void {
  checkSystemd();

  if (options.unmount) {
    removeSystemdService();
  } else {
    createShellScript();
    createSystemdService();
  }
}
