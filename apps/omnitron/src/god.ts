// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import os from 'os';
import fs from 'fs';
import path from 'path';
import Cron from 'croner';
import dayjs from 'dayjs';
import vizion from 'vizion';
import domain from 'domain';
import chokidar from 'chokidar';
import eachLimit from 'async/eachLimit';
import cluster, { Worker } from 'cluster';
import timesLimit from 'async/timesLimit';
import { EventEmitter2 } from 'eventemitter2';
import { spawn, ChildProcess } from 'child_process';

import cst from './constants';
import Utility from './utility';
import pkg from '../package.json';
import treekill from './tree-kill';
import { Configuration } from './configuration';

/**
 * Override cluster module configuration
 */

if (cst.IS_BUN === true) {
  cluster.setupPrimary({
    windowsHide: true,
    exec: path.resolve(path.dirname(module.filename), 'process-container-bun.js'),
  });
} else {
  cluster.setupPrimary({
    windowsHide: true,
    exec: path.resolve(path.dirname(module.filename), 'process-container.js'),
  });
}

interface ProcEnv {
  pm_id: number;
  cron_restart?: string;
  max_memory_restart?: number;
  axm_options?: { pid?: number };
  exp_backoff_restart_delay?: number;
  prev_restart_delay?: number;
  pm_uptime?: number;
}

interface ProcKey {
  omnitron_env: ProcEnv;
  monit?: { memory?: number };
}

interface OmnitronEnv {
  pm_id: string;
  watch: boolean | string | string[];
  ignore_watch?: string | RegExp;
  watch_options?: chokidar.WatchOptions;
  name: string;
  watch_delay?: number;
  exec_interpreter?: string;
  pm_pid_path: string;
  node_args?: string[];
  pm_exec_path: string;
  args?: string[];
  pm_out_log_path: string;
  pm_err_log_path: string;
  pm_log_path?: string;
  log_date_format?: string;
  log_type?: string;
  disable_logs?: boolean;
  versioning?: { revision?: string };
  namespace?: string;
  pm_cwd?: string;
  windowsHide?: boolean;
  uid?: number;
  gid?: number;
}

interface Stds {
  out: string;
  err: string;
  std?: string;
}

interface EnvCopy {
  name: string;
  pm_id: number;
  node_args?: string[];
  _omnitron_version?: string;
  versioning?: { revision?: string };
  namespace?: string;
  node_version?: string;
}

interface Message {
  data?: any;
  type?: string;
  node_version?: string;
}

/**
 * Expose God
 */
interface GodType {
  next_id: number;
  clusters_db: Record<string, any>;
  configuration: Record<string, any>;
  started_at: number;
  system_infos_proc: any;
  system_infos: any;
  bus: EventEmitter2;
  init: () => void;
  writeExitSeparator: (omnitron_env: any, code: number, signal: string) => void;
  prepare: (env: any, cb: (err: any, result?: any) => void) => void;
  executeApp: (env: any, cb: (err: any, result?: any) => void) => void;
  handleExit: (clu: any, exit_code: number, kill_signal: string) => void;
  finalizeProcedure: (proc: any) => void;
  injectVariables: (env: any, cb: (err: any, env?: any) => void) => void;

  CronJobs: Map<string, any>;
  Worker: { is_running: boolean; start: () => void; stop: () => void };
  getCronID: (pm_id: number) => string;
  registerCron: (omnitron_env: ProcEnv) => void;
  deleteCron: (id: number) => void;
  getMonitorData: (arg: null, cb: (err: Error | null, data?: any) => void) => void;
  restartProcessId: (opts: { id: number }, cb: (err: Error | null, data?: any) => void) => void;
  reloadProcessId: (opts: { id: number }, cb: (err: Error | null, data?: any) => void) => void;

  watch: {
    _watchers: Record<string, chokidar.FSWatcher | null>;
    enable: (omnitron_env: OmnitronEnv) => void;
    disableAll: () => void;
    disable: (omnitron_env: OmnitronEnv) => boolean;
  };
  restartProcessName: (name: string, callback: (err: Error | null, list?: any) => void) => void;

  forkMode: (omnitron_env: OmnitronEnv, cb: (err: Error | null, cspr?: ChildProcess) => void) => void;
  logAndGenerateError: (err: Error) => void;

  nodeApp: (env_copy: EnvCopy, cb: (err: Error | null, clu?: Worker) => void) => void;
}

const _getProcessById = (pm_id: number): any => {
  const proc = God.clusters_db[pm_id];
  return proc ? proc : null;
};

const maxMemoryRestart = (proc_key: ProcKey, cb: () => void): void => {
  const proc = _getProcessById(proc_key.omnitron_env.pm_id);

  if (!(proc && proc.omnitron_env && proc_key.monit)) return cb();

  if (
    proc_key.monit.memory !== undefined &&
    proc.omnitron_env.max_memory_restart !== undefined &&
    proc.omnitron_env.max_memory_restart < proc_key.monit.memory &&
    proc.omnitron_env.axm_options &&
    proc.omnitron_env.axm_options.pid === undefined
  ) {
    console.log(
      '[OMNITRON][WORKER] Process %s restarted because it exceeds --max-memory-restart value (current_memory=%s max_memory_limit=%s [octets])',
      proc.omnitron_env.pm_id,
      proc_key.monit.memory,
      proc.omnitron_env.max_memory_restart
    );
    God.reloadProcessId(
      {
        id: proc.omnitron_env.pm_id,
      },
      (err, data) => {
        if (err) console.error(err.stack || err);
        return cb();
      }
    );
  } else {
    return cb();
  }
};

/**
 * softReload will wait permission from process to exit
 * @method softReload
 * @param {} God
 * @param {} id
 * @param {} cb
 * @return Literal
 */
