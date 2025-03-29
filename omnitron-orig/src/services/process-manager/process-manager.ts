import fs from 'fs';
import path from 'path';
import { Low } from 'lowdb/lib';
import { spawn } from 'child_process';
import { JSONFilePreset } from 'lowdb/node';
import { Public, Service } from '@devgrid/netron';

import { ProcessOptions, IProcessManager, ConfigProcessOptions } from './types';
import { LOG_DIR, OMNITRON_DIR, PROCESSES_FILE, BOOTSTRAP_SCRIPT } from '../../consts';

@Service('process-manager')
export class ProcessManager implements IProcessManager {
  private processes: Low<{ processes: ConfigProcessOptions[] }> | null = null;
  constructor() { }

  async init(): Promise<void> {
    this.ensureOmnitronDirs();
    this.processes = await JSONFilePreset<{ processes: ConfigProcessOptions[] }>(PROCESSES_FILE, { processes: [] });
  }

  /**
   * Starts a new process with the given options.
   * @param options - Configuration options for the process.
   */
  @Public()
  async start(app: string, options: ProcessOptions): Promise<void> {
    this.ensureOmnitronDirs();

    // Если передан файл `omnitron.config.js`, грузим его как конфигурацию
    if (app.endsWith('omnitron.config.js') && fs.existsSync(app)) {
      const configPath = path.resolve(app);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const config = require(configPath);
      if (config.apps) {
        console.log(`📄 Loading configuration from ${app}`);
        config.apps.forEach((appConfig: ProcessOptions) => this.startInternal(appConfig));
        return;
      }
    }

    await this.startInternal(options);
  }

  private async startInternal(options: ProcessOptions): Promise<void> {
    let restartCount = 0;
    const logs = this.setupLogging(options.name);

    if (options.execMode === 'exec' || options.execMode === 'fork') {
      const start = () => {
        let child;
        const isExec = options.execMode === 'exec';

        // console.log(`🚀 Starting ${options.execMode} process "${options.name}"...`);

        if (isExec) {
          const command = options.interpreter || options.script;
          const args = options.interpreter ? [options.script, ...(options.args || [])] : options.args || [];

          child = spawn(command, args, {
            detached: true,
            cwd: options.cwd || process.cwd(),
            env: { ...process.env, ...options.env },
            stdio: ['ignore', fs.createWriteStream(logs.outPath), fs.createWriteStream(logs.errPath)],
          });
        } else {
          child = spawn('node', [BOOTSTRAP_SCRIPT, ...(options.args ?? [])], {
            detached: true,
            cwd: options.cwd || process.cwd(),
            env: { ...process.env, ...options.env },
            stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
          });

          child.on('spawn', () => {
            child.send({
              type: 'options',
              options,
            });
          });
        }

        if (child) {
          console.log(`✅ Process "${options.name}" started with PID ${child.pid}`);

          this.saveProcesses([...this.loadProcesses(), { ...options, pid: child.pid }]);

          child.on('exit', (code) => {
            console.log(`⚠️ Process "${options.name}" exited with code ${code}.`);

            if (options.autorestart && restartCount < (options.maxRestarts || 5)) {
              restartCount++;
              console.log(
                `🔄 Restarting process "${options.name}" in ${options.restartDelay || 1000} ms (Restart #${restartCount})...`
              );
              setTimeout(start, options.restartDelay || 1000);
            } else {
              console.log(`❌ Process "${options.name}" reached max restart limit.`);
            }
          });
        }
      };

      start();
    } else {
      console.log(`🚀 Starting cluster process "${options.name}"...`);

      const child = spawn('node', [BOOTSTRAP_SCRIPT], {
        detached: true,
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });

      child.on('spawn', () => {
        child.send({
          type: 'options',
          options,
        });
      });

      console.log(`✅ Cluster process "${options.name}" started. Bootstrap PID: ${child.pid}`);
      this.saveProcesses([...this.loadProcesses(), { ...options, pid: child.pid! }]);
    }
  }

  /**
   * Stops a running process by its ID.
   * @param id - The ID of the process to stop. If not provided, stops all processes.
   */
  @Public()
  async stop(id?: string): Promise<void> {
    console.log('🛑 ProcessManager stopped');
  }

  /**
   * Restarts a running process by its ID.
   * @param id - The ID of the process to restart. If not provided, restarts all processes.
   */
  @Public()
  async restart(id?: string): Promise<void> {
    console.log('🔄 ProcessManager restarted');
  }

  /**
   * Lists all controlled processes.
   */
  @Public()
  async list(): Promise<void> {
    console.log('🔍 ProcessManager status');
  }

  /**
   * Ensures necessary directories exist.
   */
  private ensureOmnitronDirs(): void {
    if (!fs.existsSync(OMNITRON_DIR)) fs.mkdirSync(OMNITRON_DIR, { recursive: true });
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    if (!fs.existsSync(PROCESSES_FILE)) fs.writeFileSync(PROCESSES_FILE, JSON.stringify([]));
  }

  /**
   * Logs process output to files.
   */
  private setupLogging(name: string): { outPath: string; errPath: string } {
    const outPath = path.join(LOG_DIR, `${name}-out.log`);
    const errPath = path.join(LOG_DIR, `${name}-err.log`);
    return { outPath, errPath };
  }

  // /**
  //  * Saves updated process list.
  //  */
  // private saveProcesses(processes: ConfigProcessOptions[]): void {
  //   fs.writeFileSync(PROCESSES_FILE, JSON.stringify(processes, null, 2));
  // }
}
