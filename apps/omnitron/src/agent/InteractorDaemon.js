'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const axon = require('pm2-axon');
const semver = require('semver');
const rpc = require('pm2-axon-rpc');

const cst = require('./constants.js');
const WatchDog = require('./WatchDog');
const Utility = require('./Utility.js');
const pkg = require('../../package.json');

const domain = require('domain'); // eslint-disable-line

const OMNITRONClient = require('./PM2Client.js');
const InteractorClient = require('./InteractorClient');
const PushInteractor = require('./push/PushInteractor.js');
const TransporterInterface = require('./TransporterInterface.js');
const ReverseInteractor = require('./reverse/ReverseInteractor.js');

global._logs = false;

const InteractorDaemon = (module.exports = class InteractorDaemon {
  constructor() {
    this.opts = this.retrieveConf();

    this.DAEMON_ACTIVE = false;
    this.transport = new TransporterInterface(this.opts, this).bind('websocket');
    this.transport.on('error', (err) => console.error('[NETWORK] Error : ' + err.message || err));
    this.httpClient = new Utility.HTTPClient();
    this._online = true;

    if (cst.IS_BUN === false) this._internalDebugger();
  }

  /**
   * Use process.send() if connected
   * @param {Object} data
   */
  sendToParent(data) {
    if (!process.connected || !process.send || cst.IS_BUN == true) return console.log('Could not send data to parent');

    try {
      process.send(data);
    } catch (e) {
      console.trace('Parent process disconnected');
    }
  }

  /**
   * Get an interface for communicating with OMNITRON daemon
   * @private
   * @return {OMNITRONClient}
   */
  getOMNITRONClient() {
    if (!this._iomnitron) {
      this._iomnitron = new OMNITRONClient();
    }
    return this._iomnitron;
  }

  /**
   * Terminate aconnections and exit
   * @param {cb} callback called at the end
   */
  exit(err, cb) {
    // clear workers
    if (this._workerEndpoint) clearInterval(this._workerEndpoint);

    // stop interactors
    if (this.reverse) this.reverse.stop();
    if (this.push) this.push.stop();

    if (this._iomnitron) this._iomnitron.disconnect();
    if (this.watchDog) this.watchDog.stop();
    // stop transport
    if (this.transport) this.transport.disconnect();

    if (!err) {
      try {
        fs.unlinkSync(cst.INTERACTOR_RPC_PORT);
        fs.unlinkSync(cst.INTERACTOR_PID_PATH);
      } catch (err) { }
    }

    if (!this._rpc || !this._rpc.sock) {
      return process.exit(cst.ERROR_EXIT);
    }

    if (typeof cb === 'function') {
      cb();
    }

    setTimeout(() => {
      this._rpc.sock.close(() => {
        process.exit(err ? cst.ERROR_EXIT : cst.SUCCESS_EXIT);
      });
    }, 10);
  }

  /**
   * Start a RPC server and expose it throught a socket file
   */
  startRPC(opts) {
    const rep = axon.socket('rep');
    const rpcServer = new rpc.Server(rep);
    const self = this;
    rep.bind(cst.INTERACTOR_RPC_PORT);

    rpcServer.expose({
      kill(cb) {
        return self.exit(null, cb);
      },
      getInfos(cb) {
        if (self.opts && self.DAEMON_ACTIVE === true) {
          return cb(null, {
            machine_name: self.opts.MACHINE_NAME,
            public_key: self.opts.PUBLIC_KEY,
            secret_key: self.opts.SECRET_KEY,
            remote_host: self.km_data.endpoints.web,
            connected: self.transport.isConnected(),
            transporters: self.transport.getActiveTransporters(),
            socket_path: cst.INTERACTOR_RPC_PORT,
            omnitron_home_monitored: cst.OMNITRON_HOME,
          });
        } else {
          return cb(null);
        }
      },
    });
    return rpcServer;
  }

  /**
   * Handle specific signals to launch memory / cpu profiling
   * if available in node
   */
  _internalDebugger() {
    // inspector isn't available under node 8
    if (semver.satisfies(process.version, '<8')) return;

    const inspector = require('inspector');
    const state = {
      heap: false,
      cpu: false,
      session: null,
    };
    const commands = {
      heap: {
        start: 'HeapProfiler.startSampling',
        stop: 'HeapProfiler.stopSampling',
      },
      cpu: {
        start: 'Profiler.start',
        stop: 'Profiler.stop',
      },
    };

    const handleSignal = (type) => (_) => {
      if (state.session === null) {
        state.session = new inspector.Session();
        state.session.connect();
      }

      const isAlreadyEnabled = state[type];
      const debuggerCommands = commands[type];
      const profilerDomain = type === 'cpu' ? 'Profiler' : 'HeapProfiler';
      const fileExt = type === 'heap' ? '.heapprofile' : '.cpuprofile';

      if (isAlreadyEnabled) {
        // stopping the profiling and writting it to disk if its running
        console.log(`[DEBUG] Stopping ${type.toUpperCase()} Profiling`);
        state.session.post(debuggerCommands.stop, (err, data) => {
          const profile = data.profile;
          if (err) return console.error(err);
          const randomId = Math.random().toString(36);
          const profilePath = path.resolve(os.tmpdir(), `${type}-${randomId}${fileExt}`);

          fs.writeFileSync(profilePath, JSON.stringify(profile));
          console.log(`[DEBUG] Writing file in ${profilePath}`);
          state[type] = false;
          state.session.post(`${profilerDomain}.disable`);
        });
      } else {
        // start the profiling otherwise
        console.log(`[DEBUG] Starting ${type.toUpperCase()} Profiling`);
        state.session.post(`${profilerDomain}.enable`, (_) => {
          state.session.post(debuggerCommands.start);
          state[type] = true;
        });
      }
    };

    // use hook
    process.on('SIGUSR1', handleSignal('cpu'));
    process.on('SIGUSR2', handleSignal('heap'));
  }

  /**
   * Retrieve metadata about the system
   */
  getSystemMetadata() {
    return {
      MACHINE_NAME: this.opts.MACHINE_NAME,
      PUBLIC_KEY: this.opts.PUBLIC_KEY,
      RECYCLE: this.opts.RECYCLE || false,
      OMNITRON_VERSION: process.env.OMNITRON_VERSION,
      MEMORY: os.totalmem() / 1000 / 1000,
      HOSTNAME: os.hostname(),
      CPUS: os.cpus(),
    };
  }

  /**
   * Ping root url to retrieve node info
   * @private
   * @param {Function} cb invoked with <Error, Object> where Object is the response sended by the server
   */
  _pingRoot(cb) {
    const data = this.getSystemMetadata();

    this.httpClient.open(
      {
        url: this.opts.ROOT_URL + '/api/node/verifyOMNITRON',
        method: 'POST',
        data: {
          public_id: this.opts.PUBLIC_KEY,
          private_id: this.opts.SECRET_KEY,
          data,
        },
        headers: {
          'User-Agent': `OMNITRON Agent v${pkg.version}`,
        },
      },
      cb
    );
  }

  /**
   * Ping root to verify retrieve and connect to the km endpoint
   * @private
   * @param {Function} cb invoked with <Error, Boolean>
   */
  _verifyEndpoint(cb) {
    if (typeof cb !== 'function') cb = function () { };

    this._pingRoot((err, data) => {
      if (err) {
        return cb(err);
      }

      this.km_data = data;

      // Verify data integrity
      if (data.disabled === true || data.pending === true) {
        return cb(
          new Error(
            'Connection refused, you might have hit the limit of agents you can connect (send email at contact@keymetrics.io for more infos)'
          )
        );
      }
      if (data.active === false) {
        return cb(null, data);
      }
      if (!data.endpoints) {
        return cb(new Error(`Endpoints field not present (${JSON.stringify(data)})`));
      }

      this.DAEMON_ACTIVE = true;
      this.transport.connect(data.endpoints, cb);
    });
  }

  /**
   * Retrieve configuration from environnement
   */
  retrieveConf() {
    let opts = {};

    opts.MACHINE_NAME = process.env.OMNITRON_MACHINE_NAME;
    opts.PUBLIC_KEY = process.env.OMNITRON_PUBLIC_KEY;
    opts.OMNITRON_BINARY_PATH = process.env.OMNITRON_BINARY_PATH;
    opts.SECRET_KEY = process.env.OMNITRON_SECRET_KEY;
    opts.RECYCLE = process.env.KM_RECYCLE ? JSON.parse(process.env.KM_RECYCLE) : false;
    opts.OMNITRON_VERSION = process.env.OMNITRON_VERSION || '0.0.0';
    opts.AGENT_TRANSPORT_WEBSOCKET = process.env.AGENT_TRANSPORT_WEBSOCKET;
    opts.internal_ip = Utility.network.v4;

    opts.OMNITRON_REMOTE_METHOD_ALLOWED = [
      'restart',
      'reload',
      'reset',
      'scale',
      'startLogging',
      'stopLogging',
      'ping',
      'launchSysMonitoring',
    ];

    if (!opts.MACHINE_NAME) {
      console.error('You must provide a OMNITRON_MACHINE_NAME environment variable');
      process.exit(cst.ERROR_EXIT);
    } else if (!opts.PUBLIC_KEY) {
      console.error('You must provide a OMNITRON_PUBLIC_KEY environment variable');
      process.exit(cst.ERROR_EXIT);
    } else if (!opts.SECRET_KEY) {
      console.error('You must provide a OMNITRON_SECRET_KEY environment variable');
      process.exit(cst.ERROR_EXIT);
    }
    return opts;
  }

  /**
   * Ping root url to retrieve node info
   * @private
   * @param {Function} cb invoked with <Error> [optional]
   */
  start(cb) {
    let retries = 0;
    this._rpc = this.startRPC();
    this.opts.ROOT_URL = cst.KEYMETRICS_ROOT_URL;

    const verifyEndpointCallback = (err, result) => {
      if (err) {
        if (retries++ < 30 && process.env.NODE_ENV !== 'test') {
          return setTimeout((_) => this._verifyEndpoint(verifyEndpointCallback), 200 * retries);
        }
        this.sendToParent({ error: true, msg: err.message || err });
        return this.exit(new Error('Error retrieving endpoints'));
      }
      if (result === false) {
        return this.exit(new Error('Error retrieving endpoints'));
      }

      // send data over IPC for CLI feedback
      this.sendToParent({
        error: false,
        km_data: this.km_data,
        online: true,
        pid: process.pid,
        machine_name: this.opts.MACHINE_NAME,
        public_key: this.opts.PUBLIC_KEY,
        secret_key: this.opts.SECRET_KEY,
        reverse_interaction: this.opts.REVERSE_INTERACT,
      });

      if (result && typeof result === 'object' && result.error === true && result.active === false) {
        return this.exit(new Error(`Error when connecting: ${result.msg}`));
      }

      // start workers
      this._workerEndpoint = setInterval(
        this._verifyEndpoint.bind(this, (err, result) => {
          if (err) return;
          // We need to exit agent if bucket is disabled (trialing)
          if (result && typeof result === 'object' && result.error === true && result.active === false) {
            return this.transport.disconnect();
          }
        }),
        60000
      );
      // start interactors
      this.watchDog = WatchDog;

      setTimeout(() => {
        this.watchDog.start({
          omnitron_binary_path: this.opts.OMNITRON_BINARY_PATH,
          conf: {
            iomnitron: this.getOMNITRONClient(),
          },
        });
      }, 30 * 1000);

      this.push = new PushInteractor(this.opts, this.getOMNITRONClient(), this.transport);
      this.reverse = new ReverseInteractor(this.opts, this.getOMNITRONClient(), this.transport);
      this.push.start();
      this.reverse.start();
      if (cb) {
        setTimeout(cb, 20);
      }
    };
    return this._verifyEndpoint(verifyEndpointCallback);
  }
});

