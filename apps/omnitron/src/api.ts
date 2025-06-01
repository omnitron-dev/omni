// @ts-nocheck

import fs from 'fs';
import path from 'path';
import util from 'util';
import chalk from 'ansis';
import dayjs from 'dayjs';
import crypto from 'crypto';
import fclone from 'fclone';
import mkdirp from 'mkdirp';
import * as axon from 'pm2-axon';
import commander from 'commander';
import series from 'async/series';
import forEach from 'async/forEach';
import * as rpc from 'pm2-axon-rpc';
import eachLimit from 'async/eachLimit';
import eachSeries from 'async/eachSeries';
import os, { tmpdir as tmpPath } from 'os';
import forEachLimit from 'async/forEachLimit';
import { spawn, exec as nodeExec } from 'child_process';

import UX from './api/ux';
import Log from './api/log';
import fmt from './tools/fmt';
import open from './tools/open';
import Utility from './utility';
import pkg from '../package.json';
import sexec from './tools/sexec';
import which from './tools/which';
import Config from './tools/config';
import Promise from './tools/promise.min';
import KMDaemon from './agent/InteractorClient';
import { Configuration } from './configuration';
import copyDirSync from './tools/copydirSync.js';
import { dockerProcessCommand } from './api/docker';
import { default as path_structure } from './paths';
import Modularizer from './api/modules/modularizer';
import { Common, lockReload, unlockReload } from './common';
import { default as cst, default as conf } from './constants';
import { make_available_extension } from './api/modules/flag-ext';

function noop() { }

const { printError, printOut } = Common;

const IMMUTABLE_MSG = chalk.bold.blue('Use --update-env to update environment variables');

let EXEC_TIMEOUT = 60000; // Default: 1 min

function deployHelper() {
  console.log(`
-----> Helper: Deployment with OMNITRON

  Generate a sample ecosystem.config.js with the command
  $ omnitron ecosystem
  Then edit the file depending on your needs

  Commands:
    setup                run remote setup commands
    update               update deploy to the latest release
    revert [n]           revert to [n]th last deployment or 1
    curr[ent]            output current release commit
    prev[ious]           output previous release commit
    exec|run <cmd>       execute the given <cmd>
    list                 list previous deploy commits
    [ref]                deploy to [ref], the "ref" setting, or latest tag


  Basic Examples:

    First initialize remote production host:
    $ omnitron deploy ecosystem.config.js production setup

    Then deploy new code:
    $ omnitron deploy ecosystem.config.js production

    If I want to revert to the previous commit:
    $ omnitron deploy ecosystem.config.js production revert 1

    Execute a command on remote server:
    $ omnitron deploy ecosystem.config.js production exec "omnitron restart all"

    OMNITRON will look by default to the ecosystem.config.js file so you dont need to give the file name:
    $ omnitron deploy production
    Else you have to tell OMNITRON the name of your ecosystem file

    More examples in https://github.com/Unitech/omnitron
`);
}

function basicMDHighlight(lines: string) {
  console.log('\n\n+-------------------------------------+');
  console.log(chalk.bold('README.md content:'));
  const lineArray = lines.split('\n');
  let isInner = false;
  lineArray.forEach((l) => {
    if (l.startsWith('#')) console.log(chalk.bold.green(l));
    else if (isInner || l.startsWith('```')) {
      if (isInner && l.startsWith('```')) isInner = false;
      else if (isInner == false) isInner = true;
      console.log(chalk.gray(l));
    } else if (l.startsWith('`')) console.log(chalk.gray(l));
    else console.log(l);
  });
  console.log('+-------------------------------------+');
}

function interactiveConfigEdit(cb: (err: any, data?: any) => void) {
  UX.helpers.openEditor(cst.OMNITRON_MODULE_CONF_FILE, (err, data) => {
    Common.printOut(chalk.bold('Module configuration (%s) edited.'), cst.OMNITRON_MODULE_CONF_FILE);
    Common.printOut(
      chalk.bold('To take changes into account, please restart module related.'),
      cst.OMNITRON_MODULE_CONF_FILE
    );
    if (err) return cb(Common.retErr(err));
    return cb(null, { success: true });
  });
}

/**
 * Configuration
 */
function displayConf(target_app: any, cb?: (err: any, data?: any) => void) {
  if (typeof target_app == 'function') {
    cb = target_app;
    target_app = null;
  }

  Configuration.getAll((err, data) => {
    UX.helpers.dispKeys(data, target_app);
    return cb();
  });
}

const exec = function (cmd: string, callback: (err: any, output: string) => void) {
  let output = '';

  const c = nodeExec(
    cmd,
    {
      env: process.env,
      maxBuffer: 3 * 1024 * 1024,
      timeout: EXEC_TIMEOUT,
    },
    (err: any) => {
      if (callback) callback(err ? err.code : 0, output);
    }
  );

  c.stdout.on('data', (data: any) => {
    output += data;
  });

  c.stderr.on('data', (data: any) => {
    output += data;
  });
};

/**
 *
 * @method execCommands
 * @param {string} repo_path
 * @param {object} command_list
 * @return
 */
const execCommands = function (repo_path: string, command_list: string[], cb: (err: any, data: any) => void) {
  let stdout = '';

  eachSeries(
    command_list,
    (command, callback) => {
      stdout += '\n' + command;
      exec('cd ' + repo_path + ';' + command, (code, output) => {
        stdout += '\n' + output;
        if (code === 0) callback();
        else callback('`' + command + '` failed');
      });
    },
    (err) => {
      if (err) return cb(stdout + '\n' + err);
      return cb(null, stdout);
    }
  );
};

/**
 * Description Search process.json for post-update commands
 * @method getPostUpdateCmds
 * @param {string} repo_path
 * @param {string} proc_name
 * @return
 */
const getPostUpdateCmds = function (repo_path: string, proc_name: string, cb: (err: any, data: any) => void) {
  if (typeof repo_path !== 'string') return cb([]);
  if (repo_path[repo_path.length - 1] !== '/') repo_path += '/';

  const searchForCommands = function (file: string, callback: (err: any, data: any) => void) {
    fs.exists(repo_path + file, (exists) => {
      if (exists) {
        let data: any;
        try {
          const conf_string = fs.readFileSync(repo_path + file);
          data = Common.parseConfig(conf_string, repo_path + file);
        } catch (e) {
          console.error(e.message || e);
        }

        if (data && data.apps) {
          eachSeries(
            data.apps,
            (item, callb) => {
              if (item.name && item.name === proc_name) {
                if (item.post_update && typeof item.post_update === 'object') {
                  if (item.exec_timeout) EXEC_TIMEOUT = parseInt(item.exec_timeout);
                  return callb(item.post_update);
                } else {
                  return callb();
                }
              } else return callb();
            },
            (final) => callback(final)
          );
        } else {
          return callback();
        }
      } else {
        return callback();
      }
    });
  };

  eachSeries(['ecosystem.json', 'process.json', 'package.json'], searchForCommands, function (final) {
    return cb(final ? final : []);
  });
};

/**
 * If command is launched without root right
 * Display helper
 */
function isNotRoot(startup_mode, platform, opts, cb) {
  Common.printOut(`${cst.PREFIX_MSG}To ${startup_mode} the Startup Script, copy/paste the following command:`);

  let omnitron_bin_path = require.main.filename;

  if (omnitron_bin_path.includes('/dist/binaries/cli.js') === true) {
    omnitron_bin_path = omnitron_bin_path.replace('/dist/binaries/cli.js', '/bin/omnitron');
  }

  if (opts.user) {
    console.log(
      'sudo env PATH=$PATH:' +
      path.dirname(process.execPath) +
      ' omnitron ' +
      opts.args[1].name() +
      ' ' +
      platform +
      ' -u ' +
      opts.user +
      ' --hp ' +
      process.env.HOME
    );
    return cb(new Error('You have to run this with elevated rights'));
  }
  return sexec('whoami', { silent: true }, (err: any, stdout: any, stderr: any) => {
    console.log(
      'sudo env PATH=$PATH:' +
      path.dirname(process.execPath) +
      ' ' +
      omnitron_bin_path +
      ' ' +
      opts.args[1].name() +
      ' ' +
      platform +
      ' -u ' +
      stdout.trim() +
      ' --hp ' +
      process.env.HOME
    );
    return cb(new Error('You have to run this with elevated rights'));
  });
}

/**
 * Detect running init system
 */
function detectInitSystem() {
  const hash_map = {
    systemctl: 'systemd',
    'update-rc.d': 'upstart',
    chkconfig: 'systemv',
    'rc-update': 'openrc',
    launchctl: 'launchd',
    sysrc: 'rcd',
    rcctl: 'rcd-openbsd',
    svcadm: 'smf',
  };
  const init_systems = Object.keys(hash_map);

  for (let i = 0; i < init_systems.length; i++) {
    if (which(init_systems[i]) != null) {
      break;
    }
  }

  if (i >= init_systems.length) {
    Common.printError(cst.PREFIX_MSG_ERR + 'Init system not found');
    return null;
  }
  Common.printOut(cst.PREFIX_MSG + 'Init System found: ' + chalk.bold(hash_map[init_systems[i]]));
  return hash_map[init_systems[i]];
}

function pspawn(cmd: string) {
  return new Promise((resolve, reject) => {
    const p_cmd = cmd.split(' ');

    const install_instance = spawn(p_cmd[0], p_cmd.splice(1, cmd.length), {
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });

    install_instance.on('close', (code: number) => {
      if (code != 0) {
        console.log(chalk.bold.red('Command failed'));
        return reject(new Error('Bad cmd return'));
      }
      return resolve();
    });

    install_instance.on('error', (err: any) => reject(err));
  });
}

/**
 * Switch Dockerfile mode
 * check test/programmatic/containerizer.mocha.js
 */
export function parseAndSwitch(file_content, main_file, opts) {
  let lines = file_content.split('\n');
  const mode = opts.mode;

  lines[0] = 'FROM keymetrics/omnitron:' + opts.node_version;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (['## DISTRIBUTION MODE', '## DEVELOPMENT MODE'].indexOf(line) > -1 || i == lines.length - 1) {
      lines.splice(i, lines.length);
      lines[i] = '## ' + mode.toUpperCase() + ' MODE';
      lines[i + 1] = 'ENV NODE_ENV=' + (mode == 'distribution' ? 'production' : mode);

      if (mode == 'distribution') {
        lines[i + 2] = 'COPY . /var/app';
        lines[i + 3] = 'CMD ["omnitron-docker", "' + main_file + '", "--env", "production"]';
      }
      if (mode == 'development') {
        lines[i + 2] = 'CMD ["omnitron-dev", "' + main_file + '", "--env", "development"]';
      }
      break;
    }
  }
  lines = lines.join('\n');
  return lines;
}

/**
 * Replace ENV, COPY and CMD depending on the mode
 * @param {String} docker_filepath Dockerfile absolute path
 * @param {String} main_file       Main file to start in container
 * @param {String} mode            Mode to switch the Dockerfile
 */
export function switchDockerFile(docker_filepath: string, main_file: string, opts: any) {
  return new Promise((resolve, reject) => {
    const data = fs.readFileSync(docker_filepath, 'utf8').toString();

    if (['distribution', 'development'].indexOf(opts.mode) == -1) {
      reject(new Error('Unknown mode'));
      return;
    }

    const lines = parseAndSwitch(data, main_file, opts);
    fs.writeFile(docker_filepath, lines, (err: any) => {
      if (err) {
        reject(err);
      } else {
        resolve({
          Dockerfile_path: docker_filepath,
          Dockerfile: lines,
          CMD: '',
        });
      }
    });
  });
}

/**
 * Generate sample Dockerfile (lib/templates/Dockerfiles)
 * @param {String} docker_filepath Dockerfile absolute path
 * @param {String} main_file       Main file to start in container
 * @param {String} mode            Mode to switch the Dockerfile
 */
export function generateDockerfile(docker_filepath: string, main_file: string, opts: any) {
  return new Promise((resolve, reject) => {
    const tpl_file = path.join(cst.TEMPLATE_FOLDER, cst.DOCKERFILE_NODEJS);
    let template = fs.readFileSync(tpl_file, { encoding: 'utf8' });
    let CMD;

    template = parseAndSwitch(template, main_file, opts);

    fs.writeFile(docker_filepath, template, (err: any) => {
      if (err) {
        reject(err);
      } else {
        resolve({
          Dockerfile_path: docker_filepath,
          Dockerfile: template,
          CMD,
        });
      }
    });
  });
}

/**
 * Main Function to be imported
 * can be aliased to OMNITRON
 *
 * To use it when OMNITRON is installed as a module:
 *
 * var OMNITRON = require('omnitron');
 *
 * var omnitron = OMNITRON(<opts>);
 *
 *
 * @param {Object}  opts
 * @param {String}  [opts.cwd=<current>]         override omnitron cwd for starting scripts
 * @param {String}  [opts.omnitron_home=[<paths.js>]] omnitron directory for log, pids, socket files
 * @param {Boolean} [opts.independent=false]     unique OMNITRON instance (random omnitron_home)
 * @param {Boolean} [opts.daemon_mode=true]      should be called in the same process or not
 * @param {String}  [opts.public_key=null]       omnitron plus bucket public key
 * @param {String}  [opts.secret_key=null]       omnitron plus bucket secret key
 * @param {String}  [opts.machine_name=null]     omnitron plus instance name
 */
export default class API {
  private daemon_mode: boolean;
  private omnitron_home: string;
  private public_key: string | null;
  private secret_key: string | null;
  private machine_name: string | null;
  private cwd: string;
  private _conf: any;
  private omnitron_configuration: any;
  private gl_interact_infos: any;
  private gl_is_km_linked: boolean;
  private gl_retry: number;
  private start_timer: Date;
  public custom = API;

  //client
  conf: any;
  rpc_socket_file: string;
  pub_socket_file: string;
  interactor_process?: any;
  client?: any;
  client_sock?: any;
  sub?: any;
  sub_sock?: any;

  constructor(opts: any = {}) {
    if (!opts) opts = {};

    this.daemon_mode = typeof opts.daemon_mode == 'undefined' ? true : opts.daemon_mode;
    this.omnitron_home = conf.OMNITRON_ROOT_PATH;
    this.public_key = conf.PUBLIC_KEY || opts.public_key || null;
    this.secret_key = conf.SECRET_KEY || opts.secret_key || null;
    this.machine_name = conf.MACHINE_NAME || opts.machine_name || null;

    /**
     * CWD resolution
     */
    this.cwd = process.cwd();
    if (opts.cwd) {
      this.cwd = path.resolve(opts.cwd);
    }

    /**
     * OMNITRON HOME resolution
     */
    if (opts.omnitron_home && opts.independent == true)
      throw new Error('You cannot set a omnitron_home and independent instance in same time');

    if (opts.omnitron_home) {
      // Override default conf file
      this.omnitron_home = opts.omnitron_home;
      conf = Object.assign(conf, path_structure(this.omnitron_home));
    } else if (opts.independent == true && conf.IS_WINDOWS === false) {
      // Create an unique omnitron instance
      const random_file = crypto.randomBytes(8).toString('hex');
      this.omnitron_home = path.join('/tmp', random_file);

      // If we dont explicitly tell to have a daemon
      // It will go as in proc
      if (typeof opts.daemon_mode == 'undefined') this.daemon_mode = false;
      conf = Object.assign(conf, path_structure(this.omnitron_home));
    }

    this._conf = conf;

    if (conf.IS_WINDOWS) {
      // Weird fix, may need to be dropped
      // @todo windows connoisseur double check
      if (process.stdout._handle && process.stdout._handle.setBlocking) process.stdout._handle.setBlocking(true);
    }

    // Create all folders and files needed
    // Client depends to that to interact with OMNITRON properly
    this.initFileStructure();

    this.rpc_socket_file = this._conf.DAEMON_RPC_PORT;
    this.pub_socket_file = this._conf.DAEMON_PUB_PORT;

    this.omnitron_configuration = Configuration.getSync('omnitron') || {};

    this.gl_interact_infos = null;
    this.gl_is_km_linked = false;

    try {
      let pid = fs.readFileSync(conf.INTERACTOR_PID_PATH);
      pid = parseInt(pid.toString().trim());
      process.kill(pid, 0);
      this.gl_is_km_linked = true;
    } catch (e) {
      this.gl_is_km_linked = false;
    }

    // For testing purposes
    if (this.secret_key && process.env.NODE_ENV == 'local_test') this.gl_is_km_linked = true;

    KMDaemon.ping(this._conf, (err, result) => {
      if (!err && result === true) {
        fs.readFile(conf.INTERACTION_CONF, (_err, _conf) => {
          if (!_err) {
            try {
              this.gl_interact_infos = JSON.parse(_conf.toString());
            } catch (e) {
              const json5 = require('./tools/json5.js');
              try {
                this.gl_interact_infos = json5.parse(_conf.toString());
              } catch (e) {
                console.error(e);
                this.gl_interact_infos = null;
              }
            }
          }
        });
      }
    });

    this.gl_retry = 0;
  }

  /**
   * Connect to OMNITRON
   * Calling this command is now optional
   *
   * @param {Function} cb callback once omnitron is ready for commands
   */
  connect(noDaemon: boolean | Function, cb?: (err: any, meta: any) => void) {
    this.start_timer = new Date();

    if (typeof cb === 'undefined') {
      cb = noDaemon as Function;
      noDaemon = false;
    } else if (noDaemon === true) {
      // Backward compatibility with OMNITRON 1.x
      this.daemon_mode = false;
    }

    this.startClient((err, meta) => {
      if (err) {
        cb(err);
        return;
      }

      if (meta.new_omnitron_instance == false && this.daemon_mode === true) {
        cb(err, meta);
        return;
      }

      this.launchSysMonitoring(() => { });
      // If new omnitron instance has been popped
      // Launch all modules
      this.launchAll((err_mod) => cb(err, meta));
    });
  }

  /**
   * Usefull when custom OMNITRON created with independent flag set to true
   * This will cleanup the newly created instance
   * by removing folder, killing OMNITRON and so on
   *
   * @param {Function} cb callback once cleanup is successfull
   */
  destroy(cb: Function) {
    this.killDaemon(() => {
      const cmd = 'rm -rf ' + this.omnitron_home;
      const test_path = path.join(this.omnitron_home, 'module_conf.json');
      const test_path_2 = path.join(this.omnitron_home, 'omnitron.pid');

      if (this.omnitron_home.indexOf('.omnitron') > -1)
        return cb(new Error('Destroy is not a allowed method on .omnitron'));

      fs.access(test_path, fs.R_OK, (err) => {
        if (err) return cb(err);
        sexec(cmd, cb);
      });
    });
  }

  /**
   * Disconnect from OMNITRON instance
   * This will allow your software to exit by itself
   *
   * @param {Function} [cb] optional callback once connection closed
   */
  disconnect(cb?: (err: Error, data: any) => void) {
    if (!cb) cb = () => { };

    this.closeClient((err: Error, data?: any) => cb(err, data));
  }

  /**
   * Alias on disconnect
   * @param cb
   */
  close(cb?: (err: Error, data: any) => void) {
    this.disconnect(cb);
  }

  /**
   * Launch modules
   *
   * @param {Function} cb callback once omnitron has launched modules
   */
  launchModules(cb: Function) {
    this.launchAll(cb);
  }

  /**
   * Exit methods for API
   * @param {Integer} code exit code for terminal
   */
  exitCli(code: number) {
    // Do nothing if OMNITRON called programmatically (also in speedlist)
    if (conf.OMNITRON_PROGRAMMATIC && process.env.OMNITRON_USAGE != 'CLI') return false;

    KMDaemon.disconnectRPC(() => {
      this.closeClient(() => {
        code = code || 0;
        // Safe exits process after all streams are drained.
        // file descriptor flag.
        let fds = 0;
        // exits process when stdout (1) and sdterr(2) are both drained.
        function tryToExit() {
          if (fds & 1 && fds & 2) {
            process.exit(code);
          }
        }

        [process.stdout, process.stderr].forEach((std) => {
          const fd = std.fd;
          if (!std.bufferSize) {
            // bufferSize equals 0 means current stream is drained.
            fds = fds | fd;
          } else {
            // Appends nothing to the std queue, but will trigger `tryToExit` event on `drain`.
            std.write?.('', () => {
              fds = fds | fd;
              tryToExit();
            });
          }
          // Does not write anything more.
          delete std.write;
        });
        tryToExit();
      });
    });
  }

  ////////////////////////////
  // Application management //
  ////////////////////////////

  /**
   * Start a file or json with configuration
   * @param {Object||String} cmd script to start or json
   * @param {Function} cb called when application has been started
   */
  start(cmd: any, opts: any, cb?: (err: any, procs: any) => void) {
    if (typeof opts == 'function') {
      cb = opts;
      opts = {};
    }
    if (!opts) opts = {};

    if (Array.isArray(opts.watch) && opts.watch.length === 0)
      opts.watch = (opts.rawArgs ? !!~opts.rawArgs.indexOf('--watch') : !!~process.argv.indexOf('--watch')) || false;

    if (Common.isConfigFile(cmd) || typeof cmd === 'object') {
      this._startJson(cmd, opts, 'restartProcessId', (err, procs) => (cb ? cb(err, procs) : this.speedList()));
    } else {
      this._startScript(cmd, opts, (err, procs) => (cb ? cb(err, procs) : this.speedList(0)));
    }
  }