function softReload(God: any, id: string, cb: (err?: Error) => void): boolean {
  const t_key = '_old_' + id;

  // Move old worker to tmp id
  God.clusters_db[t_key] = God.clusters_db[id];

  delete God.clusters_db[id];

  const old_worker = God.clusters_db[t_key];

  // Deep copy
  const new_env = Utility.clone(old_worker.omnitron_env);

  // Reset created_at and unstable_restarts
  God.resetState(new_env);

  new_env.restart_time += 1;

  old_worker.omnitron_env.pm_id = t_key;
  old_worker.pm_id = t_key;

  God.executeApp(new_env, function (err: Error, new_worker: any) {
    if (err) return cb(err);

    let timer: NodeJS.Timeout | null = null;

    const onListen = () => {
      if (timer) clearTimeout(timer);
      softCleanDeleteProcess();
      console.log('-softReload- New worker listening');
    };

    // Bind to know when the new process is up
    new_worker.once('listening', onListen);

    timer = setTimeout(() => {
      new_worker.removeListener('listening', onListen);
      softCleanDeleteProcess();
    }, new_env.listen_timeout || cst.GRACEFUL_LISTEN_TIMEOUT);

    // Remove old worker properly
    const softCleanDeleteProcess = () => {
      const cleanUp = () => {
        if (timer) clearTimeout(timer);
        console.log('-softReload- Old worker disconnected');
        return God.deleteProcessId(t_key, cb);
      };

      old_worker.once('disconnect', cleanUp);

      try {
        if (old_worker.state != 'dead' && old_worker.state != 'disconnected') old_worker.send?.('shutdown');
        else {
          if (timer) clearTimeout(timer);
          console.error('Worker %d is already disconnected', old_worker.omnitron_env.pm_id);
          return God.deleteProcessId(t_key, cb);
        }
      } catch (e) {
        if (timer) clearTimeout(timer);
        console.error('Worker %d is already disconnected', old_worker.omnitron_env.pm_id);
        return God.deleteProcessId(t_key, cb);
      }

      timer = setTimeout(() => {
        old_worker.removeListener('disconnect', cleanUp);
        return God.deleteProcessId(t_key, cb);
      }, cst.GRACEFUL_TIMEOUT);
      return false;
    };
    return false;
  });
  return false;
}

/**
 * hardReload will reload without waiting permission from process
 * @method hardReload
 * @param {} God
 * @param {} id
 * @param {} cb
 * @return Literal
 */
function hardReload(God: any, id: string, wait_msg: string, cb: (err?: Error) => void): boolean {
  const t_key = '_old_' + id;

  // Move old worker to tmp id
  God.clusters_db[t_key] = God.clusters_db[id];
  delete God.clusters_db[id];

  const old_worker = God.clusters_db[t_key];
  // Deep copy
  const new_env = Utility.clone(old_worker.omnitron_env);
  new_env.restart_time += 1;

  // Reset created_at and unstable_restarts
  God.resetState(new_env);

  old_worker.omnitron_env.pm_id = t_key;
  old_worker.pm_id = t_key;
  let timer: NodeJS.Timeout | null = null;
  let readySignalSent = false;

  const onListen = () => {
    if (timer) clearTimeout(timer);
    readySignalSent = true;
    console.log('-reload- New worker listening');
    return God.deleteProcessId(t_key, cb);
  };

  const listener = (packet: any) => {
    if (packet.raw === 'ready' && packet.process.name === old_worker.omnitron_env.name && packet.process.pm_id === id) {
      God.bus.removeListener('process:msg', listener);
      return onListen();
    }
  };

  if (wait_msg !== 'listening') {
    God.bus.on('process:msg', listener);
  }

  God.executeApp(new_env, function (err: Error, new_worker: any) {
    if (err) return cb(err);

    // Bind to know when the new process is up
    if (wait_msg === 'listening') {
      new_worker.once('listening', onListen);
    }

    timer = setTimeout(() => {
      if (readySignalSent) {
        return;
      }

      if (wait_msg === 'listening') new_worker.removeListener(wait_msg, onListen);
      else God.bus.removeListener('process:msg', listener);

      return God.deleteProcessId(t_key, cb);
    }, new_env.listen_timeout || cst.GRACEFUL_LISTEN_TIMEOUT);

    return false;
  });
  return false;
}

