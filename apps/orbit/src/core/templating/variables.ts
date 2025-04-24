export class Variables {
  private vars: Record<string, any>;

  constructor(initialVars?: Record<string, any>) {
    this.vars = { ...(initialVars || {}) };
  }

  set(name: string, value: any): void {
    this.vars[name] = value;
  }

  get(name: string): any {
    return this.vars[name];
  }

  merge(newVars: Record<string, any>): void {
    this.vars = { ...this.vars, ...newVars };
  }

  getAll(): Record<string, any> {
    return { ...this.vars };
  }
}