  /**
   * Reset process counters
   *
   * @method resetMetaProcess
   */
  reset(process_name: string, cb?: (err: any, data?: any) => void) {
    const processIds = (ids: any[], cb_: (err: any, data?: any) => void) => {
      eachLimit(
        ids,
        conf.CONCURRENT_ACTIONS,
        (id, next) => {
          this.executeRemote('resetMetaProcessId', id, (err, res) => {
            if (err) console.error(err);
            Common.printOut(conf.PREFIX_MSG + 'Resetting meta for process id %d', id);
            return next();
          });
        },
        (err) => {
          if (err) return cb_(Common.retErr(err));
          return cb_ ? cb_(null, { success: true }) : this.speedList();
        }
      );
    };

    if (process_name == 'all') {
      this.getAllProcessId((err, ids) => {
        if (err) {
          Common.printError(err);
          return cb ? cb(Common.retErr(err)) : this.exitCli(conf.ERROR_EXIT);
        }
        return processIds(ids, cb);
      });
    } else if (isNaN(process_name as any)) {
      this.getProcessIdByNameClient(process_name, (err, ids) => {
        if (err) {
          Common.printError(err);
          return cb ? cb(Common.retErr(err)) : this.exitCli(conf.ERROR_EXIT);
        }
        if (ids.length === 0) {
          Common.printError('Unknown process name');
          return cb ? cb(new Error('Unknown process name')) : this.exitCli(conf.ERROR_EXIT);
        }
        return processIds(ids, cb);
      });
    } else {
      processIds([process_name], cb);
    }
  }

  /**
   * Update daemonized OMNITRON Daemon
   *
   * @param {Function} cb callback when omnitron has been upgraded
   */
  update(cb?: (err: any, data?: any) => void) {
    Common.printOut(
      'Be sure to have the latest version by doing `npm install omnitron@latest -g` before doing this procedure.'
    );

    // Dump OMNITRON processes
    this.executeRemote('notifyKillOMNITRON', {}, () => { });

    this.getVersion((err, new_version) => {
      this.dump((err) => {
        this.killDaemon(() => {
          this.launchDaemon(
            (err, child) => {
              this.launchRPC(() => {
                this.resurrect(() => {
                  Common.printOut(chalk.blue.bold('>>>>>>>>>> OMNITRON updated'));
                  this.launchSysMonitoring(() => { });
                  this.launchAll(() => {
                    KMDaemon.launchAndInteract(
                      this._conf,
                      {
                        omnitron_version: pkg.version,
                      },
                      (err: any, data: any, interactor_proc: any) => { }
                    );
                    setTimeout(() => (cb ? cb(null, { success: true }) : this.speedList()), 250);
                  });
                });
              });
            },
            { interactor: false }
          );
        });
      });
    });

    return false;
  }

  /**
   * Reload an application
   *
   * @param {String} process_name Application Name or All
   * @param {Object} opts         Options
   * @param {Function} cb         Callback
   */
  reload(process_name: string, opts: any, cb?: (err: any, apps?: any[]) => void) {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    } else if (!opts) opts = {};

    const delay = lockReload();
    if (delay > 0 && opts.force !== true) {
      Common.printError(
        conf.PREFIX_MSG_ERR +
        'Reload already in progress, please try again in ' +
        Math.floor((conf.RELOAD_LOCK_TIMEOUT - delay) / 1000) +
        ' seconds or use --force'
      );
      return cb ? cb(new Error('Reload in progress')) : this.exitCli(conf.ERROR_EXIT);
    }

