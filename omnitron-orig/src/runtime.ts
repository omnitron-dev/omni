import { Netron } from '@devgrid/netron';

export class Runtime {
  static instance: Runtime | null = null;

  private netron: Netron | null = null;
  private config = new Map<string, any>();

  private constructor() { }

  getNetron(options?: Record<string, unknown>): Netron {
    if (this.netron === null) {
      this.netron = new Netron(options);
    }
    return this.netron;
  }

  set(key: string, value: any): void {
    this.config.set(key, value);
  }

  get(key: string): any {
    return this.config.get(key);
  }

  static get() {
    if (Runtime.instance === null) {
      Runtime.instance = new Runtime();
    }
    return Runtime.instance;
  }
}
