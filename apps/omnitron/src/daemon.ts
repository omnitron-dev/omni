// @ts-nocheck

import fs from 'fs';
import semver from 'semver';
import domain from 'domain';
import * as axon from 'pm2-axon';
import * as rpc from 'pm2-axon-rpc';
import eachLimit from 'async/eachLimit';

import God from './god';
import cst from './constants';
import fmt from './tools/fmt';
import Utility from './utility';
import pkg from '../package.json';

export class Daemon {
  ignore_signals: boolean;
  rpc_socket_ready: boolean;
  pub_socket_ready: boolean;
  pub_socket_file: string;
  rpc_socket_file: string;
  pid_path: string;
  pub: any;
  pub_socket: any;
  rep: any;
  rpc_socket: any;
  isExiting: boolean = false;

  constructor() {
    this.ignore_signals = false;
    this.rpc_socket_ready = false;
    this.pub_socket_ready = false;

    this.pub_socket_file = cst.DAEMON_PUB_PORT;
    this.rpc_socket_file = cst.DAEMON_RPC_PORT;

    this.pid_path = cst.OMNITRON_PID_FILE_PATH;
  }

  start() {
    const d = domain.create();

    d.once('error', (err: Error) => {
      fmt.sep();
      fmt.title('OMNITRON global error caught');
      fmt.field('Time', new Date());
      console.error(err.message);
      console.error(err.stack);
      fmt.sep();

      console.error('[OMNITRON] Resurrecting OMNITRON');

      const path = cst.IS_WINDOWS ? __dirname + '/../bin/omnitron' : process.env['_'];
      const fork_new_omnitron = require('child_process').spawn('node', [path, 'update'], {
        detached: true,
        windowsHide: true,
        stdio: 'inherit',
      });

      fork_new_omnitron.on('close', () => {
        console.log('OMNITRON successfully forked');
        process.exit(0);
      });
    });

    d.run(() => {
      this.innerStart();
    });
  }

