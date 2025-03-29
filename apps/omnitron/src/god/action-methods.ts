// @ts-nocheck
import fs from 'fs';
import path from 'path';
import util from 'util';
import pidusage from 'pidusage';
import eachLimit from 'async/eachLimit';

import cst from '../constants';
import Utility from '../utility';
import pkg from '../../package.json';

interface Process {
  omnitron_env: any;
  pid: number;
}

interface Packet {
  pm_id: number;
  line: string;
  id: number;
  data: any;
  topic: string;
}

interface Cmd {
  id?: number;
  name?: string;
  msg: string;
  opts?: any;
  uuid?: string;
}

interface GodType {
  clusters_db: Record<number, any>;
  getFormatedProcesses: () => Process[];
  logAndGenerateError: (msg: string) => Error;
  notify: (event: string, proc: any, status: boolean) => void;
  executeApp: (env: any, cb: (err: Error | null, proc?: any) => void) => void;
  injectVariables: (env: any, cb: (err: Error | null, proc?: any) => void) => void;
  killProcess: (pid: number, env: any, cb: (err: Error | null) => void) => void;
  resetState: (env: any) => void;
  deleteCron: (id: number) => void;
  findByName: (name: string) => number;
  watch: {
    enable: (env: any) => void;
    disable: (env: any) => void;
  };
  omnitron_being_killed: boolean;
  next_id: number;
  started_at: number;
  getFormatedProcess: (id: number) => any;
}

