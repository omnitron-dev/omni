import { Service2 } from './service2';
import { Public, Service } from '../../dist';

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
