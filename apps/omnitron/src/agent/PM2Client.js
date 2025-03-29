'use strict';

const axon = require('pm2-axon');
const rpc = require('pm2-axon-rpc');

const cst = require('./constants.js');
const EventEmitter = require('events').EventEmitter;
const OMNITRONInterface = require('./PM2Interface');

/**
 * OMNITRON API Wrapper used to setup connection with the daemon
 * @param {Object} opts options
 * @param {String} opts.sub_port socket file of the OMNITRON bus [optionnal]
 * @param {String} opts.rpc_port socket file of the OMNITRON RPC server [optionnal]
 */
module.exports = class OMNITRONClient extends EventEmitter {
  constructor(opts) {
    super();
    const subSocket = (opts && opts.sub_port) || cst.DAEMON_PUB_PORT;
    const rpcSocket = (opts && opts.rpc_port) || cst.DAEMON_RPC_PORT;

    const sub = axon.socket('sub-emitter');
    this.sub_sock = sub.connect(subSocket);
    this.bus = sub;

    const req = axon.socket('req');
    this.rpc_sock = req.connect(rpcSocket);
    this.rpc_client = new rpc.Client(req);

    this.rpc = {};

    this.rpc_sock.on('connect', (_) => {
      this.generateMethods((_) => {
        this.omnitronInterface = new OMNITRONInterface(this.rpc);
        this.emit('ready');
      });
    });

    this.rpc_sock.on('close', (_) => {
      this.emit('closed');
    });

    this.rpc_sock.on('reconnect attempt', (_) => {
      this.emit('reconnecting');
    });

    this.sub_sock.on('connect', (_) => {
      this.emit('bus:ready');
    });

    this.sub_sock.on('close', (_) => {
      this.emit('bus:closed');
    });

    this.sub_sock.on('reconnect attempt', (_) => {
      this.emit('bus:reconnecting');
    });
  }

  /**
   * Disconnect socket connections. This will allow Node to exit automatically.
   * Further calls to OMNITRON from this object will throw an error.
   */
  disconnect() {
    this.sub_sock.close();
    this.rpc_sock.close();
  }

  /**
   * Generate method by requesting exposed methods by OMNITRON
   * You can now control/interact with OMNITRON
   */
  generateMethods(cb) {
    this.rpc_client.methods((err, methods) => {
      if (err) return cb(err);
      Object.keys(methods).forEach((key) => {
        let method = methods[key];

        log('+-- Creating %s method', method.name);

        ((name) => {
          const self = this;
          this.rpc[name] = function () {
            let args = Array.prototype.slice.call(arguments);
            args.unshift(name);
            self.rpc_client.call.apply(self.rpc_client, args);
          };
        })(method.name);
      });
      return cb();
    });
  }

  remote(method, parameters, cb) {
    if (typeof this.omnitronInterface[method] === 'undefined') {
      return cb(new Error('Deprecated or invalid method'));
    }
    this.omnitronInterface[method](parameters, cb);
  }

  msgProcess(data, cb) {
    this.rpc.msgProcess(data, cb);
  }
};
