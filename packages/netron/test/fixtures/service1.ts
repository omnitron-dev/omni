import { Public, Service } from '../../src';

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
  @Public()
  public name: string;
  @Public()
  public description: string;
  @Public()
  public data: any;
  @Public({ readonly: true })
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

  @Public()
  public greet(): string {
    return `Hello, ${this.name}!`;
  }

  @Public()
  public echo(value: string): string {
    return value;
  }

  @Public()
  public addNumbers(a: number, b: number): number {
    return this._privateAdd(a, b);
  }

  @Public()
  public concatenateStrings(a: string, b: string): string {
    return this._privateConcatenate(a, b);
  }

  @Public()
  public getBooleanValue(value: boolean): boolean {
    return value;
  }

  @Public()
  public getObjectProperty(obj: { key: string }): string {
    return obj.key;
  }

  @Public()
  public getArrayElement(arr: any[], index: number): any {
    return arr[index];
  }

  @Public()
  public async fetchData(url: string): Promise<any> {
    const response = await fetch(url);
    return response.json();
  }

  @Public()
  public updateData(key: string, value: any): void {
    this._privateUpdateData(key, value);
  }

  @Public()
  public getDataKeys(): string[] {
    return Object.keys(this.data);
  }

  @Public()
  public async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  @Public()
  public async fetchDataWithDelay(url: string, delayMs: number): Promise<any> {
    await this.delay(delayMs);
    return this.fetchData(url);
  }

  @Public()
  public async updateDataWithDelay(key: string, value: any, delayMs: number): Promise<void> {
    await this.delay(delayMs);
    this.updateData(key, value);
  }

  @Public()
  public getStatus(): Status {
    return Status.Active;
  }

  @Public()
  public getPriority(): Priority {
    return Priority.High;
  }

  @Public()
  public getAllStatuses(): Status[] {
    return Object.values(Status);
  }

  @Public()
  public getAllPriorities(): Priority[] {
    return Object.values(Priority).filter((v) => typeof v === 'number') as Priority[];
  }

  @Public()
  public getUndefined(): undefined {
    return undefined;
  }

  @Public()
  public getNull(): null {
    return null;
  }

  @Public()
  public getSymbol(): symbol {
    return Symbol('test');
  }

  @Public()
  public getBigInt(): bigint {
    return BigInt(9007199254740991);
  }

  @Public()
  public getDate(): Date {
    return this._date;
  }

  @Public()
  public getRegExp(): RegExp {
    return /test/i;
  }

  @Public()
  public getMap(): Map<string, number> {
    const map = new Map();
    map.set('one', 1);
    map.set('two', 2);
    return map;
  }

  @Public()
  public getSet(): Set<string> {
    const set = new Set<string>();
    set.add('first');
    set.add('second');
    return set;
  }

  @Public()
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
