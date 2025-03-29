const child = require('child_process');

const RECONNECT_TENTATIVES_BEFORE_RESURRECT = 6;

process.env.OMNITRON_AGENT_ONLINE = true;

module.exports = class WatchDog {
  static start(p) {
    this.omnitron_binary_path = p.omnitron_binary_path;
    this.iomnitron = p.conf.iomnitron;
    this.relaunching = false;
    this.autoDumpTime = 5 * 60 * 1000;

    /**
     * Handle OMNITRON connection state changes
     */
    this.iomnitron.on('ready', (_) => {
      this.relaunching = false;
      this.autoDump();
    });

    this.reconnect_tentatives = 0;

    this.iomnitron.on('reconnecting', (_) => {
      if (this.dump_interval) {
        clearInterval(this.dump_interval);
      }

      if (this.reconnect_tentatives++ >= RECONNECT_TENTATIVES_BEFORE_RESURRECT && this.relaunching === false) {
        this.relaunching = true;
        this.resurrect();
      }
    });
  }

  static stop() {
    clearInterval(this.dump_interval);
  }

  static resurrect() {
    child.exec(`node ${this.omnitron_binary_path} resurrect`, (err, sto, ste) => {
      if (err) console.error(err);
      console.log(sto, ste);
      this.reconnect_tentatives = 0;
      setTimeout((_) => {
        this.relaunching = false;
      }, 10 * 1000);
    });
  }

  static autoDump() {
    this.dump_interval = setInterval((_) => {
      if (this.relaunching === true) return;

      this.iomnitron.omnitronInterface.dump();
    }, this.autoDumpTime);
  }
};