const God: GodType = {
  next_id: 0,
  clusters_db: {},
  configuration: {},
  started_at: Date.now(),
  system_infos_proc: null,
  system_infos: null,
  bus: new EventEmitter2({
    wildcard: true,
    delimiter: ':',
    maxListeners: 1000,
  }),
  /**
   * Watch folder for changes and restart
   * @method watch
   * @param {Object} omnitron_env omnitron app environnement
   * @return MemberExpression
   */
  watch: {
    _watchers: {},
    enable(omnitron_env: OmnitronEnv) {
      if (God.watch._watchers[omnitron_env.pm_id]) {
        God.watch._watchers[omnitron_env.pm_id]?.close();
        God.watch._watchers[omnitron_env.pm_id] = null;
        delete God.watch._watchers[omnitron_env.pm_id];
      }

      let watch = omnitron_env.watch;

      if (typeof watch == 'boolean' || (Array.isArray(watch) && watch.length === 0)) watch = omnitron_env.pm_cwd;

      let watch_options: chokidar.WatchOptions = {
        ignored: omnitron_env.ignore_watch || /[\/\\]\.|node_modules/,
        persistent: true,
        ignoreInitial: true,
        cwd: omnitron_env.pm_cwd,
      };

      if (omnitron_env.watch_options) {
        watch_options = Object.assign(watch_options, omnitron_env.watch_options);
      }

      const watcher = chokidar.watch(watch, watch_options);

      console.log('[Watch] Start watching', omnitron_env.name);

      watcher.on('all', (event, path) => {
        const self = this as any;

        if (self.restarting === true) {
          return false;
        }

        self.restarting = true;

        console.log('Change detected on path %s for app %s - restarting', path, omnitron_env.name);

        setTimeout(() => {
          God.restartProcessName(omnitron_env.name, (err, list) => {
            self.restarting = false;

            if (err) {
              return false;
            }
          });
        }, omnitron_env.watch_delay || 0);

        return false;
      });

      watcher.on('error', (e) => {
        console.error(e.stack || e);
      });

      God.watch._watchers[omnitron_env.pm_id] = watcher;

      //return God.watch._watchers[omnitron_env.name];
    },
    disableAll() {
      const watchers = God.watch._watchers;

      console.log('[Watch] OMNITRON is being killed. Watch is disabled to avoid conflicts');
      for (const i in watchers) {
        watchers[i]?.close?.();
        delete watchers[i];
      }
    },
    disable(omnitron_env: OmnitronEnv) {
      const watcher = God.watch._watchers[omnitron_env.pm_id];
      if (watcher) {
        console.log('[Watch] Stop watching', omnitron_env.name);
        watcher.close();
        delete God.watch._watchers[omnitron_env.pm_id];
        return true;
      } else {
        return false;
      }
    },
  },
  init() {
    let timer: NodeJS.Timeout | null = null;

    God.CronJobs = new Map();
    God.Worker = {
      is_running: false,
      start: () => {
        timer = setInterval(() => {
          const d = domain.create();

          d.once('error', (err) => {
            console.error('[OMNITRON][WORKER] Error caught by domain:\n' + (err.stack || err));
            God.Worker.is_running = false;
          });

          d.run(() => {
            if (God.Worker.is_running === true) {
              return false;
            }
            God.Worker.is_running = true;

            God.getMonitorData(null, (err, data) => {
              if (err || !data || typeof data !== 'object') {
                God.Worker.is_running = false;
                return console.error(err);
              }

              eachLimit(
                data,
                1,
                (proc, next) => {
                  if (!proc || !proc.omnitron_env || proc.omnitron_env.pm_id === undefined) return next();

                  if (
                    proc.omnitron_env.exp_backoff_restart_delay !== undefined &&
                    proc.omnitron_env.prev_restart_delay &&
                    proc.omnitron_env.prev_restart_delay > 0
                  ) {
                    const app_uptime = Date.now() - proc.omnitron_env.pm_uptime;
                    if (app_uptime > cst.EXP_BACKOFF_RESET_TIMER) {
                      const ref_proc = _getProcessById(proc.omnitron_env.pm_id);
                      ref_proc.omnitron_env.prev_restart_delay = 0;
                      console.log(
                        `[OMNITRON][WORKER] Reset the restart delay, as app ${proc.name} has been up for more than ${cst.EXP_BACKOFF_RESET_TIMER}ms`
                      );
                    }
                  }

                  maxMemoryRestart(proc, () => next());
                },
                () => {
                  God.Worker.is_running = false;
                }
              );
            });
          });
        }, cst.WORKER_INTERVAL);
      },
      stop: () => {
        if (timer !== null) clearInterval(timer);
      },
    };

    God.system_infos_proc = null;

    this.configuration = Configuration.getSync('omnitron');

    setTimeout(() => {
      God.Worker.start();
    }, 500);
  },
  writeExitSeparator(omnitron_env, code, signal) {
    try {
      let exit_sep = `[OMNITRON][${new Date().toISOString()}] app exited`;
      if (code) exit_sep += `itself with exit code: ${code}`;
      if (signal) exit_sep += `by an external signal: ${signal}`;
      exit_sep += '\n';

      if (omnitron_env.pm_out_log_path) fs.writeFileSync(omnitron_env.pm_out_log_path, exit_sep);
      if (omnitron_env.pm_err_log_path) fs.writeFileSync(omnitron_env.pm_err_log_path, exit_sep);
      if (omnitron_env.pm_log_path) fs.writeFileSync(omnitron_env.pm_log_path, exit_sep);
    } catch (e) {
      //
    }
  },
  prepare(env, cb) {
    // generate a new unique id for each processes
    env.env.unique_id = Utility.generateUUID();

    // if the app is standalone, no multiple instance
    if (typeof env.instances === 'undefined') {
      env.vizion_running = false;
      if (env.env && env.env.vizion_running) env.env.vizion_running = false;

      if (env.status == cst.STOPPED_STATUS) {
        env.pm_id = God.getNewId();
        const clu = {
          omnitron_env: env,
          process: {},
        };
        God.clusters_db[env.pm_id] = clu;
        God.registerCron(env);
        return cb(null, [God.clusters_db[env.pm_id]]);
      }

      return God.executeApp(env, (err, clu) => {
        if (err) return cb(err);
        God.notify('start', clu, true);
        return cb(null, [Utility.clone(clu)]);
      });
    }

    // find how many replicate the user want
    env.instances = parseInt(env.instances);
    if (env.instances === 0) {
      env.instances = os.cpus().length;
    } else if (env.instances < 0) {
      env.instances += os.cpus().length;
    }
    if (env.instances <= 0) {
      env.instances = 1;
    }

    timesLimit(
      env.instances,
      1,
      (n, next) => {
        env.vizion_running = false;
        if (env.env && env.env.vizion_running) {
          env.env.vizion_running = false;
        }

        God.injectVariables(env, (err, _env) => {
          if (err) return next(err);
          return God.executeApp(Utility.clone(_env), (err, clu) => {
            if (err) return next(err);
            God.notify('start', clu, true);
            // here call next wihtout an array because
            // async.times aggregate the result into an array
            return next(null, Utility.clone(clu));
          });
        });
      },
      cb
    );
  },
  executeApp(env, cb) {
    const env_copy = Utility.clone(env);

    Utility.extend(env_copy, env_copy.env);

    env_copy['status'] = env.autostart ? cst.LAUNCHING_STATUS : cst.STOPPED_STATUS;
    env_copy['pm_uptime'] = Date.now();
    env_copy['axm_actions'] = [];
    env_copy['axm_monitor'] = {};
    env_copy['axm_options'] = {};
    env_copy['axm_dynamic'] = {};
    env_copy['vizion_running'] = env_copy['vizion_running'] !== undefined ? env_copy['vizion_running'] : false;

    if (!env_copy.created_at) env_copy['created_at'] = Date.now();

    /**
     * Enter here when it's the first time that the process is created
     * 1 - Assign a new id
     * 2 - Reset restart time and unstable_restarts
     * 3 - Assign a log file name depending on the id
     * 4 - If watch option is set, look for changes
     */
    if (env_copy['pm_id'] === undefined) {
      env_copy['pm_id'] = God.getNewId();
      env_copy['restart_time'] = 0;
      env_copy['unstable_restarts'] = 0;

      // add -pm_id to pid file
      env_copy.pm_pid_path = env_copy.pm_pid_path.replace(/-[0-9]+\.pid$|\.pid$/g, '-' + env_copy['pm_id'] + '.pid');

      // If merge option, dont separate the logs
      if (!env_copy['merge_logs']) {
        ['', '_out', '_err'].forEach((k) => {
          const key = 'pm' + k + '_log_path';
          if (env_copy[key]) {
            env_copy[key] = env_copy[key].replace(/-[0-9]+\.log$|\.log$/g, '-' + env_copy['pm_id'] + '.log');
          }
        });
      }

      // Initiate watch file
      if (env_copy['watch']) {
        God.watch.enable(env_copy);
      }
    }

    God.registerCron(env_copy);

    if (env_copy['autostart'] === false) {
      const clu = { omnitron_env: env_copy, process: { pid: 0 } };
      God.clusters_db[env_copy.pm_id] = clu;
      return cb(null, clu);
    }

    let cb_called = false;

    /** Callback when application is launched */
    const readyCb = (proc) => {
      cb_called = true;

      proc.omnitron_env.version = Utility.findPackageVersion(proc.omnitron_env.pm_exec_path || proc.omnitron_env.cwd);
      // If vizion enabled run versioning retrieval system
      if (
        cst.ENABLE_GIT_PARSING === true &&
        proc.omnitron_env.vizion !== false &&
        proc.omnitron_env.vizion !== 'false'
      ) {
        God.finalizeProcedure(proc);
      } else God.notify('online', proc);

      if (proc.omnitron_env.status !== cst.ERRORED_STATUS) proc.omnitron_env.status = cst.ONLINE_STATUS;

      console.log(`App [${proc.omnitron_env.name}:${proc.omnitron_env.pm_id}] online`);
      if (cb) cb(null, proc);
    };

    if (env_copy.exec_mode === 'cluster_mode') {
      /**
       * Cluster mode logic (for NodeJS apps)
       */
      this.nodeApp(env_copy, (err, clu) => {
        if (cb && err) return cb(err);
        if (err) return false;

        let old_env = God.clusters_db[clu.omnitron_env.pm_id];

        if (old_env) {
          old_env = null;
          God.clusters_db[clu.omnitron_env.pm_id] = null;
        }

        God.clusters_db[clu.omnitron_env.pm_id] = clu;

        if (cst.IS_BUN) {
          // When starting an app that does not listen on a port
          // Bun do not call 'online' event
          // This is a temporary workaround
          const a = setTimeout(() => {
            if (clu.omnitron_env) God.clusters_db[clu.omnitron_env.pm_id].state = 'online';
            return readyCb(clu);
          }, 500);
        }

        clu.once('error', (err) => {
          if (cst.IS_BUN) clearTimeout(a);

          console.error(err.stack || err);
          try {
            clu.destroy?.();
          } catch (e) {
            console.error(e.stack || e);
            God.handleExit(clu, cst.ERROR_EXIT);
          }
        });

        clu.once('disconnect', () => {
          if (cst.IS_BUN) clearTimeout(a);

          console.log('App name:%s id:%s disconnected', clu.omnitron_env.name, clu.omnitron_env.pm_id);
        });

        clu.once('exit', function cluExit(code, signal) {
          if (cst.IS_BUN) {
            clearTimeout(a);
            if (cb_called == false) readyCb(clu);
          }
          //God.writeExitSeparator(clu.omnitron_env, code, signal)

          God.handleExit(clu, code || 0, signal || 'SIGINT');
        });

        return clu.once('online', () => {
          if (cst.IS_BUN) {
            clearTimeout(a);
          }

          if (!clu.omnitron_env.wait_ready) return readyCb(clu);

          // Timeout if the ready message has not been sent before listen_timeout
          const ready_timeout = setTimeout(() => {
            God.bus.removeListener('process:msg', listener);
            return readyCb(clu);
          }, clu.omnitron_env.listen_timeout || cst.GRACEFUL_LISTEN_TIMEOUT);

          const listener = (packet: any) => {
            if (
              packet.raw === 'ready' &&
              packet.process.name === clu.omnitron_env.name &&
              packet.process.pm_id === clu.omnitron_env.pm_id
            ) {
              clearTimeout(ready_timeout);
              God.bus.removeListener('process:msg', listener);
              return readyCb(clu);
            }
          };

          God.bus.on('process:msg', listener);
        });
      });
    } else {
      /**
       * Fork mode logic
       */
      this.forkMode(env_copy, (err, clu) => {
        if (cb && err) return cb(err);
        if (err) return false;

        let old_env = God.clusters_db[clu.omnitron_env.pm_id];
        if (old_env) old_env = null;

        God.clusters_db[env_copy.pm_id] = clu;

        clu.once('error', (err) => {
          console.error(err.stack || err);
          try {
            clu.kill?.();
          } catch (e) {
            console.error(e.stack || e);
            God.handleExit(clu, cst.ERROR_EXIT);
          }
        });

        clu.once('exit', (code, signal) => {
          //God.writeExitSeparator(clu.omnitron_env, code, signal)

          if (clu.connected === true) clu.disconnect?.();
          clu._reloadLogs = null;
          return God.handleExit(clu, code || 0, signal);
        });

        if (!clu.omnitron_env.wait_ready) return readyCb(clu);

        // Timeout if the ready message has not been sent before listen_timeout
        const ready_timeout = setTimeout(() => {
          God.bus.removeListener('process:msg', listener);
          return readyCb(clu);
        }, clu.omnitron_env.listen_timeout || cst.GRACEFUL_LISTEN_TIMEOUT);

        const listener = (packet: any) => {
          if (
            packet.raw === 'ready' &&
            packet.process.name === clu.omnitron_env.name &&
            packet.process.pm_id === clu.omnitron_env.pm_id
          ) {
            clearTimeout(ready_timeout);
            God.bus.removeListener('process:msg', listener);
            readyCb(clu);
            return;
          }
        };
        God.bus.on('process:msg', listener);
      });
    }
    return false;
  },
  handleExit(clu, exit_code, kill_signal) {
    console.log(
      `App [${clu.omnitron_env.name}:${clu.omnitron_env.pm_id}] exited with code [${exit_code}] via signal [${kill_signal || 'SIGINT'}]`
    );

    const proc = this.clusters_db[clu.omnitron_env.pm_id];

    if (!proc) {
      console.error('Process undefined ? with process id ', clu.omnitron_env.pm_id);
      return false;
    }

    let stopExitCodes =
      proc.omnitron_env.stop_exit_codes !== undefined && proc.omnitron_env.stop_exit_codes !== null
        ? proc.omnitron_env.stop_exit_codes
        : [];
    if (!Array.isArray(stopExitCodes)) {
      stopExitCodes = [stopExitCodes];
    }

    const stopping =
      proc.omnitron_env.status == cst.STOPPING_STATUS ||
      proc.omnitron_env.status == cst.STOPPED_STATUS ||
      proc.omnitron_env.status == cst.ERRORED_STATUS ||
      proc.omnitron_env.autorestart === false ||
      proc.omnitron_env.autorestart === 'false' ||
      stopExitCodes
        .map((strOrNum: string | number) => (typeof strOrNum === 'string' ? parseInt(strOrNum, 10) : strOrNum))
        .includes(exit_code);

    let overlimit = false;

    if (stopping) proc.process.pid = 0;

    // Reset probes and actions
    if (proc.omnitron_env.axm_actions) proc.omnitron_env.axm_actions = [];
    if (proc.omnitron_env.axm_monitor) proc.omnitron_env.axm_monitor = {};

    if (proc.omnitron_env.status != cst.ERRORED_STATUS && proc.omnitron_env.status != cst.STOPPING_STATUS)
      proc.omnitron_env.status = cst.STOPPED_STATUS;

    if (proc.omnitron_env.pm_id.toString().indexOf('_old_') !== 0) {
      try {
        fs.unlinkSync(proc.omnitron_env.pm_pid_path);
      } catch (e) {
        //
      }
    }

    /**
     * Avoid infinite reloop if an error is present
     */
    // If the process has been created less than 15seconds ago

    // And if the process has an uptime less than a second
    const min_uptime = typeof proc.omnitron_env.min_uptime !== 'undefined' ? proc.omnitron_env.min_uptime : 1000;
    const max_restarts = typeof proc.omnitron_env.max_restarts !== 'undefined' ? proc.omnitron_env.max_restarts : 16;

    if (Date.now() - proc.omnitron_env.created_at < min_uptime * max_restarts) {
      if (Date.now() - proc.omnitron_env.pm_uptime < min_uptime) {
        // Increment unstable restart
        proc.omnitron_env.unstable_restarts += 1;
      }
    }

    if (proc.omnitron_env.unstable_restarts >= max_restarts) {
      // Too many unstable restart in less than 15 seconds
      // Set the process as 'ERRORED'
      // And stop restarting it
      proc.omnitron_env.status = cst.ERRORED_STATUS;
      proc.process.pid = 0;

      console.log(
        'Script %s had too many unstable restarts (%d). Stopped. %j',
        proc.omnitron_env.pm_exec_path,
        proc.omnitron_env.unstable_restarts,
        proc.omnitron_env.status
      );

      God.notify('restart overlimit', proc);

      proc.omnitron_env.unstable_restarts = 0;
      proc.omnitron_env.created_at = null;
      overlimit = true;
    }

    if (typeof exit_code !== 'undefined') proc.omnitron_env.exit_code = exit_code;

    God.notify('exit', proc);

    if (God.omnitron_being_killed) {
      //console.log('[HandleExit] OMNITRON is being killed, stopping restart procedure...');
      return false;
    }

    let restart_delay = 0;

    if (proc.omnitron_env.restart_delay !== undefined && !isNaN(parseInt(proc.omnitron_env.restart_delay))) {
      proc.omnitron_env.status = cst.WAITING_RESTART;
      restart_delay = parseInt(proc.omnitron_env.restart_delay);
    }

    if (
      proc.omnitron_env.exp_backoff_restart_delay !== undefined &&
      !isNaN(parseInt(proc.omnitron_env.exp_backoff_restart_delay))
    ) {
      proc.omnitron_env.status = cst.WAITING_RESTART;
      if (!proc.omnitron_env.prev_restart_delay) {
        proc.omnitron_env.prev_restart_delay = proc.omnitron_env.exp_backoff_restart_delay;
        restart_delay = proc.omnitron_env.exp_backoff_restart_delay;
      } else {
        proc.omnitron_env.prev_restart_delay = Math.floor(Math.min(15000, proc.omnitron_env.prev_restart_delay * 1.5));
        restart_delay = proc.omnitron_env.prev_restart_delay;
      }
      console.log(`App [${clu.omnitron_env.name}:${clu.omnitron_env.pm_id}] will restart in ${restart_delay}ms`);
    }

    if (!stopping && !overlimit) {
      //make this property unenumerable
      Object.defineProperty(proc.omnitron_env, 'restart_task', { configurable: true, writable: true });
      proc.omnitron_env.restart_task = setTimeout(() => {
        proc.omnitron_env.restart_time += 1;
        God.executeApp(proc.omnitron_env);
      }, restart_delay);
    }

    return false;
  },
  finalizeProcedure(proc) {
    let last_path = '';
    let current_path = proc.omnitron_env.cwd || path.dirname(proc.omnitron_env.pm_exec_path);
    const proc_id = proc.omnitron_env.pm_id;

    proc.omnitron_env.version = Utility.findPackageVersion(proc.omnitron_env.pm_exec_path || proc.omnitron_env.cwd);

    if (proc.omnitron_env.vizion_running === true) {
      return God.notify('online', proc);
    }
    proc.omnitron_env.vizion_running = true;

    vizion.analyze({ folder: current_path }, (err, meta) => {
      const proc_ = God.clusters_db[proc_id];

      if (
        !proc_ ||
        !proc_.omnitron_env ||
        proc_.omnitron_env.status == cst.STOPPED_STATUS ||
        proc_.omnitron_env.status == cst.STOPPING_STATUS ||
        proc_.omnitron_env.status == cst.ERRORED_STATUS
      ) {
        return console.error('Cancelling versioning data parsing');
      }

      proc_.omnitron_env.vizion_running = false;

      if (!err) {
        proc_.omnitron_env.versioning = meta;
        proc_.omnitron_env.versioning.repo_path = current_path;
        God.notify('online', proc_);
      } else if (err && current_path === last_path) {
        proc_.omnitron_env.versioning = null;
        God.notify('online', proc_);
      } else {
        last_path = current_path;
        current_path = path.dirname(current_path);
        proc_.omnitron_env.vizion_running = true;
        vizion.analyze({ folder: current_path }, recur_path);
      }
      return false;
    });
  },
  injectVariables(env, cb) {
    // allow to override the key of NODE_APP_INSTANCE if wanted
    const instanceKey = process.env.OMNITRON_PROCESS_INSTANCE_VAR || env.instance_var;

    // we need to find the last NODE_APP_INSTANCE used
    const instances = Object.keys(God.clusters_db)
      .map((procId) => God.clusters_db[procId])
      .filter((proc) => proc.omnitron_env.name === env.name && typeof proc.omnitron_env[instanceKey] !== 'undefined')
      .map((proc) => proc.omnitron_env[instanceKey])
      .sort((a, b) => b - a);
    // default to last one + 1
    let instanceNumber = typeof instances[0] === 'undefined' ? 0 : instances[0] + 1;
    // but try to find a one available
    for (let i = 0; i < instances.length; i++) {
      if (instances.indexOf(i) === -1) {
        instanceNumber = i;
        break;
      }
    }
    env[instanceKey] = instanceNumber;

    // if using increment_var, we need to increment it
    if (env.increment_var) {
      const lastIncrement = Object.keys(God.clusters_db)
        .map((procId) => God.clusters_db[procId])
        .filter(
          (proc) => proc.omnitron_env.name === env.name && typeof proc.omnitron_env[env.increment_var] !== 'undefined'
        )
        .map((proc) => Number(proc.omnitron_env[env.increment_var]))
        .sort((a, b) => b - a)[0];
      // inject a incremental variable
      const defaut = Number(env.env[env.increment_var]) || 0;
      env[env.increment_var] = typeof lastIncrement === 'undefined' ? defaut : lastIncrement + 1;
      env.env[env.increment_var] = env[env.increment_var];
    }

    return cb(null, env);
  },

  //event
  notify(action_name, data, manually) {
    God.bus.emit('process:event', {
      event: action_name,
      manually: typeof manually == 'undefined' ? false : true,
      process: Utility.formatCLU(data),
      at: Utility.getDate(),
    });
  },

  notifyByProcessId(opts, cb) {
    if (typeof opts.id === 'undefined') {
      return cb(new Error('process id missing'));
    }
    const proc = God.clusters_db[opts.id];
    if (!proc) {
      return cb(new Error('process id doesnt exists'));
    }

    God.bus.emit('process:event', {
      event: opts.action_name,
      manually: typeof opts.manually == 'undefined' ? false : true,
      process: Utility.formatCLU(proc),
      at: Utility.getDate(),
    });

    process.nextTick(() => (cb ? cb(null) : false));
    return false;
  },

  //worker
  getCronID(pm_id: number): string {
    return `cron-${pm_id}`;
  },
  registerCron(omnitron_env: ProcEnv): void {
    if (
      !omnitron_env ||
      omnitron_env.pm_id === undefined ||
      !omnitron_env.cron_restart ||
      omnitron_env.cron_restart == '0' ||
      God.CronJobs.has(God.getCronID(omnitron_env.pm_id))
    )
      return;

    const pm_id = omnitron_env.pm_id;
    console.log('[OMNITRON][WORKER] Registering a cron job on:', pm_id);

    const job = Cron(omnitron_env.cron_restart, () => {
      God.restartProcessId({ id: pm_id }, (err, data) => {
        if (err) console.error(err.stack || err);
        return;
      });
    });

    God.CronJobs.set(God.getCronID(pm_id), job);
  },
  deleteCron(id: number): void {
    if (typeof id !== 'undefined' && God.CronJobs.has(God.getCronID(id)) === false) return;
    console.log('[OMNITRON] Deregistering a cron job on:', id);
    const job = God.CronJobs.get(God.getCronID(id));

    if (job) job.stop();

    God.CronJobs.delete(God.getCronID(id));
  },

  //methods
  logAndGenerateError(err: any): Error {
    // Is an Error object
    if (err instanceof Error) {
      console.trace(err);
      return err;
    }
    // Is a JSON or simple string
    console.error(err);
    return new Error(err);
  },
  getProcesses(): any {
    return God.clusters_db;
  },
  getFormatedProcess(id: number): any {
    if (God.clusters_db[id])
      return {
        pid: God.clusters_db[id].process.pid,
        name: God.clusters_db[id].omnitron_env.name,
        omnitron_env: God.clusters_db[id].omnitron_env,
        pm_id: God.clusters_db[id].omnitron_env.pm_id,
      };
    return {};
  },
  /**
   * Get formated processes
   * @method getFormatedProcesses
   * @return {Array} formated processes
   */
  getFormatedProcesses(): any[] {
    const keys = Object.keys(God.clusters_db);
    const arr: any[] = [];
    const kl = keys.length;

    for (let i = 0; i < kl; i++) {
      const key = keys[i];

      if (!God.clusters_db[key]) continue;
      // Avoid _old type pm_ids
      if (isNaN(God.clusters_db[key].omnitron_env.pm_id)) continue;

      arr.push({
        pid: God.clusters_db[key].process.pid,
        name: God.clusters_db[key].omnitron_env.name,
        omnitron_env: God.clusters_db[key].omnitron_env,
        pm_id: God.clusters_db[key].omnitron_env.pm_id,
      });
    }
    return arr;
  },
  findProcessById(id: number): any {
    return God.clusters_db[id] ? God.clusters_db[id] : null;
  },
  findByName(name: string): any[] {
    const db = God.clusters_db;
    const arr: any[] = [];

    if (name == 'all') {
      for (const key in db) {
        // Avoid _old_proc process style
        if (typeof God.clusters_db[key].omnitron_env.pm_id === 'number') arr.push(db[key]);
      }
      return arr;
    }

    for (const key in db) {
      if (
        God.clusters_db[key].omnitron_env.name == name ||
        God.clusters_db[key].omnitron_env.pm_exec_path == path.resolve(name)
      ) {
        arr.push(db[key]);
      }
    }
    return arr;
  },
  /**
   * Check if a process is alive in system processes
   * Return TRUE if process online
   * @method checkProcess
   * @param {} pid
   * @return
   */
  checkProcess(pid: number): boolean {
    if (!pid) return false;

    try {
      // Sending 0 signal do not kill the process
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return false;
    }
  },
  processIsDead(pid: number, omnitron_env: any, cb: Function, sigkill?: boolean): boolean {
    if (!pid) return cb({ type: 'param:missing', msg: 'no pid passed' });

    let timeout: NodeJS.Timeout | null = null;
    const kill_timeout = omnitron_env && omnitron_env.kill_timeout ? omnitron_env.kill_timeout : cst.KILL_TIMEOUT;
    const mode = omnitron_env.exec_mode;

    const timer = setInterval(() => {
      if (God.checkProcess(pid) === false) {
        console.log('pid=%d msg=process killed', pid);
        clearTimeout(timeout!);
        clearInterval(timer);
        return cb(null, true);
      }
      console.log('pid=%d msg=failed to kill - retrying in %dms', pid, omnitron_env.kill_retry_time);
      return false;
    }, omnitron_env.kill_retry_time);

    timeout = setTimeout(() => {
      clearInterval(timer);
      if (sigkill) {
        console.log('Process with pid %d could not be killed', pid);
        return cb({ type: 'timeout', msg: 'timeout' });
      } else {
        console.log('Process with pid %d still alive after %sms, sending it SIGKILL now...', pid, kill_timeout);

        if (omnitron_env.treekill !== true) {
          try {
            process.kill(parseInt(pid), 'SIGKILL');
          } catch (e) {
            console.error('[SimpleKill][SIGKILL] %s pid can not be killed', pid, e.stack, e.message);
          }
          return God.processIsDead(pid, omnitron_env, cb, true);
        } else {
          treekill(parseInt(pid), 'SIGKILL', (err: any) => God.processIsDead(pid, omnitron_env, cb, true));
        }
      }
    }, kill_timeout);
    return false;
  },
  killProcess(pid: number, omnitron_env: any, cb: Function): boolean {
    if (!pid) return cb({ msg: 'no pid passed or null' });

    if (
      typeof omnitron_env.pm_id === 'number' &&
      (cst.KILL_USE_MESSAGE || omnitron_env.shutdown_with_message == true)
    ) {
      const proc = God.clusters_db[omnitron_env.pm_id];

      if (proc && proc.send) {
        try {
          proc.send('shutdown');
        } catch (e) {
          console.error(`[AppKill] Cannot send "shutdown" message to ${pid}`);
          console.error(e.stack, e.message);
        }
        return God.processIsDead(pid, omnitron_env, cb);
      } else {
        console.log(`[AppKill] ${pid} pid cannot be notified with send()`);
      }
    }

    if (omnitron_env.treekill !== true) {
      try {
        process.kill(parseInt(pid), cst.KILL_SIGNAL);
      } catch (e) {
        console.error('[SimpleKill] %s pid can not be killed', pid, e.stack, e.message);
      }
      return God.processIsDead(pid, omnitron_env, cb);
    } else {
      treekill(parseInt(pid), cst.KILL_SIGNAL, (err: any) => God.processIsDead(pid, omnitron_env, cb));
    }
  },
  getNewId(): number {
    return God.next_id++;
  },
  /**
   * When a process is restarted or reloaded reset fields
   * to monitor unstable starts
   * @method resetState
   * @param {} omnitron_env
   * @return
   */
  resetState(omnitron_env: any): void {
    omnitron_env.created_at = Date.now();
    omnitron_env.unstable_restarts = 0;
    omnitron_env.prev_restart_delay = 0;
  },

  forkMode(omnitron_env: OmnitronEnv, cb: (err: Error | null, cspr?: ChildProcess) => void) {
    let command = '';
    let args: string[] = [];

    console.log(`App [${omnitron_env.name}:${omnitron_env.pm_id}] starting in -fork mode-`);

    const interpreter = omnitron_env.exec_interpreter || process.execPath;
    const pidFile = omnitron_env.pm_pid_path;

    if (interpreter !== 'none') {
      command = interpreter;

      if (omnitron_env.node_args && Array.isArray(omnitron_env.node_args)) {
        args = args.concat(omnitron_env.node_args);
      }

      if (process.env.OMNITRON_NODE_OPTIONS) {
        args = args.concat(process.env.OMNITRON_NODE_OPTIONS.split(' '));
      }

      if (interpreter === 'node' || RegExp('node$').test(interpreter)) {
        args.push(path.resolve(path.dirname(module.filename), 'process-container-fork.js'));
      } else if (interpreter.includes('bun') === true) {
        args.push(path.resolve(path.dirname(module.filename), 'process-container-fork-bun.js'));
      } else {
        args.push(omnitron_env.pm_exec_path);
      }
    } else {
      command = omnitron_env.pm_exec_path;
      args = [];
    }

    if (omnitron_env.args) {
      args = args.concat(omnitron_env.args);
    }

    const stds: Stds = {
      out: omnitron_env.pm_out_log_path,
      err: omnitron_env.pm_err_log_path,
    };

    if ('pm_log_path' in omnitron_env) {
      stds.std = omnitron_env.pm_log_path;
    }

    Utility.startLogging(stds, (err: Error | null, result: any) => {
      if (err) {
        God.logAndGenerateError(err);
        return cb(err);
      }

      let cspr: ChildProcess | null = null;
      try {
        const options: any = {
          env: omnitron_env,
          detached: true,
          cwd: omnitron_env.pm_cwd || process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        };

        if (typeof omnitron_env.windowsHide === 'boolean') {
          options.windowsHide = omnitron_env.windowsHide;
        } else {
          options.windowsHide = true;
        }

        if (omnitron_env.uid) {
          options.uid = omnitron_env.uid;
        }

        if (omnitron_env.gid) {
          options.gid = omnitron_env.gid;
        }

        cspr = spawn(command, args, options);
      } catch (e) {
        God.logAndGenerateError(e);
        return cb(e);
      }

      if (!cspr || !cspr.stderr || !cspr.stdout) {
        const fatalError = new Error('Process could not be forked properly, check your system health');
        God.logAndGenerateError(fatalError);
        return cb(fatalError);
      }

      cspr.process = {};
      cspr.process.pid = cspr.pid;
      cspr.omnitron_env = omnitron_env;

      function transformLogToJson(omnitron_env_: OmnitronEnv, type: string, data: any) {
        return (
          JSON.stringify({
            message: data.toString(),
            timestamp: omnitron_env_.log_date_format
              ? dayjs().format(omnitron_env_.log_date_format)
              : new Date().toISOString(),
            type,
            process_id: cspr.omnitron_env.pm_id,
            app_name: cspr.omnitron_env.name,
          }) + '\n'
        );
      }

      function prefixLogWithDate(omnitron_env_: OmnitronEnv, data: any) {
        let log_data: string[] = [];
        log_data = data.toString().split('\n');
        if (log_data.length > 1) log_data.pop();
        log_data = log_data.map((line) => `${dayjs().format(omnitron_env_.log_date_format)}: ${line}\n`);
        log_data = log_data.join('');
        return log_data;
      }

      cspr.stderr.on('data', (data: any) => {
        let log_data: string | null = null;

        if (omnitron_env.disable_logs === true) return false;

        if (omnitron_env.log_type && omnitron_env.log_type === 'json') {
          log_data = transformLogToJson(omnitron_env, 'err', data);
        } else if (omnitron_env.log_date_format) {
          log_data = prefixLogWithDate(omnitron_env, data);
        } else {
          log_data = data.toString();
        }

        God.bus.emit('log:err', {
          process: {
            pm_id: cspr.omnitron_env.pm_id,
            name: cspr.omnitron_env.name,
            rev:
              cspr.omnitron_env.versioning && cspr.omnitron_env.versioning.revision
                ? cspr.omnitron_env.versioning.revision
                : null,
            namespace: cspr.omnitron_env.namespace,
          },
          at: Utility.getDate(),
          data: log_data,
        });

        if (
          Utility.checkPathIsNull(omnitron_env.pm_err_log_path) &&
          (!omnitron_env.pm_log_path || Utility.checkPathIsNull(omnitron_env.pm_log_path))
        ) {
          return false;
        }

        stds.std?.write?.(log_data);
        stds.err?.write?.(log_data);
      });

      cspr.stdout.on('data', (data: any) => {
        let log_data: string | null = null;

        if (omnitron_env.disable_logs === true) return false;

        if (omnitron_env.log_type && omnitron_env.log_type === 'json') {
          log_data = transformLogToJson(omnitron_env, 'out', data);
        } else if (omnitron_env.log_date_format) {
          log_data = prefixLogWithDate(omnitron_env, data);
        } else {
          log_data = data.toString();
        }

        God.bus.emit('log:out', {
          process: {
            pm_id: cspr.omnitron_env.pm_id,
            name: cspr.omnitron_env.name,
            rev:
              cspr.omnitron_env.versioning && cspr.omnitron_env.versioning.revision
                ? cspr.omnitron_env.versioning.revision
                : null,
            namespace: cspr.omnitron_env.namespace,
          },
          at: Utility.getDate(),
          data: log_data,
        });

        if (
          Utility.checkPathIsNull(omnitron_env.pm_out_log_path) &&
          (!omnitron_env.pm_log_path || Utility.checkPathIsNull(omnitron_env.pm_log_path))
        ) {
          return false;
        }

        stds.std?.write?.(log_data);
        stds.out?.write?.(log_data);
      });

      cspr.on('message', (msg: any) => {
        if (msg.data && msg.type) {
          process.nextTick(() =>
            God.bus.emit(msg.type ? msg.type : 'process:msg', {
              at: Utility.getDate(),
              data: msg.data,
              process: {
                pm_id: cspr.omnitron_env.pm_id,
                name: cspr.omnitron_env.name,
                versioning: cspr.omnitron_env.versioning,
                namespace: cspr.omnitron_env.namespace,
              },
            })
          );
        } else {
          if (typeof msg == 'object' && 'node_version' in msg) {
            cspr.omnitron_env.node_version = msg.node_version;
            return false;
          }

          return God.bus.emit('process:msg', {
            at: Utility.getDate(),
            raw: msg,
            process: {
              pm_id: cspr.omnitron_env.pm_id,
              name: cspr.omnitron_env.name,
              namespace: cspr.omnitron_env.namespace,
            },
          });
        }
      });

      try {
        const pid = cspr.pid;
        if (typeof pid !== 'undefined') fs.writeFileSync(pidFile, pid.toString());
      } catch (e) {
        console.error(e.stack || e);
      }

      cspr.once('exit', (status: number) => {
        try {
          for (const k in stds) {
            if (stds[k] && stds[k].destroy) stds[k].destroy();
            else if (stds[k] && stds[k].end) stds[k].end();
            else if (stds[k] && stds[k].close) stds[k].close();
            stds[k] = stds[k]._file;
          }
        } catch (e) {
          God.logAndGenerateError(e);
        }
      });

      cspr._reloadLogs = (cb: (err: Error | null) => void) => {
        try {
          for (const k in stds) {
            if (stds[k] && stds[k].destroy) stds[k].destroy();
            else if (stds[k] && stds[k].end) stds[k].end();
            else if (stds[k] && stds[k].close) stds[k].close();
            stds[k] = stds[k]._file;
          }
        } catch (e) {
          God.logAndGenerateError(e);
        }
        Utility.startLogging(stds, cb);
      };

      cspr.unref();

      return cb(null, cspr);
    });
  },
  nodeApp(env_copy: EnvCopy, cb: (err: Error | null, clu?: Worker) => void) {
    let clu: Worker | null = null;

    console.log(`App [${env_copy.name}:${env_copy.pm_id}] starting in -cluster mode-`);
    if (env_copy.node_args && Array.isArray(env_copy.node_args)) {
      cluster.settings.execArgv = env_copy.node_args;
    }

    env_copy._omnitron_version = pkg.version;

    try {
      clu = cluster.fork({ omnitron_env: JSON.stringify(env_copy), windowsHide: true });
    } catch (e) {
      God.logAndGenerateError(e);
      return cb(e);
    }

    clu.omnitron_env = env_copy;

    clu.on('message', function cluMessage(msg: Message) {
      if (msg.data && msg.type) {
        return God.bus.emit(msg.type ? msg.type : 'process:msg', {
          at: Utility.getDate(),
          data: msg.data,
          process: {
            pm_id: clu.omnitron_env.pm_id,
            name: clu.omnitron_env.name,
            rev:
              clu.omnitron_env.versioning && clu.omnitron_env.versioning.revision
                ? clu.omnitron_env.versioning.revision
                : null,
            namespace: clu.omnitron_env.namespace,
          },
        });
      } else {
        if (typeof msg == 'object' && 'node_version' in msg) {
          clu.omnitron_env.node_version = msg.node_version;
          return false;
        }

        return God.bus.emit('process:msg', {
          at: Utility.getDate(),
          raw: msg,
          process: {
            pm_id: clu.omnitron_env.pm_id,
            name: clu.omnitron_env.name,
            namespace: clu.omnitron_env.namespace,
          },
        });
      }
    });

    return cb(null, clu);
  },
  softReloadProcessId(opts: { id: string; env?: any }, cb: (err?: Error) => void) {
    const id = opts.id;

    if (!(id in God.clusters_db)) return cb(new Error(`pm_id ${id} not available in ${id}`));

    if (
      God.clusters_db[id].omnitron_env.status == cst.ONLINE_STATUS &&
      God.clusters_db[id].omnitron_env.exec_mode == 'cluster_mode' &&
      !God.clusters_db[id].omnitron_env.wait_ready
    ) {
      Utility.extend(God.clusters_db[id].omnitron_env.env, opts.env);
      Utility.extendExtraConfig(God.clusters_db[id], opts);

      return softReload(God, id, cb);
    } else {
      console.log('Process %s in a stopped status, starting it', id);
      return God.restartProcessId(opts, cb);
    }
  },
  reloadProcessId(opts: { id: string; env?: any }, cb: (err?: Error) => void) {
    const id = opts.id;

    if (!(id in God.clusters_db)) return cb(new Error('OMNITRON ID unknown'));

    if (
      God.clusters_db[id].omnitron_env.status == cst.ONLINE_STATUS &&
      God.clusters_db[id].omnitron_env.exec_mode == 'cluster_mode'
    ) {
      Utility.extend(God.clusters_db[id].omnitron_env.env, opts.env);
      Utility.extendExtraConfig(God.clusters_db[id], opts);

      const wait_msg = God.clusters_db[id].omnitron_env.wait_ready ? 'ready' : 'listening';
      return hardReload(God, id, wait_msg, cb);
    } else {
      console.log('Process %s in a stopped status, starting it', id);
      return God.restartProcessId(opts, cb);
    }
  },
};

Utility.overrideConsole(God.bus);

require('./god/action-methods').default(God);

God.init();

export default God;
