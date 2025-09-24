import { Service2 } from './service2.js';
import { Public, Service } from '../../../src/decorators/core.js';

export interface IService3 {
  getService2(): Service2;
}

@Service('service3')
export class Service3 implements IService3 {
  private service2: Service2 = new Service2();

  @Public()
  getService2(): Service2 {
    return this.service2;
  }
}
