import { omit } from "../src";

describe("omit", () => {
  it("should omit a key from the object", () => {
    expect(omit({ a: "a", b: "b", c: "c" }, "a")).toEqual({ b: "b", c: "c" });
    expect(omit({ aaa: "a", bbb: "b", ccc: "c" }, "aaa")).toEqual({
      bbb: "b",
      ccc: "c",
    });
  });

  it("should omit an array of keys from the object", () => {
    expect(omit({ a: "a", b: "b", c: "c" }, ["a", "c"])).toEqual({ b: "b" });
  });

  it("should return the object if no keys are given", () => {
    expect(omit({ a: "a", b: "b", c: "c" })).toEqual({
      a: "a",
      b: "b",
      c: "c",
    });
  });

  it("should return a new object when no keys are given", () => {
    const obj = { a: "a", b: "b", c: "c" };
    expect(omit(obj) !== obj).toBeTruthy();
  });

  it("should omit using a filter function", () => {
    const obj = { a: "a", b: "b", c: "c" };

    // Проверяем все варианты аргументов предиката
    const withOneArg = omit(obj, (key: string) => key === "a");
    const withTwoArgs = omit(obj, (key: string, val: string) => val === "b");
    const withThreeArgs = omit(obj, (key: string, val: string, o: typeof obj) => o === obj && key === "c");

    expect(withOneArg).toEqual({ b: "b", c: "c" });
    expect(withTwoArgs).toEqual({ a: "a", c: "c" });
    expect(withThreeArgs).toEqual({ a: "a", b: "b" });
  });

  it("should return an empty object if the first arg is not an object", () => {
    expect(omit(null, { a: "a", b: "b", c: "c" })).toEqual({});
  });

  it("should return an empty object if no object is specified", () => {
    expect(omit()).toEqual({});
  });

  it("should omit all items", () => {
    expect(
      omit(
        {
          __dirname: false,
          __filename: false,
          Buffer: false,
          clearImmediate: false,
          clearInterval: false,
          clearTimeout: false,
          console: false,
          exports: true,
          global: false,
          Intl: false,
          module: false,
          process: false,
          require: false,
          setImmediate: false,
          setInterval: false,
          setTimeout: false,
        },
        ["exports", "__dirname", "__filename", "module", "require"]
      )
    ).toEqual({
      Buffer: false,
      clearImmediate: false,
      clearInterval: false,
      clearTimeout: false,
      console: false,
      global: false,
      Intl: false,
      process: false,
      setImmediate: false,
      setInterval: false,
      setTimeout: false,
    });
  });

  it("should return really empty object for props=true", () => {
    class A {
      constructor(public sec: any) { }
    }

    expect(omit(A, true)).toEqual({});
  });

  it("not omitted properties should have same descriptors", () => {
    class A {
      static prop1 = 12;

      constructor(public sec: any) { }
    }

    const originalDescrs: any[] = [];
    const resultDescrs: any[] = [];

    const keys_ = Object.keys(omit(A, ["a"]));


    for (const key of keys_) {
      if (key !== "name") {
        originalDescrs.push(Object.getOwnPropertyDescriptor(A, key));
      }
    }

    const result = omit(A, ["name"]);

    for (const key of Object.keys(result)) {
      resultDescrs.push(Object.getOwnPropertyDescriptor(result, key));
    }

    expect(resultDescrs).toEqual(originalDescrs);
  });

  it("should throw error for invalid options type", () => {
    expect(() => omit({ a: 1 }, {})).toThrow("Invalid options type");
    expect(() => omit({ a: 1 }, 42)).toThrow("Invalid options type");
  });

  it("should work with empty array of keys", () => {
    const obj = { a: 1, b: 2 };
    expect(omit(obj, [])).toEqual(obj);
  });

  it("should work with empty string key", () => {
    const obj = { "": 1, b: 2 };
    expect(omit(obj, "")).toEqual({ b: 2 });
  });

  it("should preserve property descriptors including getters and setters", () => {
    const obj = {};
    let value = 1;

    Object.defineProperty(obj, 'a', {
      get() { return value; },
      set(v) { value = v; },
      enumerable: true,
      configurable: true
    });

    Object.defineProperty(obj, 'b', {
      value: 2,
      writable: false,
      enumerable: true
    });

    const result = omit(obj, ['c']); // не омитаем ничего

    const aDescriptor = Object.getOwnPropertyDescriptor(result, 'a');
    const bDescriptor = Object.getOwnPropertyDescriptor(result, 'b');

    expect(aDescriptor?.get).toBeDefined();
    expect(aDescriptor?.set).toBeDefined();
    expect(bDescriptor?.writable).toBe(false);
    expect(bDescriptor?.value).toBe(2);
  });

  it("should work with non-enumerable properties", () => {
    const obj = {};
    Object.defineProperty(obj, 'a', {
      value: 1,
      enumerable: false
    });
    Object.defineProperty(obj, 'b', {
      value: 2,
      enumerable: true
    });

    const result = omit(obj, ['a']);
    expect(Object.keys(result)).toEqual(['b']);
  });

  it("should handle function predicate with all arguments", () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = omit(obj, (key: string, value: number, object: typeof obj) => key === 'a' || value === 2 || object === obj);
    expect(result).toEqual({});
  });

  it("should work with inherited properties", () => {
    const parent = { a: 1, b: 2 };
    const child = Object.create(parent);
    child.c = 3;

    expect(omit(child, ['b', 'c'])).toEqual({});
  });

  it("should handle undefined in array of keys", () => {
    const obj = { a: 1, b: 2, undefined: 3 };
    expect(omit(obj, ['a'])).toEqual({ b: 2, undefined: 3 });
  });

  it("should handle null in array of keys", () => {
    const obj = { a: 1, b: 2, null: 3 };
    expect(omit(obj, ['a', null])).toEqual({ b: 2, null: 3 });
  });

  it("should handle function predicate with partial arguments", () => {
    const obj = { a: 1, b: 2 };
    const result = omit(obj, (key: string) => key === 'a'); // использует только key
    expect(result).toEqual({ b: 2 });
  });

  it("should handle Symbol keys", () => {
    const sym = Symbol('test');
    const obj = { [sym]: 1, b: 2 };
    expect(omit(obj, [sym])).toEqual({ b: 2 });
  });

  it("should handle nested objects", () => {
    const obj = { a: { b: 1 }, c: 2 };
    expect(omit(obj, ['a'])).toEqual({ c: 2 });
  });

  it("should handle arrays as values", () => {
    const obj = { a: [1, 2], b: 3 };
    expect(omit(obj, ['a'])).toEqual({ b: 3 });
  });

  it("should handle RegExp pattern", () => {
    const obj = {
      test1: 1,
      test2: 2,
      other: 3
    };
    expect(omit(obj, /^test/)).toEqual({ other: 3 });
  });

  it("should handle dot notation paths", () => {
    const obj = {
      a: {
        b: {
          c: 1,
          d: 2
        },
        e: 3
      },
      f: 4
    };

    const result = omit(obj, 'a.b.c', { path: true });
    expect(result).toEqual({
      a: {
        b: {
          d: 2
        },
        e: 3
      },
      f: 4
    });
  });

  it("should handle deep omit", () => {
    const obj = {
      a: {
        b: {
          c: 1,
          d: 2
        },
        e: 3
      },
      f: 4
    };

    const result = omit(obj, ['c'], { deep: true });
    expect(result).toEqual({
      a: {
        b: {
          d: 2
        },
        e: 3
      },
      f: 4
    });
  });

  it("should maintain performance with large objects", () => {
    const largeObj = {};
    for (let i = 0; i < 10000; i++) {
      largeObj[`key${i}`] = i;
    }

    const start = performance.now();
    omit(largeObj, ['key1', 'key2']);
    const end = performance.now();

    expect(end - start).toBeLessThan(50); // должно выполняться менее чем за 50мс
  });

  it("should handle combination of options", () => {
    const obj = {
      a: {
        test1: 1,
        test2: 2,
        other: {
          test3: 3
        }
      },
      b: {
        test4: 4
      }
    };

    const result = omit(obj, /^test/, { deep: true });
    expect(result).toEqual({
      a: {
        other: {}
      },
      b: {}
    });
  });

  it("should preserve descriptors in nested objects", () => {
    const obj = {
      a: {
        get b() { return 1; },
        c: 2
      }
    };

    const result = omit(obj, ['c'], { deep: true });
    const descriptor = Object.getOwnPropertyDescriptor(result.a, 'b');

    expect(descriptor?.get).toBeDefined();
  });

  it("should be fast with large arrays of keys", () => {
    const obj = {};
    const keys = [];

    for (let i = 0; i < 10000; i++) {
      obj[`key${i}`] = i;
      if (i % 2 === 0) {
        keys.push(`key${i}`);
      }
    }

    const start = performance.now();
    omit(obj, keys);
    const end = performance.now();

    expect(end - start).toBeLessThan(50);
  });

  it("should handle multiple dot notation paths", () => {
    const obj = {
      a: {
        b: {
          c: 1,
          d: 2
        },
        e: 3
      },
      f: 4
    };

    const result = omit(obj, ['a.b.c', 'f'], { path: true });
    expect(result).toEqual({
      a: {
        b: {
          d: 2
        },
        e: 3
      }
    });
  });

  it("should handle dot notation with non-existent paths", () => {
    const obj = {
      a: {
        b: 1
      }
    };

    const result = omit(obj, 'a.c.d', { path: true });
    expect(result).toEqual(obj);
  });

  it("should handle dot notation with array values", () => {
    const obj = {
      a: {
        b: [1, 2, 3],
        c: 4
      }
    };

    const result = omit(obj, 'a.b', { path: true });
    expect(result).toEqual({
      a: {
        c: 4
      }
    });
  });
});
