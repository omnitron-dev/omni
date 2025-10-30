import { Method, Service } from '../../../src/decorators/core.js';

enum Status {
  Active = 'ACTIVE',
  Inactive = 'INACTIVE',
  Pending = 'PENDING',
}

enum Priority {
  Low = 1,
  Medium = 2,
  High = 3,
}

export interface IService1 {
  name: string;
  description: string;
  data: any;
  readonly isActive: boolean;

  greet(): string;
  addNumbers(a: number, b: number): number;
  concatenateStrings(a: string, b: string): string;
  getBooleanValue(value: boolean): boolean;
  getObjectProperty(obj: { key: string }): string;
  getArrayElement(arr: any[], index: number): any;
  fetchData(url: string): Promise<any>;
  updateData(key: string, value: any): void;
  getDataKeys(): string[];
  delay(ms: number): Promise<void>;
  fetchDataWithDelay(url: string, delayMs: number): Promise<any>;
  updateDataWithDelay(key: string, value: any, delayMs: number): Promise<void>;
  getStatus(): Status;
  getPriority(): Priority;
  getAllStatuses(): Status[];
  getAllPriorities(): Priority[];
  getUndefined(): undefined;
  getNull(): null;
  getSymbol(): symbol;
  getBigInt(): bigint;
  getDate(): Date;
  getRegExp(): RegExp;
  getMap(): Map<string, number>;
  getSet(): Set<string>;
  getPromise(): Promise<string>;
  echo(value: string): string;
}

@Service('service1')
export class Service1 implements IService1 {
  @Method()
  public name: string;
  @Method()
  public description: string;
  @Method()
  public data: any;
  @Method({ readonly: true })
  public readonly isActive: boolean;

  private _privateCounter: number;
  private _privateData: any;
  private _date = new Date();

  constructor(name?: string, description?: string) {
    this.name = name ?? 'Context1';
    this.description = description ?? 'This is a test context';
    this.data = {};
    this.isActive = true;
    this._privateCounter = 0;
    this._privateData = {};
  }

  @Method()
  public greet(): string {
    return `Hello, ${this.name}!`;
  }

  @Method()
  public echo(value: string): string {
    return value;
  }

  @Method()
  public addNumbers(a: number, b: number): number {
    return this._privateAdd(a, b);
  }

  @Method()
  public concatenateStrings(a: string, b: string): string {
    return this._privateConcatenate(a, b);
  }

  @Method()
  public getBooleanValue(value: boolean): boolean {
    return value;
  }

  @Method()
  public getObjectProperty(obj: { key: string }): string {
    return obj.key;
  }

  @Method()
  public getArrayElement(arr: any[], index: number): any {
    return arr[index];
  }

  @Method()
  public async fetchData(url: string): Promise<any> {
    const response = await fetch(url);
    return response.json();
  }

  @Method()
  public updateData(key: string, value: any): void {
    this._privateUpdateData(key, value);
  }

  @Method()
  public getDataKeys(): string[] {
    return Object.keys(this.data);
  }

  @Method()
  public async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  @Method()
  public async fetchDataWithDelay(url: string, delayMs: number): Promise<any> {
    await this.delay(delayMs);
    return this.fetchData(url);
  }

  @Method()
  public async updateDataWithDelay(key: string, value: any, delayMs: number): Promise<void> {
    await this.delay(delayMs);
    this.updateData(key, value);
  }

  @Method()
  public getStatus(): Status {
    return Status.Active;
  }

  @Method()
  public getPriority(): Priority {
    return Priority.High;
  }

  @Method()
  public getAllStatuses(): Status[] {
    return Object.values(Status);
  }

  @Method()
  public getAllPriorities(): Priority[] {
    return Object.values(Priority).filter((v) => typeof v === 'number') as Priority[];
  }

  @Method()
  public getUndefined(): undefined {
    return undefined;
  }

  @Method()
  public getNull(): null {
    return null;
  }

  @Method()
  public getSymbol(): symbol {
    return Symbol('test');
  }

  @Method()
  public getBigInt(): bigint {
    return BigInt(9007199254740991);
  }

  @Method()
  public getDate(): Date {
    return this._date;
  }

  @Method()
  public getRegExp(): RegExp {
    return /test/i;
  }

  @Method()
  public getMap(): Map<string, number> {
    const map = new Map();
    map.set('one', 1);
    map.set('two', 2);
    return map;
  }

  @Method()
  public getSet(): Set<string> {
    const set = new Set<string>();
    set.add('first');
    set.add('second');
    return set;
  }

  @Method()
  public getPromise(): Promise<string> {
    return Promise.resolve('resolved');
  }

  private _privateAdd(a: number, b: number): number {
    return a + b;
  }

  private _privateConcatenate(a: string, b: string): string {
    return a + b;
  }

  private _privateUpdateData(key: string, value: any): void {
    this.data[key] = value;
  }
}
