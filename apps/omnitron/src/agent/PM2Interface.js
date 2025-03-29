'use strict';

const fs = require('fs');
const path = require('path');
const async = require('async');

const cst = require('./constants');

module.exports = class OMNITRONInterface {
  constructor(rpc) {
    this.rpc = rpc;
  }

  getProcessByName(name, cb) {
    var foundProc = [];

    this.rpc.getMonitorData({}, (err, list) => {
      if (err) {
        return cb(err);
      }

      list.forEach((proc) => {
        if (proc.omnitron_env.name === name || proc.omnitron_env.pm_exec_path === path.resolve(name.toString())) {
          foundProc.push(proc);
        }
      });

      return cb(null, foundProc);
    });
  }

  /**
   * Scale up/down a process
   * @method scale
   */
  scale(opts, cb) {
    const self = this;
    const appName = opts.name;
    let number = opts.number;

    function addProcs(proc, value, cb) {
      (function ex(proc, number) {
        if (number-- === 0) return cb();
        self.rpc.duplicateProcessId(proc.omnitron_env.pm_id, ex.bind(this, proc, number));
      })(proc, number);
    }

    function rmProcs(procs, value, cb) {
      let i = 0;

      (function ex(procs, number) {
        if (number++ === 0) return cb();
        self.rpc.deleteProcessId(procs[i++].omnitron_env.pm_id, ex.bind(this, procs, number));
      })(procs, number);
    }

    let end = () => (cb ? cb(null, { success: true }) : true);

    this.getProcessByName(appName, (err, procs) => {
      if (err) {
        return cb ? cb(err) : true;
      }

      if (!procs || procs.length === 0) {
        return cb ? cb(new Error('App not found')) : true;
      }

      let procNumber = procs.length;

      if (typeof number === 'string' && number.indexOf('+') >= 0) {
        number = parseInt(number, 10);
        return addProcs(procs[0], number, end);
      } else if (typeof number === 'string' && number.indexOf('-') >= 0) {
        number = parseInt(number, 10);
        return rmProcs(procs, number, end);
      } else {
        number = parseInt(number, 10);
        number = number - procNumber;

        if (number < 0) {
          return rmProcs(procs, number, end);
        } else if (number > 0) {
          return addProcs(procs[0], number, end);
        } else {
          return cb ? cb(new Error('Same process number')) : true;
        }
      }
    });
  }

  /**
   * Dump current processes managed by omnitron into DUMP_FILE_PATH file
   * @method dump
   * @param {} cb
   * @return
   */
  dump(cb) {
    var envArr = [];

    this.rpc.getMonitorData({}, (err, list) => {
      if (err) {
        return typeof cb === 'function' ? cb(err) : false;
      }

      /**
       * Description
       * @method end
       * @param {} err
       * @return
       */
      const end = () => {
        // Overwrite dump file, delete if broken and exit
        try {
          fs.writeFileSync(cst.DUMP_FILE_PATH, JSON.stringify(envArr, '', 2));
        } catch (e) {
          return cb(e);
        }
        return cb ? cb(null, { success: true }) : true;
      };

      async.each(
        list,
        (app, done) => {
          delete app.omnitron_env.instances;
          delete app.omnitron_env.pm_id;
          if (!app.omnitron_env.pmx_module) {
            envArr.push(app.omnitron_env);
          }
          done();
        },
        end
      );
    });
  }

  _callWithProcessId(fn, params, cb) {
    if (params.id === undefined) {
      this.getProcessByName(params.name, (err, processes) => {
        if (err) return cb(err);

        // in case we don't find the process ourselves
        // we believe omnitron will find it
        if (processes.length === 0) {
          return fn(Object.assign({ id: params.name }, params), cb);
        }

        async.eachOf(
          processes,
          (process, _key, localCb) => {
            params.id = process.pm_id;
            fn(params, localCb);
          },
          cb
        );
      });
    } else {
      fn(params, cb);
    }
  }

  restart(params, cb) {
    this._callWithProcessId(this.rpc.restartProcessId, params, cb);
  }

  reload(params, cb) {
    this._callWithProcessId(this.rpc.reloadProcessId, params, cb);
  }

  reset(params, cb) {
    this._callWithProcessId((newParams, cb) => this.rpc.resetMetaProcessId(newParams.id, cb), params, cb);
  }

  ping(params, cb) {
    this._callWithProcessId(this.rpc.ping, params, cb);
  }
};
