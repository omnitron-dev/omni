import { Service1 } from './service1.js';
import { Method, Service } from '../../../src/decorators/core.js';

export interface IService2 {
  name: string;
  getService1(): Service1;
  getNewService1(name?: string, description?: string): Service1;
}

@Service('service2')
export class Service2 implements IService2 {
  private service1: Service1 = new Service1();

  @Method()
  public name: string;

  constructor() {
    this.name = 'Context2';
  }

  @Method()
  getService1(): Service1 {
    return this.service1;
  }

  @Method()
  getNewService1(name?: string, description?: string): Service1 {
    return new Service1(name, description);
  }

  @Method()
  public addNumbers(a: number, b: number): number {
    return a + b;
  }
}
