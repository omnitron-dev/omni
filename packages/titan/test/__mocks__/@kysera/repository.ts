/**
 * Mock for @kysera/repository package
 */

export function repository(config: any) {
  return function (target: any) {
    return target;
  };
}

export class BaseRepository {
  constructor(protected db: any, protected config: any) {}
}