    if (Common.isConfigFile(process_name))
      this._startJson(process_name, opts, 'reloadProcessId', (err, apps) => {
        unlockReload();
        if (err) return cb ? cb(err) : this.exitCli(conf.ERROR_EXIT);
        return cb ? cb(null, apps) : this.exitCli(conf.SUCCESS_EXIT);
      });
    else {
      if (opts && opts.env) {
        const err = 'Using --env [env] without passing the ecosystem.config.js does not work';
        Common.err(err);
        unlockReload();
        return cb ? cb(Common.retErr(err)) : this.exitCli(conf.ERROR_EXIT);
      }

      if (opts && !opts.updateEnv) Common.printOut(IMMUTABLE_MSG);

      this._operate('reloadProcessId', process_name, opts, (err, apps) => {
        unlockReload();

        if (err) return cb ? cb(err) : this.exitCli(conf.ERROR_EXIT);
        return cb ? cb(null, apps) : this.exitCli(conf.SUCCESS_EXIT);
      });
    }
  }

  /**
   * Restart process
   *
   * @param {String} cmd   Application Name / Process id / JSON application file / 'all'
   * @param {Object} opts  Extra options to be updated
   * @param {Function} cb  Callback
   */
  restart(cmd: any, opts: any, cb: (err: any, procs: any) => void) {
    if (typeof opts == 'function') {
      cb = opts;
      opts = {};
    }

    if (typeof cmd === 'number') cmd = cmd.toString();

    if (cmd == '-') {
      // Restart from PIPED JSON
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (param) => {
        process.stdin.pause();
        this.actionFromJson('restartProcessId', param, opts, 'pipe', cb);
      });
    } else if (Common.isConfigFile(cmd) || typeof cmd === 'object') this._startJson(cmd, opts, 'restartProcessId', cb);
    else {
      if (opts && opts.env) {
        const err = 'Using --env [env] without passing the ecosystem.config.js does not work';
        Common.err(err);
        return cb ? cb(Common.retErr(err)) : this.exitCli(conf.ERROR_EXIT);
      }
      if (opts && !opts.updateEnv) Common.printOut(IMMUTABLE_MSG);
      this._operate('restartProcessId', cmd, opts, cb);
    }
  }

  /**
   * Delete process
   *
   * @param {String} process_name Application Name / Process id / Application file / 'all'
   * @param {Function} cb Callback
   */
  delete(process_name: string, jsonVia: any, cb?: (err: any, procs: any) => void) {
    if (typeof jsonVia === 'function') {
      cb = jsonVia;
      jsonVia = null;
    }

    if (typeof process_name === 'number') {
      process_name = process_name.toString();
    }

    if (jsonVia == 'pipe') {
      return this.actionFromJson('deleteProcessId', process_name, commander, 'pipe', (err, procs) =>
        cb ? cb(err, procs) : this.speedList()
      );
    }
    if (Common.isConfigFile(process_name)) {
      return this.actionFromJson('deleteProcessId', process_name, commander, 'file', (err, procs) =>
        cb ? cb(err, procs) : this.speedList()
      );
    }

    this._operate('deleteProcessId', process_name, (err, procs) => (cb ? cb(err, procs) : this.speedList()));
  }

  /**
   * Stop process
   *
   * @param {String} process_name Application Name / Process id / Application file / 'all'
   * @param {Function} cb Callback
   */
  stop(process_name: string, cb: (err: any, procs: any) => void) {
    if (typeof process_name === 'number') process_name = process_name.toString();

    if (process_name == '-') {
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (param) => {
        process.stdin.pause();
        this.actionFromJson('stopProcessId', param, commander, 'pipe', (err, procs) =>
          cb ? cb(err, procs) : this.speedList()
        );
      });
    } else if (Common.isConfigFile(process_name))
      this.actionFromJson('stopProcessId', process_name, commander, 'file', (err, procs) =>
        cb ? cb(err, procs) : this.speedList()
      );
    else this._operate('stopProcessId', process_name, (err, procs) => (cb ? cb(err, procs) : this.speedList()));
  }

  /**
   * Get list of all processes managed
   *
   * @param {Function} cb Callback
   */
  list(opts?: any, cb?: (err: any, list: any) => void) {
    if (typeof opts == 'function') {
      cb = opts;
      opts = null;
    }

    this.executeRemote('getMonitorData', {}, (err: any, list: any) => {
      if (err) {
        Common.printError(err);
        return cb ? cb(Common.retErr(err)) : this.exitCli(conf.ERROR_EXIT);
      }

      if (opts && opts.rawArgs && opts.rawArgs.indexOf('--watch') > -1) {
        const show = () => {
          process.stdout.write('\x1b[2J');
          process.stdout.write('\x1b[0f');
          console.log('Last refresh: ', dayjs().format());
          this.executeRemote('getMonitorData', {}, (err: any, list: any) => {
            UX.list(list, null);
          });
        };

        show();
        setInterval(show, 900);
        return false;
      }

      return cb ? cb(null, list) : this.speedList(null);
    });
  }

  /**
   * Kill Daemon
   *
   * @param {Function} cb Callback
   */
  killDaemon(cb: (err: any, res: any) => void) {
    process.env.OMNITRON_STATUS = 'stopping';

    this.executeRemote('notifyKillOMNITRON', {}, () => { });

    this._operate('deleteProcessId', 'all', (err, list) => {
      Common.printOut(conf.PREFIX_MSG + '[v] All Applications Stopped');
      process.env.OMNITRON_SILENT = 'false';

      this.killAgent((err, data) => {
        if (!err) {
          Common.printOut(conf.PREFIX_MSG + '[v] Agent Stopped');
        }

        this.killDaemonClient((err, res) => {
          if (err) Common.printError(err);
          Common.printOut(conf.PREFIX_MSG + '[v] OMNITRON Daemon Stopped');
          return cb ? cb(err, res) : this.exitCli(conf.SUCCESS_EXIT);
        });
      });
    });
  }

  kill(cb: (err: any, res: any) => void) {
    this.killDaemon(cb);
  }

  /////////////////////
  // Private methods //
  /////////////////////

  /**
   * Method to START / RESTART a script
   *
   * @private
   * @param {string} script script name (will be resolved according to location)
   */
  private _startScript(script: string, opts: any, cb: (err: any, data: any) => void) {
    if (typeof opts == 'function') {
      cb = opts;
      opts = {};
    }

    /**
     * Commander.js tricks
     */
    let app_conf = Config.filterOptions(opts);
    let appConf: any = {};

    if (typeof app_conf.name == 'function') delete app_conf.name;

    delete app_conf.args;

    // Retrieve arguments via -- <args>
    let argsIndex;

    if (opts.rawArgs && (argsIndex = opts.rawArgs.indexOf('--')) >= 0)
      app_conf.args = opts.rawArgs.slice(argsIndex + 1);
    else if (opts.scriptArgs) app_conf.args = opts.scriptArgs;

    app_conf.script = script;
    if (!app_conf.namespace) app_conf.namespace = 'default';

    if ((appConf = Common.verifyConfs(app_conf)) instanceof Error) {
      Common.err(appConf);
      return cb ? cb(Common.retErr(appConf)) : this.exitCli(conf.ERROR_EXIT);
    }

    app_conf = appConf[0];

    if (opts.watchDelay) {
      if (typeof opts.watchDelay === 'string' && opts.watchDelay.indexOf('ms') !== -1)
        app_conf.watch_delay = parseInt(opts.watchDelay);
      else {
        app_conf.watch_delay = parseFloat(opts.watchDelay) * 1000;
      }
    }

    const mas: any[] = [];
    if (typeof opts.ext != 'undefined') make_available_extension(opts, mas); // for -e flag

    if (mas.length > 0) app_conf.ignore_watch = mas;

    /**
     * If -w option, write configuration to configuration.json file
     */
    if (app_conf.write) {
      const dst_path = path.join(process.env.PWD || process.cwd(), app_conf.name + '-omnitron.json');
      Common.printOut(conf.PREFIX_MSG + 'Writing configuration to', chalk.blue(dst_path));
      // pretty JSON
      try {
        fs.writeFileSync(dst_path, JSON.stringify(app_conf, null, 2));
      } catch (e) {
        console.error(e.stack || e);
      }
    }

    /**
     * If start <app_name> start/restart application
     */
    const restartExistingProcessName = (cb_: (err: any, data: any) => void) => {
      if (
        !isNaN(script as any) ||
        (typeof script === 'string' && script.indexOf('/') != -1) ||
        (typeof script === 'string' && path.extname(script) !== '')
      ) {
        cb_(null);
        return;
      }

      this.getProcessIdByNameClient(script, (err, ids) => {
        if (err && cb_) return cb_(err);
        if (ids.length > 0) {
          this._operate('restartProcessId', script, opts, (err, list) => {
            if (err) return cb_(err);
            Common.printOut(conf.PREFIX_MSG + 'Process successfully started');
            return cb_(true, list);
          });
        } else return cb_(null);
      });
    };

    /**
     * If start <namespace> start/restart namespace
     */
    const restartExistingNameSpace = (cb_: (err: any, data: any) => void) => {
      if (
        !isNaN(script) ||
        (typeof script === 'string' && script.indexOf('/') != -1) ||
        (typeof script === 'string' && path.extname(script) !== '')
      ) {
        cb_(null);
        return;
      }

      if (script !== 'all') {
        this.getProcessIdsByNamespace(script, (err, ids) => {
          if (err && cb_) return cb_(err);
          if (ids.length > 0) {
            this._operate('restartProcessId', script, opts, (err, list) => {
              if (err) return cb_(err);
              Common.printOut(conf.PREFIX_MSG + 'Process successfully started');
              return cb_(true, list);
            });
          } else return cb_(null);
        });
      } else {
        this._operate('restartProcessId', 'all', (err, list) => {
          if (err) return cb_(err);
          Common.printOut(conf.PREFIX_MSG + 'Process successfully started');
          return cb_(true, list);
        });
      }
    };

    const restartExistingProcessId = (cb_: (err: any, data: any) => void) => {
      if (isNaN(script)) {
        cb_(null);
        return;
      }

      this._operate('restartProcessId', script, opts, (err, list) => {
        if (err) return cb_(err);
        Common.printOut(conf.PREFIX_MSG + 'Process successfully started');
        return cb_(true, list);
      });
    };

    /**
     * Restart a process with the same full path or start it
     */
    const restartExistingProcessPathOrStartNew = (cb_: (err: any, data: any) => void) => {
      this.executeRemote('getMonitorData', {}, (err, procs) => {
        if (err) {
          if (cb_) return cb_(new Error(err));
          else this.exitCli(conf.ERROR_EXIT);
          return false;
        }

        const full_path = path.resolve(this.cwd, script);
        let managed_script = null;

        procs.forEach((proc) => {
          if (proc.omnitron_env.pm_exec_path == full_path && proc.omnitron_env.name == app_conf.name)
            managed_script = proc;
        });

        if (
          managed_script &&
          (managed_script.omnitron_env.status == conf.STOPPED_STATUS ||
            managed_script.omnitron_env.status == conf.STOPPING_STATUS ||
            managed_script.omnitron_env.status == conf.ERRORED_STATUS)
        ) {
          // Restart process if stopped
          const app_name = managed_script.omnitron_env.name;

          this._operate('restartProcessId', app_name, opts, (err, list) => {
            if (err) {
              if (cb_) return cb_(new Error(err));
              else this.exitCli(conf.ERROR_EXIT);
              return false;
            }
            Common.printOut(conf.PREFIX_MSG + 'Process successfully started');
            return cb_(true, list);
          });
          return false;
        } else if (managed_script && !opts.force) {
          Common.err('Script already launched, add -f option to force re-execution');
          return cb_(new Error('Script already launched'));
        }

        let resolved_paths = null;

        try {
          resolved_paths = Common.resolveAppAttributes(
            {
              cwd: this.cwd,
              omnitron_home: this.omnitron_home,
            },
            app_conf
          );
        } catch (e) {
          Common.err(e.message);
          return cb_(Common.retErr(e));
        }

        Common.printOut(
          conf.PREFIX_MSG + 'Starting %s in %s (%d instance' + (resolved_paths.instances > 1 ? 's' : '') + ')',
          resolved_paths.pm_exec_path,
          resolved_paths.exec_mode,
          resolved_paths.instances
        );

        if (!resolved_paths.env) resolved_paths.env = {};

        // Set OMNITRON HOME in case of child process using OMNITRON API
        resolved_paths.env['OMNITRON_HOME'] = this.omnitron_home;

        const additional_env = Modularizer.getAdditionalConf(resolved_paths.name);
        Object.assign(resolved_paths.env, additional_env);

        // Is KM linked?
        resolved_paths.km_link = this.gl_is_km_linked;

        this.executeRemote('prepare', resolved_paths, (err, data) => {
          if (err) {
            Common.printError(conf.PREFIX_MSG_ERR + 'Error while launching application', err.stack || err);
            return cb_(Common.retErr(err));
          }

          Common.printOut(conf.PREFIX_MSG + 'Done.');
          return cb_(true, data);
        });
        return false;
      });
    };

    series(
      [
        restartExistingProcessName,
        restartExistingNameSpace,
        restartExistingProcessId,
        restartExistingProcessPathOrStartNew,
      ],
      (err, data) => {
        if (err instanceof Error) {
          if (cb) cb(err);
          else this.exitCli(conf.ERROR_EXIT);
          return;
        }

        let ret: any = {};

        data.forEach((_dt) => {
          if (_dt !== undefined) ret = _dt;
        });

        if (cb) cb(null, ret);
        else this.speedList();
      }
    );
  }

  /**
   * Method to start/restart/reload processes from a JSON file
   * It will start app not started
   * Can receive only option to skip applications
   *
   * @private
   */
  _startJson(file: string, opts: any, action: string, pipe?: string, cb?: (err: Error, apps?: any[]) => void) {
    let config = {};
    let appConf = {};
    let staticConf = [];
    let deployConf = {};
    let apps_info = [];

    /**
     * Get File configuration
     */
    if (typeof cb === 'undefined' && typeof pipe === 'function') {
      cb = pipe;
    }
    if (typeof file === 'object') {
      config = file;
    } else if (pipe === 'pipe') {
      config = Common.parseConfig(file, 'pipe');
    } else {
      let data: any = null;

      const isAbsolute = path.isAbsolute(file);
      const file_path = isAbsolute ? file : path.join(this.cwd, file);

      try {
        data = fs.readFileSync(file_path);
      } catch (e) {
        Common.printError(conf.PREFIX_MSG_ERR + 'File ' + file + ' not found');
        return cb ? cb(Common.retErr(e)) : this.exitCli(conf.ERROR_EXIT);
      }

      try {
        config = Common.parseConfig(data, file);
      } catch (e) {
        Common.printError(conf.PREFIX_MSG_ERR + 'File ' + file + ' malformated');
        console.error(e);
        return cb ? cb(Common.retErr(e)) : this.exitCli(conf.ERROR_EXIT);
      }
    }

    /**
     * Alias some optional fields
     */
    if (config.deploy) deployConf = config.deploy;
    if (config.static) staticConf = config.static;
    if (config.apps) appConf = config.apps;
    else if (config.omnitron) appConf = config.omnitron;
    else appConf = config;
    if (!Array.isArray(appConf)) appConf = [appConf];

    if ((appConf = Common.verifyConfs(appConf)) instanceof Error)
      return cb ? cb(appConf) : this.exitCli(conf.ERROR_EXIT);

    process.env.OMNITRON_JSON_PROCESSING = true;

    // Get App list
    const apps_name = [];
    const proc_list = {};

    // Add statics to apps
    staticConf.forEach((serve) => {
      appConf.push({
        name: serve.name ? serve.name : `static-page-server-${serve.port}`,
        script: path.resolve(__dirname, 'api', 'serve.js'),
        env: {
          OMNITRON_SERVE_PORT: serve.port,
          OMNITRON_SERVE_HOST: serve.host,
          OMNITRON_SERVE_PATH: serve.path,
          OMNITRON_SERVE_SPA: serve.spa,
          OMNITRON_SERVE_DIRECTORY: serve.directory,
          OMNITRON_SERVE_BASIC_AUTH: serve.basic_auth !== undefined,
          OMNITRON_SERVE_BASIC_AUTH_USERNAME: serve.basic_auth ? serve.basic_auth.username : null,
          OMNITRON_SERVE_BASIC_AUTH_PASSWORD: serve.basic_auth ? serve.basic_auth.password : null,
          OMNITRON_SERVE_MONITOR: serve.monitor,
        },
      });
    });

    // Here we pick only the field we want from the CLI when starting a JSON
    appConf.forEach((app) => {
      if (!app.env) {
        app.env = {};
      }
      app.env.io = app.io;
      // --only <app>
      if (opts.only) {
        const apps = opts.only.split(/,| /);
        if (apps.indexOf(app.name) == -1) return false;
      }
      // Namespace
      if (!app.namespace) {
        if (opts.namespace) app.namespace = opts.namespace;
        else app.namespace = 'default';
      }
      // --watch
      if (!app.watch && opts.watch && opts.watch === true) app.watch = true;
      // --ignore-watch
      if (!app.ignore_watch && opts.ignore_watch) app.ignore_watch = opts.ignore_watch;
      if (opts.install_url) app.install_url = opts.install_url;
      // --instances <nb>
      if (opts.instances && typeof opts.instances === 'number') app.instances = opts.instances;
      // --uid <user>
      if (opts.uid) app.uid = opts.uid;
      // --gid <user>
      if (opts.gid) app.gid = opts.gid;
      // Specific
      if (app.append_env_to_name && opts.env) app.name += '-' + opts.env;
      if (opts.name_prefix && app.name.indexOf(opts.name_prefix) == -1) app.name = `${opts.name_prefix}:${app.name}`;

      app.username = Common.getCurrentUsername();
      apps_name.push(app.name);
    });

    this.executeRemote('getMonitorData', {}, (err, raw_proc_list) => {
      if (err) {
        Common.printError(err);
        return cb ? cb(Common.retErr(err)) : this.exitCli(conf.ERROR_EXIT);
      }

      /**
       * Uniquify in memory process list
       */
      raw_proc_list.forEach((proc) => {
        proc_list[proc.name] = proc;
      });

      /**
       * Auto detect application already started
       * and act on them depending on action
       */
      eachLimit(
        Object.keys(proc_list),
        conf.CONCURRENT_ACTIONS,
        (proc_name, next) => {
          // Skip app name (--only option)
          if (apps_name.indexOf(proc_name) == -1) return next();

          if (!(action == 'reloadProcessId' || action == 'softReloadProcessId' || action == 'restartProcessId'))
            throw new Error('Wrong action called');

          const apps = appConf.filter((app) => app.name == proc_name);

          const envs = apps.map((app) =>
            // Binds env_diff to env and returns it.
            Common.mergeEnvironmentVariables(app, opts.env, deployConf)
          );

          // Assigns own enumerable properties of all
          // Notice: if people use the same name in different apps,
          //         duplicated envs will be overrode by the last one
          const env = envs.reduce((e1, e2) => Object.assign(e1, e2));

          // When we are processing JSON, allow to keep the new env by default
          env.updateEnv = true;

          // Pass `env` option
          this._operate(action, proc_name, env, (err, ret) => {
            if (err) Common.printError(err);

            // For return
            apps_info = apps_info.concat(ret);

            this.notifyGod(action, proc_name);
            // And Remove from array to spy
            apps_name.splice(apps_name.indexOf(proc_name), 1);
            return next();
          });
        },
        (err) => {
          if (err) return cb ? cb(Common.retErr(err)) : this.exitCli(conf.ERROR_EXIT);
          if (apps_name.length > 0 && action != 'start')
            Common.printOut(conf.PREFIX_MSG_WARNING + 'Applications %s not running, starting...', apps_name.join(', '));
          // Start missing apps
          return startApps(apps_name, (err, apps) => {
            apps_info = apps_info.concat(apps);
            return cb ? cb(err, apps_info) : this.speedList(err ? 1 : 0);
          });
        }
      );
      return false;
    });

    const startApps = (app_name_to_start, cb) => {
      const apps_to_start = [];
      let apps_started = [];
      const apps_errored = [];

      appConf.forEach((app, i) => {
        if (app_name_to_start.indexOf(app.name) != -1) {
          apps_to_start.push(appConf[i]);
        }
      });

      eachLimit(
        apps_to_start,
        conf.CONCURRENT_ACTIONS,
        (app, next) => {
          if (opts.cwd) app.cwd = opts.cwd;
          if (opts.force_name) app.name = opts.force_name;
          if (opts.started_as_module) app.pmx_module = true;

          let resolved_paths = null;

          // hardcode script name to use `serve` feature inside a process file
          if (app.script === 'serve') {
            app.script = path.resolve(__dirname, 'api', 'serve.js');
          }

          try {
            resolved_paths = Common.resolveAppAttributes(
              {
                cwd: this.cwd,
                omnitron_home: this.omnitron_home,
              },
              app
            );
          } catch (e) {
            apps_errored.push(e);
            Common.err(`Error: ${e.message}`);
            return next();
          }

          if (!resolved_paths.env) resolved_paths.env = {};

          // Set OMNITRON HOME in case of child process using OMNITRON API
          resolved_paths.env['OMNITRON_HOME'] = this.omnitron_home;

          const additional_env = Modularizer.getAdditionalConf(resolved_paths.name);
          Object.assign(resolved_paths.env, additional_env);

          resolved_paths.env = Common.mergeEnvironmentVariables(resolved_paths, opts.env, deployConf);

          delete resolved_paths.env.current_conf;

          // Is KM linked?
          resolved_paths.km_link = this.gl_is_km_linked;

          if (resolved_paths.wait_ready) {
            Common.warn(`App ${resolved_paths.name} has option 'wait_ready' set, waiting for app to be ready...`);
          }
          this.executeRemote('prepare', resolved_paths, (err, data) => {
            if (err) {
              Common.printError(conf.PREFIX_MSG_ERR + 'Process failed to launch %s', err.message ? err.message : err);
              return next();
            }
            if (data.length === 0) {
              Common.printError(conf.PREFIX_MSG_ERR + 'Process config loading failed', data);
              return next();
            }

            Common.printOut(
              conf.PREFIX_MSG + 'App [%s] launched (%d instances)',
              data[0].omnitron_env.name,
              data.length
            );
            apps_started = apps_started.concat(data);
            next();
          });
        },
        (err) => {
          const final_error = err || apps_errored.length > 0 ? apps_errored : null;
          return cb ? cb(final_error, apps_started) : this.speedList();
        }
      );
      return false;
    };
  }

  /**
   * Apply a RPC method on the json file
   * @private
   * @method actionFromJson
   * @param {string} action RPC Method
   * @param {object} options
   * @param {string|object} file file
   * @param {string} jsonVia action type (=only 'pipe' ?)
   * @param {Function}
   */
  actionFromJson(action, file, opts, jsonVia, cb) {
    let appConf = {};
    const ret_processes = [];

    //accept programmatic calls
    if (typeof file == 'object') {
      cb = typeof jsonVia == 'function' ? jsonVia : cb;
      appConf = file;
    } else if (jsonVia == 'file') {
      let data = null;

      try {
        data = fs.readFileSync(file);
      } catch (e) {
        Common.printError(conf.PREFIX_MSG_ERR + 'File ' + file + ' not found');
        return cb ? cb(Common.retErr(e)) : this.exitCli(conf.ERROR_EXIT);
      }

      try {
        appConf = Common.parseConfig(data, file);
      } catch (e) {
        Common.printError(conf.PREFIX_MSG_ERR + 'File ' + file + ' malformated');
        console.error(e);
        return cb ? cb(Common.retErr(e)) : this.exitCli(conf.ERROR_EXIT);
      }
    } else if (jsonVia == 'pipe') {
      appConf = Common.parseConfig(file, 'pipe');
    } else {
      Common.printError('Bad call to actionFromJson, jsonVia should be one of file, pipe');
      return this.exitCli(conf.ERROR_EXIT);
    }

    // Backward compatibility
    if (appConf.apps) appConf = appConf.apps;

    if (!Array.isArray(appConf)) appConf = [appConf];

    if ((appConf = Common.verifyConfs(appConf)) instanceof Error)
      return cb ? cb(appConf) : this.exitCli(conf.ERROR_EXIT);

    eachLimit(
      appConf,
      conf.CONCURRENT_ACTIONS,
      (proc, next1) => {
        let name = '';
        let new_env;

        if (!proc.name) name = path.basename(proc.script);
        else name = proc.name;

        if (opts.only && opts.only != name) return process.nextTick(next1);

        if (opts && opts.env) new_env = Common.mergeEnvironmentVariables(proc, opts.env);
        else new_env = Common.mergeEnvironmentVariables(proc);

        this.getProcessIdByNameClient(name, (err, ids) => {
          if (err) {
            Common.printError(err);
            return next1();
          }
          if (!ids) return next1();

          eachLimit(
            ids,
            conf.CONCURRENT_ACTIONS,
            (id, next2) => {
              let opts = {};

              //stopProcessId could accept options to?
              if (action == 'restartProcessId') {
                opts = { id, env: new_env };
              } else {
                opts = id;
              }

              this.executeRemote(action, opts, (err, res) => {
                ret_processes.push(res);
                if (err) {
                  Common.printError(err);
                  return next2();
                }

                if (action == 'restartProcessId') {
                  this.notifyGod('restart', id);
                } else if (action == 'deleteProcessId') {
                  this.notifyGod('delete', id);
                } else if (action == 'stopProcessId') {
                  this.notifyGod('stop', id);
                }

                Common.printOut(conf.PREFIX_MSG + '[%s](%d) \u2713', name, id);
                return next2();
              });
            },
            (err) => next1(null, ret_processes)
          );
        });
      },
      (err) => {
        if (cb) return cb(null, ret_processes);
        else return this.speedList();
      }
    );
  }

  /**
   * Main function to operate with OMNITRON daemon
   *
   * @param {String} action_name  Name of action (restartProcessId, deleteProcessId, stopProcessId)
   * @param {String} process_name can be 'all', a id integer or process name
   * @param {Object} envs         object with CLI options / environment
   */
  _operate(action_name, process_name, envs, cb) {
    const that = this;
    let update_env = false;
    const ret = [];

    // Make sure all options exist
    if (!envs) envs = {};

    if (typeof envs == 'function') {
      cb = envs;
      envs = {};
    }

    // Set via env.update (JSON processing)
    if (envs.updateEnv === true) update_env = true;

    let concurrent_actions = envs.parallel || conf.CONCURRENT_ACTIONS;

    if (!process.env.OMNITRON_JSON_PROCESSING || envs.commands) {
      envs = this._handleAttributeUpdate(envs);
    }

    /**
     * Set current updated configuration if not passed
     */
    if (!envs.current_conf) {
      const _conf = fclone(envs);
      envs = {
        current_conf: _conf,
      };

      // Is KM linked?
      envs.current_conf.km_link = this.gl_is_km_linked;
    }

    /**
     * Operate action on specific process id
     */
    const processIds = (ids, cb) => {
      Common.printOut(conf.PREFIX_MSG + 'Applying action %s on app [%s](ids: %s)', action_name, process_name, ids);

      if (ids.length <= 2) concurrent_actions = 1;

      if (action_name == 'deleteProcessId') concurrent_actions = 10;

      eachLimit(
        ids,
        concurrent_actions,
        (id, next) => {
          let opts;

          // These functions need extra param to be passed
          if (
            action_name == 'restartProcessId' ||
            action_name == 'reloadProcessId' ||
            action_name == 'softReloadProcessId'
          ) {
            let new_env = {};

            if (update_env === true) {
              if (conf.OMNITRON_PROGRAMMATIC == true) new_env = Common.safeExtend({}, process.env);
              else new_env = Object.assign({}, process.env);

              Object.keys(envs).forEach((k) => {
                new_env[k] = envs[k];
              });
            } else {
              new_env = envs;
            }

            opts = {
              id,
              env: new_env,
            };
          } else {
            opts = id;
          }

          that.executeRemote(action_name, opts, (err, res) => {
            if (err) {
              Common.printError(conf.PREFIX_MSG_ERR + 'Process %s not found', id);
              return next(`Process ${id} not found`);
            }

            if (action_name == 'restartProcessId') {
              that.notifyGod('restart', id);
            } else if (action_name == 'deleteProcessId') {
              that.notifyGod('delete', id);
            } else if (action_name == 'stopProcessId') {
              that.notifyGod('stop', id);
            } else if (action_name == 'reloadProcessId') {
              that.notifyGod('reload', id);
            } else if (action_name == 'softReloadProcessId') {
              that.notifyGod('graceful reload', id);
            }

            if (!Array.isArray(res)) res = [res];

            // Filter return
            res.forEach((proc) => {
              Common.printOut(
                conf.PREFIX_MSG + '[%s](%d) \u2713',
                proc.omnitron_env ? proc.omnitron_env.name : process_name,
                id
              );

              if (action_name == 'stopProcessId' && proc.omnitron_env && proc.omnitron_env.cron_restart) {
                Common.warn(
                  `App ${chalk.bold(proc.omnitron_env.name)} stopped but CRON RESTART is still UP ${proc.omnitron_env.cron_restart}`
                );
              }

              if (!proc.omnitron_env) return false;

              ret.push({
                name: proc.omnitron_env.name,
                namespace: proc.omnitron_env.namespace,
                pm_id: proc.omnitron_env.pm_id,
                status: proc.omnitron_env.status,
                restart_time: proc.omnitron_env.restart_time,
                omnitron_env: {
                  name: proc.omnitron_env.name,
                  namespace: proc.omnitron_env.namespace,
                  pm_id: proc.omnitron_env.pm_id,
                  status: proc.omnitron_env.status,
                  restart_time: proc.omnitron_env.restart_time,
                  env: proc.omnitron_env.env,
                },
              });
            });

            return next();
          });
        },
        (err) => {
          if (err) return cb ? cb(Common.retErr(err)) : that.exitCli(conf.ERROR_EXIT);
          return cb ? cb(null, ret) : that.speedList();
        }
      );
    };

    if (process_name == 'all') {
      // When using shortcuts like 'all', do not delete modules
      let fn;

      if (process.env.OMNITRON_STATUS == 'stopping')
        that.getAllProcessId((err, ids) => {
          reoperate(err, ids);
        });
      else
        that.getAllProcessIdWithoutModules((err, ids) => {
          reoperate(err, ids);
        });

      function reoperate(err, ids) {
        if (err) {
          Common.printError(err);
          return cb ? cb(Common.retErr(err)) : that.exitCli(conf.ERROR_EXIT);
        }
        if (!ids || ids.length === 0) {
          Common.printError(conf.PREFIX_MSG_WARNING + 'No process found');
          return cb ? cb(new Error('process name not found')) : that.exitCli(conf.ERROR_EXIT);
        }
        return processIds(ids, cb);
      }
    }
    // operate using regex
    else if (isNaN(process_name) && process_name[0] === '/' && process_name[process_name.length - 1] === '/') {
      const regex = new RegExp(process_name.replace(/\//g, ''));

      that.executeRemote('getMonitorData', {}, (err, list) => {
        if (err) {
          Common.printError('Error retrieving process list: ' + err);
          return cb(err);
        }
        const found_proc = [];
        list.forEach((proc) => {
          if (regex.test(proc.omnitron_env.name)) {
            found_proc.push(proc.pm_id);
          }
        });

        if (found_proc.length === 0) {
          Common.printError(conf.PREFIX_MSG_WARNING + 'No process found');
          return cb ? cb(new Error('process name not found')) : that.exitCli(conf.ERROR_EXIT);
        }

        return processIds(found_proc, cb);
      });
    } else if (isNaN(process_name)) {
      /**
       * We can not stop or delete a module but we can restart it
       * to refresh configuration variable
       */
      const allow_module_restart = action_name == 'restartProcessId' ? true : false;

      that.getProcessIdByNameClient(process_name, allow_module_restart, (err, ids) => {
        if (err) {
          Common.printError(err);
          return cb ? cb(Common.retErr(err)) : that.exitCli(conf.ERROR_EXIT);
        }
        if (ids && ids.length > 0) {
          /**
           * Determine if the process to restart is a module
           * if yes load configuration variables and merge with the current environment
           */
          const additional_env = Modularizer.getAdditionalConf(process_name);
          Object.assign(envs, additional_env);
          return processIds(ids, cb);
        }

        that.getProcessIdsByNamespace(process_name, allow_module_restart, (err, ns_process_ids) => {
          if (err) {
            Common.printError(err);
            return cb ? cb(Common.retErr(err)) : that.exitCli(conf.ERROR_EXIT);
          }
          if (!ns_process_ids || ns_process_ids.length === 0) {
            Common.printError(conf.PREFIX_MSG_ERR + 'Process or Namespace %s not found', process_name);
            return cb ? cb(new Error('process or namespace not found')) : that.exitCli(conf.ERROR_EXIT);
          }

          /**
           * Determine if the process to restart is a module
           * if yes load configuration variables and merge with the current environment
           */
          const ns_additional_env = Modularizer.getAdditionalConf(process_name);
          Object.assign(envs, ns_additional_env);
          return processIds(ns_process_ids, cb);
        });
      });
    } else {
      if (that.omnitron_configuration.docker == 'true' || that.omnitron_configuration.docker == true) {
        // Docker/Systemd process interaction detection
        that.executeRemote('getMonitorData', {}, (err, proc_list) => {
          let higher_id = 0;
          proc_list.forEach((p) => {
            if (p.pm_id > higher_id) {
              higher_id = p.pm_id;
            }
          });

          // Is Docker/Systemd
          if (process_name > higher_id)
            return dockerProcessCommand(that, higher_id, process_name, action_name, (err_) => {
              if (err_) {
                Common.printError(conf.PREFIX_MSG_ERR + (err_.message ? err_.message : err_));
                return cb ? cb(Common.retErr(err_)) : that.exitCli(conf.ERROR_EXIT);
              }

              return cb ? cb(null, ret) : that.speedList();
            });

          // Check if application name as number is an app name
          that.getProcessIdByNameClient(process_name, (err, ids) => {
            if (ids.length > 0) return processIds(ids, cb);

            // Check if application name as number is an namespace
            that.getProcessIdsByNamespace(process_name, (err, ns_process_ids) => {
              if (ns_process_ids.length > 0) return processIds(ns_process_ids, cb);
              // Else operate on pm id
              return processIds([process_name], cb);
            });
          });
        });
      } else {
        // Check if application name as number is an app name
        that.getProcessIdByNameClient(process_name, (err, ids) => {
          if (ids.length > 0) return processIds(ids, cb);

          // Check if application name as number is an namespace
          that.getProcessIdsByNamespace(process_name, (err, ns_process_ids) => {
            if (ns_process_ids.length > 0) return processIds(ns_process_ids, cb);
            // Else operate on pm id
            return processIds([process_name], cb);
          });
        });
      }
    }
  }

  /**
   * Converts CamelCase Commander.js arguments
   * to Underscore
   * (nodeArgs -> node_args)
   */
  _handleAttributeUpdate(opts) {
    const conf_ = Config.filterOptions(opts);

    if (typeof conf_.name != 'string') delete conf_.name;

    let argsIndex = 0;
    if (opts.rawArgs && (argsIndex = opts.rawArgs.indexOf('--')) >= 0) {
      conf_.args = opts.rawArgs.slice(argsIndex + 1);
    }

    const appConf = Common.verifyConfs(conf_)[0];

    if (appConf instanceof Error) {
      Common.printError('Error while transforming CamelCase args to underscore');
      return appConf;
    }

    if (argsIndex == -1) delete appConf.args;
    if (appConf.name == 'undefined') delete appConf.name;

    delete appConf.exec_mode;

    if (Array.isArray(appConf.watch) && appConf.watch.length === 0) {
      if (!~opts.rawArgs.indexOf('--watch')) delete appConf.watch;
    }

    // Options set via environment variables
    if (process.env.OMNITRON_DEEP_MONITORING) appConf.deep_monitoring = true;

    // Force deletion of defaults values set by commander
    // to avoid overriding specified configuration by user
    if (appConf.treekill === true) delete appConf.treekill;
    if (appConf.vizion === true) delete appConf.vizion;
    if (appConf.autostart === true) delete appConf.autostart;
    if (appConf.autorestart === true) delete appConf.autorestart;

    return appConf;
  }

  getProcessIdByName(name: string, cb?: (err: Error, id?: number) => void) {
    this.getProcessIdByNameClient(name, (err, id) => {
      if (err) {
        Common.printError(err);
        return cb ? cb(Common.retErr(err)) : this.exitCli(conf.ERROR_EXIT);
      }
      console.log(id);
      return cb ? cb(null, id) : this.exitCli(conf.SUCCESS_EXIT);
    });
  }

  /**
   * Description
   * @method jlist
   * @param {} debug
   * @return
   */
  jlist(debug?: boolean) {
    this.executeRemote('getMonitorData', {}, (err, list) => {
      if (err) {
        Common.printError(err);
        return this.exitCli(conf.ERROR_EXIT);
      }

      if (debug) {
        process.stdout.write(util.inspect(list, false, null, false));
      } else {
        process.stdout.write(JSON.stringify(list));
      }

      this.exitCli(conf.SUCCESS_EXIT);
    });
  }

  /**
   * Display system information
   * @method slist
   * @return
   */
  slist(tree?: boolean) {
    this.executeRemote('getSystemData', {}, (err, sys_infos) => {
      if (err) {
        Common.err(err);
        return this.exitCli(conf.ERROR_EXIT);
      }

      if (tree === true) {
        const treeify = require('./tools/treeify.js');
        console.log(treeify.asTree(sys_infos, true));
      } else process.stdout.write(util.inspect(sys_infos, false, null, false));
      this.exitCli(conf.SUCCESS_EXIT);
    });
  }

  /**
   * Description
   * @method speedList
   * @return
   */
  speedList(code?: number, apps_acted?: any[]) {
    const that = this;
    const acted = [];

    if (code != 0 && code != null) {
      return this.exitCli(code ? code : conf.SUCCESS_EXIT);
    }

    if (apps_acted && apps_acted.length > 0) {
      apps_acted.forEach((proc) => {
        acted.push(proc.omnitron_env ? proc.omnitron_env.pm_id : proc.pm_id);
      });
    }

    // Do nothing if OMNITRON called programmatically and not called from CLI (also in exitCli)
    if (conf.OMNITRON_PROGRAMMATIC && process.env.OMNITRON_USAGE != 'CLI') return false;

    return this.executeRemote('getMonitorData', {}, (err, proc_list) => {
      doList(err, proc_list);
    });

    function doList(err, list) {
      if (err) {
        if (that.gl_retry == 0) {
          that.gl_retry += 1;
          return setTimeout(that.speedList.bind(that), 1400);
        }
        console.error(
          'Error retrieving process list: %s.\nA process seems to be on infinite loop, retry in 5 seconds',
          err
        );
        return that.exitCli(conf.ERROR_EXIT);
      }
      if (process.stdout.isTTY === false) {
        UX.list_min(list);
      } else if (commander.miniList && !commander.silent) UX.list_min(list);
      else if (!commander.silent) {
        if (that.gl_interact_infos) {
          let dashboard_url = `https://app.omnitron.io/#/r/${that.gl_interact_infos.public_key}`;

          if (that.gl_interact_infos.info_node != 'https://root.keymetrics.io') {
            dashboard_url = `${that.gl_interact_infos.info_node}/#/r/${that.gl_interact_infos.public_key}`;
          }

          Common.printOut(
            '%s OMNITRON+ activated | Instance Name: %s | Dash: %s',
            chalk.green.bold('⇆'),
            chalk.bold(that.gl_interact_infos.machine_name),
            chalk.bold(dashboard_url)
          );
        }
        UX.list(list, commander);
        //Common.printOut(chalk.white.italic(' Use `omnitron show <id|name>` to get more details about an app'));
      }

      if (that.daemon_mode == false) {
        Common.printOut('[--no-daemon] Continue to stream logs');
        Common.printOut(
          '[--no-daemon] Exit on target OMNITRON exit pid=' + fs.readFileSync(conf.OMNITRON_PID_FILE_PATH).toString()
        );
        global._auto_exit = true;
        return that.streamLogs('all', 0, false, 'HH:mm:ss', false);
      }
      // if (process.stdout.isTTY) if looking for start logs
      else if (!process.env.TRAVIS && process.env.NODE_ENV != 'test' && acted.length > 0 && commander.attach === true) {
        Common.info(`Log streaming apps id: ${chalk.cyan(acted.join(' '))}, exit with Ctrl-C or will exit in 10secs`);

        // setTimeout(() => {
        //   Common.info(`Log streaming exited automatically, run 'omnitron logs' to continue watching logs`)
        //   return that.exitCli(code ? code : conf.SUCCESS_EXIT);
        // }, 10000)

        return acted.forEach((proc_name) => {
          that.streamLogs(proc_name, 0, false, null, false);
        });
      } else {
        return that.exitCli(code ? code : conf.SUCCESS_EXIT);
      }
    }
  }

  /**
   * Scale up/down a process
   * @method scale
   */
  scale(app_name: string, number: number, cb?: (err: Error, data?: any) => void) {
    const that = this;

    function addProcs(proc, value, cb) {
      (function ex(proc, number) {
        if (number-- === 0) return cb();
        Common.printOut(conf.PREFIX_MSG + 'Scaling up application');
        that.executeRemote('duplicateProcessId', proc.omnitron_env.pm_id, ex.bind(this, proc, number));
      })(proc, number);
    }

    function rmProcs(procs, value, cb) {
      let i = 0;

      (function ex(procs, number) {
        if (number++ === 0) return cb();
        that._operate('deleteProcessId', procs[i++].omnitron_env.pm_id, ex.bind(this, procs, number));
      })(procs, number);
    }

    function end() {
      return cb ? cb(null, { success: true }) : that.speedList();
    }

    this.getProcessByName(app_name, function (err, procs) {
      if (err) {
        Common.printError(err);
        return cb ? cb(Common.retErr(err)) : that.exitCli(conf.ERROR_EXIT);
      }

      if (!procs || procs.length === 0) {
        Common.printError(conf.PREFIX_MSG_ERR + 'Application %s not found', app_name);
        return cb ? cb(new Error('App not found')) : that.exitCli(conf.ERROR_EXIT);
      }

      const proc_number = procs.length;

      if (typeof number === 'string' && number.indexOf('+') >= 0) {
        number = parseInt(number, 10);
        return addProcs(procs[0], number, end);
      } else if (typeof number === 'string' && number.indexOf('-') >= 0) {
        number = parseInt(number, 10);
        return rmProcs(procs[0], number, end);
      } else {
        number = parseInt(number, 10);
        number = number - proc_number;

        if (number < 0) return rmProcs(procs, number, end);
        else if (number > 0) return addProcs(procs[0], number, end);
        else {
          Common.printError(conf.PREFIX_MSG_ERR + 'Nothing to do');
          return cb ? cb(new Error('Same process number')) : that.exitCli(conf.ERROR_EXIT);
        }
      }
    });
  }

  /**
   * Description
   * @method describeProcess
   * @param {} omnitron_id
   * @return
   */
  describe(omnitron_id: string | number, cb?: (err: Error, list: any[]) => void) {
    const found_proc = [];

    this.executeRemote('getMonitorData', {}, (err, list) => {
      if (err) {
        Common.printError('Error retrieving process list: ' + err);
        this.exitCli(conf.ERROR_EXIT);
      }

      list.forEach((proc) => {
        if (
          (!isNaN(omnitron_id) && proc.pm_id == omnitron_id) ||
          (typeof omnitron_id === 'string' && proc.name == omnitron_id)
        ) {
          found_proc.push(proc);
        }
      });

      if (found_proc.length === 0) {
        Common.printError(conf.PREFIX_MSG_WARNING + "%s doesn't exist", omnitron_id);
        return cb ? cb(null, []) : this.exitCli(conf.ERROR_EXIT);
      }

      if (!cb) {
        found_proc.forEach((proc) => {
          UX.describe(proc);
        });
      }

      return cb ? cb(null, found_proc) : this.exitCli(conf.SUCCESS_EXIT);
    });
  }

  // extra
  /**
   * Get version of the daemonized OMNITRON
   * @method getVersion
   * @callback cb
   */
  getVersion(cb?: (err: Error, data?: any) => void) {
    this.executeRemote('getVersion', {}, (...args) => (cb ? cb.apply(null, args) : this.exitCli(cst.SUCCESS_EXIT)));
  }

  /**
   * Install pm2-sysmonit
   */
  launchSysMonitoring(cb?: (err: any, data?: any) => void) {
    if (
      (this.omnitron_configuration && this.omnitron_configuration.sysmonit != 'true') ||
      process.env.TRAVIS ||
      global.it === 'function' ||
      cst.IS_WINDOWS === true
    )
      return cb ? cb(null) : null;

    let filepath;

    try {
      filepath = path.dirname(require.resolve('pm2-sysmonit'));
    } catch (e) {
      return cb ? cb(null) : null;
    }

    this.start(
      {
        script: filepath,
      },
      {
        started_as_module: true,
      },
      (err, res) => {
        if (err) {
          Common.printError(cst.PREFIX_MSG_ERR + 'Error while trying to serve : ' + err.message || err);
          return cb ? cb(err) : this.speedList(cst.ERROR_EXIT);
        }
        return cb ? cb(null) : this.speedList();
      }
    );
  }

  /**
   * Show application environment
   * @method env
   * @callback cb
   */
  env(app_id: string, cb?: (err: any, data?: any) => void) {
    let printed = 0;

    this.executeRemote('getMonitorData', {}, (err, list) => {
      list.forEach((l) => {
        if (app_id == l.pm_id) {
          printed++;
          const env = Common.safeExtend({}, l.omnitron_env);
          Object.keys(env).forEach((key) => {
            console.log(`${key}: ${chalk.green(env[key])}`);
          });
        }
      });

      if (printed == 0) {
        Common.err(`Modules with id ${app_id} not found`);
        return cb ? cb.apply(null, [err, list]) : this.exitCli(cst.ERROR_EXIT);
      }
      return cb ? cb.apply(null, [err, list]) : this.exitCli(cst.SUCCESS_EXIT);
    });
  }

  /**
   * Get version of the daemonized OMNITRON
   * @method getVersion
   * @callback cb
   */
  report() {
    const that = this;

    this.executeRemote('getReport', {}, (err, report) => {
      console.log();
      console.log();
      console.log();
      console.log('```');
      fmt.title('OMNITRON report');
      fmt.field('Date', new Date());
      fmt.sep();

      if (report && !err) {
        fmt.title(chalk.bold.blue('Daemon'));
        fmt.field('omnitrond version', report.omnitron_version);
        fmt.field('node version', report.node_version);
        fmt.field('node path', report.node_path);
        fmt.field('argv', report.argv);
        fmt.field('argv0', report.argv0);
        fmt.field('user', report.user);
        fmt.field('uid', report.uid);
        fmt.field('gid', report.gid);
        fmt.field('uptime', dayjs(new Date()).diff(report.started_at, 'minute') + 'min');
      }

      fmt.sep();
      fmt.title(chalk.bold.blue('CLI'));
      fmt.field('local omnitron', pkg.version);
      fmt.field('node version', process.versions.node);
      fmt.field('node path', process.env['_'] || 'not found');
      fmt.field('argv', process.argv);
      fmt.field('argv0', process.argv0);
      fmt.field('user', process.env.USER || process.env.LNAME || process.env.USERNAME);
      if (cst.IS_WINDOWS === false && process.geteuid) fmt.field('uid', process.geteuid());
      if (cst.IS_WINDOWS === false && process.getegid) fmt.field('gid', process.getegid());

      fmt.sep();
      fmt.title(chalk.bold.blue('System info'));
      fmt.field('arch', os.arch());
      fmt.field('platform', os.platform());
      fmt.field('type', os.type());
      fmt.field('cpus', os.cpus()[0].model);
      fmt.field('cpus nb', Object.keys(os.cpus()).length);
      fmt.field('freemem', os.freemem());
      fmt.field('totalmem', os.totalmem());
      fmt.field('home', os.homedir());

      that.executeRemote('getMonitorData', {}, (err, list) => {
        fmt.sep();
        fmt.title(chalk.bold.blue('OMNITRON list'));
        UX.list(list, that.gl_interact_infos);

        fmt.sep();
        fmt.title(chalk.bold.blue('Daemon logs'));
        Log.tail(
          [
            {
              path: cst.OMNITRON_LOG_FILE_PATH,
              app_name: 'OMNITRON',
              type: 'OMNITRON',
            },
          ],
          20,
          false,
          () => {
            console.log('```');
            console.log();
            console.log();

            console.log(
              chalk.bold.green(
                'Please copy/paste the above report in your issue on https://github.com/Unitech/omnitron/issues'
              )
            );

            console.log();
            console.log();
            that.exitCli(cst.SUCCESS_EXIT);
          }
        );
      });
    });
  }

  getPID(app_name: string | null, cb?: (err: any, pids?: number[]) => void) {
    if (typeof app_name === 'function') {
      cb = app_name;
      app_name = null;
    }

    this.executeRemote('getMonitorData', {}, (err, list) => {
      if (err) {
        Common.printError(cst.PREFIX_MSG_ERR + err);
        return cb ? cb(Common.retErr(err)) : this.exitCli(cst.ERROR_EXIT);
      }

      const pids: number[] = [];

      list.forEach((app) => {
        if (!app_name || app_name == app.name) pids.push(app.pid);
      });

      if (!cb) {
        Common.printOut(pids.join('\n'));
        return this.exitCli(cst.SUCCESS_EXIT);
      }
      return cb(null, pids);
    });
  }

  /**
   * Create OMNITRON memory snapshot
   * @method getVersion
   * @callback cb
   */
  profile(type: string, time: number, cb?: (err: Error, data?: any) => void) {
    let cmd;

    if (type == 'cpu') {
      cmd = {
        ext: '.cpuprofile',
        action: 'profileCPU',
      };
    }
    if (type == 'mem') {
      cmd = {
        ext: '.heapprofile',
        action: 'profileMEM',
      };
    }

    const file = path.join(process.cwd(), dayjs().format('dd-HH:mm:ss') + cmd.ext);
    time = time || 10000;

    console.log(`Starting ${cmd.action} profiling for ${time}ms...`);
    this.executeRemote(
      cmd.action,
      {
        pwd: file,
        timeout: time,
      },
      (err, ...args) => {
        if (err) {
          console.error(err);
          return this.exitCli(1);
        }
        console.log(`Profile done in ${file}`);
        return cb ? cb.apply(null, [err, ...args]) : this.exitCli(cst.SUCCESS_EXIT);
      }
    );
  }

  /**
   * omnitron create command
   * create boilerplate of application for fast try
   * @method boilerplate
   */
  boilerplate(cb?: (err: Error, data?: any) => void) {
    const i = 0;
    const projects = [];
    const enquirer = require('enquirer');

    fs.readdir(path.join(__dirname, '../templates/sample-apps'), (err, items) => {
      forEach(
        items,
        (app, next) => {
          const fp = path.join(__dirname, '../templates/sample-apps', app);
          fs.readFile(path.join(fp, 'package.json'), (err, dt) => {
            const meta = JSON.parse(dt);
            meta.fullpath = fp;
            meta.folder_name = app;
            projects.push(meta);
            next();
          });
        },
        () => {
          const prompt = new enquirer.Select({
            name: 'boilerplate',
            message: 'Select a boilerplate',
            choices: projects.map((p, i) => ({
              message: `${chalk.bold.blue(p.name)} ${p.description}`,
              value: `${i}`,
            })),
          });

          prompt
            .run()
            .then((answer) => {
              const p = projects[parseInt(answer)];
              basicMDHighlight(fs.readFileSync(path.join(p.fullpath, 'README.md')).toString());
              console.log(chalk.bold(`>> Project copied inside folder ./${p.folder_name}/\n`));
              copyDirSync(p.fullpath, path.join(process.cwd(), p.folder_name));
              this.start(
                path.join(p.fullpath, 'ecosystem.config.js'),
                {
                  cwd: p.fullpath,
                },
                (...args) => (cb ? cb.apply(null, args) : this.speedList(cst.SUCCESS_EXIT))
              );
            })
            .catch((e) => (cb ? cb.apply(null, [e]) : this.speedList(cst.SUCCESS_EXIT)));
        }
      );
    });
  }

  /**
   * Description
   * @method sendLineToStdin
   */
  sendLineToStdin(pm_id: string, line: string, separator?: any, cb?: (err: any, data?: any) => void) {
    if (!cb && typeof separator == 'function') {
      cb = separator;
      separator = null;
    }

    const packet = {
      pm_id,
      line: line + (separator || '\n'),
    };

    this.executeRemote('sendLineToStdin', packet, (err, res) => {
      if (err) {
        Common.printError(cst.PREFIX_MSG_ERR + err);
        return cb ? cb(Common.retErr(err)) : this.exitCli(cst.ERROR_EXIT);
      }
      return cb ? cb(null, res) : this.speedList();
    });
  }

  /**
   * Description
   * @method attachToProcess
   */
  attach(pm_id: string, separator?: any, cb?: (err: any, data?: any) => void) {
    const readline = require('readline');

    if (isNaN(pm_id)) {
      Common.printError('pm_id must be a process number (not a process name)');
      return cb ? cb(Common.retErr('pm_id must be number')) : this.exitCli(cst.ERROR_EXIT);
    }

    if (typeof separator == 'function') {
      cb = separator;
      separator = null;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.on('close', () => (cb ? cb() : this.exitCli(cst.SUCCESS_EXIT)));

    this.launchBus((err, bus, socket) => {
      if (err) {
        Common.printError(err);
        return cb ? cb(Common.retErr(err)) : this.exitCli(cst.ERROR_EXIT);
      }

      bus.on('log:*', (type, packet) => {
        if (packet.process.pm_id !== parseInt(pm_id)) return;
        process.stdout.write(packet.data);
      });
    });

    rl.on('line', (line) => this.sendLineToStdin(pm_id, line, separator, () => { }));
  }

  /**
   * Description
   * @method sendDataToProcessId
   */
  sendDataToProcessId(proc_id, packet, cb) {
    if (typeof proc_id === 'object' && typeof packet === 'function') {
      // the proc_id is packet.
      cb = packet;
      packet = proc_id;
    } else {
      packet.id = proc_id;
    }

    this.executeRemote('sendDataToProcessId', packet, (err, res) => {
      if (err) {
        Common.printError(err);
        return cb ? cb(Common.retErr(err)) : this.exitCli(cst.ERROR_EXIT);
      }
      Common.printOut('successfully sent data to process');
      return cb ? cb(null, res) : this.speedList();
    });
  }

  /**
   * Used for custom actions, allows to trigger function inside an app
   * To expose a function you need to use keymetrics/pmx
   *
   * @method msgProcess
   * @param {Object} opts
   * @param {String} id           process id
   * @param {String} action_name  function name to trigger
   * @param {Object} [opts.opts]  object passed as first arg of the function
   * @param {String} [uuid]       optional unique identifier when logs are emitted
   *
   */
  msgProcess(opts, cb) {
    this.executeRemote('msgProcess', opts, cb);
  }

  /**
   * Trigger a PMX custom action in target application
   * Custom actions allows to interact with an application
   *
   * @method trigger
   * @param  {String|Number} pm_id       process id or application name
   * @param  {String}        action_name name of the custom action to trigger
   * @param  {Mixed}         params      parameter to pass to target action
   * @param  {Function}      cb          callback
   */
  trigger(pm_id: string | number, action_name: string, params: any, cb?: (err: Error, data?: any) => void) {
    if (typeof params === 'function') {
      cb = params;
      params = null;
    }
    const cmd = {
      msg: action_name,
    };
    let counter = 0;
    let process_wait_count = 0;
    const results = [];

    if (params) cmd.opts = params;
    if (isNaN(pm_id)) cmd.name = pm_id;
    else cmd.id = pm_id;

    this.launchBus((err, bus) => {
      bus.on('axm:reply', (ret) => {
        if (
          ret.process.name == pm_id ||
          ret.process.pm_id == pm_id ||
          ret.process.namespace == pm_id ||
          pm_id == 'all'
        ) {
          results.push(ret);
          Common.printOut('[%s:%s:%s]=%j', ret.process.name, ret.process.pm_id, ret.process.namespace, ret.data.return);
          if (++counter == process_wait_count) return cb ? cb(null, results) : this.exitCli(cst.SUCCESS_EXIT);
        }
      });

      this.msgProcess(cmd, (err, data) => {
        if (err) {
          Common.printError(err);
          return cb ? cb(Common.retErr(err)) : this.exitCli(cst.ERROR_EXIT);
        }

        if (data.process_count == 0) {
          Common.printError('Not any process has received a command (offline or unexistent)');
          return cb ? cb(Common.retErr('Unknown process')) : this.exitCli(cst.ERROR_EXIT);
        }

        process_wait_count = data.process_count;
        Common.printOut(chalk.bold('%s processes have received command %s'), data.process_count, action_name);
      });
    });
  }

  /**
   * Description
   * @method sendSignalToProcessName
   * @param {} signal
   * @param {} process_name
   * @return
   */
  sendSignalToProcessName(signal: string, process_name: string, cb?: (err: Error, list?: any) => void) {
    this.executeRemote(
      'sendSignalToProcessName',
      {
        signal,
        process_name,
      },
      (err, list) => {
        if (err) {
          Common.printError(err);
          return cb ? cb(Common.retErr(err)) : this.exitCli(cst.ERROR_EXIT);
        }
        Common.printOut('successfully sent signal %s to process name %s', signal, process_name);
        return cb ? cb(null, list) : this.speedList();
      }
    );
  }

  /**
   * Description
   * @method sendSignalToProcessId
   * @param {} signal
   * @param {} process_id
   * @return
   */
  sendSignalToProcessId(signal: string, process_id: string, cb?: (err: Error, list?: any) => void) {
    const that = this;

    that.executeRemote(
      'sendSignalToProcessId',
      {
        signal,
        process_id,
      },
      function (err, list) {
        if (err) {
          Common.printError(err);
          return cb ? cb(Common.retErr(err)) : that.exitCli(cst.ERROR_EXIT);
        }
        Common.printOut('successfully sent signal %s to process id %s', signal, process_id);
        return cb ? cb(null, list) : that.speedList();
      }
    );
  }

  /**
   * API method to launch a process that will serve directory over http
   */
  autoinstall(cb?: (err: any, data?: any) => void) {
    const filepath = path.resolve(path.dirname(module.filename), '../Sysinfo/ServiceDetection/ServiceDetection.js');

    this.start(filepath, (err, res) => {
      if (err) {
        Common.printError(cst.PREFIX_MSG_ERR + 'Error while trying to serve : ' + err.message || err);
        return cb ? cb(err) : this.speedList(cst.ERROR_EXIT);
      }
      return cb ? cb(null) : this.speedList();
    });
  }

  /**
   * API method to launch a process that will serve directory over http
   *
   * @param {Object} opts options
   * @param {String} opts.path path to be served
   * @param {Number} opts.port port on which http will bind
   * @param {Boolean} opts.spa single page app served
   * @param {String} opts.basicAuthUsername basic auth username
   * @param {String} opts.basicAuthPassword basic auth password
   * @param {Object} cmndr commander object
   * @param {Function} cb optional callback
   */
  serve(target_path: string, port: number, opts: any, cmndr: any, cb?: (err: any, data?: any) => void) {
    const servePort = process.env.OMNITRON_SERVE_PORT || port || 8080;
    const servePath = path.resolve(process.env.OMNITRON_SERVE_PATH || target_path || '.');

    const filepath = path.resolve(path.dirname(module.filename), './serve.js');

    if (typeof cmndr.name === 'string') opts.name = cmndr.name;
    else opts.name = 'static-page-server-' + servePort;
    if (!opts.env) opts.env = {};
    opts.env.OMNITRON_SERVE_PORT = servePort;
    opts.env.OMNITRON_SERVE_PATH = servePath;
    opts.env.OMNITRON_SERVE_SPA = opts.spa;
    if (opts.basicAuthUsername && opts.basicAuthPassword) {
      opts.env.OMNITRON_SERVE_BASIC_AUTH = 'true';
      opts.env.OMNITRON_SERVE_BASIC_AUTH_USERNAME = opts.basicAuthUsername;
      opts.env.OMNITRON_SERVE_BASIC_AUTH_PASSWORD = opts.basicAuthPassword;
    }
    if (opts.monitor) {
      opts.env.OMNITRON_SERVE_MONITOR = opts.monitor;
    }
    opts.cwd = servePath;

    this.start(filepath, opts, (err, res) => {
      if (err) {
        Common.printError(cst.PREFIX_MSG_ERR + 'Error while trying to serve : ' + err.message || err);
        return cb ? cb(err) : this.speedList(cst.ERROR_EXIT);
      }
      Common.printOut(cst.PREFIX_MSG + 'Serving ' + servePath + ' on port ' + servePort);
      return cb ? cb(null, res) : this.speedList();
    });
  }

  /**
   * Ping daemon - if OMNITRON daemon not launched, it will launch it
   * @method ping
   */
  ping(cb?: (err: Error, res?: any) => void) {
    this.executeRemote('ping', {}, (err, res) => {
      if (err) {
        Common.printError(err);
        return cb ? cb(new Error(err)) : this.exitCli(cst.ERROR_EXIT);
      }
      Common.printOut(res);
      return cb ? cb(null, res) : this.exitCli(cst.SUCCESS_EXIT);
    });
  }

  /**
   * Execute remote command
   */
  remote(command, opts, cb) {
    this[command](opts.name, (err_cmd, ret) => {
      if (err_cmd) console.error(err_cmd);
      console.log('Command %s finished', command);
      return cb(err_cmd, ret);
    });
  }

  /**
   * This remote method allows to pass multiple arguments
   * to OMNITRON
   * It is used for the new scoped OMNITRON action system
   */
  remoteV2(command, opts, cb) {
    if (this[command].length == 1) return this[command](cb);

    opts.args.push(cb);
    return this[command].apply(this, opts.args);
  }

  generateSample(mode) {
    let templatePath;

    if (mode == 'simple') templatePath = path.join(cst.TEMPLATE_FOLDER, cst.APP_CONF_TPL_SIMPLE);
    else templatePath = path.join(cst.TEMPLATE_FOLDER, cst.APP_CONF_TPL);

    const sample = fs.readFileSync(templatePath);
    const dt = sample.toString();
    const f_name = 'ecosystem.config.js';
    const pwd = process.env.PWD || process.cwd();

    try {
      fs.writeFileSync(path.join(pwd, f_name), dt);
    } catch (e) {
      console.error(e.stack || e);
      return this.exitCli(cst.ERROR_EXIT);
    }
    Common.printOut('File %s generated', path.join(pwd, f_name));
    this.exitCli(cst.SUCCESS_EXIT);
  }

  /**
   * Description
   * @method dashboard
   * @return
   */
  dashboard(cb?: (err: any, data?: any) => void) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Dashboard = require('./api/dashboard');

    if (cb) return cb(new Error('Dashboard cant be called programmatically'));

    Dashboard.init();

    this.launchBus((err, bus) => {
      if (err) {
        console.error('Error launchBus: ' + err);
        this.exitCli(cst.ERROR_EXIT);
      }
      bus.on('log:*', (type: any, data: any) => {
        Dashboard.log(type, data);
      });
    });

    process.on('SIGINT', () => {
      this.disconnectBus(() => {
        process.exit(cst.SUCCESS_EXIT);
      });
    });

    const refreshDashboard = () => {
      this.executeRemote('getMonitorData', {}, (err, list) => {
        if (err) {
          console.error('Error retrieving process list: ' + err);
          this.exitCli(cst.ERROR_EXIT);
        }

        Dashboard.refresh(list);

        setTimeout(() => {
          refreshDashboard();
        }, 800);
      });
    };

    refreshDashboard();
  }

  monit(cb?: (err: any, data?: any) => void) {
    const Monit = require('./monit').default;

    if (cb) {
      cb(new Error('Monit cant be called programmatically'));
      return;
    }

    Monit.init();

    const launchMonitor = () => {
      this.executeRemote('getMonitorData', {}, (err, list) => {
        if (err) {
          console.error('Error retrieving process list: ' + err);
          this.exitCli(conf.ERROR_EXIT);
        }

        Monit.refresh(list);

        setTimeout(() => {
          launchMonitor();
        }, 400);
      });
    };

    launchMonitor();
  }

  inspect(app_name, cb) {
    this.trigger(app_name, 'internal:inspect', (err, res) => {
      if (res && res[0]) {
        if (res[0].data.return === '') {
          Common.printOut(`Inspect disabled on ${app_name}`);
        } else {
          Common.printOut(`Inspect enabled on ${app_name} => go to chrome : chrome://inspect !!!`);
        }
      } else {
        Common.printOut(`Unable to activate inspect mode on ${app_name} !!!`);
      }

      this.exitCli(cst.SUCCESS_EXIT);
    });
  }

  // deploy
  deploy(file: string, commands: any, cb?: (err?: any, data?: any) => void) {
    if (file == 'help') {
      deployHelper();
      if (cb) {
        cb();
        return;
      }
      this.exitCli(cst.SUCCESS_EXIT);
      return;
    }

    const args = commands.rawArgs;
    let env;

    args.splice(0, args.indexOf('deploy') + 1);

    // Find ecosystem file by default
    if (!Common.isConfigFile(file)) {
      env = args[0];
      const defaultConfigNames = [...Common.getConfigFileCandidates('ecosystem'), 'ecosystem.json5', 'package.json'];

      file = Utility.whichFileExists(defaultConfigNames);

      if (!file) {
        Common.printError(
          'Not any default deployment file exists.' +
          ' Allowed default config file names are: ' +
          defaultConfigNames.join(', ')
        );
        if (cb) {
          cb('Not any default ecosystem file present');
          return;
        }
        this.exitCli(cst.ERROR_EXIT);
        return;
      }
    } else {
      env = args[1];
    }

    let json_conf: any = null;

    try {
      json_conf = Common.parseConfig(fs.readFileSync(file), file);
    } catch (e) {
      Common.printError(e);
      if (cb) {
        cb(e);
        return;
      }
      this.exitCli(cst.ERROR_EXIT);
      return;
    }

    if (!env) {
      deployHelper();
      if (cb) {
        cb();
        return;
      }
      this.exitCli(cst.SUCCESS_EXIT);
      return;
    }

    if (!json_conf.deploy || !json_conf.deploy[env]) {
      Common.printError('%s environment is not defined in %s file', env, file);
      if (cb) {
        cb('%s environment is not defined in %s file');
        return;
      }
      this.exitCli(cst.ERROR_EXIT);
      return;
    }

    if (!json_conf.deploy[env]['post-deploy']) {
      json_conf.deploy[env]['post-deploy'] = 'omnitron startOrRestart ' + file + ' --env ' + env;
    }

    require('pm2-deploy').deployForEnv(json_conf.deploy, env, args, (err, data) => {
      if (err) {
        Common.printError('Deploy failed');
        Common.printError(err.message || err);
        if (cb) {
          cb(err);
          return;
        }
        this.exitCli(cst.ERROR_EXIT);
        return;
      }
      Common.printOut('--> Success');
      if (cb) {
        cb(null, data);
        return;
      }
      this.exitCli(cst.SUCCESS_EXIT);
    });
  }

  // modules
  /**
   * Install / Update a module
   */
  install(module_name: string, opts: any, cb?: any) {
    if (typeof opts == 'function') {
      cb = opts;
      opts = {};
    }

    Modularizer.install(this, module_name, opts, (err: any, data: any) => {
      if (err) {
        Common.printError(cst.PREFIX_MSG_ERR + (err.message || err));
        return cb ? cb(Common.retErr(err)) : this.speedList(cst.ERROR_EXIT);
      }
      return cb ? cb(null, data) : this.speedList(cst.SUCCESS_EXIT);
    });
  }

  /**
   * Uninstall a module
   */
  uninstall(module_name: string, cb?: any) {
    Modularizer.uninstall(this, module_name, (err: any, data: any) => {
      if (err) return cb ? cb(Common.retErr(err)) : this.speedList(cst.ERROR_EXIT);
      return cb ? cb(null, data) : this.speedList(cst.SUCCESS_EXIT);
    });
  }

  launchAll(cb?: (err: Error, data?: any) => void) {
    Modularizer.launchModules(this, cb);
  }

  package(module_path: string, cb?: (err: Error, res?: any) => void) {
    Modularizer.package(this, module_path, (err, res) => {
      if (err) {
        Common.errMod(err);
        return cb ? cb(err) : this.exitCli(1);
      }
      Common.logMod(`Module packaged in ${res.path}`);
      return cb ? cb(err) : this.exitCli(0);
    });
  }

  /**
   * Publish module on NPM + Git push
   */
  publish(folder: string, opts: any, cb?: (err: any, data?: any) => void) {
    Modularizer.publish(this, folder, opts, (err, data) => {
      if (err) return cb ? cb(Common.retErr(err)) : this.speedList(cst.ERROR_EXIT);
      return cb ? cb(null, data) : this.speedList(cst.SUCCESS_EXIT);
    });
  }

  /**
   * Publish module on NPM + Git push
   */
  generateModuleSample(app_name: string, cb?: (err: any, data?: any) => void) {
    Modularizer.generateSample(app_name, (err, data) => {
      if (err) return cb ? cb(Common.retErr(err)) : this.exitCli(cst.ERROR_EXIT);
      return cb ? cb(null, data) : this.exitCli(cst.SUCCESS_EXIT);
    });
  }

  /**
   * Special delete method
   */
  deleteModule(module_name, cb) {
    const found_proc = [];

    this.getAllProcess((err, procs) => {
      if (err) {
        Common.printError('Error retrieving process list: ' + err);
        return cb(Common.retErr(err));
      }

      procs.forEach((proc) => {
        if (proc.omnitron_env.name == module_name && proc.omnitron_env.pmx_module) {
          found_proc.push(proc.pm_id);
        }
      });

      if (found_proc.length == 0) return cb();

      this._operate('deleteProcessId', found_proc[0], (err_: any) => {
        if (err_) return cb(Common.retErr(err_));
        Common.printOut('In memory process deleted');
        return cb();
      });
    });
  }

  // pm2-plus
  linkManagement(cmd: string, public_key: string, machine: string, opts: any, cb?: (err: any, data?: any) => void) {
    // omnitron link stop || kill
    if (cmd == 'stop' || cmd == 'kill') {
      this.gl_is_km_linked = false;
      console.log(cst.OMNITRON_IO_MSG + ' Stopping agent...');

      this.killAgent((err) => {
        if (err) {
          Common.printError(err);
          process.exit(cst.ERROR_EXIT);
        }
        console.log(cst.OMNITRON_IO_MSG + ' Stopped');

        this.reload('all', () => process.exit(cst.SUCCESS_EXIT));
      });
      return;
    }

    // omnitron link info
    if (cmd == 'info') {
      console.log(cst.OMNITRON_IO_MSG + ' Getting agent information...');
      this.agentInfos((err, infos) => {
        if (err) {
          console.error(cst.OMNITRON_IO_MSG_ERR + ' ' + err.message);
          this.exitCli(cst.ERROR_EXIT);
          return;
        }
        console.log(infos);
        this.exitCli(cst.SUCCESS_EXIT);
      });
      return;
    }

    // omnitron link delete
    if (cmd == 'delete') {
      this.gl_is_km_linked = false;
      console.log(cst.OMNITRON_IO_MSG + ' Permanently disable agent...');
      this.killAgent((err) => {
        try {
          fs.unlinkSync(cst.INTERACTION_CONF);
        } catch (e) {
          console.log(cst.OMNITRON_IO_MSG + ' No interaction config file found');
          process.exit(cst.SUCCESS_EXIT);
        }
        console.log(cst.OMNITRON_IO_MSG + ' Agent interaction ended');
        if (!cb) process.exit(cst.SUCCESS_EXIT);
        cb();
      });
      return;
    }

    if (cmd && !public_key) {
      console.error(cst.OMNITRON_IO_MSG + ' Command [%s] unknown or missing public key', cmd);
      process.exit(cst.ERROR_EXIT);
    }

    // omnitron link xxx yyy
    let infos;

    if (!cmd) {
      infos = null;
    } else
      infos = {
        public_key,
        secret_key: cmd,
        machine_name: machine,
        info_node: opts.infoNode || null,
        omnitron_version: pkg.version,
      };

    this.link(infos, cb);
  }

  link(infos: any, cb: any) {
    process.env.WS_JSON_PATCH = true;

    KMDaemon.launchAndInteract(cst, infos, (err: any, dt: any) => {
      if (err) {
        Common.printError(cst.OMNITRON_IO_MSG + ' Run `$ omnitron plus` to connect');
        this.exitCli(cst.ERROR_EXIT);
        return;
      }
      console.log(chalk.bold.green('[+] OMNITRON+ activated!'));
      if (!cb) {
        this.exitCli(cst.SUCCESS_EXIT);
        return;
      }
      cb(null, dt);
    });
  }

  agentInfos(cb: any) {
    KMDaemon.getInteractInfo(this._conf, (err: any, data: any) => {
      if (err) return cb(Common.retErr(err));
      return cb(null, data);
    });
  }

  killAgent(cb: any) {
    KMDaemon.killInteractorDaemon(this._conf, (err: any) => {
      if (err) return cb ? cb(Common.retErr(err)) : this.exitCli(cst.SUCCESS_EXIT);
      return cb ? cb(null) : this.exitCli(cst.SUCCESS_EXIT);
    });
  }

  unlink(cb?: (err: any, data?: any) => void) {
    this.linkManagement('delete', cb);
  }

  /**
   * Monitor Selectively Processes (auto filter in interaction)
   * @param String state 'monitor' or 'unmonitor'
   * @param String target <pm_id|name|all>
   * @param Function cb callback
   */
  monitorState(state: string, target: string, cb?: (err: any, data?: any) => void) {
    const that = this;

    if (!target) {
      Common.printError(cst.PREFIX_MSG_ERR + 'Please specify an <app_name|pm_id>');
      return cb ? cb(new Error('argument missing')) : that.exitCli(cst.ERROR_EXIT);
    }

    function monitor(pm_id, cb) {
      // State can be monitor or unmonitor
      that.executeRemote(state, pm_id, cb);
    }
    if (target === 'all') {
      that.getAllProcessId(function (err, procs) {
        if (err) {
          Common.printError(err);
          return cb ? cb(Common.retErr(err)) : that.exitCli(cst.ERROR_EXIT);
        }
        forEachLimit(procs, 1, monitor, function (err, res) {
          return typeof cb === 'function' ? cb(err, res) : that.speedList();
        });
      });
    } else if (!Number.isInteger(parseInt(target))) {
      this.getProcessIdByNameClient(target, true, function (err, procs) {
        if (err) {
          Common.printError(err);
          return cb ? cb(Common.retErr(err)) : that.exitCli(cst.ERROR_EXIT);
        }
        forEachLimit(procs, 1, monitor, (err: any, res: any) =>
          typeof cb === 'function' ? cb(err, res) : that.speedList()
        );
      });
    } else {
      monitor(parseInt(target), (err, res) => (typeof cb === 'function' ? cb(err, res) : that.speedList()));
    }
  }

  openDashboard() {
    if (!this.gl_interact_infos) {
      Common.printError(chalk.bold.white('Agent if offline, type `$ omnitron plus` to log in'));
      this.exitCli(cst.ERROR_EXIT);
    } else {
      const uri = `https://app.omnitron.io/#/r/${this.gl_interact_infos.public_key}`;
      console.log(cst.OMNITRON_IO_MSG + ` Opening ${uri}`);
      open(uri);
      setTimeout((_) => {
        this.exitCli();
      }, 200);
    }
  }

  clearSetup(opts, cb) {
    const modules = ['event-loop-inspector'];
    this.gl_is_km_linked = false;

    forEach(
      modules,
      (_module, next) => {
        this.uninstall(_module, () => {
          next();
        });
      },
      (err: any) => {
        this.reload('all', () => cb());
      }
    );
  }

  /**
   * Install required package and enable flags for current running processes
   */
  minimumSetup(opts: any, cb: any) {
    this.gl_is_km_linked = true;

    const install = (cb_: any) => {
      let modules = [];

      if (opts.type === 'enterprise' || opts.type === 'plus') {
        modules = ['omnitron-logrotate', 'pm2-server-monit'];
        if (opts.type === 'enterprise') {
          modules.push('deep-metrics');
        }
      }

      forEach(
        modules,
        (_module, next) => {
          this.install(_module, {}, () => {
            next();
          });
        },
        (err: any) => {
          this.reload('all', () => cb_());
        }
      );
    };

    this.processesAreAlreadyMonitored((already_monitored: any) => {
      if (already_monitored) {
        console.log(cst.OMNITRON_IO_MSG + ` OMNITRON ${opts.type || ''} bundle already installed`);
        return cb();
      }

      if (opts.installAll) return install(cb);

      // promptly.confirm(chalk.bold('Install all omnitron plus dependencies ? (y/n)'), (err, answer) => {
      //   if (!err && answer === true)
      return install(cb);
      // self.reload('all', () => {
      //     return cb()
      //   })
      // });
    });
  }

  // configuration
  get(key?: string, cb?: (err: any, data?: any) => void) {
    const that = this;

    if (!key || key == 'all') {
      displayConf((err: any, data: any) => {
        if (err) return cb ? cb(Common.retErr(err)) : that.exitCli(cst.ERROR_EXIT);
        return cb ? cb(null, { success: true }) : that.exitCli(cst.SUCCESS_EXIT);
      });
      return false;
    }
    Configuration.get(key, (err: any, data: any) => {
      if (err) {
        return cb ? cb(Common.retErr(err)) : that.exitCli(cst.ERROR_EXIT);
      }
      // omnitron conf module-name
      if (key.indexOf(':') === -1 && key.indexOf('.') === -1) {
        displayConf(key, () => {
          console.log('Modules configuration. Copy/Paste line to edit values.');
          return cb ? cb(null, { success: true }) : that.exitCli(cst.SUCCESS_EXIT);
        });
        return false;
      }
      // omnitron conf module-name:key
      let module_name, key_name;

      if (key.indexOf(':') > -1) {
        module_name = key.split(':')[0];
        key_name = key.split(':')[1];
      } else if (key.indexOf('.') > -1) {
        module_name = key.split('.')[0];
        key_name = key.split('.')[1];
      }

      Common.printOut(
        'Value for module ' + chalk.blue(module_name),
        'key ' + chalk.blue(key_name) + ': ' + chalk.bold.green(data)
      );

      return cb ? cb(null, { success: true }) : that.exitCli(cst.SUCCESS_EXIT);
    });
  }

  set(key: string, value: any, cb?: (err: any, data?: any) => void) {
    const that = this;

    if (!key) {
      interactiveConfigEdit(function (err) {
        if (err) return cb ? cb(Common.retErr(err)) : that.exitCli(cst.ERROR_EXIT);
        return cb ? cb(null, { success: true }) : that.exitCli(cst.SUCCESS_EXIT);
      });
      return false;
    }

    /**
     * Set value
     */
    Configuration.set(key, value, function (err) {
      if (err) return cb ? cb(Common.retErr(err)) : that.exitCli(cst.ERROR_EXIT);

      let values = [];

      if (key.indexOf('.') > -1) values = key.split('.');

      if (key.indexOf(':') > -1) values = key.split(':');

      if (values && values.length > 1) {
        // The first element is the app name (module_conf.json)
        const app_name = values[0];

        process.env.OMNITRON_PROGRAMMATIC = 'true';
        that.restart(
          app_name,
          {
            updateEnv: true,
          },
          function (err, data) {
            process.env.OMNITRON_PROGRAMMATIC = 'false';
            if (!err) Common.printOut(cst.PREFIX_MSG + 'Module %s restarted', app_name);
            Common.log('Setting changed');
            displayConf(app_name, function () {
              return cb ? cb(null, { success: true }) : that.exitCli(cst.SUCCESS_EXIT);
            });
          }
        );
        return false;
      }
      displayConf(null, function () {
        return cb ? cb(null, { success: true }) : that.exitCli(cst.SUCCESS_EXIT);
      });
    });
  }

  multiset(serial: string, cb?: (err: any, data?: any) => void) {
    const that = this;

    Configuration.multiset(serial, function (err, data) {
      if (err) return cb ? cb({ success: false, err }) : that.exitCli(cst.ERROR_EXIT);

      let values = [];
      const key = serial.match(/(?:[^ "]+|"[^"]*")+/g)[0];

      if (key.indexOf('.') > -1) values = key.split('.');

      if (key.indexOf(':') > -1) values = key.split(':');

      if (values && values.length > 1) {
        // The first element is the app name (module_conf.json)
        var app_name = values[0];

        process.env.OMNITRON_PROGRAMMATIC = 'true';
        that.restart(
          app_name,
          {
            updateEnv: true,
          },
          function (err, data) {
            process.env.OMNITRON_PROGRAMMATIC = 'false';
            if (!err) Common.printOut(cst.PREFIX_MSG + 'Module %s restarted', app_name);
            displayConf(app_name, function () {
              return cb ? cb(null, { success: true }) : that.exitCli(cst.SUCCESS_EXIT);
            });
          }
        );
        return false;
      }
      displayConf(app_name, function () {
        return cb ? cb(null, { success: true }) : that.exitCli(cst.SUCCESS_EXIT);
      });
    });
  }

  unset(key: string, cb?: (err: any, data?: any) => void) {
    const that = this;

    Configuration.unset(key, function (err) {
      if (err) {
        return cb ? cb(Common.retErr(err)) : that.exitCli(cst.ERROR_EXIT);
      }

      displayConf(function () {
        cb ? cb(null, { success: true }) : that.exitCli(cst.SUCCESS_EXIT);
      });
    });
  }

  conf(key: string, value: any, cb?: (err: any, data?: any) => void) {
    const that = this;

    if (typeof value === 'function') {
      cb = value;
      value = null;
    }

    // If key + value = set
    if (key && value) {
      that.set(key, value, function (err) {
        if (err) return cb ? cb(Common.retErr(err)) : that.exitCli(cst.ERROR_EXIT);
        return cb ? cb(null, { success: true }) : that.exitCli(cst.SUCCESS_EXIT);
      });
    }
    // If only key = get
    else if (key) {
      that.get(key, function (err, data) {
        if (err) return cb ? cb(Common.retErr(err)) : that.exitCli(cst.ERROR_EXIT);
        return cb ? cb(null, { success: true }) : that.exitCli(cst.SUCCESS_EXIT);
      });
    } else {
      interactiveConfigEdit(function (err) {
        if (err) return cb ? cb(Common.retErr(err)) : that.exitCli(cst.ERROR_EXIT);
        return cb ? cb(null, { success: true }) : that.exitCli(cst.SUCCESS_EXIT);
      });
    }
  }

  // version
  _pull(opts, cb) {
    const that = this;

    const process_name = opts.process_name;
    const reload_type = opts.action;

    printOut(cst.PREFIX_MSG + 'Updating repository for process name %s', process_name);

    that.getProcessByNameOrId(process_name, function (err, processes) {
      if (err || processes.length === 0) {
        printError('No processes with this name or id : %s', process_name);
        return cb ? cb({ msg: 'Process not found: ' + process_name }) : that.exitCli(cst.ERROR_EXIT);
      }

      const proc = processes[0];
      if (!proc.omnitron_env.versioning) {
        printOut(cst.PREFIX_MSG + 'No versioning system found for process %s', process_name);
        return cb
          ? cb({ success: false, msg: 'No versioning system found for process' })
          : that.exitCli(cst.SUCCESS_EXIT);
      }
      require('vizion').update(
        {
          folder: proc.omnitron_env.versioning.repo_path,
        },
        function (err, meta) {
          if (err !== null) {
            return cb ? cb({ msg: err }) : that.exitCli(cst.ERROR_EXIT);
          }

          if (meta.success === true) {
            getPostUpdateCmds(proc.omnitron_env.versioning.repo_path, process_name, function (command_list) {
              execCommands(proc.omnitron_env.versioning.repo_path, command_list, function (err, res) {
                if (err !== null) {
                  printError(err);
                  return cb ? cb({ msg: meta.output + err }) : that.exitCli(cst.ERROR_EXIT);
                } else {
                  printOut(cst.PREFIX_MSG + 'Process successfully updated %s', process_name);
                  printOut(cst.PREFIX_MSG + 'Current commit %s', meta.current_revision);
                  return that[reload_type](process_name, function (err, procs) {
                    if (err && cb) return cb(err);
                    if (err) console.error(err);
                    return cb ? cb(null, meta.output + res) : that.exitCli(cst.SUCCESS_EXIT);
                  });
                }
              });
            });
          } else {
            printOut(cst.PREFIX_MSG + 'Already up-to-date or an error occured for app: %s', process_name);
            return cb ? cb({ success: false, msg: 'Already up to date' }) : that.exitCli(cst.SUCCESS_EXIT);
          }
          return false;
        }
      );
      return false;
    });
  }

  /**
   * CLI method for updating a repository to a specific commit id
   * @method pullCommitId
   * @param {string} process_name
   * @param {string} commit_id
   * @return
   */
  pullCommitId(process_name, commit_id, cb) {
    const reload_type = 'reload';
    const that = this;

    printOut(cst.PREFIX_MSG + 'Updating repository for process name %s', process_name);

    that.getProcessByNameOrId(process_name, function (err, processes) {
      if (err || processes.length === 0) {
        printError('No processes with this name or id : %s', process_name);
        return cb ? cb({ msg: 'Process not found: ' + process_name }) : that.exitCli(cst.ERROR_EXIT);
      }

      const proc = processes[0];
      if (proc.omnitron_env.versioning) {
        require('vizion').isUpToDate({ folder: proc.omnitron_env.versioning.repo_path }, (err, meta) => {
          if (err !== null) return cb ? cb({ msg: err }) : that.exitCli(cst.ERROR_EXIT);
          require('vizion').revertTo(
            {
              revision: commit_id,
              folder: proc.omnitron_env.versioning.repo_path,
            },
            (err2, meta2) => {
              if (!err2 && meta2.success) {
                getPostUpdateCmds(proc.omnitron_env.versioning.repo_path, process_name, (command_list) => {
                  execCommands(proc.omnitron_env.versioning.repo_path, command_list, (err, res) => {
                    if (err !== null) {
                      printError(err);
                      return cb ? cb({ msg: err }) : that.exitCli(cst.ERROR_EXIT);
                    } else {
                      printOut(cst.PREFIX_MSG + 'Process successfully updated %s', process_name);
                      printOut(cst.PREFIX_MSG + 'Current commit %s', commit_id);
                      return that[reload_type](process_name, cb);
                    }
                  });
                });
              } else {
                printOut(cst.PREFIX_MSG + 'Already up-to-date or an error occured: %s', process_name);
                if (cb) cb(null, { success: meta.success });
                else that.exitCli(cst.SUCCESS_EXIT);
              }
            }
          );
        });
      } else {
        printOut(cst.PREFIX_MSG + 'No versioning system found for process %s', process_name);
        return cb ? cb(null, { success: false }) : that.exitCli(cst.SUCCESS_EXIT);
      }
    });
  }

  /**
   * CLI method for downgrading a repository to the previous commit (older)
   * @method backward
   * @param {string} process_name
   * @return
   */
  backward(process_name: string, cb?: (err: any, data?: any) => void) {
    const that = this;
    printOut(cst.PREFIX_MSG + 'Downgrading to previous commit repository for process name %s', process_name);

    this.getProcessByNameOrId(process_name, (err, processes) => {
      if (err || processes.length === 0) {
        printError('No processes with this name or id : %s', process_name);
        return cb ? cb({ msg: 'Process not found: ' + process_name }) : that.exitCli(cst.ERROR_EXIT);
      }

      const proc = processes[0];
      // in case user searched by id/pid
      process_name = proc.name;

      if (proc.omnitron_env.versioning === undefined || proc.omnitron_env.versioning === null)
        return cb({ msg: 'Versioning unknown' });

      require('vizion').prev(
        {
          folder: proc.omnitron_env.versioning.repo_path,
        },
        (err, meta) => {
          if (err) return cb ? cb({ msg: err, data: meta }) : that.exitCli(cst.ERROR_EXIT);

          if (meta.success !== true) {
            printOut(cst.PREFIX_MSG + 'No versioning system found for process %s', process_name);
            return cb ? cb({ msg: err, data: meta }) : that.exitCli(cst.ERROR_EXIT);
          }

          getPostUpdateCmds(proc.omnitron_env.versioning.repo_path, process_name, (command_list) => {
            execCommands(proc.omnitron_env.versioning.repo_path, command_list, (err, res) => {
              if (err !== null) {
                require('vizion').next({ folder: proc.omnitron_env.versioning.repo_path }, (err2, meta2) => {
                  printError(err);
                  return cb ? cb({ msg: meta.output + err }) : that.exitCli(cst.ERROR_EXIT);
                });
                return false;
              }

              printOut(cst.PREFIX_MSG + 'Process successfully updated %s', process_name);
              printOut(cst.PREFIX_MSG + 'Current commit %s', meta.current_revision);
              this.reload(process_name, (err, procs) => {
                if (err) return cb(err);
                if (cb) cb(null, meta.output + res);
                else that.exitCli(cst.SUCCESS_EXIT);
              });
            });
          });
        }
      );
    });
  }

  /**
   * CLI method for updating a repository to the next commit (more recent)
   * @method forward
   * @param {string} process_name
   * @return
   */
  forward(process_name: string, cb?: (err: any, data?: any) => void) {
    const that = this;
    printOut(cst.PREFIX_MSG + 'Updating to next commit repository for process name %s', process_name);

    this.getProcessByNameOrId(process_name, (err, processes) => {
      if (err || processes.length === 0) {
        printError('No processes with this name or id: %s', process_name);
        return cb ? cb({ msg: 'Process not found: ' + process_name }) : that.exitCli(cst.ERROR_EXIT);
      }

      const proc = processes[0];
      // in case user searched by id/pid
      process_name = proc.name;
      if (proc.omnitron_env.versioning) {
        require('vizion').next({ folder: proc.omnitron_env.versioning.repo_path }, (err, meta) => {
          if (err !== null) return cb ? cb({ msg: err }) : that.exitCli(cst.ERROR_EXIT);
          if (meta.success === true) {
            getPostUpdateCmds(proc.omnitron_env.versioning.repo_path, process_name, (command_list) => {
              execCommands(proc.omnitron_env.versioning.repo_path, command_list, (err, res) => {
                if (err !== null) {
                  require('vizion').prev({ folder: proc.omnitron_env.versioning.repo_path }, (err2, meta2) => {
                    printError(err);
                    return cb ? cb({ msg: meta.output + err }) : that.exitCli(cst.ERROR_EXIT);
                  });
                } else {
                  printOut(cst.PREFIX_MSG + 'Process successfully updated %s', process_name);
                  printOut(cst.PREFIX_MSG + 'Current commit %s', meta.current_revision);
                  this.reload(process_name, (err, procs) => {
                    if (err) return cb(err);
                    if (cb) cb(null, meta.output + res);
                    else that.exitCli(cst.SUCCESS_EXIT);
                  });
                }
              });
            });
          } else {
            printOut(cst.PREFIX_MSG + 'Already up-to-date or an error occured: %s', process_name);
            return cb ? cb(null, { success: meta.success }) : that.exitCli(cst.SUCCESS_EXIT);
          }
        });
      } else {
        printOut(cst.PREFIX_MSG + 'No versioning system found for process %s', process_name);
        return cb ? cb({ success: false, msg: 'No versioning system found' }) : that.exitCli(cst.SUCCESS_EXIT);
      }
    });
  }

  /**
   * CLI method for updating a repository
   * @method pullAndRestart
   * @param {string} process_name name of processes to pull
   * @return
   */
  pullAndRestart(process_name: string, cb?: (err: any, data?: any) => void) {
    this._pull({ process_name, action: 'reload' }, cb);
  }

  /**
   * CLI method for updating a repository
   * @method pullAndReload
   * @param {string} process_name name of processes to pull
   * @return
   */
  pullAndReload(process_name, cb) {
    this._pull({ process_name, action: 'reload' }, cb);
  }

  /**
   * CLI method for updating a repository to a specific commit id
   * @method pullCommitId
   * @param {object} opts
   * @return
   */
  _pullCommitId(opts: any, cb?: (err: any, data?: any) => void) {
    this.pullCommitId(opts.omnitron_name, opts.commit_id, cb);
  }

  // startup
  uninstallStartup(platform: string, opts: any, cb?: (err: any, data?: any) => void) {
    let commands;
    const that = this;
    const actual_platform = detectInitSystem();
    const user = opts.user || process.env.USER || process.env.LOGNAME; // Use LOGNAME on Solaris-like systems
    let service_name = opts.serviceName || 'omnitron-' + user;
    const openrc_service_name = 'omnitron';
    const launchd_service_name = opts.serviceName || 'omnitron.' + user;

    if (!platform) platform = actual_platform;
    else if (actual_platform && actual_platform !== platform) {
      Common.printOut('-----------------------------------------------------------');
      Common.printOut(' OMNITRON detected ' + actual_platform + ' but you precised ' + platform);
      Common.printOut(' Please verify that your choice is indeed your init system');
      Common.printOut(' If you arent sure, just run : omnitron startup');
      Common.printOut('-----------------------------------------------------------');
    }
    if (platform === null) throw new Error('Init system not found');

    if (!cb) {
      cb = function (err, data) {
        if (err) return that.exitCli(cst.ERROR_EXIT);
        return that.exitCli(cst.SUCCESS_EXIT);
      };
    }

    if (process.getuid() != 0) {
      return isNotRoot('unsetup', platform, opts, cb);
    }

    if (fs.existsSync('/etc/init.d/omnitron-init.sh')) {
      platform = 'oldsystem';
    }

    switch (platform) {
      case 'systemd':
        commands = [
          'systemctl stop ' + service_name,
          'systemctl disable ' + service_name,
          'rm /etc/systemd/system/' + service_name + '.service',
        ];
        break;
      case 'systemv':
        commands = ['chkconfig ' + service_name + ' off', 'rm /etc/init.d/' + service_name];
        break;
      case 'oldsystem':
        Common.printOut(cst.PREFIX_MSG + 'Disabling and deleting old startup system');
        commands = [
          'update-rc.d omnitron-init.sh disable',
          'update-rc.d -f omnitron-init.sh remove',
          'rm /etc/init.d/omnitron-init.sh',
        ];
        break;
      case 'openrc':
        service_name = openrc_service_name;
        commands = [
          '/etc/init.d/' + service_name + ' stop',
          'rc-update delete ' + service_name + ' default',
          'rm /etc/init.d/' + service_name,
        ];
        break;
      case 'upstart':
        commands = [
          'update-rc.d ' + service_name + ' disable',
          'update-rc.d -f ' + service_name + ' remove',
          'rm /etc/init.d/' + service_name,
        ];
        break;
      case 'launchd': {
        const destination = path.join(process.env.HOME, 'Library/LaunchAgents/' + launchd_service_name + '.plist');
        commands = ['launchctl remove ' + launchd_service_name + ' || true', 'rm ' + destination];
        break;
      }
      case 'rcd':
        service_name = opts.serviceName || 'omnitron_' + user;
        commands = [
          '/usr/local/etc/rc.d/' + service_name + ' stop',
          'sysrc -x ' + service_name + '_enable',
          'rm /usr/local/etc/rc.d/' + service_name,
        ];
        break;
      case 'rcd-openbsd': {
        service_name = opts.serviceName || 'omnitron_' + user;
        const destination = path.join('/etc/rc.d', service_name);
        commands = ['rcctl stop ' + service_name, 'rcctl disable ' + service_name, 'rm ' + destination];
        break;
      }
      case 'smf': {
        service_name = opts.serviceName || 'omnitron_' + user;
        commands = ['svcadm disable ' + service_name, 'svccfg delete -f ' + service_name];
        break;
      }
      default: {
        throw new Error('Unknown platform/init system name');
      }
    }

    sexec(commands.join('&& '), (code: any, stdout: any, stderr: any) => {
      Common.printOut(stdout);
      Common.printOut(stderr);
      if (code == 0) {
        Common.printOut(cst.PREFIX_MSG + chalk.bold('Init file disabled.'));
      } else {
        Common.printOut(cst.ERROR_MSG + chalk.bold('Return code : ' + code));
      }

      cb(null, {
        commands,
        platform,
      });
    });
  }

  /**
   * Startup script generation
   * @method startup
   * @param {string} platform type (centos|redhat|amazon|gentoo|systemd|smf)
   */
  startup(platform: string, opts: any, cb?: (err: any, data?: any) => void) {
    const that = this;
    const actual_platform = detectInitSystem();
    const user = opts.user || process.env.USER || process.env.LOGNAME; // Use LOGNAME on Solaris-like systems
    let service_name = opts.serviceName || 'omnitron-' + user;
    const openrc_service_name = 'omnitron';
    const launchd_service_name = opts.serviceName || 'omnitron.' + user;

    if (!platform) platform = actual_platform;
    else if (actual_platform && actual_platform !== platform) {
      Common.printOut('-----------------------------------------------------------');
      Common.printOut(' OMNITRON detected ' + actual_platform + ' but you precised ' + platform);
      Common.printOut(' Please verify that your choice is indeed your init system');
      Common.printOut(' If you arent sure, just run : omnitron startup');
      Common.printOut('-----------------------------------------------------------');
    }
    if (platform == null) throw new Error('Init system not found');

    if (!cb) {
      cb = (err, data) => {
        if (err) return that.exitCli(cst.ERROR_EXIT);
        return that.exitCli(cst.SUCCESS_EXIT);
      };
    }

    if (process.getuid() != 0) {
      return isNotRoot('setup', platform, opts, cb);
    }

    let destination;
    let commands;
    let template;

    function getTemplate(type) {
      return fs.readFileSync(path.join(__dirname, '..', 'templates/init-scripts', type + '.tpl'), { encoding: 'utf8' });
    }

    switch (platform) {
      case 'ubuntu':
      case 'centos':
      case 'arch':
      case 'oracle':
      case 'systemd':
        if (opts.waitIp) template = getTemplate('systemd-online');
        else template = getTemplate('systemd');
        destination = '/etc/systemd/system/' + service_name + '.service';
        commands = ['systemctl enable ' + service_name];
        break;
      case 'ubuntu14':
      case 'ubuntu12':
      case 'upstart':
        template = getTemplate('upstart');
        destination = '/etc/init.d/' + service_name;
        commands = [
          'chmod +x ' + destination,
          'mkdir -p /var/lock/subsys',
          'touch /var/lock/subsys/' + service_name,
          'update-rc.d ' + service_name + ' defaults',
        ];
        break;
      case 'systemv':
      case 'amazon':
      case 'centos6':
        template = getTemplate('upstart');
        destination = '/etc/init.d/' + service_name;
        commands = [
          'chmod +x ' + destination,
          'mkdir -p /var/lock/subsys',
          'touch /var/lock/subsys/' + service_name,
          'chkconfig --add ' + service_name,
          'chkconfig ' + service_name + ' on',
          'initctl list',
        ];
        break;
      case 'macos':
      case 'darwin':
      case 'launchd':
        template = getTemplate('launchd');
        destination = path.join(process.env.HOME, 'Library/LaunchAgents/' + launchd_service_name + '.plist');
        commands = [
          'mkdir -p ' + path.join(process.env.HOME, 'Library/LaunchAgents'),
          'launchctl load -w ' + destination,
        ];
        break;
      case 'freebsd':
      case 'rcd':
        template = getTemplate('rcd');
        service_name = opts.serviceName || 'omnitron_' + user;
        destination = '/usr/local/etc/rc.d/' + service_name;
        commands = ['chmod 755 ' + destination, 'sysrc ' + service_name + '_enable=YES'];
        break;
      case 'openbsd':
      case 'rcd-openbsd':
        template = getTemplate('rcd-openbsd');
        service_name = opts.serviceName || 'omnitron_' + user;
        destination = path.join('/etc/rc.d/', service_name);
        commands = ['chmod 755 ' + destination, 'rcctl enable ' + service_name, 'rcctl start ' + service_name];
        break;
      case 'openrc':
        template = getTemplate('openrc');
        service_name = openrc_service_name;
        destination = '/etc/init.d/' + service_name;
        commands = ['chmod +x ' + destination, 'rc-update add ' + service_name + ' default'];
        break;
      case 'smf':
      case 'sunos':
      case 'solaris':
        template = getTemplate('smf');
        service_name = opts.serviceName || 'omnitron_' + user;
        destination = path.join(tmpPath(), service_name + '.xml');
        commands = ['svccfg import ' + destination, 'svcadm enable ' + service_name];
        break;
      default:
        throw new Error('Unknown platform / init system name');
    }

    /**
     * 4# Replace template variable value
     */
    let envPath;

    if (cst.HAS_NODE_EMBEDDED == true)
      envPath = util.format('%s:%s', process.env.PATH || '', path.dirname(process.execPath));
    else if (new RegExp(path.dirname(process.execPath)).test(process.env.PATH)) envPath = process.env.PATH;
    else envPath = util.format('%s:%s', process.env.PATH || '', path.dirname(process.execPath));

    let omnitron_bin_path = require.main.filename;

    if (omnitron_bin_path.includes('/dist/binaries/cli.js') === true) {
      omnitron_bin_path = omnitron_bin_path.replace('/dist/binaries/cli.js', '/bin/omnitron');
    }

    template = template
      .replace(/%OMNITRON_PATH%/g, omnitron_bin_path)
      .replace(/%NODE_PATH%/g, envPath)
      .replace(/%USER%/g, user)
      .replace(/%HOME_PATH%/g, opts.hp ? path.resolve(opts.hp, '.omnitron') : cst.OMNITRON_ROOT_PATH)
      .replace(/%SERVICE_NAME%/g, service_name);

    Common.printOut(chalk.bold('Platform'), platform);
    Common.printOut(chalk.bold('Template'));
    Common.printOut(template);
    Common.printOut(chalk.bold('Target path'));
    Common.printOut(destination);
    Common.printOut(chalk.bold('Command list'));
    Common.printOut(commands);

    Common.printOut(cst.PREFIX_MSG + 'Writing init configuration in ' + destination);
    try {
      fs.writeFileSync(destination, template);
    } catch (e) {
      console.error(cst.PREFIX_MSG_ERR + 'Failure when trying to write startup script');
      console.error(e.message || e);
      return cb(e);
    }

    Common.printOut(cst.PREFIX_MSG + 'Making script booting at startup...');

    forEachLimit(
      commands,
      1,
      (command, next) => {
        Common.printOut(cst.PREFIX_MSG + '[-] Executing: %s...', chalk.bold(command));

        sexec(command, (code, stdout, stderr) => {
          if (code === 0) {
            Common.printOut(cst.PREFIX_MSG + chalk.bold('[v] Command successfully executed.'));
            return next();
          } else {
            Common.printOut(chalk.red('[ERROR] Exit code : ' + code));
            return next(new Error(command + ' failed, see error above.'));
          }
        });
      },
      (err) => {
        if (err) {
          console.error(cst.PREFIX_MSG_ERR + (err.message || err));
          return cb(err);
        }
        Common.printOut(chalk.bold.blue('+---------------------------------------+'));
        Common.printOut(chalk.bold.blue(cst.PREFIX_MSG + 'Freeze a process list on reboot via:'));
        Common.printOut(chalk.bold('$ omnitron save'));
        Common.printOut('');
        Common.printOut(chalk.bold.blue(cst.PREFIX_MSG + 'Remove init script via:'));
        Common.printOut(chalk.bold('$ omnitron unstartup ' + platform));

        return cb(null, {
          destination,
          template,
        });
      }
    );
  }

  /**
   * DISABLED FEATURE
   * KEEPING METHOD FOR BACKWARD COMPAT
   */
  autodump(cb) {
    return cb();
  }

  /**
   * Dump current processes managed by omnitron into DUMP_FILE_PATH file
   * @method dump
   * @param {} cb
   * @return
   */
  dump(force: boolean, cb?: (err: any, data?: any) => void) {
    const env_arr = [];
    const that = this;

    if (typeof force === 'function') {
      cb = force;
      force = false;
    }

    if (!cb) Common.printOut(cst.PREFIX_MSG + 'Saving current process list...');

    that.executeRemote('getMonitorData', {}, (err, list) => {
      if (err) {
        Common.printError('Error retrieving process list: ' + err);
        return cb ? cb(Common.retErr(err)) : that.exitCli(cst.ERROR_EXIT);
      }

      /**
       * Description
       * @method fin
       * @param {} err
       * @return
       */
      const fin = (err) => {
        // try to fix issues with empty dump file
        // like #3485
        if (!force && env_arr.length === 0 && !process.env.FORCE) {
          // fix : if no dump file, no process, only module and after omnitron update
          if (!fs.existsSync(cst.DUMP_FILE_PATH)) {
            that.clearDump(() => { });
          }

          // if no process in list don't modify dump file
          // process list should not be empty
          if (cb) {
            return cb(new Error('Process list empty, cannot save empty list'));
          } else {
            Common.printOut(cst.PREFIX_MSG_WARNING + 'OMNITRON is not managing any process, skipping save...');
            Common.printOut(cst.PREFIX_MSG_WARNING + 'To force saving use: omnitron save --force');
            that.exitCli(cst.SUCCESS_EXIT);
            return;
          }
        }

        // Back up dump file
        try {
          if (fs.existsSync(cst.DUMP_FILE_PATH)) {
            fs.writeFileSync(cst.DUMP_BACKUP_FILE_PATH, fs.readFileSync(cst.DUMP_FILE_PATH));
          }
        } catch (e) {
          console.error(e.stack || e);
          Common.printOut(cst.PREFIX_MSG_ERR + 'Failed to back up dump file in %s', cst.DUMP_BACKUP_FILE_PATH);
        }

        // Overwrite dump file, delete if broken and exit
        try {
          fs.writeFileSync(cst.DUMP_FILE_PATH, JSON.stringify(env_arr, '', 2));
        } catch (e) {
          console.error(e.stack || e);
          try {
            // try to backup file
            if (fs.existsSync(cst.DUMP_BACKUP_FILE_PATH)) {
              fs.writeFileSync(cst.DUMP_FILE_PATH, fs.readFileSync(cst.DUMP_BACKUP_FILE_PATH));
            }
          } catch (e) {
            // don't keep broken file
            fs.unlinkSync(cst.DUMP_FILE_PATH);
            console.error(e.stack || e);
          }
          Common.printOut(cst.PREFIX_MSG_ERR + 'Failed to save dump file in %s', cst.DUMP_FILE_PATH);
          return that.exitCli(cst.ERROR_EXIT);
        }
        if (cb) return cb(null, { success: true });

        Common.printOut(cst.PREFIX_MSG + 'Successfully saved in %s', cst.DUMP_FILE_PATH);
        return that.exitCli(cst.SUCCESS_EXIT);
      }

      (function ex(apps) {
        if (!apps[0]) return fin(null);
        delete apps[0].omnitron_env.instances;
        delete apps[0].omnitron_env.pm_id;
        delete apps[0].omnitron_env.prev_restart_delay;
        if (!apps[0].omnitron_env.pmx_module) env_arr.push(apps[0].omnitron_env);
        apps.shift();
        return ex(apps);
      })(list);
    });
  }

  /**
   * Remove DUMP_FILE_PATH file and DUMP_BACKUP_FILE_PATH file
   * @method dump
   * @param {} cb
   * @return
   */
  clearDump(cb?: (err: any, data?: any) => void) {
    fs.writeFileSync(cst.DUMP_FILE_PATH, JSON.stringify([]));

    if (cb && typeof cb === 'function') return cb();

    Common.printOut(cst.PREFIX_MSG + 'Successfully created %s', cst.DUMP_FILE_PATH);
    return this.exitCli(cst.SUCCESS_EXIT);
  }

  /**
   * Resurrect processes
   * @method resurrect
   * @param {} cb
   * @return
   */
  resurrect(cb?: (err: any, data?: any) => void) {
    let apps = {};
    const that = this;

    let processes;

    function readDumpFile(dumpFilePath) {
      Common.printOut(cst.PREFIX_MSG + 'Restoring processes located in %s', dumpFilePath);
      let apps_;
      try {
        apps_ = fs.readFileSync(dumpFilePath);
      } catch (e) {
        Common.printError(cst.PREFIX_MSG_ERR + 'Failed to read dump file in %s', dumpFilePath);
        throw e;
      }

      return apps_;
    }

    function parseDumpFile(dumpFilePath, apps_) {
      let processes_;
      try {
        processes_ = Common.parseConfig(apps_, 'none');
      } catch (e) {
        Common.printError(cst.PREFIX_MSG_ERR + 'Failed to parse dump file in %s', dumpFilePath);
        try {
          fs.unlinkSync(dumpFilePath);
        } catch (e) {
          console.error(e.stack || e);
        }
        throw e;
      }

      return processes_;
    }

    // Read dump file, fall back to backup, delete if broken
    try {
      apps = readDumpFile(cst.DUMP_FILE_PATH);
      processes = parseDumpFile(cst.DUMP_FILE_PATH, apps);
    } catch (e) {
      try {
        apps = readDumpFile(cst.DUMP_BACKUP_FILE_PATH);
        processes = parseDumpFile(cst.DUMP_BACKUP_FILE_PATH, apps);
      } catch (e) {
        Common.printError(cst.PREFIX_MSG_ERR + "No processes saved; DUMP file doesn't exist");
        // if (cb) return cb(Common.retErr(e));
        // else return that.exitCli(cst.ERROR_EXIT);
        return that.speedList();
      }
    }

    that.executeRemote('getMonitorData', {}, (err: any, list: any) => {
      if (err) {
        Common.printError(err);
        return that.exitCli(1);
      }

      const current = [];
      const target = [];

      list.forEach((app: any) => {
        if (!current[app.name]) current[app.name] = 0;
        current[app.name]++;
      });

      processes.forEach((app: any) => {
        if (!target[app.name]) target[app.name] = 0;
        target[app.name]++;
      });

      const tostart = Object.keys(target).filter((i: any) => Object.keys(current).indexOf(i) < 0);

      eachLimit(
        processes,
        cst.CONCURRENT_ACTIONS,
        (app: any, next: any) => {
          if (tostart.indexOf(app.name) == -1) return next();
          that.executeRemote('prepare', app, (err: any, dt: any) => {
            if (err) Common.printError(err);
            else Common.printOut(cst.PREFIX_MSG + 'Process %s restored', app.pm_exec_path);
            next();
          });
        },
        (err: any) => (cb ? cb(null, apps) : that.speedList())
      );
    });
  }

  // log-management
  /**
   * Description
   * @method flush
   * @return
   */
  flush(api: string, cb?: (err: any, data?: any) => void) {
    if (!api) {
      Common.printOut(cst.PREFIX_MSG + 'Flushing ' + cst.OMNITRON_LOG_FILE_PATH);
      fs.closeSync(fs.openSync(cst.OMNITRON_LOG_FILE_PATH, 'w'));
    }

    this.executeRemote('getMonitorData', {}, (err: any, list: any) => {
      if (err) {
        Common.printError(err);
        return cb ? cb(Common.retErr(err)) : this.exitCli(cst.ERROR_EXIT);
      }
      list.forEach((l: any) => {
        if (typeof api == 'undefined') {
          Common.printOut(cst.PREFIX_MSG + 'Flushing:');
          Common.printOut(cst.PREFIX_MSG + l.omnitron_env.pm_out_log_path);
          Common.printOut(cst.PREFIX_MSG + l.omnitron_env.pm_err_log_path);

          if (l.omnitron_env.pm_log_path) {
            Common.printOut(cst.PREFIX_MSG + l.omnitron_env.pm_log_path);
            fs.closeSync(fs.openSync(l.omnitron_env.pm_log_path, 'w'));
          }
          fs.closeSync(fs.openSync(l.omnitron_env.pm_out_log_path, 'w'));
          fs.closeSync(fs.openSync(l.omnitron_env.pm_err_log_path, 'w'));
        } else if (l.omnitron_env.pm_id == api || l.omnitron_env.name === api) {
          Common.printOut(cst.PREFIX_MSG + 'Flushing:');

          if (l.omnitron_env.pm_log_path && fs.existsSync(l.omnitron_env.pm_log_path)) {
            Common.printOut(cst.PREFIX_MSG + l.omnitron_env.pm_log_path);
            fs.closeSync(fs.openSync(l.omnitron_env.pm_log_path, 'w'));
          }

          if (l.omnitron_env.pm_out_log_path && fs.existsSync(l.omnitron_env.pm_out_log_path)) {
            Common.printOut(cst.PREFIX_MSG + l.omnitron_env.pm_out_log_path);
            fs.closeSync(fs.openSync(l.omnitron_env.pm_out_log_path, 'w'));
          }

          if (l.omnitron_env.pm_err_log_path && fs.existsSync(l.omnitron_env.pm_err_log_path)) {
            Common.printOut(cst.PREFIX_MSG + l.omnitron_env.pm_err_log_path);
            fs.closeSync(fs.openSync(l.omnitron_env.pm_err_log_path, 'w'));
          }
        }
      });

      Common.printOut(cst.PREFIX_MSG + 'Logs flushed');
      return cb ? cb(null, list) : this.exitCli(cst.SUCCESS_EXIT);
    });
  }

  logrotate(opts: any, cb?: (err: any, data?: any) => void) {
    if (process.getuid() != 0) {
      nodeExec('whoami', (err, stdout, stderr) => {
        Common.printError(cst.PREFIX_MSG + 'You have to run this command as root. Execute the following command:');
        Common.printError(
          cst.PREFIX_MSG +
          chalk.gray(
            '      sudo env PATH=$PATH:' + path.dirname(process.execPath) + ' omnitron logrotate -u ' + stdout.trim()
          )
        );

        if (cb) {
          cb(Common.retErr('You have to run this with elevated rights'));
        } else {
          this.exitCli(cst.ERROR_EXIT);
        }
      });
      return;
    }

    if (!fs.existsSync('/etc/logrotate.d')) {
      Common.printError(cst.PREFIX_MSG + '/etc/logrotate.d does not exist we can not copy the default configuration.');
      if (cb) {
        cb(Common.retErr('/etc/logrotate.d does not exist'));
      } else {
        this.exitCli(cst.ERROR_EXIT);
      }
      return;
    }

    const templatePath = path.join(cst.TEMPLATE_FOLDER, cst.LOGROTATE_SCRIPT);
    Common.printOut(cst.PREFIX_MSG + 'Getting logrorate template ' + templatePath);
    let script = fs.readFileSync(templatePath, { encoding: 'utf8' });

    const user = opts.user || 'root';

    script = script.replace(/%HOME_PATH%/g, cst.OMNITRON_ROOT_PATH).replace(/%USER%/g, user);

    try {
      fs.writeFileSync('/etc/logrotate.d/omnitron-' + user, script);
    } catch (e) {
      console.error(e.stack || e);
    }

    Common.printOut(cst.PREFIX_MSG + 'Logrotate configuration added to /etc/logrotate.d/omnitron');
    if (cb) {
      cb(null, { success: true });
    } else {
      this.exitCli(cst.SUCCESS_EXIT);
    }
  }

  /**
   * Description
   * @method reloadLogs
   * @return
   */
  reloadLogs(cb?: (err: any, data?: any) => void) {
    Common.printOut('Reloading all logs...');
    this.executeRemote('reloadLogs', {}, (err, logs) => {
      if (err) {
        Common.printError(err);
        return cb ? cb(Common.retErr(err)) : this.exitCli(cst.ERROR_EXIT);
      }
      Common.printOut('All logs reloaded');
      return cb ? cb(null, logs) : this.exitCli(cst.SUCCESS_EXIT);
    });
  }

  /**
   * Description
   * @method streamLogs
   * @param {String} id
   * @param {Number} lines
   * @param {Boolean} raw
   * @return
   */
  streamLogs(id, lines, raw, timestamp, exclusive, highlight) {
    const files_list = [];

    // If no argument is given, we stream logs for all running apps
    id = id || 'all';
    lines = lines !== undefined ? lines : 20;
    lines = lines < 0 ? -lines : lines;

    // Avoid duplicates and check if path is different from '/dev/null'
    const pushIfUnique = (entry) => {
      let exists = false;

      if (entry.path.toLowerCase && entry.path.toLowerCase() !== '/dev/null') {
        files_list.some((file) => {
          if (file.path === entry.path) exists = true;
          return exists;
        });

        if (exists) return;

        files_list.push(entry);
      }
    };

    // Get the list of all running apps
    this.executeRemote('getMonitorData', {}, (err, list) => {
      const regexList = [];
      const namespaceList = [];

      if (err) {
        Common.printError(err);
        this.exitCli(cst.ERROR_EXIT);
      }

      if (lines === 0) return Log.stream(this, id, raw, timestamp, exclusive, highlight);

      Common.printOut(
        chalk.bold.grey(
          util.format.call(
            this,
            '[TAILING] Tailing last %d lines for [%s] process%s (change the value with --lines option)',
            lines,
            id,
            id === 'all' ? 'es' : ''
          )
        )
      );

      // Populate the array `files_list` with the paths of all files we need to tail
      list.forEach((proc) => {
        if (proc.omnitron_env && (id === 'all' || proc.omnitron_env.name == id || proc.omnitron_env.pm_id == id)) {
          if (proc.omnitron_env.pm_out_log_path && exclusive !== 'err')
            pushIfUnique({
              path: proc.omnitron_env.pm_out_log_path,
              app_name: proc.omnitron_env.pm_id + '|' + proc.omnitron_env.name,
              type: 'out',
            });
          if (proc.omnitron_env.pm_err_log_path && exclusive !== 'out')
            pushIfUnique({
              path: proc.omnitron_env.pm_err_log_path,
              app_name: proc.omnitron_env.pm_id + '|' + proc.omnitron_env.name,
              type: 'err',
            });
        } else if (proc.omnitron_env && proc.omnitron_env.namespace == id) {
          if (namespaceList.indexOf(proc.omnitron_env.name) === -1) {
            namespaceList.push(proc.omnitron_env.name);
          }
          if (proc.omnitron_env.pm_out_log_path && exclusive !== 'err')
            pushIfUnique({
              path: proc.omnitron_env.pm_out_log_path,
              app_name: proc.omnitron_env.pm_id + '|' + proc.omnitron_env.name,
              type: 'out',
            });
          if (proc.omnitron_env.pm_err_log_path && exclusive !== 'out')
            pushIfUnique({
              path: proc.omnitron_env.pm_err_log_path,
              app_name: proc.omnitron_env.pm_id + '|' + proc.omnitron_env.name,
              type: 'err',
            });
        }
        // Populate the array `files_list` with the paths of all files we need to tail, when log in put is a regex
        else if (proc.omnitron_env && isNaN(id) && id[0] === '/' && id[id.length - 1] === '/') {
          const regex = new RegExp(id.replace(/\//g, ''));
          if (regex.test(proc.omnitron_env.name)) {
            if (regexList.indexOf(proc.omnitron_env.name) === -1) {
              regexList.push(proc.omnitron_env.name);
            }
            if (proc.omnitron_env.pm_out_log_path && exclusive !== 'err')
              pushIfUnique({
                path: proc.omnitron_env.pm_out_log_path,
                app_name: proc.omnitron_env.pm_id + '|' + proc.omnitron_env.name,
                type: 'out',
              });
            if (proc.omnitron_env.pm_err_log_path && exclusive !== 'out')
              pushIfUnique({
                path: proc.omnitron_env.pm_err_log_path,
                app_name: proc.omnitron_env.pm_id + '|' + proc.omnitron_env.name,
                type: 'err',
              });
          }
        }
      });

      //for fixing issue https://github.com/Unitech/omnitron/issues/3506
      /* if (files_list && files_list.length == 0) {
         Common.printError(cst.PREFIX_MSG_ERR + 'No file to stream for app [%s], exiting.', id);
         return process.exit(cst.ERROR_EXIT);
       }*/

      if (!raw && (id === 'all' || id === 'OMNITRON') && exclusive === false) {
        Log.tail(
          [
            {
              path: cst.OMNITRON_LOG_FILE_PATH,
              app_name: 'OMNITRON',
              type: 'OMNITRON',
            },
          ],
          lines,
          raw,
          () => {
            Log.tail(files_list, lines, raw, () => {
              Log.stream(this, id, raw, timestamp, exclusive, highlight);
            });
          }
        );
      } else {
        Log.tail(files_list, lines, raw, () => {
          if (regexList.length > 0) {
            regexList.forEach((id) => {
              Log.stream(this, id, raw, timestamp, exclusive, highlight);
            });
          } else if (namespaceList.length > 0) {
            namespaceList.forEach((id) => {
              Log.stream(this, id, raw, timestamp, exclusive, highlight);
            });
          } else {
            Log.stream(this, id, raw, timestamp, exclusive, highlight);
          }
        });
      }
    });
  }

  /**
   * Description
   * @method printLogs
   * @param {String} id
   * @param {Number} lines
   * @param {Boolean} raw
   * @return
   */
  printLogs(id, lines, raw, timestamp, exclusive) {
    const that = this;
    const files_list = [];

    // If no argument is given, we stream logs for all running apps
    id = id || 'all';
    lines = lines !== undefined ? lines : 20;
    lines = lines < 0 ? -lines : lines;

    // Avoid duplicates and check if path is different from '/dev/null'
    const pushIfUnique = (entry: any) => {
      let exists = false;

      if (entry.path.toLowerCase && entry.path.toLowerCase() !== '/dev/null') {
        files_list.some((file: any) => {
          if (file.path === entry.path) exists = true;
          return exists;
        });

        if (exists) return;

        files_list.push(entry);
      }
    };

    // Get the list of all running apps
    that.executeRemote('getMonitorData', {}, (err: any, list: any) => {
      if (err) {
        Common.printError(err);
        that.exitCli(cst.ERROR_EXIT);
      }

      if (lines <= 0) {
        return that.exitCli(cst.SUCCESS_EXIT);
      }

      Common.printOut(
        chalk.bold.grey(
          util.format.call(
            this,
            '[TAILING] Tailing last %d lines for [%s] process%s (change the value with --lines option)',
            lines,
            id,
            id === 'all' ? 'es' : ''
          )
        )
      );

      // Populate the array `files_list` with the paths of all files we need to tail
      list.forEach((proc) => {
        if (proc.omnitron_env && (id === 'all' || proc.omnitron_env.name == id || proc.omnitron_env.pm_id == id)) {
          if (proc.omnitron_env.pm_out_log_path && exclusive !== 'err')
            pushIfUnique({
              path: proc.omnitron_env.pm_out_log_path,
              app_name: proc.omnitron_env.pm_id + '|' + proc.omnitron_env.name,
              type: 'out',
            });
          if (proc.omnitron_env.pm_err_log_path && exclusive !== 'out')
            pushIfUnique({
              path: proc.omnitron_env.pm_err_log_path,
              app_name: proc.omnitron_env.pm_id + '|' + proc.omnitron_env.name,
              type: 'err',
            });
        }
        // Populate the array `files_list` with the paths of all files we need to tail, when log in put is a regex
        else if (proc.omnitron_env && isNaN(id) && id[0] === '/' && id[id.length - 1] === '/') {
          const regex = new RegExp(id.replace(/\//g, ''));
          if (regex.test(proc.omnitron_env.name)) {
            if (proc.omnitron_env.pm_out_log_path && exclusive !== 'err')
              pushIfUnique({
                path: proc.omnitron_env.pm_out_log_path,
                app_name: proc.omnitron_env.pm_id + '|' + proc.omnitron_env.name,
                type: 'out',
              });
            if (proc.omnitron_env.pm_err_log_path && exclusive !== 'out')
              pushIfUnique({
                path: proc.omnitron_env.pm_err_log_path,
                app_name: proc.omnitron_env.pm_id + '|' + proc.omnitron_env.name,
                type: 'err',
              });
          }
        }
      });

      if (!raw && (id === 'all' || id === 'OMNITRON') && exclusive === false) {
        Log.tail(
          [
            {
              path: cst.OMNITRON_LOG_FILE_PATH,
              app_name: 'OMNITRON',
              type: 'OMNITRON',
            },
          ],
          lines,
          raw,
          () => {
            Log.tail(files_list, lines, raw, () => {
              this.exitCli(cst.SUCCESS_EXIT);
            });
          }
        );
      } else {
        Log.tail(files_list, lines, raw, () => {
          this.exitCli(cst.SUCCESS_EXIT);
        });
      }
    });
  }

  // containerizer
  generateDockerfile(script, opts) {
    const docker_filepath = path.join(process.cwd(), 'Dockerfile');

    fs.stat(docker_filepath, (err: any, stat: any) => {
      if (err || opts.force == true) {
        generateDockerfile(docker_filepath, script, {
          mode: 'development',
        }).then(() => {
          console.log(chalk.bold('New Dockerfile generated in current folder'));
          console.log(chalk.bold('You can now run\n$ omnitron docker:dev <file|config>'));
          return this.exitCli(cst.SUCCESS_EXIT);
        });
        return false;
      }
      console.log(chalk.red.bold('Dockerfile already exists in this folder, use --force if you want to replace it'));
      thid.exitCli(cst.ERROR_EXIT);
    });
  }

  dockerMode(script, opts, mode) {
    const promptly = require('promptly');
    const self = this;

    process.on('SIGINT', () => {
      this.disconnect();

      if (mode != 'distribution') return false;

      nodeExec('docker ps -lq', (err: any, stdout: any, stderr: any) => {
        if (err) {
          console.error(err);
        }
        require('vizion').analyze({ folder: process.cwd() }, (err: any, meta: any) => {
          if (!err && meta.revision) {
            const commit_id = util.format('#%s(%s) %s', meta.branch, meta.revision.slice(0, 5), meta.comment);

            console.log(
              chalk.bold.magenta('$ docker commit -m "%s" %s %s'),
              commit_id,
              stdout.replace('\n', ''),
              opts.imageName
            );
          } else console.log(chalk.bold.magenta('$ docker commit %s %s'), stdout.replace('\n', ''), opts.imageName);

          console.log(chalk.bold.magenta('$ docker push %s'), opts.imageName);
        });
      });
    });

    if (mode == 'distribution' && !opts.imageName) {
      console.error(chalk.bold.red('--image-name [name] option is missing'));
      return this.exitCli(cst.ERROR_EXIT);
    }

    let template;
    let app_path, main_script;
    const node_version = opts.nodeVersion ? opts.nodeVersion.split('.')[0] : 'latest';

    const image_name = opts.imageName || crypto.randomBytes(6).toString('hex');

    if (script.indexOf('/') > -1) {
      app_path = path.join(process.cwd(), path.dirname(script));
      main_script = path.basename(script);
    } else {
      app_path = process.cwd();
      main_script = script;
    }

    new Promise((resolve, reject) => {
      nodeExec("docker version -f '{{.Client.Version}}'", (err: any, stdout: any, stderr: any) => {
        if (err) {
          console.error(chalk.red.bold('[Docker access] Error while trying to use docker command'));
          if (err.message && err.message.indexOf('Cannot connect to the Docker') > -1) {
            console.log();
            console.log(chalk.blue.bold('[Solution] Setup Docker to be able to be used without sudo rights:'));
            console.log(chalk.bold('$ sudo groupadd docker'));
            console.log(chalk.bold('$ sudo usermod -aG docker $USER'));
            console.log(chalk.bold('Then LOGOUT and LOGIN your Linux session'));
            console.log('Read more: http://bit.ly/29JGdCE');
          }
          return reject(err);
        }
        return resolve();
      });
    })
      .then(
        () =>
          /////////////////////////
          // Generate Dockerfile //
          /////////////////////////
          new Promise((resolve, reject) => {
            const docker_filepath = path.join(process.cwd(), 'Dockerfile');

            fs.stat(docker_filepath, (err, stat) => {
              if (err) {
                // Dockerfile does not exist, generate one
                // console.log(chalk.blue.bold('Generating new Dockerfile'));
                if (opts.force == true) {
                  return resolve(
                    generateDockerfile(docker_filepath, main_script, {
                      node_version,
                      mode,
                    })
                  );
                }
                if (opts.dockerdaemon)
                  return resolve(
                    generateDockerfile(docker_filepath, main_script, {
                      node_version,
                      mode,
                    })
                  );
                promptly.prompt('No Dockerfile in current directory, ok to generate a new one? (y/n)', (err, value) => {
                  if (value == 'y')
                    return resolve(
                      generateDockerfile(docker_filepath, main_script, {
                        node_version,
                        mode,
                      })
                    );
                  else return self.exitCli(cst.SUCCESS_EXIT);
                });
                return false;
              }
              return resolve(
                switchDockerFile(docker_filepath, main_script, {
                  node_version,
                  mode,
                })
              );
            });
          })
      )
      .then((_template) => {
        template = _template;
        return Promise.resolve();
      })
      .then(() => {
        //////////////////
        // Docker build //
        //////////////////

        let docker_build = util.format('docker build -t %s -f %s', image_name, template.Dockerfile_path);

        if (opts.fresh == true) docker_build += ' --no-cache';
        docker_build += ' .';

        console.log();
        fmt.sep();
        fmt.title('Building Boot System');
        fmt.field('Type', chalk.cyan.bold('Docker'));
        fmt.field('Mode', mode);
        fmt.field('Image name', image_name);
        fmt.field('Docker build command', docker_build);
        fmt.field('Dockerfile path', template.Dockerfile_path);
        fmt.sep();

        return pspawn(docker_build);
      })
      .then(() => {
        ////////////////
        // Docker run //
        ////////////////

        let docker_run = 'docker run --net host';

        if (opts.dockerdaemon == true) docker_run += ' -d';
        if (mode != 'distribution') docker_run += util.format(' -v %s:/var/app -v /var/app/node_modules', app_path);
        docker_run += ' ' + image_name;
        const dockerfile_parsed = template.Dockerfile.split('\n');
        const base_image = dockerfile_parsed[0];
        const run_cmd = dockerfile_parsed[dockerfile_parsed.length - 1];

        console.log();
        fmt.sep();
        fmt.title('Booting');
        fmt.field('Type', chalk.cyan.bold('Docker'));
        fmt.field('Mode', mode);
        fmt.field('Base Image', base_image);
        fmt.field('Image Name', image_name);
        fmt.field('Docker Command', docker_run);
        fmt.field('RUN Command', run_cmd);
        fmt.field('CWD', app_path);
        fmt.sep();
        return pspawn(docker_run);
      })
      .then(() => {
        console.log(chalk.blue.bold('>>> Leaving Docker instance uuid=%s'), image_name);
        self.disconnect();
        return Promise.resolve();
      })
      .catch((err) => {
        console.log();
        console.log(chalk.gray('Raw error=', err.message));
        self.disconnect();
      });
  }

  processesAreAlreadyMonitored(cb: any) {
    this.executeRemote('getMonitorData', {}, (err: any, list: any) => {
      if (err) return cb(false);
      const l = list.filter((l: any) => l.omnitron_env.km_link == true);
      const l2 = list.filter((l: any) => l.name == 'pm2-server-monit');

      return cb(l.length > 0 && l2.length > 0 ? true : false);
    });
  }

  // @breaking change (noDaemonMode has been drop)
  // @todo ret err
  startClient(cb: (err: any, meta?: any) => void) {
    // eslint-disable-next-line consistent-return
    this.pingDaemon((daemonAlive) => {
      if (daemonAlive === true) {
        return this.launchRPC((err: any) =>
          cb(null, {
            daemon_mode: this._conf.daemon_mode,
            new_omnitron_instance: false,
            rpc_socket_file: this.rpc_socket_file,
            pub_socket_file: this.pub_socket_file,
            omnitron_home: this.omnitron_home,
          })
        );
      }

      /**
       * No Daemon mode
       */
      if (this.daemon_mode === false) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Daemon } = require('./daemon');

        const daemon = new Daemon({
          pub_socket_file: this._conf.DAEMON_PUB_PORT,
          rpc_socket_file: this._conf.DAEMON_RPC_PORT,
          pid_file: this._conf.OMNITRON_PID_FILE_PATH,
          ignore_signals: true,
        });

        console.log('Launching in no daemon mode');

        daemon.innerStart(() => {
          KMDaemon.launchAndInteract(
            this._conf,
            {
              machine_name: this.machine_name,
              public_key: this.public_key,
              secret_key: this.secret_key,
              omnitron_version: pkg.version,
            },
            (err, data, interactor_proc) => {
              this.interactor_process = interactor_proc;
            }
          );

          this.launchRPC((err: any) =>
            cb(null, {
              daemon_mode: this._conf.daemon_mode,
              new_omnitron_instance: true,
              rpc_socket_file: this.rpc_socket_file,
              pub_socket_file: this.pub_socket_file,
              omnitron_home: this.omnitron_home,
            })
          );
        });
        return false;
      }

      /**
       * Daemon mode
       */
      // eslint-disable-next-line consistent-return
      this.launchDaemon((err: any, child: any) => {
        if (err) {
          Common.printError(err);
          return cb ? cb(err) : process.exit(this._conf.ERROR_EXIT);
        }

        if (!process.env.OMNITRON_DISCRETE_MODE)
          Common.printOut(this._conf.PREFIX_MSG + 'OMNITRON Successfully daemonized');

        this.launchRPC(() =>
          cb(null, {
            daemon_mode: this._conf.daemon_mode,
            new_omnitron_instance: true,
            rpc_socket_file: this.rpc_socket_file,
            pub_socket_file: this.pub_socket_file,
            omnitron_home: this.omnitron_home,
          })
        );
      });
    });
  }

  // Init file structure of omnitron_home
  // This includes
  // - omnitron pid and log path
  // - rpc and pub socket for command execution
  initFileStructure() {
    if (!fs.existsSync(this._conf.DEFAULT_LOG_PATH)) {
      try {
        mkdirp.sync(this._conf.DEFAULT_LOG_PATH);
      } catch (e: any) {
        console.error(e.stack || e);
      }
    }

    if (!fs.existsSync(this._conf.DEFAULT_PID_PATH)) {
      try {
        mkdirp.sync(this._conf.DEFAULT_PID_PATH);
      } catch (e: any) {
        console.error(e.stack || e);
      }
    }

    if (!fs.existsSync(this._conf.OMNITRON_MODULE_CONF_FILE)) {
      try {
        fs.writeFileSync(this._conf.OMNITRON_MODULE_CONF_FILE, '{}');
      } catch (e: any) {
        console.error(e.stack || e);
      }
    }

    if (!fs.existsSync(this._conf.DEFAULT_MODULE_PATH)) {
      try {
        mkdirp.sync(this._conf.DEFAULT_MODULE_PATH);
      } catch (e: any) {
        console.error(e.stack || e);
      }
    }
  }

  closeClient(cb: (err?: any) => void) {
    forEach(
      [this.disconnectRPC.bind(this), this.disconnectBus.bind(this)],
      (fn, next) => {
        fn(next);
      },
      cb
    );
  }

  /**
   * Launch the Daemon by forking this same file
   * The method Client.remoteWrapper will be called
   *
   * @method launchDaemon
   * @param {Object} opts
   * @param {Object} [opts.interactor=true] allow to disable interaction on launch
   */
  launchDaemon(cb: (err?: any, child?: any) => void, opts: any = { interactor: true }) {
    let node_args: string[] = [];

    // if (process.env.TRAVIS) {
    //   // Redirect OMNITRON internal err and out to STDERR STDOUT when running with Travis
    //   out = 1;
    //   err = 2;
    // }
    // else {
    const out = fs.openSync(this._conf.OMNITRON_LOG_FILE_PATH, 'a');
    const err = fs.openSync(this._conf.OMNITRON_LOG_FILE_PATH, 'a');
    //}

    if (this._conf.LOW_MEMORY_ENVIRONMENT) {
      node_args.push('--gc-global'); // Does full GC (smaller memory footprint)
      node_args.push('--max-old-space-size=' + Math.floor(os.totalmem() / 1024 / 1024));
    }

    // Node.js tuning for better performance
    //node_args.push('--expose-gc'); // Allows manual GC in the code

    /**
     * Add node [arguments] depending on OMNITRON_NODE_OPTIONS env variable
     */
    if (process.env.OMNITRON_NODE_OPTIONS) node_args = node_args.concat(process.env.OMNITRON_NODE_OPTIONS.split(' '));
    node_args.push(path.resolve(path.dirname(module.filename), 'daemon.js'));

    if (!process.env.OMNITRON_DISCRETE_MODE)
      Common.printOut(this._conf.PREFIX_MSG + 'Spawning OMNITRON daemon with omnitron_home=' + this.omnitron_home);

    const interpreter = process.execPath;

    const child_ = spawn(interpreter, node_args, {
      detached: true,
      cwd: this._conf.cwd || process.cwd(),
      windowsHide: true,
      env: Object.assign(
        {
          SILENT: this._conf.DEBUG ? !this._conf.DEBUG : true,
          OMNITRON_HOME: this.omnitron_home,
        },
        process.env
      ),
      stdio: [null, out, err, 'ipc'],
    });

    function onError(e: any) {
      console.error(e.message || e);
      return cb ? cb(e.message || e) : false;
    }

    child_.once('error', onError);

    if (this._conf.IS_BUN === false) child_.unref();

    child_.once('message', (msg: any) => {
      child_.removeListener('error', onError);
      child_.disconnect();
      if (opts && opts.interactor == false) {
        cb(null, child_);
        return;
      }

      if (process.env.OMNITRON_NO_INTERACTION == 'true') {
        cb(null, child_);
        return;
      }

      /**
       * Here the Keymetrics agent is launched automaticcaly if
       * it has been already configured before (via omnitron link)
       */
      KMDaemon.launchAndInteract(
        this._conf,
        {
          machine_name: this.machine_name,
          public_key: this.public_key,
          secret_key: this.secret_key,
          omnitron_version: pkg.version,
        },
        (_: any, data: any, interactor_proc: any) => {
          this.interactor_process = interactor_proc;
          cb(null, child_);
        }
      );
    });
  }

  /**
   * Ping the daemon to know if it alive or not
   * @api public
   * @method pingDaemon
   * @param {} cb
   * @return
   */
  pingDaemon(cb: (alive: boolean) => void) {
    const req = axon.socket('req');
    const client = new rpc.Client(req);

    client.sock.once('reconnect attempt', () => {
      client.sock.close();
      process.nextTick(() => cb(false));
    });

    client.sock.once('error', (e: any) => {
      if (e.code === 'EACCES') {
        fs.stat(this._conf.DAEMON_RPC_PORT, (err: any, stats: any) => {
          if (stats.uid === 0) {
            console.error(this._conf.PREFIX_MSG_ERR + 'Permission denied, to give access to current user:');
            console.log(
              '$ sudo chown ' +
              process.env.USER +
              ':' +
              process.env.USER +
              ' ' +
              this._conf.DAEMON_RPC_PORT +
              ' ' +
              this._conf.DAEMON_PUB_PORT
            );
          } else
            console.error(
              this._conf.PREFIX_MSG_ERR + 'Permission denied, check permissions on ' + this._conf.DAEMON_RPC_PORT
            );

          process.exit(1);
        });
      } else console.error(e.message || e);
    });

    client.sock.once('connect', () => {
      client.sock.once('close', () => cb(true));
      client.sock.close();
    });

    req.connect(this.rpc_socket_file);
  }

  /**
   * Methods to interact with the Daemon via RPC
   * This method wait to be connected to the Daemon
   * Once he's connected it trigger the command parsing (on ./bin/omnitron file, at the end)
   * @method launchRPC
   * @params {function} [cb]
   * @return
   */
  launchRPC(cb: (err?: any) => void) {
    const req = axon.socket('req');
    this.client = new rpc.Client(req);

    const connectHandler = () => {
      this.client.sock.removeListener('error', errorHandler);
      if (cb) {
        setTimeout(() => {
          cb(null);
        }, 4);
      }
    };

    const errorHandler = (e: any) => {
      this.client.sock.removeListener('connect', connectHandler);
      if (cb) {
        cb(e);
      }
    };

    this.client.sock.once('connect', connectHandler);
    this.client.sock.once('error', errorHandler);
    this.client_sock = req.connect(this.rpc_socket_file);
  }

  /**
   * Methods to close the RPC connection
   * @callback cb
   */
  disconnectRPC(cb: (err?: any, result?: any) => void) {
    if (!cb) cb = noop;

    if (!this.client_sock || !this.client_sock.close) {
      this.client = null;
      return process.nextTick(() => {
        cb(new Error('SUB connection to OMNITRON is not launched'));
      });
    }

    if (this.client_sock.connected === false || this.client_sock.closing === true) {
      this.client = null;
      return process.nextTick(() => {
        cb(new Error('RPC already being closed'));
      });
    }

    try {
      this.client_sock.once('close', () => {
        clearTimeout(timer);
        this.client = null;
        return cb(null, { msg: 'RPC Successfully closed' });
      });

      const timer = setTimeout(() => {
        if (this.client_sock.destroy) this.client_sock.destroy();
        this.client = null;
        return cb(null, { msg: 'RPC Successfully closed via timeout' });
      }, 200);

      this.client_sock.close();
    } catch (e) {
      return cb(e);
    }
    return false;
  }

  launchBus(cb: (err: any, sub?: any, sub_sock?: any) => void) {
    this.sub = axon.socket('sub-emitter');
    this.sub_sock = this.sub.connect(this.pub_socket_file);

    this.sub_sock.once('connect', () => {
      cb(null, this.sub, this.sub_sock);
    });
  }

  disconnectBus(cb: (err?: any, result?: any) => void) {
    if (!cb) cb = noop;

    if (!this.sub_sock || !this.sub_sock.close) {
      this.sub = null;
      process.nextTick(() => {
        cb(null, { msg: 'bus was not connected' });
      });
      return;
    }

    if (this.sub_sock.connected === false || this.sub_sock.closing === true) {
      this.sub = null;
      process.nextTick(() => {
        cb(new Error('SUB connection is already being closed'));
      });
      return;
    }

    try {
      this.sub_sock.once('close', () => {
        this.sub = null;
        clearTimeout(timer);
        return cb();
      });

      const timer = setTimeout(() => {
        if (this.sub_sock.destroy) this.sub_sock.destroy();
        return cb();
      }, 200);

      this.sub_sock.close();
    } catch (e) {
      cb(e);
    }
  }

  /**
   * Description
   * @method gestExposedMethods
   * @param {} cb
   * @return
   */
  getExposedMethods(cb: (err: any, methods?: any) => void) {
    this.client.methods(cb);
  }

  /**
   * Description
   * @method executeRemote
   * @param {} method
   * @param {} env
   * @param {} fn
   * @return
   */
  executeRemote(method: string, app_conf: any, fn?: (err: any, result?: any) => void) {
    // stop watch on stop | env is the process id
    if (method.indexOf('stop') !== -1) {
      this.stopWatch(method, app_conf);
    }
    // stop watching when process is deleted
    else if (method.indexOf('delete') !== -1) {
      this.stopWatch(method, app_conf);
    }
    // stop everything on kill
    else if (method.indexOf('kill') !== -1) {
      this.stopWatch('deleteAll', app_conf);
    } else if (method.indexOf('restartProcessId') !== -1 && process.argv.indexOf('--watch') > -1) {
      delete app_conf.env.current_conf.watch;
      this.toggleWatch(method, app_conf);
    }

    if (!this.client || !this.client.call) {
      this.startClient((error: any) => {
        if (error) {
          if (fn) {
            fn(error);
            return;
          }
          console.error(error);
          process.exit(0);
        }
        if (this.client) {
          this.client.call(method, app_conf, fn);
        }
      });
      return false;
    }

    return this.client.call(method, app_conf, fn);
  }

  notifyGod(action_name: string, id: number, cb: () => void) {
    this.executeRemote(
      'notifyByProcessId',
      {
        id,
        action_name,
        manually: true,
      },
      () => (cb ? cb() : false)
    );
  }

  killDaemonClient(fn: (err: any, result?: any) => void) {
    const quit = () => {
      this.closeClient(() => (fn ? fn(null, { success: true }) : false));
    };

    // under unix, we listen for signal (that is send by daemon to notify us that its shuting down)
    if (process.platform !== 'win32') {
      process.once('SIGQUIT', () => {
        clearTimeout(timeout);
        quit();
      });
    } else {
      // if under windows, try to ping the daemon to see if it still here
      setTimeout(() => {
        this.pingDaemon((alive: boolean) => {
          if (!alive) {
            clearTimeout(timeout);
            quit();
          }
        });
      }, 250);
    }

    const timeout = setTimeout(() => {
      quit();
    }, 3000);

    // Kill daemon
    this.executeRemote('killMe', { pid: process.pid });
  }

  /**
   * Description
   * @method toggleWatch
   * @param {String} omnitron method name
   * @param {Object} application environment, should include id
   * @param {Function} callback
   */
  toggleWatch(method: string, env: any, fn?: () => void) {
    this.client.call('toggleWatch', method, env, () => (fn ? fn() : false));
  }

  /**
   * Description
   * @method startWatch
   * @param {String} omnitron method name
   * @param {Object} application environment, should include id
   * @param {Function} callback
   */
  startWatch(method: string, env: any, fn: () => void) {
    this.client.call('startWatch', method, env, () => (fn ? fn() : false));
  }

  /**
   * Description
   * @method stopWatch
   * @param {String} omnitron method name
   * @param {Object} application environment, should include id
   * @param {Function} callback
   */
  stopWatch(method: string, env: any, fn?: () => void) {
    this.client.call('stopWatch', method, env, () => (fn ? fn() : false));
  }

  getAllProcess(cb: (err: any, procs?: any) => void) {
    this.executeRemote('getMonitorData', {}, (err, procs) => {
      if (err) {
        Common.printError('Error retrieving process list: ' + err);
        return cb(err);
      }

      return cb(null, procs);
    });
  }

  getAllProcessId(cb: (err: any, ids?: any) => void) {
    this.executeRemote('getMonitorData', {}, (err, procs) => {
      if (err) {
        Common.printError('Error retrieving process list: ' + err);
        return cb(err);
      }

      return cb(
        null,
        procs.map((proc) => proc.pm_id)
      );
    });
  }

  getAllProcessIdWithoutModules(cb: (err: any, ids?: any) => void) {
    this.executeRemote('getMonitorData', {}, (err, procs) => {
      if (err) {
        Common.printError('Error retrieving process list: ' + err);
        return cb(err);
      }

      const proc_ids = procs.filter((proc) => !proc.omnitron_env.pmx_module).map((proc) => proc.pm_id);

      return cb(null, proc_ids);
    });
  }

  getProcessIdByNameClient(
    name: string | number,
    force_all: boolean | ((err: any, ids?: any, details?: any) => void),
    cb?: (err: any, ids?: any, details?: any) => void
  ) {
    const found_proc: any[] = [];
    const full_details: any = {};

    if (typeof cb === 'undefined') {
      cb = force_all as (err: any, ids?: any, details?: any) => void;
      force_all = false;
    }

    if (typeof name == 'number') name = name.toString();

    this.executeRemote('getMonitorData', {}, (err, list) => {
      if (err) {
        Common.printError('Error retrieving process list: ' + err);
        return cb(err);
      }

      list.forEach((proc: any) => {
        if (proc.omnitron_env.name == name || proc.omnitron_env.pm_exec_path == path.resolve(name)) {
          found_proc.push(proc.pm_id);
          full_details[proc.pm_id] = proc;
        }
      });

      return cb(null, found_proc, full_details);
    });
  }

  getProcessIdsByNamespace(
    namespace: string | number,
    force_all: boolean | ((err: any, ids?: any, details?: any) => void),
    cb?: (err: any, ids?: any, details?: any) => void
  ) {
    const found_proc: any[] = [];
    const full_details: any = {};

    if (typeof cb === 'undefined') {
      cb = force_all as (err: any, ids?: any, details?: any) => void;
      force_all = false;
    }

    if (typeof namespace == 'number') namespace = namespace.toString();

    this.executeRemote('getMonitorData', {}, (err, list) => {
      if (err) {
        Common.printError('Error retrieving process list: ' + err);
        return cb(err);
      }

      list.forEach((proc: any) => {
        if (proc.omnitron_env.namespace == namespace) {
          found_proc.push(proc.pm_id);
          full_details[proc.pm_id] = proc;
        }
      });

      return cb(null, found_proc, full_details);
    });
  }

  getProcessByName(name: string, cb: (err: any, procs?: any) => void) {
    const found_proc: any[] = [];

    this.executeRemote('getMonitorData', {}, (err, list) => {
      if (err) {
        Common.printError('Error retrieving process list: ' + err);
        return cb(err);
      }

      list.forEach((proc: any) => {
        if (proc.omnitron_env.name == name || proc.omnitron_env.pm_exec_path == path.resolve(name)) {
          found_proc.push(proc);
        }
      });

      return cb(null, found_proc);
    });
  }

  getProcessByNameOrId(nameOrId: string | number, cb: (err: any, procs?: any) => void) {
    const foundProc: any[] = [];

    this.executeRemote('getMonitorData', {}, (err, list) => {
      if (err) {
        Common.printError('Error retrieving process list: ' + err);
        return cb(err);
      }

      list.forEach((proc: any) => {
        if (
          proc.omnitron_env.name === nameOrId ||
          proc.omnitron_env.pm_exec_path === path.resolve(nameOrId as string) ||
          proc.pid === parseInt(nameOrId as string) ||
          proc.omnitron_env.pm_id === parseInt(nameOrId as string)
        ) {
          foundProc.push(proc);
        }
      });

      return cb(null, foundProc);
    });
  }
}
