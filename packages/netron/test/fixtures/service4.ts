import type { IService1 } from './service1';
import { Public, Service } from '../../src';

export interface IService4 {
  setService(svc: IService1): boolean;
  addNumbers(a: number, b: number): number;
}

@Service('service4')
export class Service4 implements IService4 {
  private iService1: IService1 | null = null;

  @Public()
  setService(svc: IService1): boolean {
    this.iService1 = svc;
    return true;
  }

  @Public()
  addNumbers(a: number, b: number): number {
    return this.iService1?.addNumbers(a, b) ?? 0;
  }
}
