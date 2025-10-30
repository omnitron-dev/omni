import type { IService1 } from './service1.js';
import { Method, Service } from '../../../src/decorators/core.js';

export interface IService4 {
  setService(svc: IService1): boolean;
  addNumbers(a: number, b: number): number;
}

@Service('service4')
export class Service4 implements IService4 {
  private iService1: IService1 | null = null;

  @Method()
  setService(svc: IService1): boolean {
    this.iService1 = svc;
    return true;
  }

  @Method()
  addNumbers(a: number, b: number): number {
    return this.iService1?.addNumbers(a, b) ?? 0;
  }
}
