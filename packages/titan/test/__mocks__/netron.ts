export class Netron {
  id: string;
  options: any;
  private _started = false;

  constructor(options: any = {}) {
    this.options = options;
    this.id = options.id || 'test-netron';
  }

  async start() {
    this._started = true;
    return Promise.resolve();
  }

  async stop() {
    this._started = false;
    return Promise.resolve();
  }

  get isStarted() {
    return this._started;
  }
}

export type NetronOptions = {
  id?: string;
  port?: number;
  host?: string;
  logger?: any;
  [key: string]: any;
};
