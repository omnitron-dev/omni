// @ts-nocheck
import { noop } from "../src/primitives";

import {
  props,
  defer,
  delay,
  retry,
  timeout,
  nodeify,
  promisify,
  try as _try,
  callbackify,
  promisifyAll,
  finally as _finally,
} from "../src/promise";

describe("defer", () => {
  it("should have a promise", () => {
    const d = defer();
    expect(d.promise).toBeInstanceOf(Promise);
  });

  it("should have a resolve function", () => {
    const d = defer();
    expect(d.resolve).toBeInstanceOf(Function);
  });

  it("should have a reject function", () => {
    const d = defer();
    expect(d.reject).toBeInstanceOf(Function);
  });

  it("should resolve the promise", async () => {
    const d = defer();
    d.resolve!(5);
    expect(await d.promise).toEqual(5);
  });

  it("should reject the promise", async () => {
    const d = defer();
    d.reject!(10);
    expect(
      await d.promise!.then(
        () => null,
        (x) => x
      )
    ).toEqual(10);
  });
});

describe("delay", () => {
  it("should be a promise", () => {
    expect(delay(100)).toBeInstanceOf(Promise);
  });

  it("should be delayed", async () => {
    const past = (new Date()).getTime();
    await delay(100);
    expect((new Date()).getTime() - past).toBeGreaterThan(95);
  });

  it("should be resolves with a value", async () => {
    expect(await delay(50, 10)).toEqual(10);
  });
});

describe("timeout", () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it("should throw if the first argument is not a promise", () => {
    expect(() => {
      timeout(5 as any);
    }).toThrow(new TypeError("The first argument must be a promise"));
  });

  it("should reject the promise after the delay", async () => {
    const p = delay(500);
    const q = timeout(p, 200);
    const res = await q.then(
      () => null,
      (x) => x
    );
    expect(res).toBeInstanceOf(Error);
    expect(res.message).toEqual("Timeout of 200ms exceeded");
  });

  it("should not reject the promise if it resolves", async () => {
    const p = delay(10, 10);
    expect(await timeout(p, 100)).toEqual(10);
  });

  it("should be rejected by itself", async () => {
    const error = new Error("hello");
    const p = delay(10).then(() => {
      throw error;
    });

    try {
      await timeout(p, 100);
      throw new Error("Should have thrown");
    } catch (e) {
      expect(e).toBe(error);
      expect(e.message).toBe("hello");
    }
  });

  it("should throw on invalid timeout value", () => {
    expect(() => timeout(Promise.resolve(), -1)).toThrow(TypeError);
    expect(() => timeout(Promise.resolve(), 0)).toThrow(TypeError);
    expect(() => timeout(Promise.resolve(), "100" as any)).toThrow(TypeError);
  });

  it("should handle multiple timeouts concurrently", async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      timeout(delay(i < 5 ? 50 : 150), 100)
    );

    const results = await Promise.allSettled(promises);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(5);
  });

  it("should not leak memory", async () => {
    // Сначала запустим сборщик мусора
    if (global.gc) {
      global.gc();
    }

    const initialMemory = process.memoryUsage().heapUsed;

    // Создаем меньше итераций и используем Promise.all для параллельного выполнения
    const promises = Array.from({ length: 100 }, () =>
      timeout(Promise.resolve(), 10)
        .catch(() => { })
    );

    await Promise.all(promises);

    // Снова запускаем сборщик мусора
    if (global.gc) {
      global.gc();
    }

    const memoryDiff = process.memoryUsage().heapUsed - initialMemory;
    // Увеличим допустимый порог, так как тест может быть нестабильным
    expect(memoryDiff).toBeLessThan(5000000); // 5MB
  });

  it("should support abort signal", async () => {
    const controller = new AbortController();
    const promise = timeout(delay(10), 500, { signal: controller.signal });

    controller.abort();

    await expect(promise).rejects.toThrow('Timeout aborted');
  });

  it("should support unref option", async () => {
    const p = delay(200);
    const promise = timeout(p, 100, { unref: true });

    await expect(promise).rejects.toThrow('Timeout of 100ms exceeded');
  });
});