// If its the entry file launch the daemon
// otherwise we just required it to use a function
if (require.main === module) {
  const d = domain.create();
  let daemon = null;

  d.on('error', function (err) {
    console.error('-- FATAL EXCEPTION happened --');
    console.error(new Date());
    console.error(err.stack);
    console.log('Re-initiating Agent');

    InteractorClient.getOrSetConf(cst, null, (err, infos) => {
      if (err || !infos) {
        if (err) {
          console.error('[OMNITRON Agent] Failed to rescue agent :');
          console.error(err || new Error(`Cannot find configuration to connect to backend`));
          return process.exit(1);
        }
      }
      console.log(
        `[OMNITRON Agent] Using (Public key: ${infos.public_key}) (Private key: ${infos.secret_key}) (Info node: ${infos.info_node})`
      );

      // Exit anyway the errored agent
      var timeout = setTimeout((_) => {
        console.error('Daemonization of failsafe agent did not worked');
        daemon.exit(err);
      }, 2000);

      InteractorClient.daemonize(cst, infos, (err) => {
        clearTimeout(timeout);
        daemon.exit(err);
      });
    });
  });

  d.run((_) => {
    daemon = new InteractorDaemon();

    process.title = `OMNITRON Agent v${pkg.version}: (${cst.OMNITRON_HOME})`;

    daemon.start();
  });
}