export default function (God: GodType) {
  God.getMonitorData = function getMonitorData(env: any, cb: (err: Error | null, data?: any) => void) {
    let processes = God.getFormatedProcesses();
    const pids = processes.filter(filterBadProcess).map(function (pro, i) {
      const pid = getProcessId(pro);
      return pid;
    });

    if (pids.length === 0) {
      return cb(
        null,
        processes.map(function (pro) {
          pro['monit'] = {
            memory: 0,
            cpu: 0,
          };

          return pro;
        })
      );
    }

    pidusage(pids, function retPidUsage(err, statistics) {
      if (err) {
        console.error('Error caught while calling pidusage');
        console.error(err);

        return cb(
          null,
          processes.map(function (pro) {
            pro['monit'] = {
              memory: 0,
              cpu: 0,
            };
            return pro;
          })
        );
      }

      if (!statistics) {
        console.error('Statistics is not defined!');

        return cb(
          null,
          processes.map(function (pro) {
            pro['monit'] = {
              memory: 0,
              cpu: 0,
            };
            return pro;
          })
        );
      }

      processes = processes.map(function (pro) {
        if (filterBadProcess(pro) === false) {
          pro['monit'] = {
            memory: 0,
            cpu: 0,
          };

          return pro;
        }

        const pid = getProcessId(pro);
        const stat = statistics[pid];

        if (!stat) {
          pro['monit'] = {
            memory: 0,
            cpu: 0,
          };

          return pro;
        }

        pro['monit'] = {
          memory: stat.memory,
          cpu: Math.round(stat.cpu * 10) / 10,
        };

        return pro;
      });

      cb(null, processes);
    });
  };

  God.dumpProcessList = function (cb: (err: Error | null, data?: any) => void) {
    const process_list: any[] = [];
    const apps = Utility.clone(God.getFormatedProcesses());
    const that = this;

    if (!apps[0]) {
      return cb(null, { success: true, process_list });
    }

    function fin(err: Error | null) {
      if (process_list.length === 0) {
        if (!fs.existsSync(cst.DUMP_FILE_PATH) && typeof that.clearDump === 'function') {
          that.clearDump(function () {});
        }

        return cb(null, { success: true, process_list });
      }

      try {
        if (fs.existsSync(cst.DUMP_FILE_PATH)) {
          fs.writeFileSync(cst.DUMP_BACKUP_FILE_PATH, fs.readFileSync(cst.DUMP_FILE_PATH));
        }
      } catch (e) {
        console.error(e.stack || e);
      }

      try {
        fs.writeFileSync(cst.DUMP_FILE_PATH, JSON.stringify(process_list));
      } catch (e) {
        console.error(e.stack || e);
        try {
          if (fs.existsSync(cst.DUMP_BACKUP_FILE_PATH)) {
            fs.writeFileSync(cst.DUMP_FILE_PATH, fs.readFileSync(cst.DUMP_BACKUP_FILE_PATH));
          }
        } catch (e) {
          fs.unlinkSync(cst.DUMP_FILE_PATH);
          console.error(e.stack || e);
        }
      }

      return cb(null, { success: true, process_list });
    }

    function saveProc(apps: any[]) {
      if (!apps[0]) return fin(null);
      delete apps[0].omnitron_env.instances;
      delete apps[0].omnitron_env.pm_id;
      if (!apps[0].omnitron_env.pmx_module) process_list.push(apps[0].omnitron_env);
      apps.shift();
      return saveProc(apps);
    }
    saveProc(apps);
  };

  God.ping = function (env: any, cb: (err: Error | null, data?: any) => void) {
    return cb(null, { msg: 'pong' });
  };

  God.notifyKillOMNITRON = function () {
    God.omnitron_being_killed = true;
  };

  God.duplicateProcessId = function (id: number, cb: (err: Error | null, data?: any) => void) {
    if (!(id in God.clusters_db)) return cb(God.logAndGenerateError(id + ' id unknown'), {});

    if (!God.clusters_db[id] || !God.clusters_db[id].omnitron_env)
      return cb(God.logAndGenerateError('Error when getting proc || proc.omnitron_env'), {});

    const proc = Utility.clone(God.clusters_db[id].omnitron_env);

    delete proc.created_at;
    delete proc.pm_id;
    delete proc.unique_id;

    proc.unique_id = Utility.generateUUID();

    God.injectVariables(proc, function inject(_err, proc) {
      return God.executeApp(Utility.clone(proc), function (err, clu) {
        if (err) return cb(err);
        God.notify('start', clu, true);
        return cb(err, Utility.clone(clu));
      });
    });
  };

  God.startProcessId = function (id: number, cb: (err: Error | null, data?: any) => void) {
    if (!(id in God.clusters_db)) return cb(God.logAndGenerateError(id + ' id unknown'), {});

    const proc = God.clusters_db[id];
    if (proc.omnitron_env.status == cst.ONLINE_STATUS) return cb(God.logAndGenerateError('process already online'), {});
    if (proc.omnitron_env.status == cst.LAUNCHING_STATUS)
      return cb(God.logAndGenerateError('process already started'), {});
    if (proc.process && proc.process.pid)
      return cb(God.logAndGenerateError('Process with pid ' + proc.process.pid + ' already exists'), {});

    return God.executeApp(God.clusters_db[id].omnitron_env, function (err, proc) {
      return cb(err, Utility.clone(proc));
    });
  };

  God.stopProcessId = function (id: number, cb: (err: Error | null, data?: any) => void) {
    if (typeof id == 'object' && 'id' in id) id = id.id;

    if (!(id in God.clusters_db)) return cb(God.logAndGenerateError(id + ' : id unknown'), {});

    const proc = God.clusters_db[id];

    clearTimeout(proc.omnitron_env.restart_task);

    if (proc.omnitron_env.status == cst.STOPPED_STATUS) {
      proc.process.pid = 0;
      return cb(null, God.getFormatedProcess(id));
    }
    if (proc.state && proc.state === 'none')
      return setTimeout(function () {
        God.stopProcessId(id, cb);
      }, 250);

    console.log('Stopping app:%s id:%s', proc.omnitron_env.name, proc.omnitron_env.pm_id);
    proc.omnitron_env.status = cst.STOPPING_STATUS;

    if (!proc.process.pid) {
      console.error('app=%s id=%d does not have a pid', proc.omnitron_env.name, proc.omnitron_env.pm_id);
      proc.omnitron_env.status = cst.STOPPED_STATUS;
      return cb(null, { error: true, message: 'could not kill process w/o pid' });
    }

    God.killProcess(proc.process.pid, proc.omnitron_env, function (err) {
      proc.omnitron_env.status = cst.STOPPED_STATUS;

      God.notify('exit', proc);

      if (err && err.type && err.type === 'timeout') {
        console.error(
          'app=%s id=%d pid=%s could not be stopped',
          proc.omnitron_env.name,
          proc.omnitron_env.pm_id,
          proc.process.pid
        );
        proc.omnitron_env.status = cst.ERRORED_STATUS;
        return cb(null, God.getFormatedProcess(id));
      }

      if (proc.omnitron_env.pm_id.toString().indexOf('_old_') !== 0) {
        try {
          fs.unlinkSync(proc.omnitron_env.pm_pid_path);
        } catch (e) {}
      }

      if (proc.omnitron_env.axm_actions) proc.omnitron_env.axm_actions = [];
      if (proc.omnitron_env.axm_monitor) proc.omnitron_env.axm_monitor = {};

      proc.process.pid = 0;
      return cb(null, God.getFormatedProcess(id));
    });
  };

  God.resetMetaProcessId = function (id: number, cb: (err: Error | null, data?: any) => void) {
    if (!(id in God.clusters_db)) return cb(God.logAndGenerateError(id + ' id unknown'), {});

    if (!God.clusters_db[id] || !God.clusters_db[id].omnitron_env)
      return cb(God.logAndGenerateError('Error when getting proc || proc.omnitron_env'), {});

    God.clusters_db[id].omnitron_env.created_at = Utility.getDate();
    God.clusters_db[id].omnitron_env.unstable_restarts = 0;
    God.clusters_db[id].omnitron_env.restart_time = 0;

    return cb(null, God.getFormatedProcesses());
  };

  God.deleteProcessId = function (id: number, cb: (err: Error | null, data?: any) => void) {
    God.deleteCron(id);

    God.stopProcessId(id, function (err, proc) {
      if (err) return cb(God.logAndGenerateError(err), {});
      delete God.clusters_db[id];

      if (Object.keys(God.clusters_db).length == 0) God.next_id = 0;
      return cb(null, proc);
    });
    return false;
  };

  God.restartProcessId = function (opts: { id: number; env?: any }, cb: (err: Error | null, data?: any) => void) {
    const id = opts.id;
    const env = opts.env || {};

    if (typeof id === 'undefined') return cb(God.logAndGenerateError('opts.id not passed to restartProcessId', opts));
    if (!(id in God.clusters_db)) return cb(God.logAndGenerateError('God db process id unknown'), {});

    const proc = God.clusters_db[id];

    God.resetState(proc.omnitron_env);
    God.deleteCron(id);

    Utility.extend(proc.omnitron_env.env, env);
    Utility.extendExtraConfig(proc, opts);

    if (God.omnitron_being_killed) {
      return cb(God.logAndGenerateError('[RestartProcessId] OMNITRON is being killed, stopping restart procedure...'));
    }
    if (proc.omnitron_env.status === cst.ONLINE_STATUS || proc.omnitron_env.status === cst.LAUNCHING_STATUS) {
      God.stopProcessId(id, function (err) {
        if (God.omnitron_being_killed)
          return cb(
            God.logAndGenerateError('[RestartProcessId] OMNITRON is being killed, stopping restart procedure...')
          );
        proc.omnitron_env.restart_time += 1;
        return God.startProcessId(id, cb);
      });

      return false;
    } else {
      return God.startProcessId(id, cb);
    }
  };

  God.restartProcessName = function (name: string, cb: (err: Error | null, data?: any) => void) {
    const processes = God.findByName(name);

    if (processes && processes.length === 0) return cb(God.logAndGenerateError('Unknown process'), {});

    eachLimit(
      processes,
      cst.CONCURRENT_ACTIONS,
      function (proc, next) {
        if (God.omnitron_being_killed) return next('[Watch] OMNITRON is being killed, stopping restart procedure...');
        if (proc.omnitron_env.status === cst.ONLINE_STATUS)
          return God.restartProcessId({ id: proc.omnitron_env.pm_id }, next);
        else if (proc.omnitron_env.status !== cst.STOPPING_STATUS && proc.omnitron_env.status !== cst.LAUNCHING_STATUS)
          return God.startProcessId(proc.omnitron_env.pm_id, next);
        else return next(util.format("[Watch] Process name %s is being stopped so I won't restart it", name));
      },
      function (err) {
        if (err) return cb(God.logAndGenerateError(err));
        return cb(null, God.getFormatedProcesses());
      }
    );

    return false;
  };

  God.sendSignalToProcessId = function (
    opts: { process_id: number; signal: string },
    cb: (err: Error | null, data?: any) => void
  ) {
    const id = opts.process_id;
    const signal = opts.signal;

    if (!(id in God.clusters_db)) return cb(God.logAndGenerateError(id + ' id unknown'), {});

    const proc = God.clusters_db[id];

    try {
      process.kill(God.clusters_db[id].process.pid, signal);
    } catch (e) {
      return cb(God.logAndGenerateError('Error when sending signal (signal unknown)'), {});
    }
    return cb(null, God.getFormatedProcesses());
  };

  God.sendSignalToProcessName = function (
    opts: { process_name: string; signal: string },
    cb: (err: Error | null, data?: any) => void
  ) {
    const processes = God.findByName(opts.process_name);
    const signal = opts.signal;

    if (processes && processes.length === 0) return cb(God.logAndGenerateError('Unknown process name'), {});

    eachLimit(
      processes,
      cst.CONCURRENT_ACTIONS,
      function (proc, next) {
        if (proc.omnitron_env.status == cst.ONLINE_STATUS || proc.omnitron_env.status == cst.LAUNCHING_STATUS) {
          try {
            process.kill(proc.process.pid, signal);
          } catch (e) {
            return next(e);
          }
        }
        return setTimeout(next, 200);
      },
      function (err) {
        if (err) return cb(God.logAndGenerateError(err), {});
        return cb(null, God.getFormatedProcesses());
      }
    );
  };

  God.stopWatch = function (method: string, value: any, fn: (err: Error | null, data?: any) => void) {
    let env = null;

    if (method == 'stopAll' || method == 'deleteAll') {
      const processes = God.getFormatedProcesses();

      processes.forEach(function (proc) {
        God.clusters_db[proc.pm_id].omnitron_env.watch = false;
        God.watch.disable(proc.omnitron_env);
      });
    } else {
      if (method.indexOf('ProcessId') !== -1) {
        env = God.clusters_db[value];
      } else if (method.indexOf('ProcessName') !== -1) {
        env = God.clusters_db[God.findByName(value)];
      }

      if (env) {
        God.watch.disable(env.omnitron_env);
        env.omnitron_env.watch = false;
      }
    }
    return fn(null, { success: true });
  };

  God.toggleWatch = function (method: string, value: any, fn: (err: Error | null, data?: any) => void) {
    let env = null;

    if (method == 'restartProcessId') {
      env = God.clusters_db[value.id];
    } else if (method == 'restartProcessName') {
      env = God.clusters_db[God.findByName(value)];
    }

    if (env) {
      env.omnitron_env.watch = !env.omnitron_env.watch;
      if (env.omnitron_env.watch) God.watch.enable(env.omnitron_env);
      else God.watch.disable(env.omnitron_env);
    }

    return fn(null, { success: true });
  };

  God.startWatch = function (method: string, value: any, fn: (err: Error | null, data?: any) => void) {
    let env = null;

    if (method == 'restartProcessId') {
      env = God.clusters_db[value.id];
    } else if (method == 'restartProcessName') {
      env = God.clusters_db[God.findByName(value)];
    }

    if (env) {
      if (env.omnitron_env.watch) return fn(null, { success: true, notrestarted: true });

      God.watch.enable(env.omnitron_env);
      env.omnitron_env.watch = true;
    }

    return fn(null, { success: true });
  };

  God.reloadLogs = function (opts: any, cb: (err: Error | null, data?: any) => void) {
    console.log('Reloading logs...');
    const processIds = Object.keys(God.clusters_db);

    processIds.forEach(function (id) {
      const cluster = God.clusters_db[id];

      console.log('Reloading logs for process id %d', id);

      if (cluster && cluster.omnitron_env) {
        if (cluster.send && cluster.omnitron_env.exec_mode == 'cluster_mode') {
          try {
            cluster.send({
              type: 'log:reload',
            });
          } catch (e) {
            console.error(e.message || e);
          }
        } else if (cluster._reloadLogs) {
          cluster._reloadLogs(function (err) {
            if (err) God.logAndGenerateError(err);
          });
        }
      }
    });

    return cb(null, {});
  };

  God.sendLineToStdin = function (packet: Packet, cb: (err: Error | null, data?: any) => void) {
    if (typeof packet.pm_id == 'undefined' || !packet.line)
      return cb(God.logAndGenerateError('pm_id or line field missing'), {});

    const pm_id = packet.pm_id;
    const line = packet.line;

    const proc = God.clusters_db[pm_id];

    if (!proc) return cb(God.logAndGenerateError('Process with ID <' + pm_id + '> unknown.'), {});

    if (proc.omnitron_env.exec_mode == 'cluster_mode')
      return cb(God.logAndGenerateError('Cannot send line to processes in cluster mode'), {});

    if (proc.omnitron_env.status != cst.ONLINE_STATUS && proc.omnitron_env.status != cst.LAUNCHING_STATUS)
      return cb(God.logAndGenerateError('Process with ID <' + pm_id + '> offline.'), {});

    try {
      proc.stdin.write(line, function () {
        return cb(null, {
          pm_id,
          line,
        });
      });
    } catch (e) {
      return cb(God.logAndGenerateError(e), {});
    }
  };

  God.sendDataToProcessId = function (packet: Packet, cb: (err: Error | null, data?: any) => void) {
    if (typeof packet.id == 'undefined' || typeof packet.data == 'undefined' || !packet.topic)
      return cb(God.logAndGenerateError('ID, DATA or TOPIC field is missing'), {});

    const pm_id = packet.id;
    const data = packet.data;

    const proc = God.clusters_db[pm_id];

    if (!proc) return cb(God.logAndGenerateError('Process with ID <' + pm_id + '> unknown.'), {});

    if (proc.omnitron_env.status != cst.ONLINE_STATUS && proc.omnitron_env.status != cst.LAUNCHING_STATUS)
      return cb(God.logAndGenerateError('Process with ID <' + pm_id + '> offline.'), {});

    try {
      proc.send(packet);
    } catch (e) {
      return cb(God.logAndGenerateError(e), {});
    }

    return cb(null, {
      success: true,
      data: packet,
    });
  };

  God.msgProcess = function (cmd: Cmd, cb: (err: Error | null, data?: any) => void) {
    if ('id' in cmd) {
      const id = cmd.id;
      if (!(id in God.clusters_db)) return cb(God.logAndGenerateError(id + ' id unknown'), {});
      const proc = God.clusters_db[id];

      var action_exist = false;

      proc.omnitron_env.axm_actions.forEach(function (action: any) {
        if (action.action_name == cmd.msg) {
          action_exist = true;
          action.output = [];
        }
      });
      if (action_exist == false) {
        return cb(God.logAndGenerateError("Action doesn't exist " + cmd.msg + ' for ' + proc.omnitron_env.name), {});
      }

      if (proc.omnitron_env.status == cst.ONLINE_STATUS || proc.omnitron_env.status == cst.LAUNCHING_STATUS) {
        if (cmd.opts == null && !cmd.uuid) proc.send(cmd.msg);
        else proc.send(cmd);

        return cb(null, { process_count: 1, success: true });
      } else return cb(God.logAndGenerateError(id + ' : id offline'), {});
    } else if ('name' in cmd) {
      const name = cmd.name;
      const arr = Object.keys(God.clusters_db);
      let sent = 0;

      (function ex(arr: string[]) {
        if (arr[0] == null || !arr) {
          return cb(null, {
            process_count: sent,
            success: true,
          });
        }

        const id = arr[0];

        if (!God.clusters_db[id] || !God.clusters_db[id].omnitron_env) {
          arr.shift();
          return ex(arr);
        }

        const proc_env = God.clusters_db[id].omnitron_env;

        const isActionAvailable =
          proc_env.axm_actions.find((action: any) => action.action_name === cmd.msg) !== undefined;

        if (isActionAvailable === false) {
          arr.shift();
          return ex(arr);
        }

        if (
          (path.basename(proc_env.pm_exec_path) == name ||
            proc_env.name == name ||
            proc_env.namespace == name ||
            name == 'all') &&
          (proc_env.status == cst.ONLINE_STATUS || proc_env.status == cst.LAUNCHING_STATUS)
        ) {
          proc_env.axm_actions.forEach(function (action: any) {
            if (action.action_name == cmd.msg) {
              action_exist = true;
            }
          });

          if (action_exist == false || proc_env.axm_actions.length == 0) {
            arr.shift();
            return ex(arr);
          }

          if (cmd.opts == null) God.clusters_db[id].send(cmd.msg);
          else God.clusters_db[id].send(cmd);

          sent++;
          arr.shift();
          return ex(arr);
        } else {
          arr.shift();
          return ex(arr);
        }
        return false;
      })(arr);
    } else return cb(God.logAndGenerateError('method requires name or id field'), {});
    return false;
  };

  God.getVersion = function (env: any, cb: (err: Error | null, data?: any) => void) {
    process.nextTick(function () {
      return cb(null, pkg.version);
    });
  };

  God.monitor = function Monitor(pm_id: number, cb: (err: Error | null, data?: any) => void) {
    if (!God.clusters_db[pm_id] || !God.clusters_db[pm_id].omnitron_env) return cb(new Error('Unknown pm_id'));

    God.clusters_db[pm_id].omnitron_env._km_monitored = true;
    return cb(null, { success: true, pm_id });
  };

  God.unmonitor = function Monitor(pm_id: number, cb: (err: Error | null, data?: any) => void) {
    if (!God.clusters_db[pm_id] || !God.clusters_db[pm_id].omnitron_env) return cb(new Error('Unknown pm_id'));

    God.clusters_db[pm_id].omnitron_env._km_monitored = false;
    return cb(null, { success: true, pm_id });
  };

  God.getReport = function (arg: any, cb: (err: Error | null, data?: any) => void) {
    const report = {
      omnitron_version: pkg.version,
      node_version: 'N/A',
      node_path: process.env['_'] || 'not found',
      argv0: process.argv0,
      argv: process.argv,
      user: process.env.USER,
      uid: cst.IS_WINDOWS === false && process.geteuid ? process.geteuid() : 'N/A',
      gid: cst.IS_WINDOWS === false && process.getegid ? process.getegid() : 'N/A',
      env: process.env,
      managed_apps: Object.keys(God.clusters_db).length,
      started_at: God.started_at,
    };

    if (process.versions && process.versions.node) {
      report.node_version = process.versions.node;
    }

    process.nextTick(function () {
      return cb(null, report);
    });
  };
}

function filterBadProcess(pro: Process) {
  if (pro.omnitron_env.status !== cst.ONLINE_STATUS) {
    return false;
  }

  if (pro.omnitron_env.axm_options && pro.omnitron_env.axm_options.pid) {
    if (isNaN(pro.omnitron_env.axm_options.pid)) {
      return false;
    }
  }

  return true;
}

function getProcessId(pro: Process) {
  let pid = pro.pid;

  if (pro.omnitron_env.axm_options && pro.omnitron_env.axm_options.pid) {
    pid = pro.omnitron_env.axm_options.pid;
  }

  return pid;
}