  innerStart(cb?: (err: Error | null, data: any) => void) {
    if (!cb)
      cb = () => {
        fmt.sep();
        fmt.title('New OMNITRON Daemon started');
        fmt.field('Time', new Date());
        fmt.field('OMNITRON version', pkg.version);
        fmt.field('Node.js version', process.versions.node);
        fmt.field('Current arch', process.arch);
        fmt.field('OMNITRON home', cst.OMNITRON_HOME);
        fmt.field('OMNITRON PID file', this.pid_path);
        fmt.field('RPC socket file', this.rpc_socket_file);
        fmt.field('BUS socket file', this.pub_socket_file);
        fmt.field('Application log path', cst.DEFAULT_LOG_PATH);
        fmt.field('Worker Interval', cst.WORKER_INTERVAL);
        fmt.field('Process dump file', cst.DUMP_FILE_PATH);
        fmt.field('Concurrent actions', cst.CONCURRENT_ACTIONS);
        fmt.field('SIGTERM timeout', cst.KILL_TIMEOUT);
        fmt.field('Runtime Binary', process.execPath);
        fmt.sep();
      };

    // Write Daemon PID into file
    try {
      fs.writeFileSync(this.pid_path, process.pid.toString());
    } catch (e) {
      console.error((e as Error).stack || e);
    }

    if (this.ignore_signals != true) this.handleSignals();

    /**
     * Pub system for real time notifications
     */
    this.pub = axon.socket('pub-emitter');

    this.pub_socket = this.pub.bind(this.pub_socket_file);

    this.pub_socket.once('bind', () => {
      fs.chmod(this.pub_socket_file, '775', (e: Error) => {
        if (e) console.error(e);

        try {
          if (process.env.OMNITRON_SOCKET_USER && process.env.OMNITRON_SOCKET_GROUP)
            fs.chown(
              this.pub_socket_file,
              parseInt(process.env.OMNITRON_SOCKET_USER),
              parseInt(process.env.OMNITRON_SOCKET_GROUP),
              (e: Error) => {
                if (e) console.error(e);
              }
            );
        } catch (e) {
          console.error(e);
        }
      });

      this.pub_socket_ready = true;
      this.sendReady(cb);
    });

    /**
     * Rep/Req - RPC system to interact with God
     */
    this.rep = axon.socket('rep');

    const server = new rpc.Server(this.rep);

    this.rpc_socket = this.rep.bind(this.rpc_socket_file);

    this.rpc_socket.once('bind', () => {
      fs.chmod(this.rpc_socket_file, '775', (e: Error) => {
        if (e) console.error(e);

        try {
          if (process.env.OMNITRON_SOCKET_USER && process.env.OMNITRON_SOCKET_GROUP)
            fs.chown(
              this.rpc_socket_file,
              parseInt(process.env.OMNITRON_SOCKET_USER),
              parseInt(process.env.OMNITRON_SOCKET_GROUP),
              (e: Error) => {
                if (e) console.error(e);
              }
            );
        } catch (e) {
          console.error(e);
        }
      });

      this.rpc_socket_ready = true;
      this.sendReady(cb);
    });

    /**
     * Memory Snapshot
     */
    function profile(type: string, msg: any, cb_: (err: Error | null, data: any) => void) {
      if (semver.satisfies(process.version, '< 8')) return cb_(null, { error: 'Node.js is not on right version' });

      let cmd: any;

      if (type === 'cpu') {
        cmd = {
          enable: 'Profiler.enable',
          start: 'Profiler.start',
          stop: 'Profiler.stop',
          disable: 'Profiler.disable',
        };
      }
      if (type == 'mem') {
        cmd = {
          enable: 'HeapProfiler.enable',
          start: 'HeapProfiler.startSampling',
          stop: 'HeapProfiler.stopSampling',
          disable: 'HeapProfiler.disable',
        };
      }

      const inspector = require('inspector');
      const session = new inspector.Session();

      session.connect();

      const timeout = msg.timeout || 5000;

      session.post(cmd.enable, (err: Error, data: any) => {
        if (err) return cb_(null, { error: err.message || err });

        console.log(`Starting ${cmd.start}`);
        session.post(cmd.start, (err: Error, data: any) => {
          if (err) return cb_(null, { error: err.message || err });

          setTimeout(() => {
            session.post(cmd.stop, (err: Error, data: any) => {
              if (err) return cb_(null, { error: err.message || err });
              const profile_ = data.profile;

              console.log(`Stopping ${cmd.stop}`);
              session.post(cmd.disable);

              fs.writeFile(msg.pwd, JSON.stringify(profile_), (err: Error) => {
                if (err) return cb_(null, { error: err.message || err });
                return cb_(null, { file: msg.pwd });
              });
            });
          }, timeout);
        });
      });
    }

    server.expose({
      killMe: this.close.bind(this),
      profileCPU: profile.bind(this, 'cpu'),
      profileMEM: profile.bind(this, 'mem'),
      prepare: God.prepare,
      getMonitorData: God.getMonitorData,

      startProcessId: God.startProcessId,
      stopProcessId: God.stopProcessId,
      restartProcessId: God.restartProcessId,
      deleteProcessId: God.deleteProcessId,

      sendLineToStdin: God.sendLineToStdin,
      softReloadProcessId: God.softReloadProcessId,
      reloadProcessId: God.reloadProcessId,
      duplicateProcessId: God.duplicateProcessId,
      resetMetaProcessId: God.resetMetaProcessId,
      stopWatch: God.stopWatch,
      startWatch: God.startWatch,
      toggleWatch: God.toggleWatch,
      notifyByProcessId: God.notifyByProcessId,

      notifyKillOMNITRON: God.notifyKillOMNITRON,
      monitor: God.monitor,
      unmonitor: God.unmonitor,

      msgProcess: God.msgProcess,
      sendDataToProcessId: God.sendDataToProcessId,
      sendSignalToProcessId: God.sendSignalToProcessId,
      sendSignalToProcessName: God.sendSignalToProcessName,

      ping: God.ping,
      getVersion: God.getVersion,
      getReport: God.getReport,
      reloadLogs: God.reloadLogs,
    });

    this.startLogic();
  }

  close(opts: any, cb: Function) {
    const that = this;

    God.bus.emit('omnitron:kill', {
      status: 'killed',
      msg: 'omnitron has been killed via CLI',
    });

    if (God.system_infos_proc !== null) God.system_infos_proc.kill();

    /**
     * Cleanly kill omnitron
     */
    that.rpc_socket.close(() => {
      that.pub_socket.close(() => {
        // notify cli that the daemon is shuting down (only under unix since windows doesnt handle signals)
        if (cst.IS_WINDOWS === false) {
          try {
            process.kill(parseInt(opts.pid), 'SIGQUIT');
          } catch (e) {
            console.error('Could not send SIGQUIT to CLI');
          }
        }

        try {
          fs.unlinkSync(that.pid_path);
        } catch (e) {
          //
        }

        console.log('OMNITRON successfully stopped');
        setTimeout(() => {
          process.exit(cst.SUCCESS_EXIT);
        }, 2);
      });
    });
  }

