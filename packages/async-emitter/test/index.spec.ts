import { AsyncEventEmitter, isAsyncEventEmitter } from "../src";

describe("AsyncEventEmitter", () => {
  it("isEmitter() should return true", () => {
    const emitter = new AsyncEventEmitter();
    expect(isAsyncEventEmitter(emitter)).toBeTruthy();
  });

  describe("emitParallel()", () => {
    it("should receive the return value of listeners asynchronously", async () => {
      const emitter = new AsyncEventEmitter();
      emitter.on("foo", (action) => action);
      emitter.on(
        "foo",
        (action) =>
          new Promise((resolve) => {
            setTimeout(() => resolve(action));
          })
      );

      const values = await emitter.emitParallel("foo", "bar");
      expect(values.length).toEqual(2);
      expect(values[0]).toEqual("bar");
      expect(values[1]).toEqual("bar");
    });

    it("if an error occurs, it should throw an error only the first one", async () => {
      const emitter = new AsyncEventEmitter();
      emitter.on("foo", (action) => action);
      emitter.on(
        "foo",
        () =>
          new Promise(() => {
            throw new Error("beep");
          })
      );
      emitter.on("foo", () => Promise.reject(new Error("boop")));

      try {
        await emitter.emitParallel("foo", "bar");
      } catch (err: any) {
        expect(err.message).toEqual("beep");
      }
    });

    it("if the promise was rejected, it should throw only the first of the reject", async () => {
      const emitter = new AsyncEventEmitter();
      emitter.on("foo", (action) => action);
      emitter.on("foo", () => Promise.reject(new Error("boop")));
      emitter.on(
        "foo",
        () =>
          new Promise(() => {
            throw new Error("beep");
          })
      );

      try {
        await emitter.emitParallel("foo", "bar");
      } catch (err: any) {
        expect(err.message).toEqual("boop");
      }
    });

    it("if throws error, it should be handled as reject", async () => {
      const emitter = new AsyncEventEmitter();
      emitter.on("foo", (action) => action);
      emitter.on("foo", () => {
        throw new Error("boop");
      });
      emitter.on("foo", () => Promise.reject(new Error("beep")));
      try {
        await emitter.emitParallel("foo", "bar");
      } catch (err: any) {
        expect(err.message).toEqual("boop");
      }
    });
  });

  describe("emitSerial()", () => {
    it("listener should be run serially", async () => {
      const delay = 100;
      const expectedArray = new Array(3);
      let index = 0;
      const emitter = new AsyncEventEmitter();
      emitter.on(
        "delay",
        (ms) =>
          new Promise((resolve) => {
            setTimeout(() => {
              expectedArray[index] = index;
              resolve(index++);
            }, ms);
          })
      );
      emitter.on(
        "delay",
        (ms) =>
          new Promise((resolve) => {
            setTimeout(() => {
              expectedArray[index] = index;
              resolve(index++);
            }, ms);
          })
      );
      emitter.on(
        "delay",
        (ms) =>
          new Promise((resolve) => {
            setTimeout(() => {
              expectedArray[index] = index;
              resolve(index++);
            }, ms);
          })
      );

      const values = await emitter.emitSerial("delay", delay);
      expect(expectedArray).toEqual(values);
    });

    it("if an error occurs, it should throw an error only the first one", async () => {
      const delay = 100;
      const emitter = new AsyncEventEmitter();
      emitter.on(
        "delay",
        (ms) =>
          new Promise((resolve) => {
            setTimeout(() => resolve(Date.now()), ms);
          })
      );
      emitter.on(
        "delay",
        (ms) =>
          new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error("foo")), ms);
          })
      );
      emitter.on(
        "delay",
        (ms) =>
          new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error("bar")), ms);
          })
      );

      try {
        await emitter.emitSerial("delay", delay);
      } catch (err: any) {
        expect(err.message).toEqual("foo");
      }
    });
  });

  describe("emitReduce()/emitReduceRight()", () => {
    it("listener should be run serially using previous listener return value", async () => {
      expect(await new AsyncEventEmitter().emitReduce("noop")).toEqual([]);
      expect(await new AsyncEventEmitter().emitReduce("noop", 1)).toEqual([1]);

      const emitter = new AsyncEventEmitter();
      emitter.on("square", (keys, value) => Promise.resolve([keys.concat(1), value * value]));
      emitter.on("square", (keys, value) => Promise.resolve([keys.concat(2), value * value]));
      emitter.on("square", (keys, value) => Promise.resolve([keys.concat(3), value * value]));

      expect(await emitter.emitReduce("square", [], 2)).toEqual([[1, 2, 3], 256]);
      expect(await emitter.emitReduceRight("square", [], 2)).toEqual([[3, 2, 1], 256]);
    });

    it("if listener returns a non-array, it should be passed on correctly value to the next listener", async () => {
      const emitter = new AsyncEventEmitter();
      emitter.on("normal", () => 1);
      emitter.on("normal", (value) => [value]);

      expect(await emitter.emitReduce("normal")).toEqual([1]);
    });

    it("if an error occurs, it should throw an error only the first one", async () => {
      const emitter = new AsyncEventEmitter();
      emitter.on("square", (keys, value1) => Promise.resolve([keys.concat(1), value1 * 2]));
      emitter.on("square", () => Promise.reject(new Error("foo")));
      emitter.on("square", () => Promise.reject(new Error("bar")));

      try {
        await emitter.emitReduce("square", [], 1);
      } catch (err: any) {
        expect(err.message).toEqual("foo");
      }

      try {
        await emitter.emitReduceRight("square", [], 1);
      } catch (err: any) {
        expect(err.message).toEqual("bar");
      }
    });
  });

  describe("once()", () => {
    it("listeners that have been executed should be removed immediately", async () => {
      const emitter = new AsyncEventEmitter();
      emitter.once("foo", (action: any) => action);

      let values;
      values = await emitter.emitParallel("foo", "bar");
      expect(values.length).toEqual(1);
      expect(values[0]).toEqual("bar");

      values = await emitter.emitParallel("foo", "bar");
      expect(values.length).toEqual(0);
      expect(values[0]).toBeUndefined();
    });

    it("if the argument isn't function, should throw an error", async () => {
      const emitter = new AsyncEventEmitter();
      try {

        await emitter.once("foo", "bad argument!");
      } catch (err: any) {
        expect(err.message).toEqual("listener must be a function");
      }
    });
  });

  describe("subscribe()", () => {
    it("if executed the return value, should remove the listener", async () => {
      const emitter = new AsyncEventEmitter();
      const unsubcribe = emitter.subscribe("foo", (action) => action);

      let values;
      values = await emitter.emitParallel("foo", "bar");
      expect(values.length).toEqual(1);
      expect(values[0]).toEqual("bar");

      unsubcribe();

      values = await emitter.emitParallel("foo", "bar");
      expect(values.length).toEqual(0);
      expect(values[0]).toBeUndefined();
    });

    it("if specify third argument is true, should remove the listener after executed", async () => {
      const emitter = new AsyncEventEmitter();

      const unsubscribe = emitter.subscribe("foo", (action) => action, true);
      unsubscribe();

      emitter.subscribe("foo", (action) => action, true);
      let values;
      values = await emitter.emitParallel("foo", "bar");
      expect(values.length).toEqual(1);
      expect(values[0]).toEqual("bar");

      values = await emitter.emitParallel("foo", "bar");
      expect(values.length).toEqual(0);
      expect(values[0]).toBeUndefined();
    });
  });

  describe("setConcurrency()", () => {
    const delay = 100;
    const delayTolerance = 10;
    const delayListener = () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(Date.now()), delay);
      });

    it("should set max concurrency in the constructor", async () => {
      const emitter = new AsyncEventEmitter(2);
      emitter.on("foo", delayListener);
      emitter.on("foo", delayListener);
      emitter.on("foo", delayListener);
      emitter.on("foo", delayListener);
      emitter.on("foo", delayListener);

      const [a, b, c, d, e] = await emitter.emitParallel("foo");
      expect(b - a < delay + delayTolerance).toBeTruthy();
      expect(c - b >= delay - delayTolerance).toBeTruthy();
      expect(d - c < delay + delayTolerance).toBeTruthy();
      expect(e - d >= delay - delayTolerance).toBeTruthy();
    });

    it("the limit should be managed by an instance", async () => {
      const emitter = new AsyncEventEmitter(2);
      emitter.on("foo", delayListener);

      const [[a], [b], [c], [d], [e]] = await Promise.all([
        emitter.emitSerial("foo"),
        emitter.emitSerial("foo"),
        emitter.emitSerial("foo"),
        emitter.emitSerial("foo"),
        emitter.emitSerial("foo"),
      ]);
      expect(b! - a! < delay + delayTolerance).toBeTruthy();
      expect(c! - b! >= delay - delayTolerance).toBeTruthy();
      expect(d! - c! < delay + delayTolerance).toBeTruthy();
      expect(e! - d! >= delay - delayTolerance).toBeTruthy();
    });

    it("should the maximum number that changed are applied", async () => {
      const emitter = new AsyncEventEmitter(1);
      emitter.on("foo", delayListener);
      emitter.on("foo", delayListener);

      const [[a, b], [c, d]] = await Promise.all([
        emitter.emitParallel("foo"),
        emitter.setConcurrency(2).emitParallel("foo"),
      ]);
      expect(b - a >= delay - delayTolerance).toBeTruthy();
      expect(d - c < delay + delayTolerance).toBeTruthy();
    });
  });

  describe("issues (regression test)", () => {
    describe("once()", () => {
      it("#3: always the listener should be stopped at the removeListener", async () => {
        const listener = () => 1;
        const emitter = new AsyncEventEmitter();
        emitter.once("foo", listener);
        emitter.removeListener("foo", listener);

        const values = await emitter.emitParallel("foo");
        expect(values.length).toEqual(0);
        expect(values[0]).toBeUndefined();
      });
    });
    describe("emitSerial()", () => {
      it("#4: should not be destroying a listener for the return values", async () => {
        const delay = 100;
        const emitter = new AsyncEventEmitter();
        emitter.on("delay", () => [1]);
        emitter.on("delay", () => [2]);

        const values = await emitter.emitSerial("delay", delay);
        expect(values[0]![0]).toEqual(1);
        expect(values[1]![0]).toEqual(2);
      });
    });
  });
});
