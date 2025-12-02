/**
 * Mock for @kysera/timestamps package
 */

export function withTimestamps(config?: any) {
  return function (target: any) {
    return target;
  };
}

export class TimestampsPlugin {
  constructor(private options: any = {}) {}

  transformQuery(args: any) {
    return args.node;
  }

  async transformResult(args: any) {
    return args;
  }
}