  handleSignals() {
    process.on('SIGTERM', this.gracefullExit.bind(this));
    process.on('SIGINT', this.gracefullExit.bind(this));
    process.on('SIGHUP', () => { });
    process.on('SIGQUIT', this.gracefullExit.bind(this));
    process.on('SIGUSR2', () => {
      God.reloadLogs({}, () => { });
    });
  }

  sendReady(cb: (err: Error | null, data: any) => void) {
    // Send ready message to Client
    if (this.rpc_socket_ready == true && this.pub_socket_ready == true) {
      cb(null, {
        pid: process.pid,
        omnitron_version: pkg.version,
      });
      if (typeof process.send === 'function') {
        process.send({
          online: true,
          success: true,
          pid: process.pid,
          omnitron_version: pkg.version,
        });
      }
    }
  }

  gracefullExit() {
    const that = this;

    // never execute multiple gracefullExit simultaneously
    // this can lead to loss of some apps in dump file
    if (this.isExiting) return;

    this.isExiting = true;

    God.bus.emit('omnitron:kill', {
      status: 'killed',
      msg: 'omnitron has been killed by SIGNAL',
    });

    console.log('omnitron has been killed by signal, dumping process list before exit...');

    if (God.system_infos_proc !== null) God.system_infos_proc.kill();

    God.dumpProcessList(() => {
      const processes = God.getFormatedProcesses();

      eachLimit(
        processes,
        1,
        (proc: any, next: () => void) => {
          console.log('Deleting process %s', proc.omnitron_env.pm_id);
          God.deleteProcessId(proc.omnitron_env.pm_id, () => next());
        },
        (err: Error) => {
          try {
            fs.unlinkSync(that.pid_path);
          } catch (e) {
            //
          }
          setTimeout(() => {
            that.isExiting = false;
            console.log('Exited peacefully');
            process.exit(cst.SUCCESS_EXIT);
          }, 2);
        }
      );
    });
  }

  startLogic() {
    const that = this;

    /**
     * Action treatment specifics
     * Attach actions to omnitron_env.axm_actions variables (name + options)
     */
    God.bus.on('axm:action', (msg: any) => {
      const omnitron_env = msg.process;
      let exists = false;
      const axm_action = msg.data;

      if (!omnitron_env || !God.clusters_db[omnitron_env.pm_id])
        return console.error('AXM ACTION Unknown id %s', omnitron_env.pm_id);

      if (!God.clusters_db[omnitron_env.pm_id].omnitron_env.axm_actions)
        God.clusters_db[omnitron_env.pm_id].omnitron_env.axm_actions = [];

      God.clusters_db[omnitron_env.pm_id].omnitron_env.axm_actions.forEach((actions: any) => {
        if (actions.action_name == axm_action.action_name) exists = true;
      });

      if (exists === false) {
        God.clusters_db[omnitron_env.pm_id].omnitron_env.axm_actions.push(axm_action);
      }
      msg = null;
    });

    /**
     * Configure module
     */
    God.bus.on('axm:option:configuration', (msg: any) => {
      if (!msg.process) return console.error('[axm:option:configuration] no process defined');

      if (!God.clusters_db[msg.process.pm_id])
        return console.error('[axm:option:configuration] Unknown id %s', msg.process.pm_id);

      try {
        // Application Name nverride
        if (msg.data.name) God.clusters_db[msg.process.pm_id].omnitron_env.name = msg.data.name;

        Object.keys(msg.data).forEach((conf_key) => {
          God.clusters_db[msg.process.pm_id].omnitron_env.axm_options[conf_key] = Utility.clone(msg.data[conf_key]);
        });
      } catch (e) {
        console.error((e as Error).stack || e);
      }
      msg = null;
    });

    /**
     * Process monitoring data (probes)
     */
    God.bus.on('axm:monitor', (msg: any) => {
      if (!msg.process) return console.error('[axm:monitor] no process defined');

      if (!msg.process || !God.clusters_db[msg.process.pm_id])
        return console.error('AXM MONITOR Unknown id %s', msg.process.pm_id);

      Object.assign(God.clusters_db[msg.process.pm_id].omnitron_env.axm_monitor, Utility.clone(msg.data));
      msg = null;
    });

    /**
     * Broadcast messages
     */
    God.bus.onAny((event: string, data_v: any) => {
      if (['axm:action', 'axm:monitor', 'axm:option:setPID', 'axm:option:configuration'].indexOf(event) > -1) {
        data_v = null;
        return false;
      }
      that.pub.emit(event, Utility.clone(data_v));
      data_v = null;
    });
  }
}

if (require.main === module) {
  process.title = process.env.OMNITRON_DAEMON_TITLE || `OMNITRON Daemon v${pkg.version} (${process.env.OMNITRON_HOME})`;
  (new Daemon()).start();
}
