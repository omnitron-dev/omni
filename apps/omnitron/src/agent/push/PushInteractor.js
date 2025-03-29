const fs = require('fs');
const path = require('path');

const Utility = require('../Utility.js');
const cst = require('../../constants.js');
const DataRetriever = require('./DataRetriever.js');
const Aggregator = require('./TransactionAggregator.js');

/**
 * PushInteractor is the class that handle pushing data to KM
 * @param {Object} opts interactor options
 * @param {OMNITRONClient} iomnitron omnitron daemon client used to listen on bus
 * @param {WebsocketTransport} transport websocket transport used to send data to KM
 */
module.exports = class PushInteractor {
  constructor(opts, iomnitron, transport) {
    this._iomnitron = iomnitron;
    this.transport = transport;
    this.opts = opts;
    this.log_buffer = {};
    this.processes = new Map(); // Key is process name, value is omnitron env
    this.broadcast_logs = new Map(); // key is process name, value is true or false
    this.ip_interval_counter = 60;
    this._cacheFS = new Utility.Cache({
      miss(key) {
        try {
          const content = fs.readFileSync(path.resolve(key));
          return content.toString().split(/\r?\n/);
        } catch (err) {
          return undefined;
        }
      },
      ttl: 60 * 30,
    });
    this._stackParser = new Utility.StackTraceParser({ cache: this._cacheFS, context: cst.CONTEXT_ON_ERROR });
    // // start transaction aggregator
    this.aggregator = new Aggregator(this);
  }

  /**
   * Start the interactor by starting all workers and listeners
   */
  start() {
    // stop old running task
    if (this._worker_executor !== undefined) {
      this.stop();
    }
    this._worker_executor = setInterval(this._worker.bind(this), cst.STATUS_INTERVAL);
    this._iomnitron.bus.on('*', this._onOMNITRONEvent.bind(this));
  }

  /**
   * Stop the interactor by removing all running worker and listeners
   */
  stop() {
    if (this._worker_executor !== undefined) {
      clearInterval(this._worker_executor);
      this._worker_executor = null;
    }
    if (this._cacheFS._worker !== undefined) {
      clearInterval(this._cacheFS._worker);
      this._cacheFS._worker = null;
    }
  }

  /**
   * Listener of omnitron bus
   * @param {String} event channel
   * @param {Object} packet data
   */
  _onOMNITRONEvent(event, packet) {
    if (event === 'axm:action') return false;
    if (!packet.process) return false;

    // Drop transitional state processes (_old_*)
    if (
      packet &&
      packet.process &&
      packet.process.pm_id &&
      typeof packet.process.pm_id === 'string' &&
      packet.process.pm_id.indexOf('_old') > -1
    )
      return false;
    if (this.processes.get(packet.process.name) && this.processes.get(packet.process.name)._km_monitored === false)
      return false;

    // bufferize logs
    if (event.match(/^log:/)) {
      if (!this.log_buffer[packet.process.name]) {
        this.log_buffer[packet.process.name] = [];
      }
      // delete the last one if too long
      if (this.log_buffer[packet.process.name].length >= cst.LOGS_BUFFER) {
        this.log_buffer[packet.process.name].shift();
      }
      // push the log data
      this.log_buffer[packet.process.name].push(packet.data);

      // don't send logs if not enabled
      if (!global._logs && !this.broadcast_logs.get(packet.process.pm_id)) return false;
      // disabled logs anyway
      if (!this.processes.has(packet.process.name) || this.processes.get(packet.process.name).send_logs === false)
        return false;
    }

    // attach additional info for exception
    if (event === 'process:exception' && cst.ENABLE_CONTEXT_ON_ERROR === true) {
      packet.data.last_logs = this.log_buffer[packet.process.name];
      packet.data = this._stackParser.attachContext(packet.data);
    }

    if (
      event === 'axm:reply' &&
      packet.data &&
      packet.data.return &&
      (packet.data.return.heapdump || packet.data.return.cpuprofile || packet.data.return.heapprofile)
    ) {
      return this._sendFile(packet);
    }

    if (event === 'human:event') {
      packet.name = packet.data.__name;
      delete packet.data.__name;
    }

    // Normalize data
    packet.process = {
      pm_id: packet.process.pm_id,
      name: packet.process.name,
      rev:
        packet.process.rev ||
        (packet.process.versioning && packet.process.versioning.revision ? packet.process.versioning.revision : null),
      server: this.opts.MACHINE_NAME,
    };

    // agregate transaction data before sending them
    if (event.indexOf('axm:trace') > -1) return this.aggregator.aggregate(packet);

    if (event.match(/^log:/)) {
      packet.log_type = event.split(':')[1];
      event = 'logs';
    }

    return this.transport.send(event, packet);
  }

  /**
   * Worker function that will retrieve process metadata and send them to KM
   */
  _worker() {
    if (!this._iomnitron.rpc || !this._iomnitron.rpc.getMonitorData) return undefined;

    if (this.ip_interval_counter-- <= 0) {
      this.opts.internal_ip = Utility.network.getIP('v4');
      this.ip_interval_counter = 60;
    }

    this._iomnitron.rpc.getMonitorData({}, (err, processes) => {
      if (err) {
        return console.error(err || 'Cant access to getMonitorData RPC OMNITRON method');
      }

      // set broadcast logs
      processes.forEach((process) => {
        this.processes.set(process.name, process.omnitron_env);
        this.broadcast_logs.set(
          process.pm_id,
          process.omnitron_env.broadcast_logs == 1 || process.omnitron_env.broadcast_logs == 'true'
        );
      });

      processes = processes.filter((process) => process.omnitron_env._km_monitored !== false);

      // send data
      this.transport.send('status', {
        data: DataRetriever.status(processes, this.opts),
        server_name: this.opts.MACHINE_NAME,
        internal_ip: this.opts.internal_ip,
      });
    });
  }

  /**
   * Handle packet containing file metadata to send to KM
   */
  _sendFile(packet) {
    const filePath = JSON.parse(JSON.stringify(packet.data.return.dump_file));
    let type = null;
    if (packet.data.return.heapdump) {
      type = 'heapdump';
    } else if (packet.data.return.heapprofile) {
      type = 'heapprofile';
    } else if (packet.data.return.cpuprofile) {
      type = 'cpuprofile';
    } else {
      return undefined;
    }

    packet = {
      pm_id: packet.process.pm_id,
      name: packet.process.name,
      server_name: this.opts.MACHINE_NAME,
      public_key: this.opts.PUBLIC_KEY,
      type,
    };
    packet[type] = true;

    fs.readFile(filePath, (err, data) => {
      if (err) return undefined;
      fs.unlink(filePath, (_) => undefined);
      packet.data = data.toString('utf-8');
      return this.transport.send('profiling', packet);
    });
  }
};