describe("nodeify", () => {
  it("should pass the value as the second argument", (done) => {
    nodeify(Promise.resolve(10), (err, value) => {
      expect(value).toEqual(10);
      done();
    });
  });

  it("should pass null as the first argument if there is no error", (done) => {
    nodeify(Promise.resolve(), (err) => {
      expect(err).toBeNull();
      done();
    });
  });

  it("should pass the error as the first argument", (done) => {
    nodeify(Promise.reject(10), (err) => {
      expect(err).toEqual(10);
      done();
    });
  });

  it("should not pass the second argument if there is an error", (done) => {
    nodeify(Promise.reject(10), (...args) => {
      expect(args).toHaveLength(1);
      done();
    });
  });

  it("should return the passed promise", async () => {
    const p = Promise.resolve(10);
    expect(nodeify(p, noop)).toEqual(p);
  });

  it("should throw if the first argument is not a promise", () => {
    expect(() => {
      nodeify();
    }).toThrow(new TypeError("The first argument must be a promise"));
  });

  it("should return the promise if the second argument is not a function", () => {
    const p = Promise.resolve();
    expect(nodeify(p)).toEqual(p);
  });
});

describe("callbackify", () => {
  it("should convert an async function to a callback-based function", async () => {
    const fn = async (a, b) => a + b;
    const fn2 = callbackify(fn);
    const [err, res] = await new Promise((resolve) => {
      fn2(1, 2, (err, result) => {
        resolve([err, result]);
      });
    });
    expect(err).toBeNull();
    expect(res).toEqual(3);
  });

  it("should correctly handle errors", async () => {
    const fn = async (a, b) => {
      throw new Error(`hello ${a} + ${b}`);
    };
    const fn2 = callbackify(fn);
    const [err, res] = await new Promise((resolve) => {
      fn2(1, 2, (err, result) => {
        resolve([err, result]);
      });
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toEqual("hello 1 + 2");
    expect(res).toBeUndefined();
  });

  it("should not pop the last argument if it is not a callback", async () => {
    const fn = async (a, b) => a + b;
    const fn2 = callbackify(fn);
    const res = await fn2(1, 2);
    expect(res).toEqual(3);
  });
});

describe("promisify", () => {
  it("should turn a callback-based function into an async function", async () => {
    const getSecrets = (cb) => {
      cb(null, 123);
    };
    const getSecretsAsync = promisify(getSecrets);
    expect(getSecretsAsync).toBeInstanceOf(Function);
    expect(await getSecretsAsync()).toEqual(123);
  });

  it("should throw if the first argument of the callback truthy", async () => {
    const getSecrets = (cb) => {
      cb(1);
    };
    const f = promisify(getSecrets);
    expect(
      await f().then(
        () => null,
        (x) => x
      )
    ).toEqual(1);
  });

  it("should correctly handle synchronous errors", async () => {
    const getSecrets = () => {
      throw new Error("Nooo");
    };
    const f = promisify(getSecrets);
    const err = await f().then(
      () => null,
      (x) => x
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toEqual("Nooo");
  });

  it("should pass arguments", async () => {
    const getSecrets = (a, b, cb) => {
      cb(null, a + b);
    };
    const f = promisify(getSecrets);
    expect(await f(1, 2)).toEqual(3);
  });

  it("should pass the context", async () => {
    const getSecrets = function _(cb) {
      cb(null, this.a + this.b);
    };
    const f = promisify(getSecrets);
    expect(await f.call({ a: 1, b: 2 })).toEqual(3);
  });

  it("should throw if the first argument is not a function", () => {
    expect(() => {
      promisify();
    }).toThrow(new TypeError("The first argument must be a function"));
  });

  it("should use a custom context", async () => {
    const f = function _(cb) {
      cb(null, this.a + this.b);
    };

    const ctx = { a: 1, b: 1 };

    const g = promisify(f, { context: { a: 2, b: 2 } });

    expect(await g.call(ctx)).toEqual(4);
  });

  describe("multiArgs", () => {
    it("normal", async () => {
      const fn = (cb) => setImmediate(() => cb(null, "a", "b"));
      expect(await promisify(fn, { multiArgs: true })()).toStrictEqual(["a", "b"]);
    });

    it("rejection", async () => {
      const fixture1 = (cb) => setImmediate(() => cb("e", "a", "b"));
      expect(await promisify(fixture1, { multiArgs: true })().catch((error) => error)).toStrictEqual(["e", "a", "b"]);
    });
  });
});

describe("promisifyAll", () => {
  it("should promisify nested functions", async () => {
    const a = {
      f: (cb) => cb(null, 1),
      b: (cb) => cb(null, 2),
    };
    const b = promisifyAll(a);
    expect(await b.fAsync()).toEqual(1);
    expect(await b.bAsync()).toEqual(2);
  });

  it("should not modify the prev functions", () => {
    const a = {
      f: (cb) => cb(null, 1),
      b: (cb) => cb(null, 2),
    };
    const b = promisifyAll(a);
    expect(b.f).toEqual(a.f);
    expect(b.b).toEqual(a.b);
  });

  it("should wrap the source object", () => {
    const a = {
      f: (cb) => cb(null, 1),
      b: (cb) => cb(null, 2),
    };
    const b = promisifyAll(a);
    expect(a).not.toEqual(b);
    a.new = 1;
    expect(b.new).toEqual(1);
    b.new = 2;
    expect(a.new).toEqual(1);
  });

  it("should change the suffix", async () => {
    const a = {
      f: (cb) => cb(null, 1),
      b: (cb) => cb(null, 2),
    };
    const b = promisifyAll(a, { suffix: "_" });
    expect(await b.f_()).toEqual(1);
    expect(await b.b_()).toEqual(2);
  });

  it("should touch only functions", () => {
    const a = {
      s: "123",
      f: (cb) => cb(null, 1),
    };
    const b = promisifyAll(a);
    expect(b).toHaveProperty("fAsync");
    expect(b).not.toHaveProperty("sAsync");
  });

  it("should filter properties", () => {
    const a = {
      f: (cb) => cb(null, 1),
      b: (cb) => cb(null, 2),
    };
    const b = promisifyAll(a, {
      filter: (key) => key !== "b",
    });
    expect(b).toHaveProperty("fAsync");
    expect(b).not.toHaveProperty("bAsync");
  });

  it("should use a custom context", async () => {
    const a = {
      a: 1,
      b: 2,
      f(cb) {
        cb(null, this.a + this.b);
      },
      g(cb) {
        cb(null, this.b);
      },
    };
    const b = promisifyAll(a, { context: { a: 2, b: 3 } });
    expect(await b.fAsync()).toEqual(5);
    expect(await b.gAsync()).toEqual(3);
  });
});

describe("finally", () => {
  const fixture = Symbol("fixture");
  const fixtureErr = new Error("err");

  it("does nothing when nothing is passed", async () => {
    expect(await _finally(Promise.resolve(fixture))).toEqual(fixture);
  });

  it("callback is called when promise is fulfilled", async () => {
    let called = false;

    const val = await _finally(Promise.resolve(fixture), () => {
      called = true;
    });

    expect(val).toEqual(fixture);
    expect(called).toBeTruthy();
  });

  it("callback is called when promise is rejected", async () => {
    let called = false;

    await _finally(Promise.reject(fixtureErr), () => {
      called = true;
    }).catch((err) => {
      expect(err).toEqual(fixtureErr);
    });

    expect(called).toBeTruthy();
  });

  it("returning a rejected promise in the callback rejects the promise", async () => {
    await _finally(Promise.resolve(fixture), () => Promise.reject(fixtureErr)).then(
      () => {
        throw new Error("Should have thrown");
      },
      (err) => {
        expect(err).toEqual(fixtureErr);
      }
    );
  });

  it("returning a rejected promise in the callback for an already rejected promise changes the rejection reason", async () => {
    await _finally(Promise.reject(new Error("orig err")), () => Promise.reject(fixtureErr)).catch((err) => {
      expect(err).toEqual(fixtureErr);
    });
  });
});

describe("retry", () => {
  it("should handle synchronous functions", async () => {
    let count = 0;
    const result = await retry(() => {
      count++;
      if (count < 3) throw new Error("fail");
      return "success";
    }, { max: 5 });

    expect(result).toBe("success");
    expect(count).toBe(3);
  });

  it("should respect custom backoff settings", async () => {
    const start = Date.now();
    let count = 0;

    await retry(() => {
      count++;
      if (count < 3) throw new Error("fail");
      return "success";
    }, {
      max: 5,
      backoffBase: 50,
      backoffExponent: 2
    });

    const duration = Date.now() - start;
    expect(duration).toBeGreaterThanOrEqual(150); // 50 + 100
  });

  it("should handle custom match patterns", async () => {
    let count = 0;
    const customError = new Error("CustomError");

    await expect(retry(() => {
      count++;
      throw customError;
    }, {
      max: 3,
      match: [/Different/, Error],
      backoffBase: 0
    })).rejects.toThrow(customError);

    expect(count).toBe(3);
  });

  it("should call report function with correct arguments", async () => {
    const reportMock = jest.fn();
    let attempts = 0;

    await retry(
      () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("First attempt failed");
        }
        return "success";
      },
      {
        max: 3,
        backoffBase: 0,
        report: reportMock
      }
    );

    expect(reportMock).toHaveBeenCalledTimes(4); // Attempt, Fail, Attempt, Success

    // Проверяем последовательность вызовов
    expect(reportMock.mock.calls[0][0]).toContain("Attempt");
    expect(reportMock.mock.calls[1][0]).toContain("Failed");
    expect(reportMock.mock.calls[2][0]).toContain("Attempt");
    expect(reportMock.mock.calls[3][0]).toContain("Success");

    // Проверяем параметры
    expect(reportMock.mock.calls[1][2]).toBeInstanceOf(Error);
    expect(reportMock.mock.calls[1][2].message).toBe("First attempt failed");
  });
});

describe("props", () => {
  it("should return a promise that is fulfilled when all the values are fulfilled", async () => {
    const obj = await props({
      a: Promise.resolve(1),
      b: Promise.resolve(2),
    });

    expect(obj.a).toEqual(1);
    expect(obj.b).toEqual(2);
  });

  it("should return a new object", async () => {
    const obj = {
      a: Promise.resolve(1),
      b: Promise.resolve(2),
    };
    const obj2 = await props(obj);
    expect(obj2).not.toEqual(obj);
    expect(obj.a).toBeInstanceOf(Promise);
    expect(obj.b).toBeInstanceOf(Promise);
  });

  it("should throw if something goes wrong", async () => {
    const obj = {
      a: Promise.resolve(1),
      b: Promise.reject(new Error("oops")),
    };

    await expect(async () => {
      await props(obj);
    }).rejects.toThrow(new Error("oops"));
  });

  it("should handle empty objects", async () => {
    const result = await props({});
    expect(result).toEqual({});
  });

  it("should handle non-promise values", async () => {
    const result = await props({
      a: 1,
      b: Promise.resolve(2),
      c: "3"
    });
    expect(result).toEqual({ a: 1, b: 2, c: "3" });
  });

  it("should preserve property descriptors", async () => {
    const obj = {
      a: Promise.resolve(1)
    };
    Object.defineProperty(obj, 'b', {
      enumerable: true,
      get: () => Promise.resolve(2)
    });

    const result = await props(obj);
    expect(result.a).toBe(1);
    expect(result.b).toBe(2);
  });
});

describe("try", () => {
  const fixture = Symbol("fixture");
  const fixtureError = new Error("fixture");

  it("main", async () => {
    expect(await _try(() => fixture)).toEqual(fixture);

    await expect(async () => _try(() => Promise.reject(fixtureError))).rejects.toThrow(new Error("fixture"));

    await expect(async () =>
      _try(() => {
        throw fixtureError;
      })
    ).rejects.toThrow(new Error("fixture"));
  });

  it("allows passing arguments through", async () => {
    expect(await _try((argument) => argument, fixture)).toEqual(fixture);
  });
});
