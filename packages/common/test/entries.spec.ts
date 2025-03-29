import { inherits } from 'node:util';

import { keys, noop, values, entries } from '../src';

describe("entries", () => {
  test('should return an empty array for an empty object', () => {
    const props = keys({});
    expect(props).toEqual([]);
  });

  test('should return all properties of the object', () => {
    const props = keys({ a: 1, b: 2, c: 3, d: () => 4, e: { f: 5 } });
    expect(props).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('should work with classic classes', () => {
    function Test() {
      this.a = 2;
    }
    Test.prototype.b = noop;
    const t = new Test();
    const props = keys(t, { followProto: true });
    expect(props.sort()).toEqual(['a', 'b'].sort());
  });

  test('should work with inheritance of classic classes', () => {
    function A() {
      this.aProp = 1;
    }
    A.prototype.aMethod = noop;

    function B() {
      A.call(this);
      this.bProp = 2;
    }
    inherits(B, A);
    B.prototype.bMethod = noop;
    const t = new B();
    const props = keys(t, { followProto: true }).sort();
    expect(props).toStrictEqual(['aMethod', 'aProp', 'bMethod', 'bProp']);
  });

  test('should work with classes', () => {
    class Test {
      public a = 2;
      b() {
        return 3;
      }
    }
    const t = new Test();
    const props = keys(t, { all: true });
    expect(props.sort()).toEqual(['a', 'b'].sort());
  });

  test('should work with class inheritance', () => {
    class A {
      public aProp = 1;

      aMethod() { }
    }

    class B extends A {
      public bProp = 2;

      bMethod() { }
    }

    const t = new B();
    const props = keys(t, { all: true }).sort();
    expect(props).toStrictEqual(['aMethod', 'aProp', 'bMethod', 'bProp']);
  });

  test('should return the values of the object', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const values = Object.values(obj);
    expect(values).toEqual([1, 2, 3]);
  });

  test('should return the entries of the object', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const entries = Object.entries(obj);
    expect(entries).toEqual([['a', 1], ['b', 2], ['c', 3]]);
  });

  test('should return only enumerable own properties', () => {
    const obj = Object.create({ inherited: 1 });
    obj.a = 2;
    obj.b = 3;
    const props = keys(obj, { enumOnly: true, followProto: false });
    expect(props).toEqual(['a', 'b']);
  });

  test('should return all own properties including non-enumerable', () => {
    const obj = Object.create({ inherited: 1 });
    Object.defineProperty(obj, 'a', { value: 2, enumerable: false });
    obj.b = 3;
    const props = keys(obj, { enumOnly: false, followProto: false });
    expect(props).toEqual(['a', 'b']);
  });

  test('should return enumerable properties including inherited ones', () => {
    const obj = Object.create({ inherited: 1 });
    obj.a = 2;
    obj.b = 3;
    const props = keys(obj, { enumOnly: true, followProto: true });
    expect(props).toEqual(['inherited', 'a', 'b']);
  });

  test('should return all properties including non-enumerable and inherited ones', () => {
    const obj = Object.create({ inherited: 1 });
    Object.defineProperty(obj, 'a', { value: 2, enumerable: false });
    obj.b = 3;
    const props = keys(obj, { enumOnly: false, followProto: true });
    expect(props).toEqual(['inherited', 'a', 'b']);
  });

  test('should return all properties when "all" option is true', () => {
    const obj = Object.create({ inherited: 1 });
    Object.defineProperty(obj, 'a', { value: 2, enumerable: false });
    obj.b = 3;
    const props = keys(obj, { all: true });
    expect(props).toEqual(['inherited', 'a', 'b']);
  });

  test('values should return empty array for null/undefined', () => {
    expect(values(null)).toEqual([]);
    expect(values(undefined)).toEqual([]);
  });

  test('values should work with non-enumerable properties', () => {
    const obj = {};
    Object.defineProperty(obj, 'a', { value: 1, enumerable: false });
    obj.b = 2;
    expect(values(obj, { enumOnly: false })).toEqual([1, 2]);
  });

  test('values should work with inherited properties', () => {
    const parent = { a: 1 };
    const obj = Object.create(parent);
    obj.b = 2;
    expect(values(obj, { followProto: true })).toEqual([1, 2]);
  });

  test('values should work with all option', () => {
    const parent = { a: 1 };
    const obj = Object.create(parent);
    Object.defineProperty(obj, 'b', { value: 2, enumerable: false });
    obj.c = 3;
    expect(values(obj, { all: true })).toEqual([1, 2, 3]);
  });

  test('entries should return empty array for null/undefined', () => {
    expect(entries(null)).toEqual([]);
    expect(entries(undefined)).toEqual([]);
  });

  test('entries should work with non-enumerable properties', () => {
    const obj = {};
    Object.defineProperty(obj, 'a', { value: 1, enumerable: false });
    obj.b = 2;
    expect(entries(obj, { enumOnly: false })).toEqual([['a', 1], ['b', 2]]);
  });

  test('entries should work with inherited properties', () => {
    const parent = { a: 1 };
    const obj = Object.create(parent);
    obj.b = 2;
    expect(entries(obj, { followProto: true })).toEqual([['a', 1], ['b', 2]]);
  });

  test('entries should work with all option', () => {
    const parent = { a: 1 };
    const obj = Object.create(parent);
    Object.defineProperty(obj, 'b', { value: 2, enumerable: false });
    obj.c = 3;
    expect(entries(obj, { all: true })).toEqual([['a', 1], ['b', 2], ['c', 3]]);
  });
});
