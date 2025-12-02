/**
 * Mock for @kysera/soft-delete package
 */

export function withSoftDelete(config?: any) {
  return function (target: any) {
    return target;
  };
}

export class SoftDeletePlugin {
  constructor(private options: any = {}) {}

  transformQuery(args: any) {
    return args.node;
  }

  async transformResult(args: any) {
    return args;
  }
}
