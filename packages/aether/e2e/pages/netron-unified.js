var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// e2e/stubs/process-shim.js
var process, setImmediate, clearImmediate;
var init_process_shim = __esm({
  "e2e/stubs/process-shim.js"() {
    "use strict";
    process = {
      env: { NODE_ENV: "production" },
      platform: "browser",
      version: "v22.0.0",
      cwd: /* @__PURE__ */ __name(() => "/", "cwd"),
      nextTick: /* @__PURE__ */ __name((fn) => Promise.resolve().then(fn), "nextTick")
    };
    setImmediate = /* @__PURE__ */ __name((fn, ...args) => {
      return setTimeout(() => fn(...args), 0);
    }, "setImmediate");
    clearImmediate = /* @__PURE__ */ __name((id) => {
      return clearTimeout(id);
    }, "clearImmediate");
    globalThis.process = process;
    globalThis.setImmediate = setImmediate;
    globalThis.clearImmediate = clearImmediate;
  }
});

// ../common/dist/primitives.js
var init_primitives = __esm({
  "../common/dist/primitives.js"() {
    "use strict";
    init_process_shim();
  }
});

// ../common/dist/predicates.js
var objectProto, hasOwnProperty, toString, funcToString, objectCtorString, isWindows, linux, freebsd, openbsd, darwin, sunos, aix, isNodejs, isArray, isBuffer, isPlainObject, isNan, isFinite2, isInteger, isSafeInteger;
var init_predicates = __esm({
  "../common/dist/predicates.js"() {
    "use strict";
    init_process_shim();
    objectProto = Object.prototype;
    ({ hasOwnProperty } = objectProto);
    ({ toString } = objectProto);
    funcToString = Function.prototype.toString;
    objectCtorString = funcToString.call(Object);
    isWindows = process.platform === "win32";
    linux = process.platform === "linux";
    freebsd = process.platform === "freebsd";
    openbsd = process.platform === "openbsd";
    darwin = process.platform === "darwin";
    sunos = process.platform === "sunos";
    aix = process.platform === "aix";
    isNodejs = Object.prototype.toString.call(typeof process !== "undefined" ? process : 0) === "[object process]";
    ({ isArray } = Array);
    isBuffer = /* @__PURE__ */ __name((obj) => obj != null && (Boolean(obj.constructor) && typeof obj.constructor.isBuffer === "function" && obj.constructor.isBuffer(obj) || Boolean(obj._isBuffer)), "isBuffer");
    isPlainObject = /* @__PURE__ */ __name((value) => {
      if (!value || typeof value !== "object") {
        return false;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto === null) {
        return true;
      }
      const hasObjectPrototype = proto === Object.prototype || Object.getPrototypeOf(proto) === null;
      if (!hasObjectPrototype) {
        return false;
      }
      const stringTag = objectProto.toString.call(value);
      return stringTag === "[object Object]";
    }, "isPlainObject");
    isNan = Number.isNaN;
    ({ isFinite: isFinite2 } = Number);
    ({ isInteger } = Number);
    ({ isSafeInteger } = Number);
  }
});

// ../common/dist/omit.js
var init_omit = __esm({
  "../common/dist/omit.js"() {
    "use strict";
    init_process_shim();
    init_primitives();
    init_predicates();
  }
});

// ../common/dist/entries.js
var objectOwnProps;
var init_entries = __esm({
  "../common/dist/entries.js"() {
    "use strict";
    init_process_shim();
    init_predicates();
    objectOwnProps = Object.getOwnPropertyNames(Object.getPrototypeOf({}));
  }
});

// ../common/dist/promise.js
var init_promise = __esm({
  "../common/dist/promise.js"() {
    "use strict";
    init_process_shim();
    init_entries();
    init_primitives();
    init_predicates();
  }
});

// ../common/dist/p-limit.js
function pLimit(concurrency) {
  validateConcurrency(concurrency);
  const queue = new Queue();
  let activeCount = 0;
  let currentConcurrency = concurrency;
  const resumeNext = /* @__PURE__ */ __name(() => {
    if (activeCount < currentConcurrency && queue.size > 0) {
      activeCount++;
      const resolveFunction = queue.dequeue();
      if (resolveFunction) {
        resolveFunction();
      }
    }
  }, "resumeNext");
  const next = /* @__PURE__ */ __name(() => {
    activeCount--;
    resumeNext();
  }, "next");
  const run = /* @__PURE__ */ __name(async (function_, resolve, arguments_) => {
    const result = (async () => function_(...arguments_))();
    resolve(result);
    try {
      await result;
    } catch {
    }
    next();
  }, "run");
  const enqueue = /* @__PURE__ */ __name((function_, resolve, arguments_) => {
    queue.enqueue(() => {
      run(function_, resolve, arguments_);
    });
    (async () => {
      await Promise.resolve();
      if (activeCount < currentConcurrency && queue.size > 0) {
        resumeNext();
      }
    })();
  }, "enqueue");
  const generator = /* @__PURE__ */ __name((function_, ...arguments_) => new Promise((resolve) => {
    enqueue(function_, resolve, arguments_);
  }), "generator");
  Object.defineProperties(generator, {
    activeCount: {
      get: /* @__PURE__ */ __name(() => activeCount, "get")
    },
    pendingCount: {
      get: /* @__PURE__ */ __name(() => queue.size, "get")
    },
    clearQueue: {
      value: /* @__PURE__ */ __name(() => {
        queue.clear();
      }, "value")
    },
    concurrency: {
      get: /* @__PURE__ */ __name(() => currentConcurrency, "get"),
      set: /* @__PURE__ */ __name((newConcurrency) => {
        validateConcurrency(newConcurrency);
        currentConcurrency = newConcurrency;
        const processQueue = typeof queueMicrotask !== "undefined" ? queueMicrotask : (fn) => Promise.resolve().then(fn);
        processQueue(() => {
          while (activeCount < currentConcurrency && queue.size > 0) {
            resumeNext();
          }
        });
      }, "set")
    },
    map: {
      async value(array, mapperFunction) {
        const promises = array.map((value, index) => this(mapperFunction, value, index));
        return Promise.all(promises);
      }
    }
  });
  return generator;
}
function validateConcurrency(concurrency) {
  if (!((Number.isInteger(concurrency) || concurrency === Number.POSITIVE_INFINITY) && concurrency > 0)) {
    throw new TypeError("Expected `concurrency` to be a number from 1 and up");
  }
}
var Queue;
var init_p_limit = __esm({
  "../common/dist/p-limit.js"() {
    "use strict";
    init_process_shim();
    Queue = class {
      static {
        __name(this, "Queue");
      }
      constructor() {
        this._size = 0;
      }
      enqueue(value) {
        const node = { value, next: void 0 };
        if (this.tail) {
          this.tail.next = node;
          this.tail = node;
        } else {
          this.head = this.tail = node;
        }
        this._size++;
      }
      dequeue() {
        const node = this.head;
        if (!node)
          return void 0;
        this.head = node.next;
        if (!this.head) {
          this.tail = void 0;
        }
        this._size--;
        return node.value;
      }
      clear() {
        this.head = this.tail = void 0;
        this._size = 0;
      }
      get size() {
        return this._size;
      }
    };
    __name(pLimit, "pLimit");
    __name(validateConcurrency, "validateConcurrency");
  }
});

// ../common/dist/timed-map.js
var TimedMap;
var init_timed_map = __esm({
  "../common/dist/timed-map.js"() {
    "use strict";
    init_process_shim();
    TimedMap = class {
      static {
        __name(this, "TimedMap");
      }
      constructor(timeoutMs, callback) {
        this.map = /* @__PURE__ */ new Map();
        this.timeout = timeoutMs ?? 1e3;
        this.timeoutCallback = callback ?? ((key) => this.map.delete(key));
      }
      set(key, value, callback, timeout) {
        this.clearTimeout(key);
        const timer = setTimeout(callback ? callback : this.timeoutCallback, Number.isInteger(timeout) ? timeout : this.timeout, key);
        this.map.set(key, { value, timer });
      }
      get(key) {
        return this.map.get(key)?.value;
      }
      forEach(callback, thisArg) {
        this.map.forEach((obj, key) => {
          callback.call(thisArg, obj.value, key, this);
        });
      }
      *entries() {
        for (const [key, obj] of this.map.entries()) {
          yield [key, obj.value];
        }
      }
      *values() {
        for (const obj of this.map.values()) {
          yield obj.value;
        }
      }
      delete(key) {
        this.clearTimeout(key);
        return this.map.delete(key);
      }
      clear() {
        this.map.forEach((obj) => {
          clearTimeout(obj.timer);
        });
        this.map.clear();
      }
      clearTimeout(key) {
        if (this.map.has(key)) {
          clearTimeout(this.map.get(key).timer);
        }
      }
    };
  }
});

// ../common/dist/list-buffer.js
var init_list_buffer = __esm({
  "../common/dist/list-buffer.js"() {
    "use strict";
    init_process_shim();
  }
});

// ../common/dist/index.js
var init_dist = __esm({
  "../common/dist/index.js"() {
    "use strict";
    init_process_shim();
    init_omit();
    init_entries();
    init_promise();
    init_p_limit();
    init_timed_map();
    init_primitives();
    init_predicates();
    init_list_buffer();
  }
});

// ../../node_modules/long/index.js
function Long(low, high, unsigned) {
  this.low = low | 0;
  this.high = high | 0;
  this.unsigned = !!unsigned;
}
function isLong(obj) {
  return (obj && obj["__isLong__"]) === true;
}
function ctz32(value) {
  var c = Math.clz32(value & -value);
  return value ? 31 - c : c;
}
function fromInt(value, unsigned) {
  var obj, cachedObj, cache;
  if (unsigned) {
    value >>>= 0;
    if (cache = 0 <= value && value < 256) {
      cachedObj = UINT_CACHE[value];
      if (cachedObj) return cachedObj;
    }
    obj = fromBits(value, 0, true);
    if (cache) UINT_CACHE[value] = obj;
    return obj;
  } else {
    value |= 0;
    if (cache = -128 <= value && value < 128) {
      cachedObj = INT_CACHE[value];
      if (cachedObj) return cachedObj;
    }
    obj = fromBits(value, value < 0 ? -1 : 0, false);
    if (cache) INT_CACHE[value] = obj;
    return obj;
  }
}
function fromNumber(value, unsigned) {
  if (isNaN(value)) return unsigned ? UZERO : ZERO;
  if (unsigned) {
    if (value < 0) return UZERO;
    if (value >= TWO_PWR_64_DBL) return MAX_UNSIGNED_VALUE;
  } else {
    if (value <= -TWO_PWR_63_DBL) return MIN_VALUE;
    if (value + 1 >= TWO_PWR_63_DBL) return MAX_VALUE;
  }
  if (value < 0) return fromNumber(-value, unsigned).neg();
  return fromBits(
    value % TWO_PWR_32_DBL | 0,
    value / TWO_PWR_32_DBL | 0,
    unsigned
  );
}
function fromBits(lowBits, highBits, unsigned) {
  return new Long(lowBits, highBits, unsigned);
}
function fromString(str, unsigned, radix) {
  if (str.length === 0) throw Error("empty string");
  if (typeof unsigned === "number") {
    radix = unsigned;
    unsigned = false;
  } else {
    unsigned = !!unsigned;
  }
  if (str === "NaN" || str === "Infinity" || str === "+Infinity" || str === "-Infinity")
    return unsigned ? UZERO : ZERO;
  radix = radix || 10;
  if (radix < 2 || 36 < radix) throw RangeError("radix");
  var p;
  if ((p = str.indexOf("-")) > 0) throw Error("interior hyphen");
  else if (p === 0) {
    return fromString(str.substring(1), unsigned, radix).neg();
  }
  var radixToPower = fromNumber(pow_dbl(radix, 8));
  var result = ZERO;
  for (var i = 0; i < str.length; i += 8) {
    var size = Math.min(8, str.length - i), value = parseInt(str.substring(i, i + size), radix);
    if (size < 8) {
      var power = fromNumber(pow_dbl(radix, size));
      result = result.mul(power).add(fromNumber(value));
    } else {
      result = result.mul(radixToPower);
      result = result.add(fromNumber(value));
    }
  }
  result.unsigned = unsigned;
  return result;
}
function fromValue(val, unsigned) {
  if (typeof val === "number") return fromNumber(val, unsigned);
  if (typeof val === "string") return fromString(val, unsigned);
  return fromBits(
    val.low,
    val.high,
    typeof unsigned === "boolean" ? unsigned : val.unsigned
  );
}
var wasm, INT_CACHE, UINT_CACHE, pow_dbl, TWO_PWR_16_DBL, TWO_PWR_24_DBL, TWO_PWR_32_DBL, TWO_PWR_64_DBL, TWO_PWR_63_DBL, TWO_PWR_24, ZERO, UZERO, ONE, UONE, NEG_ONE, MAX_VALUE, MAX_UNSIGNED_VALUE, MIN_VALUE, LongPrototype, long_default;
var init_long = __esm({
  "../../node_modules/long/index.js"() {
    init_process_shim();
    wasm = null;
    try {
      wasm = new WebAssembly.Instance(
        new WebAssembly.Module(
          new Uint8Array([
            // \0asm
            0,
            97,
            115,
            109,
            // version 1
            1,
            0,
            0,
            0,
            // section "type"
            1,
            13,
            2,
            // 0, () => i32
            96,
            0,
            1,
            127,
            // 1, (i32, i32, i32, i32) => i32
            96,
            4,
            127,
            127,
            127,
            127,
            1,
            127,
            // section "function"
            3,
            7,
            6,
            // 0, type 0
            0,
            // 1, type 1
            1,
            // 2, type 1
            1,
            // 3, type 1
            1,
            // 4, type 1
            1,
            // 5, type 1
            1,
            // section "global"
            6,
            6,
            1,
            // 0, "high", mutable i32
            127,
            1,
            65,
            0,
            11,
            // section "export"
            7,
            50,
            6,
            // 0, "mul"
            3,
            109,
            117,
            108,
            0,
            1,
            // 1, "div_s"
            5,
            100,
            105,
            118,
            95,
            115,
            0,
            2,
            // 2, "div_u"
            5,
            100,
            105,
            118,
            95,
            117,
            0,
            3,
            // 3, "rem_s"
            5,
            114,
            101,
            109,
            95,
            115,
            0,
            4,
            // 4, "rem_u"
            5,
            114,
            101,
            109,
            95,
            117,
            0,
            5,
            // 5, "get_high"
            8,
            103,
            101,
            116,
            95,
            104,
            105,
            103,
            104,
            0,
            0,
            // section "code"
            10,
            191,
            1,
            6,
            // 0, "get_high"
            4,
            0,
            35,
            0,
            11,
            // 1, "mul"
            36,
            1,
            1,
            126,
            32,
            0,
            173,
            32,
            1,
            173,
            66,
            32,
            134,
            132,
            32,
            2,
            173,
            32,
            3,
            173,
            66,
            32,
            134,
            132,
            126,
            34,
            4,
            66,
            32,
            135,
            167,
            36,
            0,
            32,
            4,
            167,
            11,
            // 2, "div_s"
            36,
            1,
            1,
            126,
            32,
            0,
            173,
            32,
            1,
            173,
            66,
            32,
            134,
            132,
            32,
            2,
            173,
            32,
            3,
            173,
            66,
            32,
            134,
            132,
            127,
            34,
            4,
            66,
            32,
            135,
            167,
            36,
            0,
            32,
            4,
            167,
            11,
            // 3, "div_u"
            36,
            1,
            1,
            126,
            32,
            0,
            173,
            32,
            1,
            173,
            66,
            32,
            134,
            132,
            32,
            2,
            173,
            32,
            3,
            173,
            66,
            32,
            134,
            132,
            128,
            34,
            4,
            66,
            32,
            135,
            167,
            36,
            0,
            32,
            4,
            167,
            11,
            // 4, "rem_s"
            36,
            1,
            1,
            126,
            32,
            0,
            173,
            32,
            1,
            173,
            66,
            32,
            134,
            132,
            32,
            2,
            173,
            32,
            3,
            173,
            66,
            32,
            134,
            132,
            129,
            34,
            4,
            66,
            32,
            135,
            167,
            36,
            0,
            32,
            4,
            167,
            11,
            // 5, "rem_u"
            36,
            1,
            1,
            126,
            32,
            0,
            173,
            32,
            1,
            173,
            66,
            32,
            134,
            132,
            32,
            2,
            173,
            32,
            3,
            173,
            66,
            32,
            134,
            132,
            130,
            34,
            4,
            66,
            32,
            135,
            167,
            36,
            0,
            32,
            4,
            167,
            11
          ])
        ),
        {}
      ).exports;
    } catch {
    }
    __name(Long, "Long");
    Long.prototype.__isLong__;
    Object.defineProperty(Long.prototype, "__isLong__", { value: true });
    __name(isLong, "isLong");
    __name(ctz32, "ctz32");
    Long.isLong = isLong;
    INT_CACHE = {};
    UINT_CACHE = {};
    __name(fromInt, "fromInt");
    Long.fromInt = fromInt;
    __name(fromNumber, "fromNumber");
    Long.fromNumber = fromNumber;
    __name(fromBits, "fromBits");
    Long.fromBits = fromBits;
    pow_dbl = Math.pow;
    __name(fromString, "fromString");
    Long.fromString = fromString;
    __name(fromValue, "fromValue");
    Long.fromValue = fromValue;
    TWO_PWR_16_DBL = 1 << 16;
    TWO_PWR_24_DBL = 1 << 24;
    TWO_PWR_32_DBL = TWO_PWR_16_DBL * TWO_PWR_16_DBL;
    TWO_PWR_64_DBL = TWO_PWR_32_DBL * TWO_PWR_32_DBL;
    TWO_PWR_63_DBL = TWO_PWR_64_DBL / 2;
    TWO_PWR_24 = fromInt(TWO_PWR_24_DBL);
    ZERO = fromInt(0);
    Long.ZERO = ZERO;
    UZERO = fromInt(0, true);
    Long.UZERO = UZERO;
    ONE = fromInt(1);
    Long.ONE = ONE;
    UONE = fromInt(1, true);
    Long.UONE = UONE;
    NEG_ONE = fromInt(-1);
    Long.NEG_ONE = NEG_ONE;
    MAX_VALUE = fromBits(4294967295 | 0, 2147483647 | 0, false);
    Long.MAX_VALUE = MAX_VALUE;
    MAX_UNSIGNED_VALUE = fromBits(4294967295 | 0, 4294967295 | 0, true);
    Long.MAX_UNSIGNED_VALUE = MAX_UNSIGNED_VALUE;
    MIN_VALUE = fromBits(0, 2147483648 | 0, false);
    Long.MIN_VALUE = MIN_VALUE;
    LongPrototype = Long.prototype;
    LongPrototype.toInt = /* @__PURE__ */ __name(function toInt() {
      return this.unsigned ? this.low >>> 0 : this.low;
    }, "toInt");
    LongPrototype.toNumber = /* @__PURE__ */ __name(function toNumber() {
      if (this.unsigned)
        return (this.high >>> 0) * TWO_PWR_32_DBL + (this.low >>> 0);
      return this.high * TWO_PWR_32_DBL + (this.low >>> 0);
    }, "toNumber");
    LongPrototype.toString = /* @__PURE__ */ __name(function toString2(radix) {
      radix = radix || 10;
      if (radix < 2 || 36 < radix) throw RangeError("radix");
      if (this.isZero()) return "0";
      if (this.isNegative()) {
        if (this.eq(MIN_VALUE)) {
          var radixLong = fromNumber(radix), div = this.div(radixLong), rem1 = div.mul(radixLong).sub(this);
          return div.toString(radix) + rem1.toInt().toString(radix);
        } else return "-" + this.neg().toString(radix);
      }
      var radixToPower = fromNumber(pow_dbl(radix, 6), this.unsigned), rem = this;
      var result = "";
      while (true) {
        var remDiv = rem.div(radixToPower), intval = rem.sub(remDiv.mul(radixToPower)).toInt() >>> 0, digits = intval.toString(radix);
        rem = remDiv;
        if (rem.isZero()) return digits + result;
        else {
          while (digits.length < 6) digits = "0" + digits;
          result = "" + digits + result;
        }
      }
    }, "toString");
    LongPrototype.getHighBits = /* @__PURE__ */ __name(function getHighBits() {
      return this.high;
    }, "getHighBits");
    LongPrototype.getHighBitsUnsigned = /* @__PURE__ */ __name(function getHighBitsUnsigned() {
      return this.high >>> 0;
    }, "getHighBitsUnsigned");
    LongPrototype.getLowBits = /* @__PURE__ */ __name(function getLowBits() {
      return this.low;
    }, "getLowBits");
    LongPrototype.getLowBitsUnsigned = /* @__PURE__ */ __name(function getLowBitsUnsigned() {
      return this.low >>> 0;
    }, "getLowBitsUnsigned");
    LongPrototype.getNumBitsAbs = /* @__PURE__ */ __name(function getNumBitsAbs() {
      if (this.isNegative())
        return this.eq(MIN_VALUE) ? 64 : this.neg().getNumBitsAbs();
      var val = this.high != 0 ? this.high : this.low;
      for (var bit = 31; bit > 0; bit--) if ((val & 1 << bit) != 0) break;
      return this.high != 0 ? bit + 33 : bit + 1;
    }, "getNumBitsAbs");
    LongPrototype.isSafeInteger = /* @__PURE__ */ __name(function isSafeInteger2() {
      var top11Bits = this.high >> 21;
      if (!top11Bits) return true;
      if (this.unsigned) return false;
      return top11Bits === -1 && !(this.low === 0 && this.high === -2097152);
    }, "isSafeInteger");
    LongPrototype.isZero = /* @__PURE__ */ __name(function isZero() {
      return this.high === 0 && this.low === 0;
    }, "isZero");
    LongPrototype.eqz = LongPrototype.isZero;
    LongPrototype.isNegative = /* @__PURE__ */ __name(function isNegative() {
      return !this.unsigned && this.high < 0;
    }, "isNegative");
    LongPrototype.isPositive = /* @__PURE__ */ __name(function isPositive() {
      return this.unsigned || this.high >= 0;
    }, "isPositive");
    LongPrototype.isOdd = /* @__PURE__ */ __name(function isOdd() {
      return (this.low & 1) === 1;
    }, "isOdd");
    LongPrototype.isEven = /* @__PURE__ */ __name(function isEven() {
      return (this.low & 1) === 0;
    }, "isEven");
    LongPrototype.equals = /* @__PURE__ */ __name(function equals(other) {
      if (!isLong(other)) other = fromValue(other);
      if (this.unsigned !== other.unsigned && this.high >>> 31 === 1 && other.high >>> 31 === 1)
        return false;
      return this.high === other.high && this.low === other.low;
    }, "equals");
    LongPrototype.eq = LongPrototype.equals;
    LongPrototype.notEquals = /* @__PURE__ */ __name(function notEquals(other) {
      return !this.eq(
        /* validates */
        other
      );
    }, "notEquals");
    LongPrototype.neq = LongPrototype.notEquals;
    LongPrototype.ne = LongPrototype.notEquals;
    LongPrototype.lessThan = /* @__PURE__ */ __name(function lessThan(other) {
      return this.comp(
        /* validates */
        other
      ) < 0;
    }, "lessThan");
    LongPrototype.lt = LongPrototype.lessThan;
    LongPrototype.lessThanOrEqual = /* @__PURE__ */ __name(function lessThanOrEqual(other) {
      return this.comp(
        /* validates */
        other
      ) <= 0;
    }, "lessThanOrEqual");
    LongPrototype.lte = LongPrototype.lessThanOrEqual;
    LongPrototype.le = LongPrototype.lessThanOrEqual;
    LongPrototype.greaterThan = /* @__PURE__ */ __name(function greaterThan(other) {
      return this.comp(
        /* validates */
        other
      ) > 0;
    }, "greaterThan");
    LongPrototype.gt = LongPrototype.greaterThan;
    LongPrototype.greaterThanOrEqual = /* @__PURE__ */ __name(function greaterThanOrEqual(other) {
      return this.comp(
        /* validates */
        other
      ) >= 0;
    }, "greaterThanOrEqual");
    LongPrototype.gte = LongPrototype.greaterThanOrEqual;
    LongPrototype.ge = LongPrototype.greaterThanOrEqual;
    LongPrototype.compare = /* @__PURE__ */ __name(function compare(other) {
      if (!isLong(other)) other = fromValue(other);
      if (this.eq(other)) return 0;
      var thisNeg = this.isNegative(), otherNeg = other.isNegative();
      if (thisNeg && !otherNeg) return -1;
      if (!thisNeg && otherNeg) return 1;
      if (!this.unsigned) return this.sub(other).isNegative() ? -1 : 1;
      return other.high >>> 0 > this.high >>> 0 || other.high === this.high && other.low >>> 0 > this.low >>> 0 ? -1 : 1;
    }, "compare");
    LongPrototype.comp = LongPrototype.compare;
    LongPrototype.negate = /* @__PURE__ */ __name(function negate() {
      if (!this.unsigned && this.eq(MIN_VALUE)) return MIN_VALUE;
      return this.not().add(ONE);
    }, "negate");
    LongPrototype.neg = LongPrototype.negate;
    LongPrototype.add = /* @__PURE__ */ __name(function add(addend) {
      if (!isLong(addend)) addend = fromValue(addend);
      var a48 = this.high >>> 16;
      var a32 = this.high & 65535;
      var a16 = this.low >>> 16;
      var a00 = this.low & 65535;
      var b48 = addend.high >>> 16;
      var b32 = addend.high & 65535;
      var b16 = addend.low >>> 16;
      var b00 = addend.low & 65535;
      var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
      c00 += a00 + b00;
      c16 += c00 >>> 16;
      c00 &= 65535;
      c16 += a16 + b16;
      c32 += c16 >>> 16;
      c16 &= 65535;
      c32 += a32 + b32;
      c48 += c32 >>> 16;
      c32 &= 65535;
      c48 += a48 + b48;
      c48 &= 65535;
      return fromBits(c16 << 16 | c00, c48 << 16 | c32, this.unsigned);
    }, "add");
    LongPrototype.subtract = /* @__PURE__ */ __name(function subtract(subtrahend) {
      if (!isLong(subtrahend)) subtrahend = fromValue(subtrahend);
      return this.add(subtrahend.neg());
    }, "subtract");
    LongPrototype.sub = LongPrototype.subtract;
    LongPrototype.multiply = /* @__PURE__ */ __name(function multiply(multiplier) {
      if (this.isZero()) return this;
      if (!isLong(multiplier)) multiplier = fromValue(multiplier);
      if (wasm) {
        var low = wasm["mul"](this.low, this.high, multiplier.low, multiplier.high);
        return fromBits(low, wasm["get_high"](), this.unsigned);
      }
      if (multiplier.isZero()) return this.unsigned ? UZERO : ZERO;
      if (this.eq(MIN_VALUE)) return multiplier.isOdd() ? MIN_VALUE : ZERO;
      if (multiplier.eq(MIN_VALUE)) return this.isOdd() ? MIN_VALUE : ZERO;
      if (this.isNegative()) {
        if (multiplier.isNegative()) return this.neg().mul(multiplier.neg());
        else return this.neg().mul(multiplier).neg();
      } else if (multiplier.isNegative()) return this.mul(multiplier.neg()).neg();
      if (this.lt(TWO_PWR_24) && multiplier.lt(TWO_PWR_24))
        return fromNumber(this.toNumber() * multiplier.toNumber(), this.unsigned);
      var a48 = this.high >>> 16;
      var a32 = this.high & 65535;
      var a16 = this.low >>> 16;
      var a00 = this.low & 65535;
      var b48 = multiplier.high >>> 16;
      var b32 = multiplier.high & 65535;
      var b16 = multiplier.low >>> 16;
      var b00 = multiplier.low & 65535;
      var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
      c00 += a00 * b00;
      c16 += c00 >>> 16;
      c00 &= 65535;
      c16 += a16 * b00;
      c32 += c16 >>> 16;
      c16 &= 65535;
      c16 += a00 * b16;
      c32 += c16 >>> 16;
      c16 &= 65535;
      c32 += a32 * b00;
      c48 += c32 >>> 16;
      c32 &= 65535;
      c32 += a16 * b16;
      c48 += c32 >>> 16;
      c32 &= 65535;
      c32 += a00 * b32;
      c48 += c32 >>> 16;
      c32 &= 65535;
      c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
      c48 &= 65535;
      return fromBits(c16 << 16 | c00, c48 << 16 | c32, this.unsigned);
    }, "multiply");
    LongPrototype.mul = LongPrototype.multiply;
    LongPrototype.divide = /* @__PURE__ */ __name(function divide(divisor) {
      if (!isLong(divisor)) divisor = fromValue(divisor);
      if (divisor.isZero()) throw Error("division by zero");
      if (wasm) {
        if (!this.unsigned && this.high === -2147483648 && divisor.low === -1 && divisor.high === -1) {
          return this;
        }
        var low = (this.unsigned ? wasm["div_u"] : wasm["div_s"])(
          this.low,
          this.high,
          divisor.low,
          divisor.high
        );
        return fromBits(low, wasm["get_high"](), this.unsigned);
      }
      if (this.isZero()) return this.unsigned ? UZERO : ZERO;
      var approx, rem, res;
      if (!this.unsigned) {
        if (this.eq(MIN_VALUE)) {
          if (divisor.eq(ONE) || divisor.eq(NEG_ONE))
            return MIN_VALUE;
          else if (divisor.eq(MIN_VALUE)) return ONE;
          else {
            var halfThis = this.shr(1);
            approx = halfThis.div(divisor).shl(1);
            if (approx.eq(ZERO)) {
              return divisor.isNegative() ? ONE : NEG_ONE;
            } else {
              rem = this.sub(divisor.mul(approx));
              res = approx.add(rem.div(divisor));
              return res;
            }
          }
        } else if (divisor.eq(MIN_VALUE)) return this.unsigned ? UZERO : ZERO;
        if (this.isNegative()) {
          if (divisor.isNegative()) return this.neg().div(divisor.neg());
          return this.neg().div(divisor).neg();
        } else if (divisor.isNegative()) return this.div(divisor.neg()).neg();
        res = ZERO;
      } else {
        if (!divisor.unsigned) divisor = divisor.toUnsigned();
        if (divisor.gt(this)) return UZERO;
        if (divisor.gt(this.shru(1)))
          return UONE;
        res = UZERO;
      }
      rem = this;
      while (rem.gte(divisor)) {
        approx = Math.max(1, Math.floor(rem.toNumber() / divisor.toNumber()));
        var log2 = Math.ceil(Math.log(approx) / Math.LN2), delta = log2 <= 48 ? 1 : pow_dbl(2, log2 - 48), approxRes = fromNumber(approx), approxRem = approxRes.mul(divisor);
        while (approxRem.isNegative() || approxRem.gt(rem)) {
          approx -= delta;
          approxRes = fromNumber(approx, this.unsigned);
          approxRem = approxRes.mul(divisor);
        }
        if (approxRes.isZero()) approxRes = ONE;
        res = res.add(approxRes);
        rem = rem.sub(approxRem);
      }
      return res;
    }, "divide");
    LongPrototype.div = LongPrototype.divide;
    LongPrototype.modulo = /* @__PURE__ */ __name(function modulo(divisor) {
      if (!isLong(divisor)) divisor = fromValue(divisor);
      if (wasm) {
        var low = (this.unsigned ? wasm["rem_u"] : wasm["rem_s"])(
          this.low,
          this.high,
          divisor.low,
          divisor.high
        );
        return fromBits(low, wasm["get_high"](), this.unsigned);
      }
      return this.sub(this.div(divisor).mul(divisor));
    }, "modulo");
    LongPrototype.mod = LongPrototype.modulo;
    LongPrototype.rem = LongPrototype.modulo;
    LongPrototype.not = /* @__PURE__ */ __name(function not() {
      return fromBits(~this.low, ~this.high, this.unsigned);
    }, "not");
    LongPrototype.countLeadingZeros = /* @__PURE__ */ __name(function countLeadingZeros() {
      return this.high ? Math.clz32(this.high) : Math.clz32(this.low) + 32;
    }, "countLeadingZeros");
    LongPrototype.clz = LongPrototype.countLeadingZeros;
    LongPrototype.countTrailingZeros = /* @__PURE__ */ __name(function countTrailingZeros() {
      return this.low ? ctz32(this.low) : ctz32(this.high) + 32;
    }, "countTrailingZeros");
    LongPrototype.ctz = LongPrototype.countTrailingZeros;
    LongPrototype.and = /* @__PURE__ */ __name(function and(other) {
      if (!isLong(other)) other = fromValue(other);
      return fromBits(this.low & other.low, this.high & other.high, this.unsigned);
    }, "and");
    LongPrototype.or = /* @__PURE__ */ __name(function or(other) {
      if (!isLong(other)) other = fromValue(other);
      return fromBits(this.low | other.low, this.high | other.high, this.unsigned);
    }, "or");
    LongPrototype.xor = /* @__PURE__ */ __name(function xor(other) {
      if (!isLong(other)) other = fromValue(other);
      return fromBits(this.low ^ other.low, this.high ^ other.high, this.unsigned);
    }, "xor");
    LongPrototype.shiftLeft = /* @__PURE__ */ __name(function shiftLeft(numBits) {
      if (isLong(numBits)) numBits = numBits.toInt();
      if ((numBits &= 63) === 0) return this;
      else if (numBits < 32)
        return fromBits(
          this.low << numBits,
          this.high << numBits | this.low >>> 32 - numBits,
          this.unsigned
        );
      else return fromBits(0, this.low << numBits - 32, this.unsigned);
    }, "shiftLeft");
    LongPrototype.shl = LongPrototype.shiftLeft;
    LongPrototype.shiftRight = /* @__PURE__ */ __name(function shiftRight(numBits) {
      if (isLong(numBits)) numBits = numBits.toInt();
      if ((numBits &= 63) === 0) return this;
      else if (numBits < 32)
        return fromBits(
          this.low >>> numBits | this.high << 32 - numBits,
          this.high >> numBits,
          this.unsigned
        );
      else
        return fromBits(
          this.high >> numBits - 32,
          this.high >= 0 ? 0 : -1,
          this.unsigned
        );
    }, "shiftRight");
    LongPrototype.shr = LongPrototype.shiftRight;
    LongPrototype.shiftRightUnsigned = /* @__PURE__ */ __name(function shiftRightUnsigned(numBits) {
      if (isLong(numBits)) numBits = numBits.toInt();
      if ((numBits &= 63) === 0) return this;
      if (numBits < 32)
        return fromBits(
          this.low >>> numBits | this.high << 32 - numBits,
          this.high >>> numBits,
          this.unsigned
        );
      if (numBits === 32) return fromBits(this.high, 0, this.unsigned);
      return fromBits(this.high >>> numBits - 32, 0, this.unsigned);
    }, "shiftRightUnsigned");
    LongPrototype.shru = LongPrototype.shiftRightUnsigned;
    LongPrototype.shr_u = LongPrototype.shiftRightUnsigned;
    LongPrototype.rotateLeft = /* @__PURE__ */ __name(function rotateLeft(numBits) {
      var b;
      if (isLong(numBits)) numBits = numBits.toInt();
      if ((numBits &= 63) === 0) return this;
      if (numBits === 32) return fromBits(this.high, this.low, this.unsigned);
      if (numBits < 32) {
        b = 32 - numBits;
        return fromBits(
          this.low << numBits | this.high >>> b,
          this.high << numBits | this.low >>> b,
          this.unsigned
        );
      }
      numBits -= 32;
      b = 32 - numBits;
      return fromBits(
        this.high << numBits | this.low >>> b,
        this.low << numBits | this.high >>> b,
        this.unsigned
      );
    }, "rotateLeft");
    LongPrototype.rotl = LongPrototype.rotateLeft;
    LongPrototype.rotateRight = /* @__PURE__ */ __name(function rotateRight(numBits) {
      var b;
      if (isLong(numBits)) numBits = numBits.toInt();
      if ((numBits &= 63) === 0) return this;
      if (numBits === 32) return fromBits(this.high, this.low, this.unsigned);
      if (numBits < 32) {
        b = 32 - numBits;
        return fromBits(
          this.high << b | this.low >>> numBits,
          this.low << b | this.high >>> numBits,
          this.unsigned
        );
      }
      numBits -= 32;
      b = 32 - numBits;
      return fromBits(
        this.low << b | this.high >>> numBits,
        this.high << b | this.low >>> numBits,
        this.unsigned
      );
    }, "rotateRight");
    LongPrototype.rotr = LongPrototype.rotateRight;
    LongPrototype.toSigned = /* @__PURE__ */ __name(function toSigned() {
      if (!this.unsigned) return this;
      return fromBits(this.low, this.high, false);
    }, "toSigned");
    LongPrototype.toUnsigned = /* @__PURE__ */ __name(function toUnsigned() {
      if (this.unsigned) return this;
      return fromBits(this.low, this.high, true);
    }, "toUnsigned");
    LongPrototype.toBytes = /* @__PURE__ */ __name(function toBytes(le) {
      return le ? this.toBytesLE() : this.toBytesBE();
    }, "toBytes");
    LongPrototype.toBytesLE = /* @__PURE__ */ __name(function toBytesLE() {
      var hi = this.high, lo = this.low;
      return [
        lo & 255,
        lo >>> 8 & 255,
        lo >>> 16 & 255,
        lo >>> 24,
        hi & 255,
        hi >>> 8 & 255,
        hi >>> 16 & 255,
        hi >>> 24
      ];
    }, "toBytesLE");
    LongPrototype.toBytesBE = /* @__PURE__ */ __name(function toBytesBE() {
      var hi = this.high, lo = this.low;
      return [
        hi >>> 24,
        hi >>> 16 & 255,
        hi >>> 8 & 255,
        hi & 255,
        lo >>> 24,
        lo >>> 16 & 255,
        lo >>> 8 & 255,
        lo & 255
      ];
    }, "toBytesBE");
    Long.fromBytes = /* @__PURE__ */ __name(function fromBytes(bytes, unsigned, le) {
      return le ? Long.fromBytesLE(bytes, unsigned) : Long.fromBytesBE(bytes, unsigned);
    }, "fromBytes");
    Long.fromBytesLE = /* @__PURE__ */ __name(function fromBytesLE(bytes, unsigned) {
      return new Long(
        bytes[0] | bytes[1] << 8 | bytes[2] << 16 | bytes[3] << 24,
        bytes[4] | bytes[5] << 8 | bytes[6] << 16 | bytes[7] << 24,
        unsigned
      );
    }, "fromBytesLE");
    Long.fromBytesBE = /* @__PURE__ */ __name(function fromBytesBE(bytes, unsigned) {
      return new Long(
        bytes[4] << 24 | bytes[5] << 16 | bytes[6] << 8 | bytes[7],
        bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3],
        unsigned
      );
    }, "fromBytesBE");
    if (typeof BigInt === "function") {
      Long.fromBigInt = /* @__PURE__ */ __name(function fromBigInt(value, unsigned) {
        var lowBits = Number(BigInt.asIntN(32, value));
        var highBits = Number(BigInt.asIntN(32, value >> BigInt(32)));
        return fromBits(lowBits, highBits, unsigned);
      }, "fromBigInt");
      Long.fromValue = /* @__PURE__ */ __name(function fromValueWithBigInt(value, unsigned) {
        if (typeof value === "bigint") return Long.fromBigInt(value, unsigned);
        return fromValue(value, unsigned);
      }, "fromValueWithBigInt");
      LongPrototype.toBigInt = /* @__PURE__ */ __name(function toBigInt() {
        var lowBigInt = BigInt(this.low >>> 0);
        var highBigInt = BigInt(this.unsigned ? this.high >>> 0 : this.high);
        return highBigInt << BigInt(32) | lowBigInt;
      }, "toBigInt");
    }
    long_default = Long;
  }
});

// ../../node_modules/base64-js/index.js
var require_base64_js = __commonJS({
  "../../node_modules/base64-js/index.js"(exports) {
    "use strict";
    init_process_shim();
    exports.byteLength = byteLength;
    exports.toByteArray = toByteArray;
    exports.fromByteArray = fromByteArray;
    var lookup = [];
    var revLookup = [];
    var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
    var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (i = 0, len = code.length; i < len; ++i) {
      lookup[i] = code[i];
      revLookup[code.charCodeAt(i)] = i;
    }
    var i;
    var len;
    revLookup["-".charCodeAt(0)] = 62;
    revLookup["_".charCodeAt(0)] = 63;
    function getLens(b64) {
      var len2 = b64.length;
      if (len2 % 4 > 0) {
        throw new Error("Invalid string. Length must be a multiple of 4");
      }
      var validLen = b64.indexOf("=");
      if (validLen === -1) validLen = len2;
      var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
      return [validLen, placeHoldersLen];
    }
    __name(getLens, "getLens");
    function byteLength(b64) {
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    __name(byteLength, "byteLength");
    function _byteLength(b64, validLen, placeHoldersLen) {
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    __name(_byteLength, "_byteLength");
    function toByteArray(b64) {
      var tmp;
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
      var curByte = 0;
      var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
      var i2;
      for (i2 = 0; i2 < len2; i2 += 4) {
        tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)];
        arr[curByte++] = tmp >> 16 & 255;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 2) {
        tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 1) {
        tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      return arr;
    }
    __name(toByteArray, "toByteArray");
    function tripletToBase64(num) {
      return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
    }
    __name(tripletToBase64, "tripletToBase64");
    function encodeChunk(uint8, start, end) {
      var tmp;
      var output = [];
      for (var i2 = start; i2 < end; i2 += 3) {
        tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255);
        output.push(tripletToBase64(tmp));
      }
      return output.join("");
    }
    __name(encodeChunk, "encodeChunk");
    function fromByteArray(uint8) {
      var tmp;
      var len2 = uint8.length;
      var extraBytes = len2 % 3;
      var parts = [];
      var maxChunkLength = 16383;
      for (var i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength) {
        parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
      }
      if (extraBytes === 1) {
        tmp = uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
        );
      } else if (extraBytes === 2) {
        tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
        );
      }
      return parts.join("");
    }
    __name(fromByteArray, "fromByteArray");
  }
});

// ../../node_modules/ieee754/index.js
var require_ieee754 = __commonJS({
  "../../node_modules/ieee754/index.js"(exports) {
    init_process_shim();
    exports.read = function(buffer, offset, isLE, mLen, nBytes) {
      var e, m;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var nBits = -7;
      var i = isLE ? nBytes - 1 : 0;
      var d = isLE ? -1 : 1;
      var s = buffer[offset + i];
      i += d;
      e = s & (1 << -nBits) - 1;
      s >>= -nBits;
      nBits += eLen;
      for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {
      }
      m = e & (1 << -nBits) - 1;
      e >>= -nBits;
      nBits += mLen;
      for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {
      }
      if (e === 0) {
        e = 1 - eBias;
      } else if (e === eMax) {
        return m ? NaN : (s ? -1 : 1) * Infinity;
      } else {
        m = m + Math.pow(2, mLen);
        e = e - eBias;
      }
      return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
    };
    exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
      var e, m, c;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
      var i = isLE ? 0 : nBytes - 1;
      var d = isLE ? 1 : -1;
      var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
      value = Math.abs(value);
      if (isNaN(value) || value === Infinity) {
        m = isNaN(value) ? 1 : 0;
        e = eMax;
      } else {
        e = Math.floor(Math.log(value) / Math.LN2);
        if (value * (c = Math.pow(2, -e)) < 1) {
          e--;
          c *= 2;
        }
        if (e + eBias >= 1) {
          value += rt / c;
        } else {
          value += rt * Math.pow(2, 1 - eBias);
        }
        if (value * c >= 2) {
          e++;
          c /= 2;
        }
        if (e + eBias >= eMax) {
          m = 0;
          e = eMax;
        } else if (e + eBias >= 1) {
          m = (value * c - 1) * Math.pow(2, mLen);
          e = e + eBias;
        } else {
          m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
          e = 0;
        }
      }
      for (; mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8) {
      }
      e = e << mLen | m;
      eLen += mLen;
      for (; eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8) {
      }
      buffer[offset + i - d] |= s * 128;
    };
  }
});

// ../../node_modules/buffer/index.js
var require_buffer = __commonJS({
  "../../node_modules/buffer/index.js"(exports) {
    "use strict";
    init_process_shim();
    var base64 = require_base64_js();
    var ieee754 = require_ieee754();
    var customInspectSymbol = typeof Symbol === "function" && typeof Symbol["for"] === "function" ? Symbol["for"]("nodejs.util.inspect.custom") : null;
    exports.Buffer = Buffer4;
    exports.SlowBuffer = SlowBuffer;
    exports.INSPECT_MAX_BYTES = 50;
    var K_MAX_LENGTH = 2147483647;
    exports.kMaxLength = K_MAX_LENGTH;
    Buffer4.TYPED_ARRAY_SUPPORT = typedArraySupport();
    if (!Buffer4.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
      console.error(
        "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
      );
    }
    function typedArraySupport() {
      try {
        const arr = new Uint8Array(1);
        const proto = { foo: /* @__PURE__ */ __name(function() {
          return 42;
        }, "foo") };
        Object.setPrototypeOf(proto, Uint8Array.prototype);
        Object.setPrototypeOf(arr, proto);
        return arr.foo() === 42;
      } catch (e) {
        return false;
      }
    }
    __name(typedArraySupport, "typedArraySupport");
    Object.defineProperty(Buffer4.prototype, "parent", {
      enumerable: true,
      get: /* @__PURE__ */ __name(function() {
        if (!Buffer4.isBuffer(this)) return void 0;
        return this.buffer;
      }, "get")
    });
    Object.defineProperty(Buffer4.prototype, "offset", {
      enumerable: true,
      get: /* @__PURE__ */ __name(function() {
        if (!Buffer4.isBuffer(this)) return void 0;
        return this.byteOffset;
      }, "get")
    });
    function createBuffer(length) {
      if (length > K_MAX_LENGTH) {
        throw new RangeError('The value "' + length + '" is invalid for option "size"');
      }
      const buf = new Uint8Array(length);
      Object.setPrototypeOf(buf, Buffer4.prototype);
      return buf;
    }
    __name(createBuffer, "createBuffer");
    function Buffer4(arg, encodingOrOffset, length) {
      if (typeof arg === "number") {
        if (typeof encodingOrOffset === "string") {
          throw new TypeError(
            'The "string" argument must be of type string. Received type number'
          );
        }
        return allocUnsafe(arg);
      }
      return from(arg, encodingOrOffset, length);
    }
    __name(Buffer4, "Buffer");
    Buffer4.poolSize = 8192;
    function from(value, encodingOrOffset, length) {
      if (typeof value === "string") {
        return fromString2(value, encodingOrOffset);
      }
      if (ArrayBuffer.isView(value)) {
        return fromArrayView(value);
      }
      if (value == null) {
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
        );
      }
      if (isInstance(value, ArrayBuffer) || value && isInstance(value.buffer, ArrayBuffer)) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof SharedArrayBuffer !== "undefined" && (isInstance(value, SharedArrayBuffer) || value && isInstance(value.buffer, SharedArrayBuffer))) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof value === "number") {
        throw new TypeError(
          'The "value" argument must not be of type number. Received type number'
        );
      }
      const valueOf = value.valueOf && value.valueOf();
      if (valueOf != null && valueOf !== value) {
        return Buffer4.from(valueOf, encodingOrOffset, length);
      }
      const b = fromObject(value);
      if (b) return b;
      if (typeof Symbol !== "undefined" && Symbol.toPrimitive != null && typeof value[Symbol.toPrimitive] === "function") {
        return Buffer4.from(value[Symbol.toPrimitive]("string"), encodingOrOffset, length);
      }
      throw new TypeError(
        "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
      );
    }
    __name(from, "from");
    Buffer4.from = function(value, encodingOrOffset, length) {
      return from(value, encodingOrOffset, length);
    };
    Object.setPrototypeOf(Buffer4.prototype, Uint8Array.prototype);
    Object.setPrototypeOf(Buffer4, Uint8Array);
    function assertSize(size) {
      if (typeof size !== "number") {
        throw new TypeError('"size" argument must be of type number');
      } else if (size < 0) {
        throw new RangeError('The value "' + size + '" is invalid for option "size"');
      }
    }
    __name(assertSize, "assertSize");
    function alloc(size, fill, encoding) {
      assertSize(size);
      if (size <= 0) {
        return createBuffer(size);
      }
      if (fill !== void 0) {
        return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
      }
      return createBuffer(size);
    }
    __name(alloc, "alloc");
    Buffer4.alloc = function(size, fill, encoding) {
      return alloc(size, fill, encoding);
    };
    function allocUnsafe(size) {
      assertSize(size);
      return createBuffer(size < 0 ? 0 : checked(size) | 0);
    }
    __name(allocUnsafe, "allocUnsafe");
    Buffer4.allocUnsafe = function(size) {
      return allocUnsafe(size);
    };
    Buffer4.allocUnsafeSlow = function(size) {
      return allocUnsafe(size);
    };
    function fromString2(string, encoding) {
      if (typeof encoding !== "string" || encoding === "") {
        encoding = "utf8";
      }
      if (!Buffer4.isEncoding(encoding)) {
        throw new TypeError("Unknown encoding: " + encoding);
      }
      const length = byteLength(string, encoding) | 0;
      let buf = createBuffer(length);
      const actual = buf.write(string, encoding);
      if (actual !== length) {
        buf = buf.slice(0, actual);
      }
      return buf;
    }
    __name(fromString2, "fromString");
    function fromArrayLike(array) {
      const length = array.length < 0 ? 0 : checked(array.length) | 0;
      const buf = createBuffer(length);
      for (let i = 0; i < length; i += 1) {
        buf[i] = array[i] & 255;
      }
      return buf;
    }
    __name(fromArrayLike, "fromArrayLike");
    function fromArrayView(arrayView) {
      if (isInstance(arrayView, Uint8Array)) {
        const copy = new Uint8Array(arrayView);
        return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength);
      }
      return fromArrayLike(arrayView);
    }
    __name(fromArrayView, "fromArrayView");
    function fromArrayBuffer(array, byteOffset, length) {
      if (byteOffset < 0 || array.byteLength < byteOffset) {
        throw new RangeError('"offset" is outside of buffer bounds');
      }
      if (array.byteLength < byteOffset + (length || 0)) {
        throw new RangeError('"length" is outside of buffer bounds');
      }
      let buf;
      if (byteOffset === void 0 && length === void 0) {
        buf = new Uint8Array(array);
      } else if (length === void 0) {
        buf = new Uint8Array(array, byteOffset);
      } else {
        buf = new Uint8Array(array, byteOffset, length);
      }
      Object.setPrototypeOf(buf, Buffer4.prototype);
      return buf;
    }
    __name(fromArrayBuffer, "fromArrayBuffer");
    function fromObject(obj) {
      if (Buffer4.isBuffer(obj)) {
        const len = checked(obj.length) | 0;
        const buf = createBuffer(len);
        if (buf.length === 0) {
          return buf;
        }
        obj.copy(buf, 0, 0, len);
        return buf;
      }
      if (obj.length !== void 0) {
        if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
          return createBuffer(0);
        }
        return fromArrayLike(obj);
      }
      if (obj.type === "Buffer" && Array.isArray(obj.data)) {
        return fromArrayLike(obj.data);
      }
    }
    __name(fromObject, "fromObject");
    function checked(length) {
      if (length >= K_MAX_LENGTH) {
        throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
      }
      return length | 0;
    }
    __name(checked, "checked");
    function SlowBuffer(length) {
      if (+length != length) {
        length = 0;
      }
      return Buffer4.alloc(+length);
    }
    __name(SlowBuffer, "SlowBuffer");
    Buffer4.isBuffer = /* @__PURE__ */ __name(function isBuffer2(b) {
      return b != null && b._isBuffer === true && b !== Buffer4.prototype;
    }, "isBuffer");
    Buffer4.compare = /* @__PURE__ */ __name(function compare2(a, b) {
      if (isInstance(a, Uint8Array)) a = Buffer4.from(a, a.offset, a.byteLength);
      if (isInstance(b, Uint8Array)) b = Buffer4.from(b, b.offset, b.byteLength);
      if (!Buffer4.isBuffer(a) || !Buffer4.isBuffer(b)) {
        throw new TypeError(
          'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
        );
      }
      if (a === b) return 0;
      let x = a.length;
      let y = b.length;
      for (let i = 0, len = Math.min(x, y); i < len; ++i) {
        if (a[i] !== b[i]) {
          x = a[i];
          y = b[i];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
      return 0;
    }, "compare");
    Buffer4.isEncoding = /* @__PURE__ */ __name(function isEncoding(encoding) {
      switch (String(encoding).toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "latin1":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return true;
        default:
          return false;
      }
    }, "isEncoding");
    Buffer4.concat = /* @__PURE__ */ __name(function concat(list, length) {
      if (!Array.isArray(list)) {
        throw new TypeError('"list" argument must be an Array of Buffers');
      }
      if (list.length === 0) {
        return Buffer4.alloc(0);
      }
      let i;
      if (length === void 0) {
        length = 0;
        for (i = 0; i < list.length; ++i) {
          length += list[i].length;
        }
      }
      const buffer = Buffer4.allocUnsafe(length);
      let pos = 0;
      for (i = 0; i < list.length; ++i) {
        let buf = list[i];
        if (isInstance(buf, Uint8Array)) {
          if (pos + buf.length > buffer.length) {
            if (!Buffer4.isBuffer(buf)) buf = Buffer4.from(buf);
            buf.copy(buffer, pos);
          } else {
            Uint8Array.prototype.set.call(
              buffer,
              buf,
              pos
            );
          }
        } else if (!Buffer4.isBuffer(buf)) {
          throw new TypeError('"list" argument must be an Array of Buffers');
        } else {
          buf.copy(buffer, pos);
        }
        pos += buf.length;
      }
      return buffer;
    }, "concat");
    function byteLength(string, encoding) {
      if (Buffer4.isBuffer(string)) {
        return string.length;
      }
      if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
        return string.byteLength;
      }
      if (typeof string !== "string") {
        throw new TypeError(
          'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
        );
      }
      const len = string.length;
      const mustMatch = arguments.length > 2 && arguments[2] === true;
      if (!mustMatch && len === 0) return 0;
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "ascii":
          case "latin1":
          case "binary":
            return len;
          case "utf8":
          case "utf-8":
            return utf8ToBytes(string).length;
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return len * 2;
          case "hex":
            return len >>> 1;
          case "base64":
            return base64ToBytes(string).length;
          default:
            if (loweredCase) {
              return mustMatch ? -1 : utf8ToBytes(string).length;
            }
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    }
    __name(byteLength, "byteLength");
    Buffer4.byteLength = byteLength;
    function slowToString(encoding, start, end) {
      let loweredCase = false;
      if (start === void 0 || start < 0) {
        start = 0;
      }
      if (start > this.length) {
        return "";
      }
      if (end === void 0 || end > this.length) {
        end = this.length;
      }
      if (end <= 0) {
        return "";
      }
      end >>>= 0;
      start >>>= 0;
      if (end <= start) {
        return "";
      }
      if (!encoding) encoding = "utf8";
      while (true) {
        switch (encoding) {
          case "hex":
            return hexSlice(this, start, end);
          case "utf8":
          case "utf-8":
            return utf8Slice(this, start, end);
          case "ascii":
            return asciiSlice(this, start, end);
          case "latin1":
          case "binary":
            return latin1Slice(this, start, end);
          case "base64":
            return base64Slice(this, start, end);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return utf16leSlice(this, start, end);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = (encoding + "").toLowerCase();
            loweredCase = true;
        }
      }
    }
    __name(slowToString, "slowToString");
    Buffer4.prototype._isBuffer = true;
    function swap(b, n, m) {
      const i = b[n];
      b[n] = b[m];
      b[m] = i;
    }
    __name(swap, "swap");
    Buffer4.prototype.swap16 = /* @__PURE__ */ __name(function swap16() {
      const len = this.length;
      if (len % 2 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 16-bits");
      }
      for (let i = 0; i < len; i += 2) {
        swap(this, i, i + 1);
      }
      return this;
    }, "swap16");
    Buffer4.prototype.swap32 = /* @__PURE__ */ __name(function swap32() {
      const len = this.length;
      if (len % 4 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 32-bits");
      }
      for (let i = 0; i < len; i += 4) {
        swap(this, i, i + 3);
        swap(this, i + 1, i + 2);
      }
      return this;
    }, "swap32");
    Buffer4.prototype.swap64 = /* @__PURE__ */ __name(function swap64() {
      const len = this.length;
      if (len % 8 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 64-bits");
      }
      for (let i = 0; i < len; i += 8) {
        swap(this, i, i + 7);
        swap(this, i + 1, i + 6);
        swap(this, i + 2, i + 5);
        swap(this, i + 3, i + 4);
      }
      return this;
    }, "swap64");
    Buffer4.prototype.toString = /* @__PURE__ */ __name(function toString3() {
      const length = this.length;
      if (length === 0) return "";
      if (arguments.length === 0) return utf8Slice(this, 0, length);
      return slowToString.apply(this, arguments);
    }, "toString");
    Buffer4.prototype.toLocaleString = Buffer4.prototype.toString;
    Buffer4.prototype.equals = /* @__PURE__ */ __name(function equals2(b) {
      if (!Buffer4.isBuffer(b)) throw new TypeError("Argument must be a Buffer");
      if (this === b) return true;
      return Buffer4.compare(this, b) === 0;
    }, "equals");
    Buffer4.prototype.inspect = /* @__PURE__ */ __name(function inspect() {
      let str = "";
      const max = exports.INSPECT_MAX_BYTES;
      str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim();
      if (this.length > max) str += " ... ";
      return "<Buffer " + str + ">";
    }, "inspect");
    if (customInspectSymbol) {
      Buffer4.prototype[customInspectSymbol] = Buffer4.prototype.inspect;
    }
    Buffer4.prototype.compare = /* @__PURE__ */ __name(function compare2(target, start, end, thisStart, thisEnd) {
      if (isInstance(target, Uint8Array)) {
        target = Buffer4.from(target, target.offset, target.byteLength);
      }
      if (!Buffer4.isBuffer(target)) {
        throw new TypeError(
          'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
        );
      }
      if (start === void 0) {
        start = 0;
      }
      if (end === void 0) {
        end = target ? target.length : 0;
      }
      if (thisStart === void 0) {
        thisStart = 0;
      }
      if (thisEnd === void 0) {
        thisEnd = this.length;
      }
      if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
        throw new RangeError("out of range index");
      }
      if (thisStart >= thisEnd && start >= end) {
        return 0;
      }
      if (thisStart >= thisEnd) {
        return -1;
      }
      if (start >= end) {
        return 1;
      }
      start >>>= 0;
      end >>>= 0;
      thisStart >>>= 0;
      thisEnd >>>= 0;
      if (this === target) return 0;
      let x = thisEnd - thisStart;
      let y = end - start;
      const len = Math.min(x, y);
      const thisCopy = this.slice(thisStart, thisEnd);
      const targetCopy = target.slice(start, end);
      for (let i = 0; i < len; ++i) {
        if (thisCopy[i] !== targetCopy[i]) {
          x = thisCopy[i];
          y = targetCopy[i];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
      return 0;
    }, "compare");
    function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
      if (buffer.length === 0) return -1;
      if (typeof byteOffset === "string") {
        encoding = byteOffset;
        byteOffset = 0;
      } else if (byteOffset > 2147483647) {
        byteOffset = 2147483647;
      } else if (byteOffset < -2147483648) {
        byteOffset = -2147483648;
      }
      byteOffset = +byteOffset;
      if (numberIsNaN(byteOffset)) {
        byteOffset = dir ? 0 : buffer.length - 1;
      }
      if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
      if (byteOffset >= buffer.length) {
        if (dir) return -1;
        else byteOffset = buffer.length - 1;
      } else if (byteOffset < 0) {
        if (dir) byteOffset = 0;
        else return -1;
      }
      if (typeof val === "string") {
        val = Buffer4.from(val, encoding);
      }
      if (Buffer4.isBuffer(val)) {
        if (val.length === 0) {
          return -1;
        }
        return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
      } else if (typeof val === "number") {
        val = val & 255;
        if (typeof Uint8Array.prototype.indexOf === "function") {
          if (dir) {
            return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
          } else {
            return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
          }
        }
        return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
      }
      throw new TypeError("val must be string, number or Buffer");
    }
    __name(bidirectionalIndexOf, "bidirectionalIndexOf");
    function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
      let indexSize = 1;
      let arrLength = arr.length;
      let valLength = val.length;
      if (encoding !== void 0) {
        encoding = String(encoding).toLowerCase();
        if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
          if (arr.length < 2 || val.length < 2) {
            return -1;
          }
          indexSize = 2;
          arrLength /= 2;
          valLength /= 2;
          byteOffset /= 2;
        }
      }
      function read(buf, i2) {
        if (indexSize === 1) {
          return buf[i2];
        } else {
          return buf.readUInt16BE(i2 * indexSize);
        }
      }
      __name(read, "read");
      let i;
      if (dir) {
        let foundIndex = -1;
        for (i = byteOffset; i < arrLength; i++) {
          if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
            if (foundIndex === -1) foundIndex = i;
            if (i - foundIndex + 1 === valLength) return foundIndex * indexSize;
          } else {
            if (foundIndex !== -1) i -= i - foundIndex;
            foundIndex = -1;
          }
        }
      } else {
        if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
        for (i = byteOffset; i >= 0; i--) {
          let found = true;
          for (let j = 0; j < valLength; j++) {
            if (read(arr, i + j) !== read(val, j)) {
              found = false;
              break;
            }
          }
          if (found) return i;
        }
      }
      return -1;
    }
    __name(arrayIndexOf, "arrayIndexOf");
    Buffer4.prototype.includes = /* @__PURE__ */ __name(function includes(val, byteOffset, encoding) {
      return this.indexOf(val, byteOffset, encoding) !== -1;
    }, "includes");
    Buffer4.prototype.indexOf = /* @__PURE__ */ __name(function indexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
    }, "indexOf");
    Buffer4.prototype.lastIndexOf = /* @__PURE__ */ __name(function lastIndexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
    }, "lastIndexOf");
    function hexWrite(buf, string, offset, length) {
      offset = Number(offset) || 0;
      const remaining = buf.length - offset;
      if (!length) {
        length = remaining;
      } else {
        length = Number(length);
        if (length > remaining) {
          length = remaining;
        }
      }
      const strLen = string.length;
      if (length > strLen / 2) {
        length = strLen / 2;
      }
      let i;
      for (i = 0; i < length; ++i) {
        const parsed = parseInt(string.substr(i * 2, 2), 16);
        if (numberIsNaN(parsed)) return i;
        buf[offset + i] = parsed;
      }
      return i;
    }
    __name(hexWrite, "hexWrite");
    function utf8Write(buf, string, offset, length) {
      return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
    }
    __name(utf8Write, "utf8Write");
    function asciiWrite(buf, string, offset, length) {
      return blitBuffer(asciiToBytes(string), buf, offset, length);
    }
    __name(asciiWrite, "asciiWrite");
    function base64Write(buf, string, offset, length) {
      return blitBuffer(base64ToBytes(string), buf, offset, length);
    }
    __name(base64Write, "base64Write");
    function ucs2Write(buf, string, offset, length) {
      return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
    }
    __name(ucs2Write, "ucs2Write");
    Buffer4.prototype.write = /* @__PURE__ */ __name(function write(string, offset, length, encoding) {
      if (offset === void 0) {
        encoding = "utf8";
        length = this.length;
        offset = 0;
      } else if (length === void 0 && typeof offset === "string") {
        encoding = offset;
        length = this.length;
        offset = 0;
      } else if (isFinite(offset)) {
        offset = offset >>> 0;
        if (isFinite(length)) {
          length = length >>> 0;
          if (encoding === void 0) encoding = "utf8";
        } else {
          encoding = length;
          length = void 0;
        }
      } else {
        throw new Error(
          "Buffer.write(string, encoding, offset[, length]) is no longer supported"
        );
      }
      const remaining = this.length - offset;
      if (length === void 0 || length > remaining) length = remaining;
      if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
        throw new RangeError("Attempt to write outside buffer bounds");
      }
      if (!encoding) encoding = "utf8";
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "hex":
            return hexWrite(this, string, offset, length);
          case "utf8":
          case "utf-8":
            return utf8Write(this, string, offset, length);
          case "ascii":
          case "latin1":
          case "binary":
            return asciiWrite(this, string, offset, length);
          case "base64":
            return base64Write(this, string, offset, length);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return ucs2Write(this, string, offset, length);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    }, "write");
    Buffer4.prototype.toJSON = /* @__PURE__ */ __name(function toJSON() {
      return {
        type: "Buffer",
        data: Array.prototype.slice.call(this._arr || this, 0)
      };
    }, "toJSON");
    function base64Slice(buf, start, end) {
      if (start === 0 && end === buf.length) {
        return base64.fromByteArray(buf);
      } else {
        return base64.fromByteArray(buf.slice(start, end));
      }
    }
    __name(base64Slice, "base64Slice");
    function utf8Slice(buf, start, end) {
      end = Math.min(buf.length, end);
      const res = [];
      let i = start;
      while (i < end) {
        const firstByte = buf[i];
        let codePoint = null;
        let bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
        if (i + bytesPerSequence <= end) {
          let secondByte, thirdByte, fourthByte, tempCodePoint;
          switch (bytesPerSequence) {
            case 1:
              if (firstByte < 128) {
                codePoint = firstByte;
              }
              break;
            case 2:
              secondByte = buf[i + 1];
              if ((secondByte & 192) === 128) {
                tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                if (tempCodePoint > 127) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 3:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 4:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              fourthByte = buf[i + 3];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                  codePoint = tempCodePoint;
                }
              }
          }
        }
        if (codePoint === null) {
          codePoint = 65533;
          bytesPerSequence = 1;
        } else if (codePoint > 65535) {
          codePoint -= 65536;
          res.push(codePoint >>> 10 & 1023 | 55296);
          codePoint = 56320 | codePoint & 1023;
        }
        res.push(codePoint);
        i += bytesPerSequence;
      }
      return decodeCodePointsArray(res);
    }
    __name(utf8Slice, "utf8Slice");
    var MAX_ARGUMENTS_LENGTH = 4096;
    function decodeCodePointsArray(codePoints) {
      const len = codePoints.length;
      if (len <= MAX_ARGUMENTS_LENGTH) {
        return String.fromCharCode.apply(String, codePoints);
      }
      let res = "";
      let i = 0;
      while (i < len) {
        res += String.fromCharCode.apply(
          String,
          codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
        );
      }
      return res;
    }
    __name(decodeCodePointsArray, "decodeCodePointsArray");
    function asciiSlice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i] & 127);
      }
      return ret;
    }
    __name(asciiSlice, "asciiSlice");
    function latin1Slice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i]);
      }
      return ret;
    }
    __name(latin1Slice, "latin1Slice");
    function hexSlice(buf, start, end) {
      const len = buf.length;
      if (!start || start < 0) start = 0;
      if (!end || end < 0 || end > len) end = len;
      let out = "";
      for (let i = start; i < end; ++i) {
        out += hexSliceLookupTable[buf[i]];
      }
      return out;
    }
    __name(hexSlice, "hexSlice");
    function utf16leSlice(buf, start, end) {
      const bytes = buf.slice(start, end);
      let res = "";
      for (let i = 0; i < bytes.length - 1; i += 2) {
        res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
      }
      return res;
    }
    __name(utf16leSlice, "utf16leSlice");
    Buffer4.prototype.slice = /* @__PURE__ */ __name(function slice(start, end) {
      const len = this.length;
      start = ~~start;
      end = end === void 0 ? len : ~~end;
      if (start < 0) {
        start += len;
        if (start < 0) start = 0;
      } else if (start > len) {
        start = len;
      }
      if (end < 0) {
        end += len;
        if (end < 0) end = 0;
      } else if (end > len) {
        end = len;
      }
      if (end < start) end = start;
      const newBuf = this.subarray(start, end);
      Object.setPrototypeOf(newBuf, Buffer4.prototype);
      return newBuf;
    }, "slice");
    function checkOffset(offset, ext, length) {
      if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
      if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
    }
    __name(checkOffset, "checkOffset");
    Buffer4.prototype.readUintLE = Buffer4.prototype.readUIntLE = /* @__PURE__ */ __name(function readUIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i = 0;
      while (++i < byteLength2 && (mul *= 256)) {
        val += this[offset + i] * mul;
      }
      return val;
    }, "readUIntLE");
    Buffer4.prototype.readUintBE = Buffer4.prototype.readUIntBE = /* @__PURE__ */ __name(function readUIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        checkOffset(offset, byteLength2, this.length);
      }
      let val = this[offset + --byteLength2];
      let mul = 1;
      while (byteLength2 > 0 && (mul *= 256)) {
        val += this[offset + --byteLength2] * mul;
      }
      return val;
    }, "readUIntBE");
    Buffer4.prototype.readUint8 = Buffer4.prototype.readUInt8 = /* @__PURE__ */ __name(function readUInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      return this[offset];
    }, "readUInt8");
    Buffer4.prototype.readUint16LE = Buffer4.prototype.readUInt16LE = /* @__PURE__ */ __name(function readUInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] | this[offset + 1] << 8;
    }, "readUInt16LE");
    Buffer4.prototype.readUint16BE = Buffer4.prototype.readUInt16BE = /* @__PURE__ */ __name(function readUInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] << 8 | this[offset + 1];
    }, "readUInt16BE");
    Buffer4.prototype.readUint32LE = Buffer4.prototype.readUInt32LE = /* @__PURE__ */ __name(function readUInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
    }, "readUInt32LE");
    Buffer4.prototype.readUint32BE = Buffer4.prototype.readUInt32BE = /* @__PURE__ */ __name(function readUInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
    }, "readUInt32BE");
    Buffer4.prototype.readBigUInt64LE = defineBigIntMethod(/* @__PURE__ */ __name(function readBigUInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const lo = first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24;
      const hi = this[++offset] + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + last * 2 ** 24;
      return BigInt(lo) + (BigInt(hi) << BigInt(32));
    }, "readBigUInt64LE"));
    Buffer4.prototype.readBigUInt64BE = defineBigIntMethod(/* @__PURE__ */ __name(function readBigUInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const hi = first * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      const lo = this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last;
      return (BigInt(hi) << BigInt(32)) + BigInt(lo);
    }, "readBigUInt64BE"));
    Buffer4.prototype.readIntLE = /* @__PURE__ */ __name(function readIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i = 0;
      while (++i < byteLength2 && (mul *= 256)) {
        val += this[offset + i] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    }, "readIntLE");
    Buffer4.prototype.readIntBE = /* @__PURE__ */ __name(function readIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let i = byteLength2;
      let mul = 1;
      let val = this[offset + --i];
      while (i > 0 && (mul *= 256)) {
        val += this[offset + --i] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    }, "readIntBE");
    Buffer4.prototype.readInt8 = /* @__PURE__ */ __name(function readInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      if (!(this[offset] & 128)) return this[offset];
      return (255 - this[offset] + 1) * -1;
    }, "readInt8");
    Buffer4.prototype.readInt16LE = /* @__PURE__ */ __name(function readInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset] | this[offset + 1] << 8;
      return val & 32768 ? val | 4294901760 : val;
    }, "readInt16LE");
    Buffer4.prototype.readInt16BE = /* @__PURE__ */ __name(function readInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset + 1] | this[offset] << 8;
      return val & 32768 ? val | 4294901760 : val;
    }, "readInt16BE");
    Buffer4.prototype.readInt32LE = /* @__PURE__ */ __name(function readInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
    }, "readInt32LE");
    Buffer4.prototype.readInt32BE = /* @__PURE__ */ __name(function readInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
    }, "readInt32BE");
    Buffer4.prototype.readBigInt64LE = defineBigIntMethod(/* @__PURE__ */ __name(function readBigInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = this[offset + 4] + this[offset + 5] * 2 ** 8 + this[offset + 6] * 2 ** 16 + (last << 24);
      return (BigInt(val) << BigInt(32)) + BigInt(first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24);
    }, "readBigInt64LE"));
    Buffer4.prototype.readBigInt64BE = defineBigIntMethod(/* @__PURE__ */ __name(function readBigInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = (first << 24) + // Overflow
      this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      return (BigInt(val) << BigInt(32)) + BigInt(this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last);
    }, "readBigInt64BE"));
    Buffer4.prototype.readFloatLE = /* @__PURE__ */ __name(function readFloatLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, true, 23, 4);
    }, "readFloatLE");
    Buffer4.prototype.readFloatBE = /* @__PURE__ */ __name(function readFloatBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, false, 23, 4);
    }, "readFloatBE");
    Buffer4.prototype.readDoubleLE = /* @__PURE__ */ __name(function readDoubleLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, true, 52, 8);
    }, "readDoubleLE");
    Buffer4.prototype.readDoubleBE = /* @__PURE__ */ __name(function readDoubleBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, false, 52, 8);
    }, "readDoubleBE");
    function checkInt(buf, value, offset, ext, max, min) {
      if (!Buffer4.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
      if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
    }
    __name(checkInt, "checkInt");
    Buffer4.prototype.writeUintLE = Buffer4.prototype.writeUIntLE = /* @__PURE__ */ __name(function writeUIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let mul = 1;
      let i = 0;
      this[offset] = value & 255;
      while (++i < byteLength2 && (mul *= 256)) {
        this[offset + i] = value / mul & 255;
      }
      return offset + byteLength2;
    }, "writeUIntLE");
    Buffer4.prototype.writeUintBE = Buffer4.prototype.writeUIntBE = /* @__PURE__ */ __name(function writeUIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let i = byteLength2 - 1;
      let mul = 1;
      this[offset + i] = value & 255;
      while (--i >= 0 && (mul *= 256)) {
        this[offset + i] = value / mul & 255;
      }
      return offset + byteLength2;
    }, "writeUIntBE");
    Buffer4.prototype.writeUint8 = Buffer4.prototype.writeUInt8 = /* @__PURE__ */ __name(function writeUInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
      this[offset] = value & 255;
      return offset + 1;
    }, "writeUInt8");
    Buffer4.prototype.writeUint16LE = Buffer4.prototype.writeUInt16LE = /* @__PURE__ */ __name(function writeUInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    }, "writeUInt16LE");
    Buffer4.prototype.writeUint16BE = Buffer4.prototype.writeUInt16BE = /* @__PURE__ */ __name(function writeUInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    }, "writeUInt16BE");
    Buffer4.prototype.writeUint32LE = Buffer4.prototype.writeUInt32LE = /* @__PURE__ */ __name(function writeUInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset + 3] = value >>> 24;
      this[offset + 2] = value >>> 16;
      this[offset + 1] = value >>> 8;
      this[offset] = value & 255;
      return offset + 4;
    }, "writeUInt32LE");
    Buffer4.prototype.writeUint32BE = Buffer4.prototype.writeUInt32BE = /* @__PURE__ */ __name(function writeUInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    }, "writeUInt32BE");
    function wrtBigUInt64LE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      return offset;
    }
    __name(wrtBigUInt64LE, "wrtBigUInt64LE");
    function wrtBigUInt64BE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset + 7] = lo;
      lo = lo >> 8;
      buf[offset + 6] = lo;
      lo = lo >> 8;
      buf[offset + 5] = lo;
      lo = lo >> 8;
      buf[offset + 4] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset + 3] = hi;
      hi = hi >> 8;
      buf[offset + 2] = hi;
      hi = hi >> 8;
      buf[offset + 1] = hi;
      hi = hi >> 8;
      buf[offset] = hi;
      return offset + 8;
    }
    __name(wrtBigUInt64BE, "wrtBigUInt64BE");
    Buffer4.prototype.writeBigUInt64LE = defineBigIntMethod(/* @__PURE__ */ __name(function writeBigUInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    }, "writeBigUInt64LE"));
    Buffer4.prototype.writeBigUInt64BE = defineBigIntMethod(/* @__PURE__ */ __name(function writeBigUInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    }, "writeBigUInt64BE"));
    Buffer4.prototype.writeIntLE = /* @__PURE__ */ __name(function writeIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i = 0;
      let mul = 1;
      let sub = 0;
      this[offset] = value & 255;
      while (++i < byteLength2 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    }, "writeIntLE");
    Buffer4.prototype.writeIntBE = /* @__PURE__ */ __name(function writeIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i = byteLength2 - 1;
      let mul = 1;
      let sub = 0;
      this[offset + i] = value & 255;
      while (--i >= 0 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    }, "writeIntBE");
    Buffer4.prototype.writeInt8 = /* @__PURE__ */ __name(function writeInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
      if (value < 0) value = 255 + value + 1;
      this[offset] = value & 255;
      return offset + 1;
    }, "writeInt8");
    Buffer4.prototype.writeInt16LE = /* @__PURE__ */ __name(function writeInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    }, "writeInt16LE");
    Buffer4.prototype.writeInt16BE = /* @__PURE__ */ __name(function writeInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    }, "writeInt16BE");
    Buffer4.prototype.writeInt32LE = /* @__PURE__ */ __name(function writeInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      this[offset + 2] = value >>> 16;
      this[offset + 3] = value >>> 24;
      return offset + 4;
    }, "writeInt32LE");
    Buffer4.prototype.writeInt32BE = /* @__PURE__ */ __name(function writeInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      if (value < 0) value = 4294967295 + value + 1;
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    }, "writeInt32BE");
    Buffer4.prototype.writeBigInt64LE = defineBigIntMethod(/* @__PURE__ */ __name(function writeBigInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    }, "writeBigInt64LE"));
    Buffer4.prototype.writeBigInt64BE = defineBigIntMethod(/* @__PURE__ */ __name(function writeBigInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    }, "writeBigInt64BE"));
    function checkIEEE754(buf, value, offset, ext, max, min) {
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
      if (offset < 0) throw new RangeError("Index out of range");
    }
    __name(checkIEEE754, "checkIEEE754");
    function writeFloat(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 4, 34028234663852886e22, -34028234663852886e22);
      }
      ieee754.write(buf, value, offset, littleEndian, 23, 4);
      return offset + 4;
    }
    __name(writeFloat, "writeFloat");
    Buffer4.prototype.writeFloatLE = /* @__PURE__ */ __name(function writeFloatLE(value, offset, noAssert) {
      return writeFloat(this, value, offset, true, noAssert);
    }, "writeFloatLE");
    Buffer4.prototype.writeFloatBE = /* @__PURE__ */ __name(function writeFloatBE(value, offset, noAssert) {
      return writeFloat(this, value, offset, false, noAssert);
    }, "writeFloatBE");
    function writeDouble(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 8, 17976931348623157e292, -17976931348623157e292);
      }
      ieee754.write(buf, value, offset, littleEndian, 52, 8);
      return offset + 8;
    }
    __name(writeDouble, "writeDouble");
    Buffer4.prototype.writeDoubleLE = /* @__PURE__ */ __name(function writeDoubleLE(value, offset, noAssert) {
      return writeDouble(this, value, offset, true, noAssert);
    }, "writeDoubleLE");
    Buffer4.prototype.writeDoubleBE = /* @__PURE__ */ __name(function writeDoubleBE(value, offset, noAssert) {
      return writeDouble(this, value, offset, false, noAssert);
    }, "writeDoubleBE");
    Buffer4.prototype.copy = /* @__PURE__ */ __name(function copy(target, targetStart, start, end) {
      if (!Buffer4.isBuffer(target)) throw new TypeError("argument should be a Buffer");
      if (!start) start = 0;
      if (!end && end !== 0) end = this.length;
      if (targetStart >= target.length) targetStart = target.length;
      if (!targetStart) targetStart = 0;
      if (end > 0 && end < start) end = start;
      if (end === start) return 0;
      if (target.length === 0 || this.length === 0) return 0;
      if (targetStart < 0) {
        throw new RangeError("targetStart out of bounds");
      }
      if (start < 0 || start >= this.length) throw new RangeError("Index out of range");
      if (end < 0) throw new RangeError("sourceEnd out of bounds");
      if (end > this.length) end = this.length;
      if (target.length - targetStart < end - start) {
        end = target.length - targetStart + start;
      }
      const len = end - start;
      if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
        this.copyWithin(targetStart, start, end);
      } else {
        Uint8Array.prototype.set.call(
          target,
          this.subarray(start, end),
          targetStart
        );
      }
      return len;
    }, "copy");
    Buffer4.prototype.fill = /* @__PURE__ */ __name(function fill(val, start, end, encoding) {
      if (typeof val === "string") {
        if (typeof start === "string") {
          encoding = start;
          start = 0;
          end = this.length;
        } else if (typeof end === "string") {
          encoding = end;
          end = this.length;
        }
        if (encoding !== void 0 && typeof encoding !== "string") {
          throw new TypeError("encoding must be a string");
        }
        if (typeof encoding === "string" && !Buffer4.isEncoding(encoding)) {
          throw new TypeError("Unknown encoding: " + encoding);
        }
        if (val.length === 1) {
          const code = val.charCodeAt(0);
          if (encoding === "utf8" && code < 128 || encoding === "latin1") {
            val = code;
          }
        }
      } else if (typeof val === "number") {
        val = val & 255;
      } else if (typeof val === "boolean") {
        val = Number(val);
      }
      if (start < 0 || this.length < start || this.length < end) {
        throw new RangeError("Out of range index");
      }
      if (end <= start) {
        return this;
      }
      start = start >>> 0;
      end = end === void 0 ? this.length : end >>> 0;
      if (!val) val = 0;
      let i;
      if (typeof val === "number") {
        for (i = start; i < end; ++i) {
          this[i] = val;
        }
      } else {
        const bytes = Buffer4.isBuffer(val) ? val : Buffer4.from(val, encoding);
        const len = bytes.length;
        if (len === 0) {
          throw new TypeError('The value "' + val + '" is invalid for argument "value"');
        }
        for (i = 0; i < end - start; ++i) {
          this[i + start] = bytes[i % len];
        }
      }
      return this;
    }, "fill");
    var errors = {};
    function E(sym, getMessage, Base) {
      errors[sym] = class NodeError extends Base {
        static {
          __name(this, "NodeError");
        }
        constructor() {
          super();
          Object.defineProperty(this, "message", {
            value: getMessage.apply(this, arguments),
            writable: true,
            configurable: true
          });
          this.name = `${this.name} [${sym}]`;
          this.stack;
          delete this.name;
        }
        get code() {
          return sym;
        }
        set code(value) {
          Object.defineProperty(this, "code", {
            configurable: true,
            enumerable: true,
            value,
            writable: true
          });
        }
        toString() {
          return `${this.name} [${sym}]: ${this.message}`;
        }
      };
    }
    __name(E, "E");
    E(
      "ERR_BUFFER_OUT_OF_BOUNDS",
      function(name) {
        if (name) {
          return `${name} is outside of buffer bounds`;
        }
        return "Attempt to access memory outside buffer bounds";
      },
      RangeError
    );
    E(
      "ERR_INVALID_ARG_TYPE",
      function(name, actual) {
        return `The "${name}" argument must be of type number. Received type ${typeof actual}`;
      },
      TypeError
    );
    E(
      "ERR_OUT_OF_RANGE",
      function(str, range, input) {
        let msg = `The value of "${str}" is out of range.`;
        let received = input;
        if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
          received = addNumericalSeparator(String(input));
        } else if (typeof input === "bigint") {
          received = String(input);
          if (input > BigInt(2) ** BigInt(32) || input < -(BigInt(2) ** BigInt(32))) {
            received = addNumericalSeparator(received);
          }
          received += "n";
        }
        msg += ` It must be ${range}. Received ${received}`;
        return msg;
      },
      RangeError
    );
    function addNumericalSeparator(val) {
      let res = "";
      let i = val.length;
      const start = val[0] === "-" ? 1 : 0;
      for (; i >= start + 4; i -= 3) {
        res = `_${val.slice(i - 3, i)}${res}`;
      }
      return `${val.slice(0, i)}${res}`;
    }
    __name(addNumericalSeparator, "addNumericalSeparator");
    function checkBounds(buf, offset, byteLength2) {
      validateNumber(offset, "offset");
      if (buf[offset] === void 0 || buf[offset + byteLength2] === void 0) {
        boundsError(offset, buf.length - (byteLength2 + 1));
      }
    }
    __name(checkBounds, "checkBounds");
    function checkIntBI(value, min, max, buf, offset, byteLength2) {
      if (value > max || value < min) {
        const n = typeof min === "bigint" ? "n" : "";
        let range;
        if (byteLength2 > 3) {
          if (min === 0 || min === BigInt(0)) {
            range = `>= 0${n} and < 2${n} ** ${(byteLength2 + 1) * 8}${n}`;
          } else {
            range = `>= -(2${n} ** ${(byteLength2 + 1) * 8 - 1}${n}) and < 2 ** ${(byteLength2 + 1) * 8 - 1}${n}`;
          }
        } else {
          range = `>= ${min}${n} and <= ${max}${n}`;
        }
        throw new errors.ERR_OUT_OF_RANGE("value", range, value);
      }
      checkBounds(buf, offset, byteLength2);
    }
    __name(checkIntBI, "checkIntBI");
    function validateNumber(value, name) {
      if (typeof value !== "number") {
        throw new errors.ERR_INVALID_ARG_TYPE(name, "number", value);
      }
    }
    __name(validateNumber, "validateNumber");
    function boundsError(value, length, type) {
      if (Math.floor(value) !== value) {
        validateNumber(value, type);
        throw new errors.ERR_OUT_OF_RANGE(type || "offset", "an integer", value);
      }
      if (length < 0) {
        throw new errors.ERR_BUFFER_OUT_OF_BOUNDS();
      }
      throw new errors.ERR_OUT_OF_RANGE(
        type || "offset",
        `>= ${type ? 1 : 0} and <= ${length}`,
        value
      );
    }
    __name(boundsError, "boundsError");
    var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
    function base64clean(str) {
      str = str.split("=")[0];
      str = str.trim().replace(INVALID_BASE64_RE, "");
      if (str.length < 2) return "";
      while (str.length % 4 !== 0) {
        str = str + "=";
      }
      return str;
    }
    __name(base64clean, "base64clean");
    function utf8ToBytes(string, units) {
      units = units || Infinity;
      let codePoint;
      const length = string.length;
      let leadSurrogate = null;
      const bytes = [];
      for (let i = 0; i < length; ++i) {
        codePoint = string.charCodeAt(i);
        if (codePoint > 55295 && codePoint < 57344) {
          if (!leadSurrogate) {
            if (codePoint > 56319) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            } else if (i + 1 === length) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            }
            leadSurrogate = codePoint;
            continue;
          }
          if (codePoint < 56320) {
            if ((units -= 3) > -1) bytes.push(239, 191, 189);
            leadSurrogate = codePoint;
            continue;
          }
          codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
        } else if (leadSurrogate) {
          if ((units -= 3) > -1) bytes.push(239, 191, 189);
        }
        leadSurrogate = null;
        if (codePoint < 128) {
          if ((units -= 1) < 0) break;
          bytes.push(codePoint);
        } else if (codePoint < 2048) {
          if ((units -= 2) < 0) break;
          bytes.push(
            codePoint >> 6 | 192,
            codePoint & 63 | 128
          );
        } else if (codePoint < 65536) {
          if ((units -= 3) < 0) break;
          bytes.push(
            codePoint >> 12 | 224,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else if (codePoint < 1114112) {
          if ((units -= 4) < 0) break;
          bytes.push(
            codePoint >> 18 | 240,
            codePoint >> 12 & 63 | 128,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else {
          throw new Error("Invalid code point");
        }
      }
      return bytes;
    }
    __name(utf8ToBytes, "utf8ToBytes");
    function asciiToBytes(str) {
      const byteArray = [];
      for (let i = 0; i < str.length; ++i) {
        byteArray.push(str.charCodeAt(i) & 255);
      }
      return byteArray;
    }
    __name(asciiToBytes, "asciiToBytes");
    function utf16leToBytes(str, units) {
      let c, hi, lo;
      const byteArray = [];
      for (let i = 0; i < str.length; ++i) {
        if ((units -= 2) < 0) break;
        c = str.charCodeAt(i);
        hi = c >> 8;
        lo = c % 256;
        byteArray.push(lo);
        byteArray.push(hi);
      }
      return byteArray;
    }
    __name(utf16leToBytes, "utf16leToBytes");
    function base64ToBytes(str) {
      return base64.toByteArray(base64clean(str));
    }
    __name(base64ToBytes, "base64ToBytes");
    function blitBuffer(src, dst, offset, length) {
      let i;
      for (i = 0; i < length; ++i) {
        if (i + offset >= dst.length || i >= src.length) break;
        dst[i + offset] = src[i];
      }
      return i;
    }
    __name(blitBuffer, "blitBuffer");
    function isInstance(obj, type) {
      return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
    }
    __name(isInstance, "isInstance");
    function numberIsNaN(obj) {
      return obj !== obj;
    }
    __name(numberIsNaN, "numberIsNaN");
    var hexSliceLookupTable = (function() {
      const alphabet = "0123456789abcdef";
      const table = new Array(256);
      for (let i = 0; i < 16; ++i) {
        const i16 = i * 16;
        for (let j = 0; j < 16; ++j) {
          table[i16 + j] = alphabet[i] + alphabet[j];
        }
      }
      return table;
    })();
    function defineBigIntMethod(fn) {
      return typeof BigInt === "undefined" ? BufferBigIntNotDefined : fn;
    }
    __name(defineBigIntMethod, "defineBigIntMethod");
    function BufferBigIntNotDefined() {
      throw new Error("BigInt not supported");
    }
    __name(BufferBigIntNotDefined, "BufferBigIntNotDefined");
  }
});

// ../smartbuffer/dist/index.js
var import_buffer, EMPTY_BUFFER, _isString, isSmartBuffer, SmartBuffer;
var init_dist2 = __esm({
  "../smartbuffer/dist/index.js"() {
    "use strict";
    init_process_shim();
    init_long();
    import_buffer = __toESM(require_buffer(), 1);
    EMPTY_BUFFER = import_buffer.Buffer.allocUnsafe(0);
    _isString = /* @__PURE__ */ __name((value) => typeof value === "string" || value instanceof String, "_isString");
    isSmartBuffer = /* @__PURE__ */ __name((obj) => obj instanceof SmartBuffer, "isSmartBuffer");
    SmartBuffer = class _SmartBuffer {
      static {
        __name(this, "SmartBuffer");
      }
      static {
        this.EMPTY_BUFFER = EMPTY_BUFFER;
      }
      static {
        this.DEFAULT_CAPACITY = 64;
      }
      static {
        this.DEFAULT_NOASSERT = false;
      }
      static {
        this.MAX_VARINT32_BYTES = 5;
      }
      static {
        this.MAX_VARINT64_BYTES = 10;
      }
      static {
        this.METRICS_CHARS = "c";
      }
      static {
        this.METRICS_BYTES = "b";
      }
      constructor(capacity, noAssert = _SmartBuffer.DEFAULT_NOASSERT) {
        this.woffset = 0;
        this.roffset = 0;
        let lCapacity = capacity === void 0 || Number.isNaN(capacity) ? _SmartBuffer.DEFAULT_CAPACITY : capacity;
        if (!noAssert) {
          lCapacity |= 0;
          if (lCapacity < 0) {
            throw new TypeError("Illegal capacity");
          }
          noAssert = Boolean(noAssert);
        }
        this.buffer = lCapacity === 0 ? EMPTY_BUFFER : import_buffer.Buffer.allocUnsafe(lCapacity);
        this.noAssert = noAssert;
      }
      get length() {
        return this.woffset - this.roffset;
      }
      get capacity() {
        return this.buffer.length;
      }
      readBitSet(offset) {
        let loffset = offset ?? this.roffset;
        const ret = this.readVarint32(loffset);
        const bits = ret.value;
        let bytes = bits >> 3;
        let bit = 0;
        const value = [];
        let k;
        loffset += ret.length;
        while (bytes--) {
          k = this.readInt8(loffset++);
          value[bit++] = Boolean(k & 1);
          value[bit++] = Boolean(k & 2);
          value[bit++] = Boolean(k & 4);
          value[bit++] = Boolean(k & 8);
          value[bit++] = Boolean(k & 16);
          value[bit++] = Boolean(k & 32);
          value[bit++] = Boolean(k & 64);
          value[bit++] = Boolean(k & 128);
        }
        if (bit < bits) {
          let m = 0;
          k = this.readInt8(loffset++);
          while (bit < bits) {
            value[bit++] = Boolean(k >> m++ & 1);
          }
        }
        if (offset === void 0) {
          this.roffset = loffset;
        }
        return value;
      }
      read(length, offset) {
        let loffset = offset ?? this.roffset;
        if (!this.noAssert) {
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          loffset >>>= 0;
          if (loffset < 0 || loffset + length > this.buffer.length) {
            throw new TypeError(`Illegal offset: 0 <= ${loffset} (${length}) <= ${this.buffer.length}`);
          }
        }
        const slice = this.slice(offset, loffset + length);
        if (offset === void 0) {
          this.roffset += length;
        }
        return slice;
      }
      readInt8(offset) {
        const loffset = this._checkRead(1, offset);
        let value = this.buffer[loffset];
        if ((value & 128) === 128) {
          value = -(255 - value + 1);
        }
        return value;
      }
      readUInt8(offset) {
        const loffset = this._checkRead(1, offset);
        return this.buffer[loffset];
      }
      readInt16LE(offset) {
        const loffset = this._checkRead(2, offset);
        let value = 0;
        value = this.buffer[loffset];
        value |= this.buffer[loffset + 1] << 8;
        if ((value & 32768) === 32768) {
          value = -(65535 - value + 1);
        }
        return value;
      }
      readInt16BE(offset) {
        const loffset = this._checkRead(2, offset);
        let value = 0;
        value = this.buffer[loffset] << 8;
        value |= this.buffer[loffset + 1];
        if ((value & 32768) === 32768) {
          value = -(65535 - value + 1);
        }
        return value;
      }
      readUInt16LE(offset) {
        const loffset = this._checkRead(2, offset);
        let value = 0;
        value = this.buffer[loffset];
        value |= this.buffer[loffset + 1] << 8;
        return value;
      }
      readUInt16BE(offset) {
        const loffset = this._checkRead(2, offset);
        let value = 0;
        value = this.buffer[loffset] << 8;
        value |= this.buffer[loffset + 1];
        return value;
      }
      readUInt24BE(offset) {
        const loffset = this._checkRead(3, offset);
        let value = 0;
        value = this.buffer[loffset] << 16;
        value |= this.buffer[loffset + 1] << 8;
        value |= this.buffer[loffset + 2];
        value |= 0;
        return value;
      }
      readInt32LE(offset) {
        const loffset = this._checkRead(4, offset);
        let value = 0;
        value = this.buffer[loffset + 2] << 16;
        value |= this.buffer[loffset + 1] << 8;
        value |= this.buffer[loffset];
        value += this.buffer[loffset + 3] << 24 >>> 0;
        value |= 0;
        return value;
      }
      readInt32BE(offset) {
        const loffset = this._checkRead(4, offset);
        let value = 0;
        value = this.buffer[loffset + 1] << 16;
        value |= this.buffer[loffset + 2] << 8;
        value |= this.buffer[loffset + 3];
        value += this.buffer[loffset] << 24 >>> 0;
        value |= 0;
        return value;
      }
      readUInt32LE(offset) {
        const loffset = this._checkRead(4, offset);
        let value = 0;
        value = this.buffer[loffset + 2] << 16;
        value |= this.buffer[loffset + 1] << 8;
        value |= this.buffer[loffset];
        value += this.buffer[loffset + 3] << 24 >>> 0;
        return value;
      }
      readUInt32BE(offset) {
        const loffset = this._checkRead(4, offset);
        let value = 0;
        value = this.buffer[loffset + 1] << 16;
        value |= this.buffer[loffset + 2] << 8;
        value |= this.buffer[loffset + 3];
        value += this.buffer[loffset] << 24 >>> 0;
        return value;
      }
      readInt64LE(offset) {
        const loffset = this._checkRead(8, offset);
        let lo = 0;
        let hi = 0;
        lo = this.buffer[loffset + 2] << 16;
        lo |= this.buffer[loffset + 1] << 8;
        lo |= this.buffer[loffset];
        lo += this.buffer[loffset + 3] << 24 >>> 0;
        hi = this.buffer[loffset + 6] << 16;
        hi |= this.buffer[loffset + 5] << 8;
        hi |= this.buffer[loffset + 4];
        hi += this.buffer[loffset + 7] << 24 >>> 0;
        return new long_default(lo, hi, false);
      }
      readInt64BE(offset) {
        const loffset = this._checkRead(8, offset);
        let lo = 0;
        let hi = 0;
        hi = this.buffer[loffset + 1] << 16;
        hi |= this.buffer[loffset + 2] << 8;
        hi |= this.buffer[loffset + 3];
        hi += this.buffer[loffset] << 24 >>> 0;
        lo = this.buffer[loffset + 5] << 16;
        lo |= this.buffer[loffset + 6] << 8;
        lo |= this.buffer[loffset + 7];
        lo += this.buffer[loffset + 4] << 24 >>> 0;
        return new long_default(lo, hi, false);
      }
      readUInt64LE(offset) {
        const loffset = this._checkRead(8, offset);
        let lo = 0;
        let hi = 0;
        lo = this.buffer[loffset + 2] << 16;
        lo |= this.buffer[loffset + 1] << 8;
        lo |= this.buffer[loffset];
        lo += this.buffer[loffset + 3] << 24 >>> 0;
        hi = this.buffer[loffset + 6] << 16;
        hi |= this.buffer[loffset + 5] << 8;
        hi |= this.buffer[loffset + 4];
        hi += this.buffer[loffset + 7] << 24 >>> 0;
        return new long_default(lo, hi, true);
      }
      readUInt64BE(offset) {
        const loffset = this._checkRead(8, offset);
        let lo = 0;
        let hi = 0;
        hi = this.buffer[loffset + 1] << 16;
        hi |= this.buffer[loffset + 2] << 8;
        hi |= this.buffer[loffset + 3];
        hi += this.buffer[loffset] << 24 >>> 0;
        lo = this.buffer[loffset + 5] << 16;
        lo |= this.buffer[loffset + 6] << 8;
        lo |= this.buffer[loffset + 7];
        lo += this.buffer[loffset + 4] << 24 >>> 0;
        return new long_default(lo, hi, true);
      }
      readBigIntBE(offset) {
        const loffset = this._checkRead(8, offset);
        let value = BigInt(this.buffer[loffset]) << 56n | BigInt(this.buffer[loffset + 1]) << 48n | BigInt(this.buffer[loffset + 2]) << 40n | BigInt(this.buffer[loffset + 3]) << 32n | BigInt(this.buffer[loffset + 4]) << 24n | BigInt(this.buffer[loffset + 5]) << 16n | BigInt(this.buffer[loffset + 6]) << 8n | BigInt(this.buffer[loffset + 7]);
        if (value & 1n << 63n) {
          value -= 1n << 64n;
        }
        return value;
      }
      readUBigIntBE(offset) {
        const loffset = this._checkRead(8, offset);
        const value = BigInt(this.buffer[loffset]) << 56n | BigInt(this.buffer[loffset + 1]) << 48n | BigInt(this.buffer[loffset + 2]) << 40n | BigInt(this.buffer[loffset + 3]) << 32n | BigInt(this.buffer[loffset + 4]) << 24n | BigInt(this.buffer[loffset + 5]) << 16n | BigInt(this.buffer[loffset + 6]) << 8n | BigInt(this.buffer[loffset + 7]);
        return value;
      }
      readBigIntLE(offset) {
        const loffset = this._checkRead(8, offset);
        let value = BigInt(this.buffer[loffset]) << 0n | BigInt(this.buffer[loffset + 1]) << 8n | BigInt(this.buffer[loffset + 2]) << 16n | BigInt(this.buffer[loffset + 3]) << 24n | BigInt(this.buffer[loffset + 4]) << 32n | BigInt(this.buffer[loffset + 5]) << 40n | BigInt(this.buffer[loffset + 6]) << 48n | BigInt(this.buffer[loffset + 7]) << 56n;
        if (value & 1n << 63n) {
          value -= 1n << 64n;
        }
        return value;
      }
      readUBigIntLE(offset) {
        const loffset = this._checkRead(8, offset);
        const value = BigInt(this.buffer[loffset + 7]) << 56n | BigInt(this.buffer[loffset + 6]) << 48n | BigInt(this.buffer[loffset + 5]) << 40n | BigInt(this.buffer[loffset + 4]) << 32n | BigInt(this.buffer[loffset + 3]) << 24n | BigInt(this.buffer[loffset + 2]) << 16n | BigInt(this.buffer[loffset + 1]) << 8n | BigInt(this.buffer[loffset]);
        return value;
      }
      readFloatLE(offset) {
        const loffset = this._checkRead(4, offset);
        return this.buffer.readFloatLE(loffset);
      }
      readFloatBE(offset) {
        const loffset = this._checkRead(4, offset);
        return this.buffer.readFloatBE(loffset);
      }
      readDoubleLE(offset) {
        const loffset = this._checkRead(8, offset);
        return this.buffer.readDoubleLE(loffset);
      }
      readDoubleBE(offset) {
        const loffset = this._checkRead(8, offset);
        return this.buffer.readDoubleBE(loffset);
      }
      write(source, offset, length, encoding = "utf8") {
        let loffset = offset === void 0 ? this.woffset : offset;
        const result = loffset >>> 0;
        if (!this.noAssert) {
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          if (loffset < 0 || loffset + 0 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (0) <= ${this.buffer.length}`);
          }
        }
        let llength;
        const isString2 = _isString(source);
        if (isString2) {
          llength = length || import_buffer.Buffer.byteLength(source);
        } else {
          if (!(source instanceof _SmartBuffer)) {
            source = _SmartBuffer.wrap(source, encoding);
          }
          llength = source.woffset - source.roffset;
        }
        if (llength <= 0) {
          return this;
        }
        loffset += llength;
        let capacity = this.buffer.length;
        if (loffset > capacity) {
          this.resize((capacity *= 2) > loffset ? capacity : loffset);
        }
        if (isString2) {
          this.buffer.write(source, result);
        } else {
          source.buffer.copy(this.buffer, result, source.roffset, source.woffset);
          source.roffset += llength;
        }
        if (offset === void 0) {
          this.woffset += llength;
        }
        return this;
      }
      writeBitSet(value, offset) {
        let loffset = offset ?? this.woffset;
        if (!this.noAssert) {
          if (!Array.isArray(value)) {
            throw new TypeError("Illegal BitSet: Not an array");
          }
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          loffset >>>= 0;
          if (loffset < 0 || loffset + 0 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (0) <= ${this.buffer.length}`);
          }
        }
        const start = loffset;
        const bits = value.length;
        let bytes = bits >> 3;
        let bit = 0;
        let k;
        loffset += this.writeVarint32(bits, loffset);
        while (bytes--) {
          k = !!value[bit++] & 1 | !!value[bit++] << 1 | !!value[bit++] << 2 | !!value[bit++] << 3 | !!value[bit++] << 4 | !!value[bit++] << 5 | !!value[bit++] << 6 | !!value[bit++] << 7;
          this.writeInt8(k, loffset++);
        }
        if (bit < bits) {
          let m = 0;
          k = 0;
          while (bit < bits) {
            k = k | !!value[bit++] << m++;
          }
          this.writeInt8(k, loffset++);
        }
        if (offset === void 0) {
          this.woffset = loffset;
          return this;
        }
        return loffset - start;
      }
      writeBuffer(buf, offset) {
        if (buf.length === 0) {
          return this;
        }
        const relative = offset === void 0;
        const loffset = relative ? this.woffset : offset;
        const targetEnd = loffset + buf.length;
        let capacity = this.buffer.length;
        if (targetEnd > capacity) {
          capacity *= 2;
          this.resize(capacity > targetEnd ? capacity : targetEnd);
        }
        buf.copy(this.buffer, loffset);
        if (relative) {
          this.woffset = targetEnd;
        }
        return this;
      }
      writeInt8(value, offset) {
        const iValue = value | 0;
        const loffset = this._checkWrite(iValue, 1, offset);
        this.buffer[loffset] = iValue;
        return this;
      }
      writeUInt8(value, offset) {
        const uValue = value >>> 0;
        const loffset = this._checkWrite(uValue, 1, offset);
        this.buffer[loffset] = uValue;
        return this;
      }
      writeInt16LE(value, offset) {
        const iValue = value | 0;
        const loffset = this._checkWrite(iValue, 2, offset);
        this.buffer[loffset + 1] = iValue >>> 8;
        this.buffer[loffset] = iValue;
        return this;
      }
      writeInt16BE(value, offset) {
        const iValue = value | 0;
        const loffset = this._checkWrite(iValue, 2, offset);
        this.buffer[loffset] = iValue >>> 8;
        this.buffer[loffset + 1] = iValue;
        return this;
      }
      writeUInt16LE(value, offset) {
        const uValue = value >>> 0;
        const loffset = this._checkWrite(uValue, 2, offset);
        this.buffer[loffset + 1] = uValue >>> 8;
        this.buffer[loffset] = uValue;
        return this;
      }
      writeUInt16BE(value, offset) {
        const uValue = value >>> 0;
        const loffset = this._checkWrite(uValue, 2, offset);
        this.buffer[loffset] = uValue >>> 8;
        this.buffer[loffset + 1] = uValue;
        return this;
      }
      writeUInt24BE(value, offset) {
        const uValue = value >>> 0;
        const loffset = this._checkWrite(uValue, 3, offset);
        this.buffer[loffset] = uValue >>> 16;
        this.buffer[loffset + 1] = uValue >>> 8;
        this.buffer[loffset + 2] = uValue;
        return this;
      }
      writeInt32LE(value, offset) {
        const iValue = value | 0;
        const loffset = this._checkWrite(iValue, 4, offset);
        this.buffer[loffset + 3] = iValue >>> 24;
        this.buffer[loffset + 2] = iValue >>> 16;
        this.buffer[loffset + 1] = iValue >>> 8;
        this.buffer[loffset] = iValue;
        return this;
      }
      writeInt32BE(value, offset) {
        const iValue = value | 0;
        const loffset = this._checkWrite(iValue, 4, offset);
        this.buffer[loffset] = iValue >>> 24;
        this.buffer[loffset + 1] = iValue >>> 16;
        this.buffer[loffset + 2] = iValue >>> 8;
        this.buffer[loffset + 3] = iValue;
        return this;
      }
      writeUInt32LE(value, offset) {
        const uValue = value >>> 0;
        offset = this._checkWrite(uValue, 4, offset);
        this.buffer[offset + 3] = uValue >>> 24;
        this.buffer[offset + 2] = uValue >>> 16;
        this.buffer[offset + 1] = uValue >>> 8;
        this.buffer[offset] = uValue;
        return this;
      }
      writeUInt32BE(value, offset) {
        const uValue = value >>> 0;
        offset = this._checkWrite(uValue, 4, offset);
        this.buffer[offset] = uValue >>> 24;
        this.buffer[offset + 1] = uValue >>> 16;
        this.buffer[offset + 2] = uValue >>> 8;
        this.buffer[offset + 3] = uValue;
        return this;
      }
      writeInt64LE(value, offset) {
        const [lvalue, loffset] = this._checkWriteLong(value, offset);
        const lo = lvalue.low;
        const hi = lvalue.high;
        this.buffer[loffset + 3] = lo >>> 24;
        this.buffer[loffset + 2] = lo >>> 16;
        this.buffer[loffset + 1] = lo >>> 8;
        this.buffer[loffset] = lo;
        this.buffer[loffset + 7] = hi >>> 24;
        this.buffer[loffset + 6] = hi >>> 16;
        this.buffer[loffset + 5] = hi >>> 8;
        this.buffer[loffset + 4] = hi;
        return this;
      }
      writeInt64BE(value, offset) {
        const [lvalue, loffset] = this._checkWriteLong(value, offset);
        const lo = lvalue.low;
        const hi = lvalue.high;
        this.buffer[loffset] = hi >>> 24;
        this.buffer[loffset + 1] = hi >>> 16;
        this.buffer[loffset + 2] = hi >>> 8;
        this.buffer[loffset + 3] = hi;
        this.buffer[loffset + 4] = lo >>> 24;
        this.buffer[loffset + 5] = lo >>> 16;
        this.buffer[loffset + 6] = lo >>> 8;
        this.buffer[loffset + 7] = lo;
        return this;
      }
      writeUInt64LE(value, offset) {
        const [lvalue, loffset] = this._checkWriteLong(value, offset);
        const lo = lvalue.low;
        const hi = lvalue.high;
        this.buffer[loffset + 3] = lo >>> 24;
        this.buffer[loffset + 2] = lo >>> 16;
        this.buffer[loffset + 1] = lo >>> 8;
        this.buffer[loffset] = lo;
        this.buffer[loffset + 7] = hi >>> 24;
        this.buffer[loffset + 6] = hi >>> 16;
        this.buffer[loffset + 5] = hi >>> 8;
        this.buffer[loffset + 4] = hi;
        return this;
      }
      writeUInt64BE(value, offset) {
        const [lvalue, loffset] = this._checkWriteLong(value, offset);
        const lo = lvalue.low;
        const hi = lvalue.high;
        this.buffer[loffset] = hi >>> 24;
        this.buffer[loffset + 1] = hi >>> 16;
        this.buffer[loffset + 2] = hi >>> 8;
        this.buffer[loffset + 3] = hi;
        this.buffer[loffset + 4] = lo >>> 24;
        this.buffer[loffset + 5] = lo >>> 16;
        this.buffer[loffset + 6] = lo >>> 8;
        this.buffer[loffset + 7] = lo;
        return this;
      }
      writeBigIntBE(value, offset) {
        const loffset = this._checkWrite(Number(value), 8, offset);
        const isNegative2 = value < 0n;
        if (isNegative2) {
          value = (1n << 64n) + value;
        }
        this.buffer[loffset] = Number(BigInt(value) >> 56n & BigInt(255));
        this.buffer[loffset + 1] = Number(BigInt(value) >> 48n & BigInt(255));
        this.buffer[loffset + 2] = Number(BigInt(value) >> 40n & BigInt(255));
        this.buffer[loffset + 3] = Number(BigInt(value) >> 32n & BigInt(255));
        this.buffer[loffset + 4] = Number(BigInt(value) >> 24n & BigInt(255));
        this.buffer[loffset + 5] = Number(BigInt(value) >> 16n & BigInt(255));
        this.buffer[loffset + 6] = Number(BigInt(value) >> 8n & BigInt(255));
        this.buffer[loffset + 7] = Number(BigInt(value) & BigInt(255));
        return this;
      }
      writeUBigIntBE(value, offset) {
        const loffset = this._checkWrite(Number(value), 8, offset);
        this.buffer[loffset] = Number(BigInt(value) >> 56n & BigInt(255));
        this.buffer[loffset + 1] = Number(BigInt(value) >> 48n & BigInt(255));
        this.buffer[loffset + 2] = Number(BigInt(value) >> 40n & BigInt(255));
        this.buffer[loffset + 3] = Number(BigInt(value) >> 32n & BigInt(255));
        this.buffer[loffset + 4] = Number(BigInt(value) >> 24n & BigInt(255));
        this.buffer[loffset + 5] = Number(BigInt(value) >> 16n & BigInt(255));
        this.buffer[loffset + 6] = Number(BigInt(value) >> 8n & BigInt(255));
        this.buffer[loffset + 7] = Number(BigInt(value) & BigInt(255));
        return this;
      }
      writeBigIntLE(value, offset) {
        const loffset = this._checkWrite(Number(value), 8, offset);
        const isNegative2 = value < 0n;
        if (isNegative2) {
          value = (1n << 64n) + value;
        }
        this.buffer[loffset] = Number(value & 0xffn);
        this.buffer[loffset + 1] = Number(BigInt(value) >> 8n & 0xffn);
        this.buffer[loffset + 2] = Number(BigInt(value) >> 16n & 0xffn);
        this.buffer[loffset + 3] = Number(BigInt(value) >> 24n & 0xffn);
        this.buffer[loffset + 4] = Number(BigInt(value) >> 32n & 0xffn);
        this.buffer[loffset + 5] = Number(BigInt(value) >> 40n & 0xffn);
        this.buffer[loffset + 6] = Number(BigInt(value) >> 48n & 0xffn);
        this.buffer[loffset + 7] = Number(BigInt(value) >> 56n & 0xffn);
        return this;
      }
      writeUBigIntLE(value, offset) {
        const loffset = this._checkWrite(Number(value), 8, offset);
        this.buffer[loffset] = Number(value & 0xffn);
        this.buffer[loffset + 1] = Number(BigInt(value) >> 8n & 0xffn);
        this.buffer[loffset + 2] = Number(BigInt(value) >> 16n & 0xffn);
        this.buffer[loffset + 3] = Number(BigInt(value) >> 24n & 0xffn);
        this.buffer[loffset + 4] = Number(BigInt(value) >> 32n & 0xffn);
        this.buffer[loffset + 5] = Number(BigInt(value) >> 40n & 0xffn);
        this.buffer[loffset + 6] = Number(BigInt(value) >> 48n & 0xffn);
        this.buffer[loffset + 7] = Number(BigInt(value) >> 56n & 0xffn);
        return this;
      }
      writeFloatLE(value, offset) {
        const loffset = this._checkWrite(value, 4, offset, true);
        this.buffer.writeFloatLE(value, loffset);
        return this;
      }
      writeFloatBE(value, offset) {
        const loffset = this._checkWrite(value, 4, offset, true);
        this.buffer.writeFloatBE(value, loffset);
        return this;
      }
      writeDoubleLE(value, offset) {
        const loffset = this._checkWrite(value, 8, offset, true);
        this.buffer.writeDoubleLE(value, loffset);
        return this;
      }
      writeDoubleBE(value, offset) {
        const loffset = this._checkWrite(value, 8, offset, true);
        this.buffer.writeDoubleBE(value, loffset);
        return this;
      }
      _checkRead(bytes, offset) {
        const loffset = offset ?? this.roffset;
        if (offset === void 0) {
          this.roffset += bytes;
        }
        if (!this.noAssert) {
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          if (loffset < 0 || loffset + bytes > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (${bytes}) <= ${this.buffer.length}`);
          }
        }
        return loffset;
      }
      _checkWrite(value, bytes, offset, isFloat = false) {
        let loffset = (offset ?? this.woffset) >>> 0;
        if (offset === void 0) {
          this.woffset += bytes;
        }
        const result = loffset >>>= 0;
        if (!this.noAssert) {
          if (typeof value !== "number" || !isFloat && value % 1 !== 0) {
            throw new TypeError(`Illegal value: ${value} (not an integer)`);
          }
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
          }
          if (loffset < 0 || loffset + 0 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (0) <= ${this.buffer.length}`);
          }
        }
        loffset += bytes;
        let capacity = this.buffer.length;
        if (loffset > capacity) {
          this.resize((capacity *= 2) > loffset ? capacity : loffset);
        }
        return result;
      }
      _checkWriteLong(value, offset) {
        let loffset = offset ?? this.woffset;
        if (offset === void 0) {
          this.woffset += 8;
        }
        const result = loffset >>>= 0;
        if (!this.noAssert) {
          if (typeof value === "number") {
            value = long_default.fromNumber(value);
          } else if (_isString(value)) {
            value = long_default.fromString(value);
          } else if (!(typeof value === "object" && value instanceof long_default)) {
            throw new TypeError(`Illegal value: ${value} (not an integer or Long)`);
          }
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          if (loffset < 0 || loffset + 0 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (0) <= ${this.buffer.length}`);
          }
        }
        if (typeof value === "number") {
          value = long_default.fromNumber(value);
        } else if (_isString(value)) {
          value = long_default.fromString(value);
        }
        loffset += 8;
        let capacity = this.buffer.length;
        if (loffset > capacity) {
          this.resize((capacity *= 2) > loffset ? capacity : loffset);
        }
        return [value, result];
      }
      writeVarint32(value, offset) {
        let loffset = offset ?? this.woffset;
        if (!this.noAssert) {
          if (typeof value !== "number" || value % 1 !== 0) {
            throw new TypeError(`Illegal value: ${value} (not an integer)`);
          }
          value |= 0;
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          loffset >>>= 0;
          if (loffset < 0 || loffset + 0 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (0) <= ${this.buffer.length}`);
          }
        }
        const size = _SmartBuffer.calculateVarint32(value);
        let b;
        loffset += size;
        let capacity10 = this.buffer.length;
        if (loffset > capacity10) {
          this.resize((capacity10 *= 2) > loffset ? capacity10 : loffset);
        }
        loffset -= size;
        value >>>= 0;
        while (value >= 128) {
          b = value & 127 | 128;
          this.buffer[loffset++] = b;
          value >>>= 7;
        }
        this.buffer[loffset++] = value;
        if (offset === void 0) {
          this.woffset = loffset;
          return this;
        }
        return size;
      }
      writeVarint32ZigZag(value, offset) {
        return this.writeVarint32(_SmartBuffer.zigZagEncode32(value), offset);
      }
      readVarint32(offset) {
        let loffset = offset ?? this.roffset;
        if (!this.noAssert) {
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          loffset >>>= 0;
          if (loffset < 0 || loffset + 1 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (1) <= ${this.buffer.length}`);
          }
        }
        let c = 0;
        let value = 0 >>> 0;
        let b;
        do {
          if (!this.noAssert && loffset > this.buffer.length) {
            const err = new Error("Truncated");
            Object.defineProperty(err, "truncated", {
              enumerable: true,
              value: true
            });
            throw err;
          }
          b = this.buffer[loffset++];
          if (c < 5) {
            value |= (b & 127) << 7 * c;
          }
          ++c;
        } while ((b & 128) !== 0);
        value |= 0;
        if (offset === void 0) {
          this.roffset = loffset;
          return value;
        }
        return { value, length: c };
      }
      readVarint32ZigZag(offset) {
        let val = this.readVarint32(offset);
        if (typeof val === "object") {
          val.value = _SmartBuffer.zigZagDecode32(val.value);
        } else {
          val = _SmartBuffer.zigZagDecode32(val);
        }
        return val;
      }
      writeVarint64(value, offset) {
        let loffset = offset === void 0 ? this.woffset : offset;
        if (!this.noAssert) {
          if (typeof value === "number") {
            value = long_default.fromNumber(value);
          } else if (_isString(value)) {
            value = long_default.fromString(value);
          } else if (!(typeof value === "object" && value instanceof long_default)) {
            throw new TypeError(`Illegal value: ${value} (not an integer or Long)`);
          }
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          loffset >>>= 0;
          if (loffset < 0 || loffset + 0 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (0) <= ${this.buffer.length}`);
          }
        }
        if (typeof value === "number") {
          value = long_default.fromNumber(value, false);
        } else if (_isString(value)) {
          value = long_default.fromString(value, false);
        } else if (value.unsigned !== false) {
          value = value.toSigned();
        }
        const size = _SmartBuffer.calculateVarint64(value);
        const part0 = value.toInt() >>> 0;
        const part1 = value.shru(28).toInt() >>> 0;
        const part2 = value.shru(56).toInt() >>> 0;
        loffset += size;
        let capacity11 = this.buffer.length;
        if (loffset > capacity11) {
          this.resize((capacity11 *= 2) > loffset ? capacity11 : loffset);
        }
        loffset -= size;
        switch (size) {
          case 10:
            this.buffer[loffset + 9] = part2 >>> 7 & 1;
          case 9:
            this.buffer[loffset + 8] = size !== 9 ? part2 | 128 : part2 & 127;
          case 8:
            this.buffer[loffset + 7] = size !== 8 ? part1 >>> 21 | 128 : part1 >>> 21 & 127;
          case 7:
            this.buffer[loffset + 6] = size !== 7 ? part1 >>> 14 | 128 : part1 >>> 14 & 127;
          case 6:
            this.buffer[loffset + 5] = size !== 6 ? part1 >>> 7 | 128 : part1 >>> 7 & 127;
          case 5:
            this.buffer[loffset + 4] = size !== 5 ? part1 | 128 : part1 & 127;
          case 4:
            this.buffer[loffset + 3] = size !== 4 ? part0 >>> 21 | 128 : part0 >>> 21 & 127;
          case 3:
            this.buffer[loffset + 2] = size !== 3 ? part0 >>> 14 | 128 : part0 >>> 14 & 127;
          case 2:
            this.buffer[loffset + 1] = size !== 2 ? part0 >>> 7 | 128 : part0 >>> 7 & 127;
          case 1:
            this.buffer[loffset] = size !== 1 ? part0 | 128 : part0 & 127;
        }
        if (offset === void 0) {
          this.woffset += size;
          return this;
        }
        return size;
      }
      writeVarint64ZigZag(value, offset) {
        return this.writeVarint64(_SmartBuffer.zigZagEncode64(value), offset);
      }
      readVarint64(offset) {
        let loffset = offset === void 0 ? this.roffset : offset;
        if (!this.noAssert) {
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          loffset >>>= 0;
          if (loffset < 0 || loffset + 1 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (1) <= ${this.buffer.length}`);
          }
        }
        const start = loffset;
        let part0 = 0;
        let part1 = 0;
        let part2 = 0;
        let b = 0;
        b = this.buffer[loffset++];
        part0 = b & 127;
        if (b & 128) {
          b = this.buffer[loffset++];
          part0 |= (b & 127) << 7;
          if (b & 128 || this.noAssert && b === void 0) {
            b = this.buffer[loffset++];
            part0 |= (b & 127) << 14;
            if (b & 128 || this.noAssert && b === void 0) {
              b = this.buffer[loffset++];
              part0 |= (b & 127) << 21;
              if (b & 128 || this.noAssert && b === void 0) {
                b = this.buffer[loffset++];
                part1 = b & 127;
                if (b & 128 || this.noAssert && b === void 0) {
                  b = this.buffer[loffset++];
                  part1 |= (b & 127) << 7;
                  if (b & 128 || this.noAssert && b === void 0) {
                    b = this.buffer[loffset++];
                    part1 |= (b & 127) << 14;
                    if (b & 128 || this.noAssert && b === void 0) {
                      b = this.buffer[loffset++];
                      part1 |= (b & 127) << 21;
                      if (b & 128 || this.noAssert && b === void 0) {
                        b = this.buffer[loffset++];
                        part2 = b & 127;
                        if (b & 128 || this.noAssert && b === void 0) {
                          b = this.buffer[loffset++];
                          part2 |= (b & 127) << 7;
                          if (b & 128 || this.noAssert && b === void 0) {
                            throw new RangeError("Buffer overrun");
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        const value = long_default.fromBits(part0 | part1 << 28, part1 >>> 4 | part2 << 24, false);
        if (offset === void 0) {
          this.roffset = loffset;
          return value;
        }
        return { value, length: loffset - start };
      }
      readVarint64ZigZag(offset) {
        let val = this.readVarint64(offset);
        if (typeof val === "object" && val.value instanceof long_default) {
          val.value = _SmartBuffer.zigZagDecode64(val.value);
        } else {
          val = _SmartBuffer.zigZagDecode64(val);
        }
        return val;
      }
      writeCString(str, offset) {
        let loffset = offset === void 0 ? this.woffset : offset;
        let i;
        let k = str.length;
        if (!this.noAssert) {
          if (!_isString(str)) {
            throw new TypeError("Illegal str: Not a string");
          }
          for (i = 0; i < k; ++i) {
            if (str.charCodeAt(i) === 0) {
              throw new TypeError("Illegal str: Contains NULL-characters");
            }
          }
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          loffset >>>= 0;
          if (loffset < 0 || loffset + 0 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (0) <= ${this.buffer.length}`);
          }
        }
        k = import_buffer.Buffer.byteLength(str, "utf8");
        loffset += k + 1;
        let capacity12 = this.buffer.length;
        if (loffset > capacity12) {
          this.resize((capacity12 *= 2) > loffset ? capacity12 : loffset);
        }
        loffset -= k + 1;
        loffset += this.buffer.write(str, loffset, k, "utf8");
        this.buffer[loffset++] = 0;
        if (offset === void 0) {
          this.woffset = loffset;
          return this;
        }
        return k;
      }
      readCString(offset) {
        let loffset = offset === void 0 ? this.roffset : offset;
        if (!this.noAssert) {
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
          }
          loffset >>>= 0;
          if (loffset < 0 || loffset + 1 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (1) <= ${this.buffer.length}`);
          }
        }
        const start = loffset;
        let temp;
        do {
          if (loffset >= this.buffer.length) {
            throw new RangeError(`Index out of range: ${loffset} <= ${this.buffer.length}`);
          }
          temp = this.buffer[loffset++];
        } while (temp !== 0);
        const str = this.buffer.toString("utf8", start, loffset - 1);
        if (offset === void 0) {
          this.roffset = loffset;
          return str;
        }
        return { string: str, length: loffset - start };
      }
      writeString(str, offset) {
        let loffset = offset === void 0 ? this.woffset : offset;
        if (!this.noAssert) {
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          loffset >>>= 0;
          if (loffset < 0 || loffset + 0 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (0) <= ${this.buffer.length}`);
          }
        }
        const k = import_buffer.Buffer.byteLength(str, "utf8");
        loffset += k;
        let capacity14 = this.buffer.length;
        if (loffset > capacity14) {
          capacity14 *= 2;
          this.resize(capacity14 > loffset ? capacity14 : loffset);
        }
        loffset -= k;
        loffset += this.buffer.write(str, loffset, k, "utf8");
        if (offset === void 0) {
          this.woffset = loffset;
          return this;
        }
        return k;
      }
      readString(length, metrics, offset) {
        if (typeof metrics === "number") {
          offset = metrics;
          metrics = void 0;
        }
        let loffset = offset === void 0 ? this.roffset : offset;
        if (metrics === void 0) {
          metrics = _SmartBuffer.METRICS_CHARS;
        }
        if (!this.noAssert) {
          if (typeof length !== "number" || length % 1 !== 0) {
            throw new TypeError(`Illegal length: ${length} (not an integer)`);
          }
          length |= 0;
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          loffset >>>= 0;
          if (loffset < 0 || loffset + 0 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (0) <= ${this.buffer.length}`);
          }
        }
        const start = loffset;
        let temp;
        if (metrics === _SmartBuffer.METRICS_CHARS) {
          const decoder = new TextDecoder("utf-8", { fatal: false });
          let charCount = 0;
          let result = "";
          while (charCount < length && loffset < this.buffer.length) {
            let bytesToRead = 1;
            let decoded = "";
            while (bytesToRead <= 4 && loffset + bytesToRead <= this.buffer.length) {
              const bytes = this.buffer.subarray(loffset, loffset + bytesToRead);
              decoded = decoder.decode(bytes, { stream: false });
              if (decoded && decoded !== "\uFFFD") {
                break;
              }
              bytesToRead++;
            }
            if (decoded && decoded !== "\uFFFD") {
              result += decoded;
              charCount += [...decoded].length;
              loffset += bytesToRead;
            } else {
              break;
            }
          }
          if (charCount !== length) {
            throw new RangeError(`Illegal range: Truncated data, ${charCount} == ${length}`);
          }
          if (offset === void 0) {
            this.roffset = loffset;
            return result;
          }
          return { string: result, length: loffset - start };
        } else if (metrics === _SmartBuffer.METRICS_BYTES) {
          if (!this.noAssert) {
            if (typeof loffset !== "number" || loffset % 1 !== 0) {
              throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
            }
            loffset >>>= 0;
            if (loffset < 0 || loffset + length > this.buffer.length) {
              throw new RangeError(`Illegal offset: 0 <= ${loffset} (${length}) <= ${this.buffer.length}`);
            }
          }
          temp = this.buffer.toString("utf8", loffset, loffset + length);
          if (offset === void 0) {
            this.roffset += length;
            return temp;
          }
          return { string: temp, length };
        }
        throw new TypeError(`Unsupported metrics: ${metrics}`);
      }
      writeVString(str, offset) {
        let loffset = offset ?? this.woffset;
        if (!this.noAssert) {
          if (!_isString(str)) {
            throw new TypeError("Illegal str: Not a string");
          }
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          loffset >>>= 0;
          if (loffset < 0 || loffset + 0 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (0) <= ${this.buffer.length}`);
          }
        }
        const start = loffset;
        const k = import_buffer.Buffer.byteLength(str, "utf8");
        const l = _SmartBuffer.calculateVarint32(k);
        loffset += l + k;
        let capacity15 = this.buffer.length;
        if (loffset > capacity15) {
          this.resize((capacity15 *= 2) > loffset ? capacity15 : loffset);
        }
        loffset -= l + k;
        loffset += this.writeVarint32(k, loffset);
        loffset += this.buffer.write(str, loffset, k, "utf8");
        if (offset === void 0) {
          this.woffset = loffset;
          return this;
        }
        return loffset - start;
      }
      readVString(offset) {
        let loffset = offset ?? this.roffset;
        if (!this.noAssert) {
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          loffset >>>= 0;
          if (loffset < 0 || loffset + 1 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (1) <= ${this.buffer.length}`);
          }
        }
        const start = loffset;
        const len = this.readVarint32(loffset);
        const str = this.readString(len.value, _SmartBuffer.METRICS_BYTES, loffset += len.length);
        loffset += str.length;
        if (offset === void 0) {
          this.roffset = loffset;
          return str.string;
        }
        return { string: str.string, length: loffset - start };
      }
      appendTo(target, offset) {
        target.write(this, offset);
        return this;
      }
      assert(assert) {
        this.noAssert = !assert;
        return this;
      }
      reset(resetWOffset = false) {
        this.roffset = 0;
        if (resetWOffset) {
          this.woffset = 0;
        }
        return this;
      }
      clone(copy = false) {
        const bb = new _SmartBuffer(0, this.noAssert);
        if (copy) {
          const buffer = import_buffer.Buffer.allocUnsafe(this.buffer.length);
          this.buffer.copy(buffer);
          bb.buffer = buffer;
        } else {
          bb.buffer = this.buffer;
        }
        bb.roffset = this.roffset;
        bb.woffset = this.woffset;
        return bb;
      }
      compact(begin, end) {
        let lbegin = begin === void 0 ? this.roffset : begin;
        let lend = end === void 0 ? this.buffer.length : end;
        if (!this.noAssert) {
          if (typeof lbegin !== "number" || lbegin % 1 !== 0) {
            throw new TypeError("Illegal begin: Not an integer");
          }
          lbegin >>>= 0;
          if (typeof lend !== "number" || lend % 1 !== 0) {
            throw new TypeError("Illegal end: Not an integer");
          }
          lend >>>= 0;
          if (lbegin < 0 || lbegin > lend || lend > this.buffer.length) {
            throw new RangeError(`Illegal range: 0 <= ${lbegin} <= ${lend} <= ${this.buffer.length}`);
          }
        }
        if (lbegin === 0 && lend === this.buffer.length) {
          return this;
        }
        const len = lend - lbegin;
        if (len === 0) {
          this.buffer = EMPTY_BUFFER;
          this.roffset = 0;
          this.woffset = 0;
          return this;
        }
        const buffer = import_buffer.Buffer.allocUnsafe(len);
        this.buffer.copy(buffer, 0, lbegin, lend);
        this.buffer = buffer;
        this.woffset -= this.roffset;
        this.roffset = 0;
        return this;
      }
      copy(begin, end) {
        let lbegin = begin === void 0 ? this.roffset : begin;
        let lend = end === void 0 ? this.woffset : end;
        if (!this.noAssert) {
          if (typeof lbegin !== "number" || lbegin % 1 !== 0) {
            throw new TypeError("Illegal begin: Not an integer");
          }
          lbegin >>>= 0;
          if (typeof lend !== "number" || lend % 1 !== 0) {
            throw new TypeError("Illegal end: Not an integer");
          }
          lend >>>= 0;
          if (lbegin < 0 || lbegin > lend || lend > this.buffer.length) {
            throw new RangeError(`Illegal range: 0 <= ${lbegin} <= ${lend} <= ${this.buffer.length}`);
          }
        }
        if (lbegin === lend) {
          return new _SmartBuffer(0, this.noAssert);
        }
        const capacity = lend - lbegin;
        const bb = new _SmartBuffer(capacity, this.noAssert);
        bb.roffset = 0;
        bb.woffset = 0;
        this.copyTo(bb, 0, lbegin, lend);
        return bb;
      }
      copyTo(target, targetOffset, sourceStart, sourceEnd) {
        if (!this.noAssert) {
          if (!(target instanceof _SmartBuffer)) {
            throw new TypeError("'target' is not a SmartBuffer");
          }
        }
        const ltargetOffset = targetOffset === void 0 ? target.woffset : targetOffset | 0;
        const lsourceStart = sourceStart === void 0 ? this.roffset : sourceStart | 0;
        const lsourceEnd = sourceEnd === void 0 ? this.woffset : sourceEnd | 0;
        if (ltargetOffset < 0 || ltargetOffset > target.buffer.length) {
          throw new RangeError(`Illegal target range: 0 <= ${ltargetOffset} <= ${target.buffer.length}`);
        }
        if (lsourceStart < 0 || lsourceEnd > this.buffer.length) {
          throw new RangeError(`Illegal source range: 0 <= ${lsourceStart} <= ${this.buffer.length}`);
        }
        const len = lsourceEnd - lsourceStart;
        if (len === 0) {
          return target;
        }
        target.ensureCapacity(ltargetOffset + len);
        this.buffer.copy(target.buffer, ltargetOffset, lsourceStart, lsourceEnd);
        if (sourceStart === void 0) {
          this.roffset += len;
        }
        if (targetOffset === void 0) {
          target.woffset += len;
        }
        return this;
      }
      ensureCapacity(capacity) {
        let current = this.buffer.length;
        if (current < capacity) {
          return this.resize((current *= 2) > capacity ? current : capacity);
        }
        return this;
      }
      fill(value, begin, end) {
        let lbegin = begin === void 0 ? this.woffset : begin;
        if (_isString(value) && value.length > 0) {
          value = value.charCodeAt(0);
        }
        let lend = end === void 0 ? this.buffer.length : end;
        if (!this.noAssert) {
          if (typeof value !== "number" || value % 1 !== 0) {
            throw new TypeError(`Illegal value: ${value} (not an integer)`);
          }
          value |= 0;
          if (typeof lbegin !== "number" || lbegin % 1 !== 0) {
            throw new TypeError("Illegal begin: Not an integer");
          }
          lbegin >>>= 0;
          if (typeof lend !== "number" || lend % 1 !== 0) {
            throw new TypeError("Illegal end: Not an integer");
          }
          lend >>>= 0;
          if (lbegin < 0 || lbegin > lend || lend > this.buffer.length) {
            throw new RangeError(`Illegal range: 0 <= ${lbegin} <= ${lend} <= ${this.buffer.length}`);
          }
        }
        if (lbegin >= lend) {
          return this;
        }
        this.buffer.fill(value, lbegin, lend);
        if (begin === void 0) {
          this.woffset = lend;
        }
        return this;
      }
      prepend(source, offset, encoding) {
        let loffset = offset === void 0 ? this.roffset : offset;
        if (!this.noAssert) {
          if (typeof loffset !== "number" || loffset % 1 !== 0) {
            throw new TypeError(`Illegal offset: ${loffset} (not an integer)`);
          }
          loffset >>>= 0;
          if (loffset < 0 || loffset + 0 > this.buffer.length) {
            throw new RangeError(`Illegal offset: 0 <= ${loffset} (0) <= ${this.buffer.length}`);
          }
        }
        if (!(source instanceof _SmartBuffer)) {
          source = _SmartBuffer.wrap(source, encoding);
        }
        const len = source.buffer.length - source.roffset;
        if (len <= 0) {
          return this;
        }
        const diff = len - loffset;
        if (diff > 0) {
          const buffer = import_buffer.Buffer.allocUnsafe(this.buffer.length + diff);
          this.buffer.copy(buffer, len, loffset, this.buffer.length);
          this.buffer = buffer;
          this.roffset += diff;
          this.woffset += diff;
          loffset += diff;
        }
        source.buffer.copy(this.buffer, loffset - len, source.roffset, source.buffer.length);
        source.roffset = source.buffer.length;
        if (offset === void 0) {
          this.roffset -= len;
        }
        return this;
      }
      prependTo(target, offset) {
        target.prepend(this, offset);
        return this;
      }
      resize(capacity) {
        if (!this.noAssert) {
          if (typeof capacity !== "number" || capacity % 1 !== 0) {
            throw new TypeError(`'capacity' is not an integer: ${capacity}`);
          }
          capacity |= 0;
          if (capacity < 0) {
            throw new TypeError(`Not valid capacity value: 0 <= ${capacity}`);
          }
        }
        if (this.buffer.length < capacity) {
          const buffer = import_buffer.Buffer.allocUnsafe(capacity);
          this.buffer.copy(buffer);
          this.buffer = buffer;
        }
        return this;
      }
      reverse(begin, end) {
        let lbegin = begin === void 0 ? this.roffset : begin;
        let lend = end === void 0 ? this.woffset : end;
        if (!this.noAssert) {
          if (typeof lbegin !== "number" || lbegin % 1 !== 0) {
            throw new TypeError("Illegal begin: Not an integer");
          }
          lbegin >>>= 0;
          if (typeof lend !== "number" || lend % 1 !== 0) {
            throw new TypeError("Illegal end: Not an integer");
          }
          lend >>>= 0;
          if (lbegin < 0 || lbegin > lend || lend > this.buffer.length) {
            throw new RangeError(`Illegal range: 0 <= ${lbegin} <= ${lend} <= ${this.buffer.length}`);
          }
        }
        if (lbegin === lend) {
          return this;
        }
        Array.prototype.reverse.call(this.buffer.slice(lbegin, lend));
        return this;
      }
      skipRead(length) {
        if (!this.noAssert) {
          if (typeof length !== "number" || length % 1 !== 0) {
            throw new TypeError(`Illegal length: ${length} (not an integer)`);
          }
          length |= 0;
        }
        const offset = this.roffset + length;
        if (!this.noAssert) {
          if (offset < 0 || offset > this.buffer.length) {
            throw new RangeError(`Illegal length: 0 <= ${this.roffset} + ${length} <= ${this.buffer.length}`);
          }
        }
        this.roffset = offset;
        return this;
      }
      skipWrite(length) {
        if (!this.noAssert) {
          if (typeof length !== "number" || length % 1 !== 0) {
            throw new TypeError(`Illegal length: ${length} (not an integer)`);
          }
          length |= 0;
        }
        const offset = this.woffset + length;
        if (!this.noAssert) {
          if (offset < 0 || offset > this.buffer.length) {
            throw new RangeError(`Illegal length: 0 <= ${this.woffset} + ${length} <= ${this.buffer.length}`);
          }
        }
        this.woffset = offset;
        return this;
      }
      slice(begin, end) {
        let lbegin = begin === void 0 ? this.roffset : begin;
        let lend = end === void 0 ? this.woffset : end;
        if (!this.noAssert) {
          if (typeof lbegin !== "number" || lbegin % 1 !== 0) {
            throw new TypeError("Illegal begin: Not an integer");
          }
          lbegin >>>= 0;
          if (typeof end !== "number" || lend % 1 !== 0) {
            throw new TypeError("Illegal end: Not an integer");
          }
          lend >>>= 0;
          if (lbegin < 0 || lbegin > lend || lend > this.buffer.length) {
            throw new RangeError(`Illegal range: 0 <= ${lbegin} <= ${lend} <= ${this.buffer.length}`);
          }
        }
        const bb = new _SmartBuffer(lend - lbegin);
        bb.buffer = this.buffer.slice(begin, lend);
        bb.woffset = bb.capacity;
        return bb;
      }
      toBuffer(forceCopy = false, begin, end) {
        let lbegin = begin === void 0 ? this.roffset : begin;
        let lend = end === void 0 ? this.woffset : end;
        lbegin >>>= 0;
        lend >>>= 0;
        if (!this.noAssert) {
          if (typeof lbegin !== "number" || lbegin % 1 !== 0) {
            throw new TypeError("Illegal begin: Not an integer");
          }
          if (typeof lend !== "number" || lend % 1 !== 0) {
            throw new TypeError("Illegal end: Not an integer");
          }
          if (lbegin < 0 || lbegin > lend || lend > this.buffer.length) {
            throw new RangeError(`Illegal range: 0 <= ${lbegin} <= ${lend} <= ${this.buffer.length}`);
          }
        }
        if (forceCopy) {
          const buffer = import_buffer.Buffer.allocUnsafe(lend - lbegin);
          this.buffer.copy(buffer, 0, lbegin, end);
          return buffer;
        }
        if (lbegin === 0 && lend === this.buffer.length) {
          return this.buffer;
        }
        return this.buffer.slice(lbegin, lend);
      }
      toArrayBuffer() {
        let offset = this.roffset;
        let limit = this.woffset;
        if (!this.noAssert) {
          if (offset === void 0 || offset % 1 !== 0) {
            throw new TypeError("Illegal offset: Not an integer");
          }
          offset >>>= 0;
          if (typeof limit !== "number" || limit % 1 !== 0) {
            throw new TypeError("Illegal limit: Not an integer");
          }
          limit >>>= 0;
          if (offset < 0 || offset > limit || limit > this.buffer.length) {
            throw new RangeError(`Illegal range: 0 <= ${offset} <= ${limit} <= ${this.buffer.length}`);
          }
        }
        const ab = new ArrayBuffer(limit - offset);
        const dst = new Uint8Array(ab);
        this.buffer.copy(dst);
        return ab;
      }
      toString(encoding, begin, end) {
        if (encoding === void 0) {
          return `ByteArrayNB(roffset=${this.roffset},woffset=${this.woffset},capacity=${this.capacity})`;
        }
        switch (encoding) {
          case "utf8":
            return this.toUTF8(begin, end);
          case "base64":
            return this.toBase64(begin, end);
          case "hex":
            return this.toHex(begin, end);
          case "binary":
            return this.toBinary(begin, end);
          case "debug":
            return this.toDebug();
          default:
            throw new TypeError(`Unsupported encoding: ${encoding}`);
        }
      }
      toBase64(begin, end) {
        let lbegin = begin === void 0 ? this.roffset : begin;
        let lend = end === void 0 ? this.woffset : end;
        lbegin |= 0;
        lend |= 0;
        if (lbegin < 0 || lend > this.buffer.length || lbegin > lend) {
          throw new RangeError("begin, end");
        }
        return this.buffer.toString("base64", lbegin, lend);
      }
      toBinary(begin, end) {
        let lbegin = begin === void 0 ? this.roffset : begin;
        let lend = end === void 0 ? this.woffset : end;
        lbegin |= 0;
        lend |= 0;
        if (lbegin < 0 || lend > this.capacity || lbegin > lend) {
          throw new RangeError("begin, end");
        }
        return this.buffer.toString("binary", lbegin, lend);
      }
      toDebug(columns = false) {
        let i = -1;
        const k = this.buffer.length;
        let b;
        let hex = "";
        let asc = "";
        let out = "";
        while (i < k) {
          if (i !== -1) {
            b = this.buffer[i];
            if (b < 16) {
              hex += `0${b.toString(16).toUpperCase()}`;
            } else {
              hex += b.toString(16).toUpperCase();
            }
            if (columns) {
              asc += b > 32 && b < 127 ? String.fromCharCode(b) : ".";
            }
          }
          ++i;
          if (columns) {
            if (i > 0 && i % 16 === 0 && i !== k) {
              while (hex.length < 3 * 16 + 3) {
                hex += " ";
              }
              out += `${hex + asc}
`;
              hex = asc = "";
            }
          }
          if (i === this.roffset && this.roffset === this.woffset && this.woffset === this.buffer.length) {
            hex += "|";
          } else if (i === this.roffset && this.roffset === this.woffset) {
            hex += "^";
          } else if (i === this.roffset && this.roffset === this.buffer.length) {
            hex += "[";
          } else if (i === this.woffset && this.woffset === this.buffer.length) {
            hex += "]";
          } else if (i === this.roffset) {
            hex += "<";
          } else if (i === this.woffset) {
            hex += ">";
          } else if (i === this.buffer.length) {
            hex += "*";
          } else {
            hex += columns || i !== 0 && i !== k ? " " : "";
          }
        }
        if (columns && hex !== " ") {
          while (hex.length < 3 * 16 + 3) {
            hex += " ";
          }
          out += `${hex + asc}
`;
        }
        return columns ? out : hex;
      }
      toHex(begin, end) {
        let lbegin = begin === void 0 ? this.roffset : begin;
        let lend = end === void 0 ? this.woffset : end;
        if (!this.noAssert) {
          if (typeof lbegin !== "number" || lbegin % 1 !== 0) {
            throw new TypeError("Illegal begin: Not an integer");
          }
          lbegin >>>= 0;
          if (typeof lend !== "number" || lend % 1 !== 0) {
            throw new TypeError("Illegal end: Not an integer");
          }
          lend >>>= 0;
          if (lbegin < 0 || lbegin > lend || lend > this.buffer.length) {
            throw new RangeError(`Illegal range: 0 <= ${lbegin} <= ${lend} <= ${this.buffer.length}`);
          }
        }
        return this.buffer.toString("hex", lbegin, lend);
      }
      toUTF8(begin, end) {
        let lbegin = begin === void 0 ? this.roffset : begin;
        let lend = end === void 0 ? this.woffset : end;
        if (!this.noAssert) {
          if (typeof lbegin !== "number" || lbegin % 1 !== 0) {
            throw new TypeError("Illegal begin: Not an integer");
          }
          lbegin >>>= 0;
          if (typeof lend !== "number" || lend % 1 !== 0) {
            throw new TypeError("Illegal end: Not an integer");
          }
          lend >>>= 0;
          if (lbegin < 0 || lbegin > lend || lend > this.buffer.length) {
            throw new RangeError(`Illegal range: 0 <= ${lbegin} <= ${lend} <= ${this.buffer.length}`);
          }
        }
        return this.buffer.toString("utf8", lbegin, lend);
      }
      static alloc(capacity, noAssert = _SmartBuffer.DEFAULT_NOASSERT) {
        return new _SmartBuffer(capacity, noAssert);
      }
      static concat(buffers, encoding, noAssert = _SmartBuffer.DEFAULT_NOASSERT) {
        let capacity = 0;
        const k = buffers.length;
        let i = 0;
        let length;
        for (; i < k; ++i) {
          if (!(buffers[i] instanceof _SmartBuffer)) {
            buffers[i] = _SmartBuffer.wrap(buffers[i], encoding);
          }
          length = buffers[i].woffset - buffers[i].roffset;
          if (length > 0) {
            capacity += length;
          }
        }
        if (capacity === 0) {
          return new _SmartBuffer(0, noAssert);
        }
        const bb = new _SmartBuffer(capacity, noAssert);
        let bi;
        i = 0;
        while (i < k) {
          bi = buffers[i++];
          length = bi.woffset - bi.roffset;
          if (length <= 0) {
            continue;
          }
          bi.buffer.copy(bb.buffer, bb.woffset, bi.roffset, bi.woffset);
          bb.woffset += length;
        }
        bb.roffset = 0;
        return bb;
      }
      static wrap(buffer, encoding, noAssert) {
        if (_isString(buffer)) {
          if (encoding === void 0) {
            encoding = "utf8";
          }
          switch (encoding) {
            case "base64":
              return _SmartBuffer.fromBase64(buffer);
            case "hex":
              return _SmartBuffer.fromHex(buffer);
            case "binary":
              return _SmartBuffer.fromBinary(buffer);
            case "utf8":
              return _SmartBuffer.fromUTF8(buffer);
            case "debug":
              return _SmartBuffer.fromDebug(buffer);
            default:
              throw new TypeError(`Unsupported encoding: ${encoding}`);
          }
        }
        let bb;
        if (buffer instanceof _SmartBuffer) {
          bb = buffer.clone();
          return bb;
        }
        let b;
        if (buffer instanceof Uint8Array) {
          b = import_buffer.Buffer.from(buffer);
          buffer = b;
        } else if (buffer instanceof ArrayBuffer) {
          b = import_buffer.Buffer.from(buffer);
          buffer = b;
        } else if (!(buffer instanceof import_buffer.Buffer)) {
          if (!Array.isArray(buffer)) {
            throw new TypeError("Illegal buffer");
          }
          buffer = import_buffer.Buffer.from(buffer);
        }
        bb = new _SmartBuffer(0, noAssert);
        if (buffer.length > 0) {
          bb.buffer = buffer;
          bb.woffset = buffer.length;
        }
        return bb;
      }
      static calculateVarint32(value) {
        value = value >>> 0;
        if (value < 1 << 7) {
          return 1;
        } else if (value < 1 << 14) {
          return 2;
        } else if (value < 1 << 21) {
          return 3;
        } else if (value < 1 << 28) {
          return 4;
        }
        return 5;
      }
      static zigZagEncode32(n) {
        return ((n |= 0) << 1 ^ n >> 31) >>> 0;
      }
      static zigZagDecode32(n) {
        return n >>> 1 ^ -(n & 1) | 0;
      }
      static calculateVarint64(value) {
        let lValue;
        if (typeof value === "number") {
          lValue = long_default.fromNumber(value);
        } else if (_isString(value)) {
          lValue = long_default.fromString(value);
        } else {
          lValue = value;
        }
        const part0 = lValue.toInt() >>> 0;
        const part1 = lValue.shru(28).toInt() >>> 0;
        const part2 = lValue.shru(56).toInt() >>> 0;
        if (part2 === 0) {
          if (part1 === 0) {
            if (part0 < 1 << 14) {
              return part0 < 1 << 7 ? 1 : 2;
            }
            return part0 < 1 << 21 ? 3 : 4;
          }
          if (part1 < 1 << 14) {
            return part1 < 1 << 7 ? 5 : 6;
          }
          return part1 < 1 << 21 ? 7 : 8;
        }
        return part2 < 1 << 7 ? 9 : 10;
      }
      static zigZagEncode64(value) {
        let lValue;
        if (typeof value === "number") {
          lValue = long_default.fromNumber(value, false);
        } else if (_isString(value)) {
          lValue = long_default.fromString(value, false);
        } else if (value.unsigned !== false) {
          lValue = value.toSigned();
        } else {
          lValue = value;
        }
        return lValue.shl(1).xor(lValue.shr(63)).toUnsigned();
      }
      static zigZagDecode64(value) {
        let lValue;
        if (typeof value === "number") {
          lValue = long_default.fromNumber(value, false);
        } else if (_isString(value)) {
          lValue = long_default.fromString(value, false);
        } else if (value.unsigned !== false) {
          lValue = value.toSigned();
        } else {
          lValue = value;
        }
        return lValue.shru(1).xor(lValue.and(long_default.ONE).toSigned().negate()).toSigned();
      }
      static calculateUTF8Chars(str) {
        return [...str].length;
      }
      static calculateString(str) {
        if (!_isString(str)) {
          throw new TypeError(`Illegal argument: ${typeof str}`);
        }
        return import_buffer.Buffer.byteLength(str, "utf8");
      }
      static fromBase64(str) {
        return _SmartBuffer.wrap(import_buffer.Buffer.from(str, "base64"));
      }
      static btoa(str) {
        return _SmartBuffer.fromBinary(str).toBase64();
      }
      static atob(b64) {
        return _SmartBuffer.fromBase64(b64).toBinary();
      }
      static fromBinary(str) {
        return _SmartBuffer.wrap(import_buffer.Buffer.from(str, "binary"));
      }
      static fromDebug(str, noAssert = _SmartBuffer.DEFAULT_NOASSERT) {
        const k = str.length;
        const bb = new _SmartBuffer((k + 1) / 3 | 0, noAssert);
        let i = 0;
        let j = 0;
        let ch;
        let b;
        let rs = false;
        let hw = false;
        let hr = false;
        let hl = false;
        let fail = false;
        while (i < k) {
          switch (ch = str.charAt(i++)) {
            case "|":
              if (!noAssert) {
                if (hr || hw || hl) {
                  fail = true;
                  break;
                }
                hr = hw = hl = true;
              }
              bb.roffset = bb.woffset = j;
              rs = false;
              break;
            case "]":
              if (!noAssert) {
                if (hw || hl) {
                  fail = true;
                  break;
                }
                hw = hl = true;
              }
              bb.woffset = j;
              rs = false;
              break;
            case "^":
              if (!noAssert) {
                if (hr || hw) {
                  fail = true;
                  break;
                }
                hr = hw = true;
              }
              bb.roffset = bb.woffset = j;
              rs = false;
              break;
            case "<":
              if (!noAssert) {
                if (hr) {
                  fail = true;
                  break;
                }
                hr = true;
              }
              bb.roffset = j;
              rs = false;
              break;
            case "*":
              if (!noAssert) {
                if (hl) {
                  fail = true;
                  break;
                }
                hl = true;
              }
              rs = false;
              break;
            case ">":
              if (!noAssert) {
                if (hw) {
                  fail = true;
                  break;
                }
                hw = true;
              }
              bb.woffset = j;
              rs = false;
              break;
            case " ":
              rs = false;
              break;
            default:
              if (!noAssert) {
                if (rs) {
                  fail = true;
                  break;
                }
              }
              b = parseInt(ch + str.charAt(i++), 16);
              if (!noAssert) {
                if (isNaN(b) || b < 0 || b > 255) {
                  throw new RangeError("Not a debug encoded string");
                }
              }
              bb.buffer[j++] = b;
              rs = true;
          }
          if (fail) {
            throw new RangeError(`Invalid symbol at ${i}`);
          }
        }
        if (!noAssert) {
          if (!hr || !hw || !hl) {
            throw new RangeError(`Missing roffset or woffset or limit: ${str}`);
          }
          if (j < bb.buffer.length) {
            throw new RangeError(`Not a debug encoded string (is it hex?) ${j} < ${k}`);
          }
        }
        return bb;
      }
      static fromHex(str, noAssert = _SmartBuffer.DEFAULT_NOASSERT) {
        if (!noAssert) {
          if (!_isString(str)) {
            throw new TypeError("Illegal str: Not a string");
          }
          if (str.length % 2 !== 0) {
            throw new TypeError("Illegal str: Length not a multiple of 2");
          }
        }
        const bb = new _SmartBuffer(0, true);
        bb.buffer = import_buffer.Buffer.from(str, "hex");
        bb.woffset = bb.buffer.length;
        return bb;
      }
      static fromUTF8(str, noAssert = _SmartBuffer.DEFAULT_NOASSERT) {
        if (!noAssert) {
          if (!_isString(str)) {
            throw new TypeError("Illegal str: Not a string");
          }
        }
        const bb = new _SmartBuffer(0, noAssert);
        bb.buffer = import_buffer.Buffer.from(str, "utf8");
        bb.woffset = bb.buffer.length;
        return bb;
      }
    };
  }
});

// src/netron/constants.ts
var MAX_UID_VALUE, CONTEXTIFY_SYMBOL, REQUEST_TIMEOUT;
var init_constants = __esm({
  "src/netron/constants.ts"() {
    "use strict";
    init_process_shim();
    MAX_UID_VALUE = Number.MAX_SAFE_INTEGER >>> 0;
    CONTEXTIFY_SYMBOL = Symbol();
    REQUEST_TIMEOUT = 5e3;
  }
});

// src/netron/uid.ts
var Uid;
var init_uid = __esm({
  "src/netron/uid.ts"() {
    "use strict";
    init_process_shim();
    init_constants();
    Uid = class {
      static {
        __name(this, "Uid");
      }
      /**
       * Current UID value, stored as an unsigned 32-bit integer.
       * The value is initialized using a zero-fill right shift to ensure proper
       * unsigned integer representation.
       *
       * @private
       * @type {number}
       */
      value = 0 >>> 0;
      /**
       * Creates a new Uid instance with an optional initial value.
       * The constructor ensures proper initialization by calling reset() with
       * the provided initial value.
       *
       * @constructor
       * @param {number} [initialValue=0] - The starting value for UID generation
       */
      constructor(initialValue = 0) {
        this.reset(initialValue);
      }
      /**
       * Generates the next unique identifier in sequence.
       * This method implements a circular counter that wraps around to 1 when
       * reaching MAX_UID_VALUE, ensuring continuous unique identifier generation
       * within the defined bounds.
       *
       * @method next
       * @returns {number} The next unique identifier in sequence
       * @throws {Error} If the maximum UID value is exceeded
       */
      next() {
        this.value = this.value === MAX_UID_VALUE ? 1 : this.value + 1;
        return this.value;
      }
      /**
       * Resets the UID generator to a specified initial value.
       * The value is converted to an unsigned 32-bit integer using a zero-fill
       * right shift operation to ensure proper numeric representation.
       *
       * @method reset
       * @param {number} [initialValue=0] - The value to reset the generator to
       * @throws {Error} If the initial value exceeds MAX_UID_VALUE
       */
      reset(initialValue = 0) {
        this.value = initialValue >>> 0;
      }
    };
  }
});

// src/netron/packet/types.ts
var TYPE_PING, TYPE_GET, TYPE_SET, TYPE_CALL, TYPE_TASK, TYPE_STREAM, TYPE_STREAM_ERROR, TYPE_STREAM_CLOSE, StreamType;
var init_types = __esm({
  "src/netron/packet/types.ts"() {
    "use strict";
    init_process_shim();
    TYPE_PING = 0;
    TYPE_GET = 1;
    TYPE_SET = 2;
    TYPE_CALL = 3;
    TYPE_TASK = 4;
    TYPE_STREAM = 5;
    TYPE_STREAM_ERROR = 6;
    TYPE_STREAM_CLOSE = 7;
    StreamType = /* @__PURE__ */ ((StreamType2) => {
      StreamType2[StreamType2["FIRST"] = 1] = "FIRST";
      StreamType2[StreamType2["MIDDLE"] = 2] = "MIDDLE";
      StreamType2[StreamType2["LAST"] = 3] = "LAST";
      return StreamType2;
    })(StreamType || {});
  }
});

// src/netron/packet/packet.ts
var getBit, clearBits, writeBits, readBits, IMPULSE_OFFSET, ERROR_OFFSET, TYPE_OFFSET, TYPE_SIZE, EOS_OFFSET, LIVE_OFFSET, uid, Packet;
var init_packet = __esm({
  "src/netron/packet/packet.ts"() {
    "use strict";
    init_process_shim();
    init_uid();
    init_types();
    getBit = /* @__PURE__ */ __name((target, offset) => target >> offset & 1, "getBit");
    clearBits = /* @__PURE__ */ __name((target, offset, count) => {
      let result = target;
      for (let i = offset; i < offset + count; ++i) {
        result &= ~(1 << i);
      }
      return result;
    }, "clearBits");
    writeBits = /* @__PURE__ */ __name((target, val, offset, count) => {
      let result = target;
      for (let i = 0; i < count; ++i) {
        if (val & 1 << i) {
          result |= 1 << offset + i;
        }
      }
      return result;
    }, "writeBits");
    readBits = /* @__PURE__ */ __name((target, offset, count) => {
      let val = 0;
      for (let i = 0; i < count; ++i) {
        if (getBit(target, offset + i)) {
          val |= 1 << i;
        }
      }
      return val;
    }, "readBits");
    IMPULSE_OFFSET = 6;
    ERROR_OFFSET = 7;
    TYPE_OFFSET = 0;
    TYPE_SIZE = 4;
    EOS_OFFSET = 4;
    LIVE_OFFSET = 5;
    uid = new Uid();
    Packet = class {
      /**
       * Creates a new Packet instance with the specified identifier.
       * The identifier is used for tracking and correlation of packets in the network.
       *
       * @param {number} id - The unique identifier for this packet (uint32)
       * @throws {Error} If the provided ID is not a valid unsigned 32-bit integer
       */
      constructor(id) {
        this.id = id;
      }
      static {
        __name(this, "Packet");
      }
      /** Control flags of the packet (uint8) containing various metadata bits */
      flags = 0;
      /** The actual payload data of the packet */
      data;
      /** Unique identifier for stream packets (uint32) */
      streamId;
      /** Chunk number for stream packets (uint32) */
      streamIndex;
      /**
       * Sets the packet type in the control flags while preserving all other flags.
       * The type field occupies 4 bits (0-3) in the flags byte and determines
       * the primary purpose of the packet in the protocol.
       *
       * @param {PacketType} type - The type to set in the packet flags
       * @throws {Error} If the type value exceeds the 4-bit range (0-15)
       */
      setType(type) {
        this.flags = writeBits(clearBits(this.flags, TYPE_OFFSET, TYPE_SIZE), type, TYPE_OFFSET, TYPE_SIZE);
      }
      /**
       * Retrieves the packet type from the control flags.
       * This method extracts the 4-bit type field from the flags byte.
       *
       * @returns {PacketType} The type of the packet as specified in the flags
       */
      getType() {
        return readBits(this.flags, TYPE_OFFSET, TYPE_SIZE);
      }
      /**
       * Sets the impulse flag in the control flags.
       * The impulse flag (bit 6) indicates whether this is a request (1) or response (0) packet.
       * This flag is crucial for request-response pattern implementation in the protocol.
       *
       * @param {PacketImpulse} val - The value to set for the impulse flag (0 or 1)
       * @throws {Error} If the value is not 0 or 1
       */
      setImpulse(val) {
        this.flags = this.flags & ~(1 << IMPULSE_OFFSET) | val << IMPULSE_OFFSET;
      }
      /**
       * Retrieves the impulse flag from the control flags.
       *
       * @returns {PacketImpulse} The value of the impulse flag (0 or 1)
       */
      getImpulse() {
        return getBit(this.flags, IMPULSE_OFFSET);
      }
      /**
       * Sets the error flag in the control flags.
       * The error flag (bit 7) indicates whether this packet represents an error condition.
       * When set, the packet's data typically contains error information.
       *
       * @param {0 | 1} val - The value to set for the error flag (0 or 1)
       * @throws {Error} If the value is not 0 or 1
       */
      setError(val) {
        this.flags = this.flags & ~(1 << ERROR_OFFSET) | val << ERROR_OFFSET;
      }
      /**
       * Retrieves the error flag from the control flags.
       *
       * @returns {number} The value of the error flag (0 or 1)
       */
      getError() {
        return getBit(this.flags, ERROR_OFFSET);
      }
      /**
       * Sets comprehensive stream information in the packet.
       * This method updates both the stream metadata fields and the corresponding control flags
       * for stream-specific attributes (end-of-stream and live stream indicators).
       *
       * @param {number} streamId - The unique identifier for the stream (uint32)
       * @param {number} streamIndex - The sequential position of this chunk in the stream (uint32)
       * @param {boolean} isLast - Indicates if this is the final chunk in the stream
       * @param {boolean} isLive - Indicates if this is a live streaming packet
       * @throws {Error} If streamId or streamIndex are not valid unsigned 32-bit integers
       */
      setStreamInfo(streamId, streamIndex, isLast, isLive) {
        this.streamId = streamId;
        this.streamIndex = streamIndex;
        this.flags = writeBits(writeBits(this.flags, isLast ? 1 : 0, EOS_OFFSET, 1), isLive ? 1 : 0, LIVE_OFFSET, 1);
      }
      /**
       * Determines if this packet is part of a stream.
       * This check is based on the packet type being set to TYPE_STREAM.
       *
       * @returns {boolean} True if the packet is a stream chunk, false otherwise
       */
      isStreamChunk() {
        return this.getType() === TYPE_STREAM;
      }
      /**
       * Checks if this packet represents the final chunk of a stream.
       * This is determined by the end-of-stream flag (bit 4) in the control flags.
       *
       * @returns {boolean} True if the packet is the last chunk of a stream, false otherwise
       */
      isLastChunk() {
        return getBit(this.flags, EOS_OFFSET) === 1;
      }
      /**
       * Determines if this packet is part of a live stream.
       * This is indicated by the live stream flag (bit 5) in the control flags.
       *
       * @returns {boolean} True if the stream is live, false otherwise
       */
      isLive() {
        return getBit(this.flags, LIVE_OFFSET) === 1;
      }
      /**
       * Generates a new unique packet identifier using the UID generator.
       * This method is used to ensure unique packet identification across the network.
       *
       * @returns {number} A new unique packet identifier (uint32)
       */
      static nextId() {
        return uid.next();
      }
      /**
       * Resets the packet ID generator to its initial state.
       * This method should be used with caution as it may cause ID collisions
       * if packets with old IDs are still in transit.
       */
      static resetId() {
        uid.reset();
      }
    };
  }
});

// ../messagepack/dist/encoder.js
var import_buffer2, getType, encodeString, encodeCustom, Encoder;
var init_encoder = __esm({
  "../messagepack/dist/encoder.js"() {
    "use strict";
    init_process_shim();
    import_buffer2 = __toESM(require_buffer(), 1);
    init_dist2();
    init_dist();
    getType = /* @__PURE__ */ __name((value) => {
      if (value === null)
        return "null";
      if (value === void 0)
        return "undefined";
      const type = typeof value;
      if (type !== "object")
        return type;
      const stringTag = Object.prototype.toString.call(value);
      const match = stringTag.match(/\[object (\w+)\]/);
      return match ? match[1].toLowerCase() : "object";
    }, "getType");
    encodeString = /* @__PURE__ */ __name((x, buf) => {
      const len = import_buffer2.Buffer.byteLength(x);
      if (len < 32) {
        buf.writeInt8(160 | len);
        if (len === 0) {
          return;
        }
      } else if (len <= 255) {
        buf.writeUInt16BE(55552 | len);
      } else if (len <= 65535) {
        buf.writeInt8(218);
        buf.writeUInt16BE(len);
      } else {
        buf.writeInt8(219);
        buf.writeUInt32BE(len);
      }
      buf.write(x, void 0, len);
    }, "encodeString");
    encodeCustom = /* @__PURE__ */ __name((x, type, encFunc, buf) => {
      const encoded = encFunc(x, buf);
      const length = encoded.length;
      if (length === 1) {
        buf.writeUInt8(212);
      } else if (length === 2) {
        buf.writeUInt8(213);
      } else if (length === 4) {
        buf.writeUInt8(214);
      } else if (length === 8) {
        buf.writeUInt8(215);
      } else if (length === 16) {
        buf.writeUInt8(216);
      } else if (length < 256) {
        buf.writeUInt16BE(50944 | length);
      } else if (length < 65536) {
        buf.writeUInt32BE(3355443200 | length << 8);
        buf.woffset -= 1;
      } else {
        buf.writeUInt8(201);
        buf.writeUInt32BE(length);
      }
      buf.writeInt8(type);
      buf.write(encoded);
    }, "encodeCustom");
    Encoder = class {
      static {
        __name(this, "Encoder");
      }
      constructor(encodingTypes) {
        this.encodingTypes = encodingTypes;
      }
      encode(x, buf) {
        buf = buf || new SmartBuffer(1024, true);
        this._encode(x, buf);
        return buf;
      }
      _encode(x, buf) {
        const type = typeof x;
        switch (type) {
          case "undefined": {
            buf.writeUInt32BE(3556769792);
            buf.woffset--;
            break;
          }
          case "boolean": {
            if (x === true) {
              buf.writeInt8(195);
            } else {
              buf.writeInt8(194);
            }
            break;
          }
          case "string": {
            encodeString(x, buf);
            break;
          }
          case "bigint": {
            encodeCustom(x, 120, this.encodingTypes.get(120).encode, buf);
            break;
          }
          case "number": {
            if (x !== (x | 0)) {
              buf.writeInt8(203);
              buf.writeDoubleBE(x);
            } else if (x >= 0) {
              if (x < 128) {
                buf.writeInt8(x);
              } else if (x < 256) {
                buf.writeInt16BE(52224 | x);
              } else if (x < 65536) {
                buf.writeInt8(205);
                buf.writeUInt16BE(x);
              } else if (x <= 4294967295) {
                buf.writeInt8(206);
                buf.writeUInt32BE(x);
              } else if (x <= 9007199254740991) {
                buf.writeInt8(207);
                buf.writeUInt64BE(x);
              } else {
                buf.writeInt8(203);
                buf.writeDoubleBE(x);
              }
            } else {
              if (x >= -32) {
                buf.writeInt8(256 + x);
              } else if (x >= -128) {
                buf.writeInt8(208);
                buf.writeInt8(x);
              } else if (x >= -32768) {
                buf.writeInt8(209);
                buf.writeInt16BE(x);
              } else if (x > -214748365) {
                buf.writeInt8(210);
                buf.writeInt32BE(x);
              } else if (x >= -9007199254740991) {
                buf.writeInt8(211);
                buf.writeInt64BE(x);
              } else {
                buf.writeInt8(203);
                buf.writeDoubleBE(x);
              }
            }
            break;
          }
          default: {
            if (x === null) {
              buf.writeInt8(192);
            } else if (isBuffer(x)) {
              if (x.length <= 255) {
                buf.writeInt16BE(50176 | x.length);
              } else if (x.length <= 65535) {
                buf.writeInt8(197);
                buf.writeUInt16BE(x.length);
              } else {
                buf.writeUInt8(198);
                buf.writeUInt32BE(x.length);
              }
              buf.write(x);
            } else if (Array.isArray(x)) {
              if (x.length < 16) {
                buf.writeInt8(144 | x.length);
              } else if (x.length < 65536) {
                buf.writeInt8(220);
                buf.writeUInt16BE(x.length);
              } else {
                buf.writeInt8(221);
                buf.writeUInt32BE(x.length);
              }
              for (const obj of x) {
                this._encode(obj, buf);
              }
            } else if (isPlainObject(x)) {
              const keys2 = Object.keys(x);
              if (keys2.length < 16) {
                buf.writeInt8(128 | keys2.length);
              } else {
                buf.writeInt8(222);
                buf.writeUInt16BE(keys2.length);
              }
              for (const key of keys2) {
                encodeString(key, buf);
                this._encode(x[key], buf);
              }
            } else {
              const encTypes = this.encodingTypes;
              for (const [type_, info] of encTypes.entries()) {
                if (info.check(x)) {
                  encodeCustom(x, type_, info.encode, buf);
                  return;
                }
              }
              throw new Error(`Not supported: ${getType(x)}`);
            }
          }
        }
      }
    };
  }
});

// ../messagepack/dist/decoder.js
var getSize, buildDecodeResult, isValidDataSize, Decoder;
var init_decoder = __esm({
  "../messagepack/dist/decoder.js"() {
    "use strict";
    init_process_shim();
    init_dist2();
    getSize = /* @__PURE__ */ __name((first) => {
      switch (first) {
        case 196:
          return 2;
        case 197:
          return 3;
        case 198:
          return 5;
        case 199:
          return 3;
        case 200:
          return 4;
        case 201:
          return 6;
        case 202:
          return 5;
        case 203:
          return 9;
        case 204:
          return 2;
        case 205:
          return 3;
        case 206:
          return 5;
        case 207:
          return 9;
        case 208:
          return 2;
        case 209:
          return 3;
        case 210:
          return 5;
        case 211:
          return 9;
        case 212:
          return 3;
        case 213:
          return 4;
        case 214:
          return 6;
        case 215:
          return 10;
        case 216:
          return 18;
        case 217:
          return 2;
        case 218:
          return 3;
        case 219:
          return 5;
        case 222:
          return 3;
        default:
          return -1;
      }
    }, "getSize");
    buildDecodeResult = /* @__PURE__ */ __name((value, bytesConsumed) => ({
      value,
      bytesConsumed
    }), "buildDecodeResult");
    isValidDataSize = /* @__PURE__ */ __name((dataLength, bufLength, headerLength) => bufLength >= headerLength + dataLength, "isValidDataSize");
    Decoder = class {
      static {
        __name(this, "Decoder");
      }
      constructor(decodingTypes) {
        this.decodingTypes = decodingTypes;
      }
      decode(buf) {
        const smartBuf = isSmartBuffer(buf) ? buf : SmartBuffer.wrap(buf, void 0, true);
        const result = this.tryDecode(smartBuf);
        if (result) {
          return result.value;
        }
        throw new Error("Incomplete buffer");
      }
      tryDecode(buf) {
        const bufLength = buf.length;
        if (bufLength <= 0) {
          return null;
        }
        const first = buf.readUInt8();
        let length;
        let result = 0;
        let type;
        const size = getSize(first);
        if (size !== -1 && bufLength < size) {
          return null;
        }
        switch (first) {
          case 192:
            return buildDecodeResult(null, 1);
          case 194:
            return buildDecodeResult(false, 1);
          case 195:
            return buildDecodeResult(true, 1);
          case 204:
            result = buf.readUInt8();
            return buildDecodeResult(result, 2);
          case 205:
            result = buf.readUInt16BE();
            return buildDecodeResult(result, 3);
          case 206:
            result = buf.readUInt32BE();
            return buildDecodeResult(result, 5);
          case 207:
            result = buf.readUInt64BE().toNumber();
            return buildDecodeResult(result, 9);
          case 208:
            result = buf.readInt8();
            return buildDecodeResult(result, 2);
          case 209:
            result = buf.readInt16BE();
            return buildDecodeResult(result, 3);
          case 210:
            result = buf.readInt32BE();
            return buildDecodeResult(result, 5);
          case 211:
            result = buf.readInt64BE().toNumber();
            return buildDecodeResult(result, 9);
          case 202:
            result = buf.readFloatBE();
            return buildDecodeResult(result, 5);
          case 203:
            result = buf.readDoubleBE();
            return buildDecodeResult(result, 9);
          case 217:
            length = buf.readUInt8();
            if (!length || !isValidDataSize(length, bufLength, 2)) {
              return null;
            }
            result = buf.toString("utf8", buf.roffset, buf.roffset + length);
            buf.skipRead(length);
            return buildDecodeResult(result, 2 + length);
          case 218:
            length = buf.readUInt16BE();
            if (!isValidDataSize(length, bufLength, 3)) {
              return null;
            }
            result = buf.toString("utf8", buf.roffset, buf.roffset + length);
            buf.skipRead(length);
            return buildDecodeResult(result, 3 + length);
          case 219:
            length = buf.readUInt32BE();
            if (!isValidDataSize(length, bufLength, 5)) {
              return null;
            }
            result = buf.toString("utf8", buf.roffset, buf.roffset + length);
            buf.skipRead(length);
            return buildDecodeResult(result, 5 + length);
          case 196:
            length = buf.readUInt8();
            if (length === void 0 || !isValidDataSize(length, bufLength, 2)) {
              return null;
            }
            result = buf.slice(buf.roffset, buf.roffset + length).buffer;
            buf.skipRead(length);
            return buildDecodeResult(result, 2 + length);
          case 197:
            length = buf.readUInt16BE();
            if (!isValidDataSize(length, bufLength, 3)) {
              return null;
            }
            result = buf.slice(buf.roffset, buf.roffset + length).buffer;
            buf.skipRead(length);
            return buildDecodeResult(result, 3 + length);
          case 198:
            length = buf.readUInt32BE();
            if (!isValidDataSize(length, bufLength, 5)) {
              return null;
            }
            result = buf.slice(buf.roffset, buf.roffset + length).buffer;
            buf.skipRead(length);
            return buildDecodeResult(result, 5 + length);
          case 220:
            if (bufLength < 3) {
              return null;
            }
            length = buf.readUInt16BE();
            return this.decodeArray(buf, length, 3);
          case 221:
            if (bufLength < 5) {
              return null;
            }
            length = buf.readUInt32BE();
            return this.decodeArray(buf, length, 5);
          case 222:
            length = buf.readUInt16BE();
            return this.decodeMap(buf, length, 3);
          case 223:
            throw new Error("map too big to decode in JS");
          case 212:
            return this.decodeFixExt(buf, 1);
          case 213:
            return this.decodeFixExt(buf, 2);
          case 214:
            return this.decodeFixExt(buf, 4);
          case 215:
            return this.decodeFixExt(buf, 8);
          case 216:
            return this.decodeFixExt(buf, 16);
          case 199:
            length = buf.readUInt8();
            type = buf.readUInt8();
            if (!type || !length || !isValidDataSize(length, bufLength, 3)) {
              return null;
            }
            return this.decodeExt(buf, type, length, 3);
          case 200:
            length = buf.readUInt16BE();
            type = buf.readUInt8();
            if (!type || !length || !isValidDataSize(length, bufLength, 4)) {
              return null;
            }
            return this.decodeExt(buf, type, length, 4);
          case 201:
            length = buf.readUInt32BE();
            type = buf.readUInt8();
            if (!type || !length || !isValidDataSize(length, bufLength, 6)) {
              return null;
            }
            return this.decodeExt(buf, type, length, 6);
        }
        if ((first & 240) === 144) {
          length = first & 15;
          return this.decodeArray(buf, length, 1);
        } else if ((first & 240) === 128) {
          length = first & 15;
          return this.decodeMap(buf, length, 1);
        } else if ((first & 224) === 160) {
          length = first & 31;
          if (isValidDataSize(length, bufLength, 1)) {
            result = buf.toString("utf8", buf.roffset, buf.roffset + length);
            buf.skipRead(length);
            return buildDecodeResult(result, length + 1);
          }
          return null;
        } else if (first >= 224) {
          result = first - 256;
          return buildDecodeResult(result, 1);
        } else if (first < 128) {
          return buildDecodeResult(first, 1);
        }
        throw new Error("Not implemented yet");
      }
      decodeMap(buf, length, headerLength) {
        const result = {};
        let key;
        let totalBytesConsumed = 0;
        for (let i = 0; i < length; ++i) {
          const keyResult = this.tryDecode(buf);
          if (keyResult) {
            const valueResult = this.tryDecode(buf);
            if (valueResult) {
              key = keyResult.value;
              result[key] = valueResult.value;
              totalBytesConsumed += keyResult.bytesConsumed + valueResult.bytesConsumed;
            } else {
              return null;
            }
          } else {
            return null;
          }
        }
        return buildDecodeResult(result, headerLength + totalBytesConsumed);
      }
      decodeArray(buf, length, headerLength) {
        const result = [];
        let totalBytesConsumed = 0;
        for (let i = 0; i < length; ++i) {
          const decodeResult = this.tryDecode(buf);
          if (decodeResult) {
            result.push(decodeResult.value);
            totalBytesConsumed += decodeResult.bytesConsumed;
          } else {
            return null;
          }
        }
        return buildDecodeResult(result, headerLength + totalBytesConsumed);
      }
      decodeFixExt(buf, size) {
        const type = buf.readUInt8();
        return this.decodeExt(buf, type, size, 2);
      }
      decodeExt(buf, type, size, headerSize) {
        const decTypes = this.decodingTypes;
        const decode = decTypes.get(type);
        if (decode) {
          const value = decode(buf.slice(buf.roffset, buf.roffset + size));
          buf.skipRead(size);
          return buildDecodeResult(value, headerSize + size);
        }
        if (type === 0) {
          const val = buf.readUInt8();
          if (val === 0) {
            return buildDecodeResult(void 0, headerSize + size);
          }
        }
        throw new Error(`Unable to find ext type ${type}`);
      }
    };
  }
});

// ../messagepack/dist/serializer.js
var Serializer;
var init_serializer = __esm({
  "../messagepack/dist/serializer.js"() {
    "use strict";
    init_process_shim();
    init_dist2();
    init_encoder();
    init_decoder();
    Serializer = class {
      static {
        __name(this, "Serializer");
      }
      constructor(initialCapacity = 64) {
        this.initialCapacity = initialCapacity;
        this.encodingTypes = /* @__PURE__ */ new Map();
        this.decodingTypes = /* @__PURE__ */ new Map();
        this.encoder = new Encoder(this.encodingTypes);
        this.decoder = new Decoder(this.decodingTypes);
      }
      registerEncoder(type, check, encode) {
        this.encodingTypes.set(type, { check, encode });
        return this;
      }
      registerDecoder(type, decode) {
        this.decodingTypes.set(type, decode);
        return this;
      }
      register(type, constructor, encode, decode) {
        if (type < 0 || type > 127) {
          throw new RangeError(`Bad type: 0 <= ${type} <= 127`);
        }
        this.registerEncoder(type, (obj) => obj instanceof constructor, (obj) => {
          const extBuf = new SmartBuffer(this.initialCapacity, true);
          encode(obj, extBuf);
          return extBuf;
        });
        this.registerDecoder(type, decode);
        return this;
      }
      encode(x, buf) {
        return this.encoder.encode(x, buf);
      }
      decode(buf) {
        return this.decoder.decode(buf);
      }
    };
  }
});

// ../messagepack/dist/errors.js
var errorIdMap, stdIdMap, stdErrors, idErrorMap, keys, createError, getStdErrorId;
var init_errors = __esm({
  "../messagepack/dist/errors.js"() {
    "use strict";
    init_process_shim();
    errorIdMap = {};
    stdIdMap = {};
    stdErrors = [];
    idErrorMap = {
      1: Error,
      2: SyntaxError,
      3: TypeError,
      4: ReferenceError,
      5: RangeError,
      6: EvalError,
      7: URIError
    };
    keys = Object.keys(idErrorMap).map((v) => +v);
    for (let i = 0; i < keys.length; i++) {
      const errCode = keys[i];
      const ExceptionClass = idErrorMap[errCode];
      errorIdMap[ExceptionClass] = errCode;
      stdErrors.push(ExceptionClass);
      stdIdMap[ExceptionClass.name] = errCode;
    }
    createError = /* @__PURE__ */ __name((id, message, stack) => {
      const err = new idErrorMap[id](message);
      err.stack = stack;
      return err;
    }, "createError");
    getStdErrorId = /* @__PURE__ */ __name((err) => stdIdMap[err.constructor.name] ?? stdIdMap[Error.name], "getStdErrorId");
  }
});

// ../messagepack/dist/index.js
var registerCommonTypesFor, serializer;
var init_dist3 = __esm({
  "../messagepack/dist/index.js"() {
    "use strict";
    init_process_shim();
    init_long();
    init_serializer();
    init_errors();
    registerCommonTypesFor = /* @__PURE__ */ __name((s) => {
      s.register(126, Error, (obj, buf) => {
        buf.writeUInt16BE(getStdErrorId(obj));
        s.encode(obj.name, buf);
        s.encode(obj.stack, buf);
        s.encode(obj.message, buf);
        const customFields = Object.keys(obj).filter((key) => !["stack", "message", "name"].includes(key) && obj[key] !== void 0);
        buf.writeUInt16BE(customFields.length);
        for (const key of customFields) {
          s.encode(key, buf);
          s.encode(obj[key], buf);
        }
      }, (buf) => {
        const id = buf.readUInt16BE();
        const name = s.decode(buf);
        const stack = s.decode(buf);
        const message = s.decode(buf);
        const error = createError(id, message, stack);
        error.name = name;
        const customFieldsCount = buf.readUInt16BE();
        for (let i = 0; i < customFieldsCount; i++) {
          const key = s.decode(buf);
          const value = s.decode(buf);
          error[key] = value;
        }
        return error;
      });
      s.register(125, Date, (obj, buf) => {
        buf.writeUInt64BE(obj.getTime());
      }, (buf) => new Date(buf.readUInt64BE().toNumber()));
      s.register(124, Map, (obj, buf) => {
        buf.writeUInt32BE(obj.size);
        for (const [key, val] of obj.entries()) {
          s.encode(key, buf);
          s.encode(val, buf);
        }
      }, (buf) => {
        const map = /* @__PURE__ */ new Map();
        const size = buf.readUInt32BE();
        for (let i = 0; i < size; i++) {
          const key = s.decode(buf);
          const val = s.decode(buf);
          map.set(key, val);
        }
        return map;
      });
      s.register(123, Set, (obj, buf) => {
        buf.writeUInt32BE(obj.size);
        for (const val of obj.values()) {
          s.encode(val, buf);
        }
      }, (buf) => {
        const set = /* @__PURE__ */ new Set();
        const size = buf.readUInt32BE();
        for (let i = 0; i < size; i++) {
          const val = s.decode(buf);
          set.add(val);
        }
        return set;
      });
      s.register(121, RegExp, (obj, buf) => {
        s.encode(obj.source, buf);
        s.encode(obj.flags, buf);
      }, (buf) => {
        const source = s.decode(buf);
        const flags = s.decode(buf);
        return new RegExp(source, flags);
      });
      s.register(120, BigInt, (obj, buf) => {
        const str = obj.toString();
        s.encode(str, buf);
      }, (buf) => {
        const str = s.decode(buf);
        return BigInt(str);
      });
      s.register(119, long_default, (obj, buf) => {
        buf.writeInt8(obj.unsigned ? 1 : 0);
        if (obj.unsigned) {
          buf.writeUInt64BE(obj);
        } else {
          buf.writeInt64BE(obj);
        }
      }, (buf) => {
        const unsigned = Boolean(buf.readInt8());
        return unsigned ? buf.readUInt64BE() : buf.readInt64BE();
      });
    }, "registerCommonTypesFor");
    serializer = new Serializer();
    registerCommonTypesFor(serializer);
  }
});

// src/netron/reference.ts
var Reference;
var init_reference = __esm({
  "src/netron/reference.ts"() {
    "use strict";
    init_process_shim();
    Reference = class {
      /**
       * Creates a new instance of Reference.
       * The constructor initializes a reference to a service definition using its unique identifier.
       * This identifier is used by the Netron framework to locate and resolve the actual service
       * definition when needed.
       *
       * @param {string} defId - The unique identifier of the service definition.
       * This identifier must match the ID of an existing service definition in the Netron network.
       *
       * @throws {Error} If the provided defId is not a valid string or is empty.
       *
       * @example
       * // Creating a reference to a specific service
       * const authServiceRef = new Reference('authentication-service');
       */
      constructor(defId) {
        this.defId = defId;
        if (!defId || typeof defId !== "string") {
          throw new Error("Service definition ID must be a non-empty string");
        }
      }
      static {
        __name(this, "Reference");
      }
    };
  }
});

// src/netron/definition.ts
var randomUUID, Definition;
var init_definition = __esm({
  "src/netron/definition.ts"() {
    "use strict";
    init_process_shim();
    randomUUID = typeof crypto !== "undefined" && crypto.randomUUID ? () => crypto.randomUUID() : () => {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : r & 3 | 8;
        return v.toString(16);
      });
    };
    Definition = class {
      /**
       * Constructs a new Definition instance with the specified parameters.
       *
       * @param {string} id - A unique identifier for the service definition. This should be
       *                      generated using the static nextId() method to ensure uniqueness.
       * @param {string} peerId - The identifier of the peer that owns or provides this service.
       *                          This links the service to its provider in the network.
       * @param {ServiceMetadata} meta - The service metadata object containing detailed
       *                                information about the service's capabilities and interface.
       * @throws {Error} If the provided id is not a valid UUID or if the metadata is incomplete.
       */
      constructor(id, peerId, meta) {
        this.id = id;
        this.peerId = peerId;
        this.meta = meta;
      }
      static {
        __name(this, "Definition");
      }
      /**
       * The identifier of the parent service definition, if this service is part of a hierarchy.
       * This property enables the creation of service trees and facilitates service composition.
       *
       * @type {string}
       * @default ''
       */
      parentId = "";
      /**
       * Generates a new cryptographically secure unique identifier using the Node.js crypto module.
       * This method uses the randomUUID() function to create a version 4 UUID that is suitable
       * for use as a service definition identifier.
       *
       * @static
       * @returns {string} A new UUID v4 string that can be used as a unique identifier.
       * @example
       * const newId = Definition.nextId();
       * // Returns something like: '123e4567-e89b-12d3-a456-426614174000'
       */
      static nextId() {
        return randomUUID();
      }
    };
  }
});

// e2e/stubs/stream.js
var Readable, Writable;
var init_stream = __esm({
  "e2e/stubs/stream.js"() {
    "use strict";
    init_process_shim();
    Readable = class {
      static {
        __name(this, "Readable");
      }
      constructor() {
      }
    };
    Writable = class {
      static {
        __name(this, "Writable");
      }
      constructor() {
      }
    };
  }
});

// src/netron/readable-stream.ts
var MAX_BUFFER_SIZE, NetronReadableStream;
var init_readable_stream = __esm({
  "src/netron/readable-stream.ts"() {
    "use strict";
    init_process_shim();
    init_stream();
    MAX_BUFFER_SIZE = 1e4;
    NetronReadableStream = class _NetronReadableStream extends Readable {
      static {
        __name(this, "NetronReadableStream");
      }
      /** The remote peer this stream is associated with */
      peer;
      /** Internal buffer for storing out-of-order packets */
      buffer = /* @__PURE__ */ new Map();
      /** Next expected packet index for ordered delivery */
      expectedIndex = 0;
      /** Timeout handle for stream inactivity detection */
      timeout;
      /** Unique identifier for this stream */
      id;
      /** Whether the stream has been closed */
      isClosed = false;
      /** Whether all data has been successfully received */
      isComplete = false;
      /** Whether this is a live streaming connection */
      isLive;
      /**
       * Creates a new NetronReadableStream instance.
       *
       * @param {NetronReadableStreamOptions} options - Configuration options for the stream
       * @throws {Error} If stream initialization fails
       */
      constructor({ peer, streamId, isLive = false, ...opts }) {
        super({ ...opts, objectMode: true });
        this.peer = peer;
        this.id = streamId;
        this.isLive = isLive;
        this.peer.logger.info({ streamId: this.id, isLive }, "Creating readable stream");
        this.peer.readableStreams.set(this.id, this);
        if (!this.isLive) {
          this.resetTimeout();
        }
        this.on("close", this.cleanup);
        this.on("error", this.handleError);
      }
      /**
       * Processes incoming data packets and manages ordered delivery.
       * This method implements the core packet handling logic, including:
       * - Buffer overflow protection
       * - Packet reordering
       * - Flow control
       * - Stream completion detection
       *
       * @param {Packet} packet - The incoming data packet
       * @returns {void}
       * @throws {Error} If buffer overflow occurs or stream is closed
       */
      onPacket(packet) {
        if (this.isClosed) {
          this.peer.logger.warn({ streamId: this.id }, "Received packet for closed stream");
          return;
        }
        this.resetTimeout();
        if (this.buffer.size > MAX_BUFFER_SIZE) {
          this.peer.logger.error({ streamId: this.id, size: this.buffer.size }, "Stream buffer overflow");
          this.destroy(new Error(`Buffer overflow: more than ${MAX_BUFFER_SIZE} packets buffered`));
          return;
        }
        this.peer.logger.debug({ streamId: this.id, index: packet.streamIndex }, "Processing packet");
        if (!packet.isLastChunk() || packet.data !== null) {
          this.buffer.set(packet.streamIndex, packet.data);
        }
        while (this.buffer.has(this.expectedIndex)) {
          const chunk = this.buffer.get(this.expectedIndex);
          this.buffer.delete(this.expectedIndex);
          this.expectedIndex++;
          if (!this.push(chunk)) {
            this.peer.logger.debug({ streamId: this.id }, "Stream backpressure detected");
            break;
          }
        }
        if (packet.isLastChunk()) {
          this.peer.logger.info({ streamId: this.id }, "Received last chunk");
          this.isComplete = true;
          this.push(null);
        }
      }
      /**
       * Implementation of the Readable stream's _read method.
       * This method is called when the stream's internal buffer is ready to accept more data.
       * In our implementation, data is pushed in onPacket, so this method is intentionally empty.
       *
       * @returns {void}
       */
      _read() {
      }
      /**
       * Resets the stream's inactivity timeout.
       * This method implements automatic stream cleanup for non-live streams
       * that have been inactive for too long.
       *
       * @returns {void}
       */
      resetTimeout() {
        if (this.isLive) return;
        if (this.timeout) clearTimeout(this.timeout);
        const timeoutDuration = this.peer.netron.options?.streamTimeout ?? 6e4;
        this.peer.logger.debug({ streamId: this.id, timeoutDuration }, "Resetting stream timeout");
        this.timeout = setTimeout(() => {
          const message = `Stream ${this.id} inactive for ${timeoutDuration}ms, closing.`;
          this.peer.logger.warn(message);
          this.destroy(new Error(message));
        }, timeoutDuration);
      }
      /**
       * Closes the stream and releases associated resources.
       * This method implements graceful stream termination with support for
       * both normal and forced closure scenarios.
       *
       * @param {boolean} [force=false] - Whether to force stream closure
       * @returns {void}
       */
      closeStream(force = false) {
        if (this.isClosed) {
          this.peer.logger.warn({ streamId: this.id }, "Attempt to close already closed stream");
          return;
        }
        if (this.isLive && !force) {
          this.peer.logger.warn({ streamId: this.id }, "Attempt to close live stream");
          return;
        }
        this.peer.logger.info({ streamId: this.id, force }, "Closing stream");
        this.push(null);
        if (this.isLive && force) {
          this.destroy();
        }
      }
      /**
       * Forces immediate stream closure due to remote stream termination.
       * This method is called when receiving an explicit close packet from the remote peer.
       * It immediately closes the stream and emits appropriate events.
       *
       * @param {string} [reason] - Optional reason for the forced closure
       * @returns {void}
       */
      forceClose(reason) {
        if (this.isClosed) {
          this.peer.logger.warn({ streamId: this.id }, "Attempt to force close already closed stream");
          return;
        }
        this.peer.logger.info({ streamId: this.id, reason }, "Force closing stream");
        this.isClosed = true;
        this.isComplete = true;
        this.push(null);
        process.nextTick(() => {
          this.emit("close");
          this.cleanup();
        });
      }
      /**
       * Performs cleanup operations when the stream is closed.
       * This method ensures proper resource deallocation and stream deregistration.
       *
       * @returns {void}
       */
      cleanup = /* @__PURE__ */ __name(() => {
        this.peer.logger.debug({ streamId: this.id }, "Cleaning up stream resources");
        if (this.timeout) clearTimeout(this.timeout);
        this.peer.readableStreams.delete(this.id);
        this.buffer.clear();
      }, "cleanup");
      /**
       * Handles stream error events.
       * This method implements error logging and cleanup for stream errors.
       *
       * @param {Error} error - The error that occurred
       * @returns {void}
       */
      handleError = /* @__PURE__ */ __name((error) => {
        this.peer.logger.error({ streamId: this.id, error }, "Stream error occurred");
        this.cleanup();
      }, "handleError");
      /**
       * Overrides the standard destroy method to ensure proper cleanup.
       * This method implements a robust stream termination process that
       * guarantees resource cleanup and error propagation.
       *
       * @param {Error} [error] - Optional error to propagate
       * @returns {this}
       */
      destroy(error) {
        if (this.isClosed) {
          this.peer.logger.warn({ streamId: this.id }, "Attempt to destroy already closed stream");
          return this;
        }
        this.peer.logger.info({ streamId: this.id, error }, "Destroying stream");
        this.isClosed = true;
        super.destroy(error);
        this.cleanup();
        return this;
      }
      /**
       * Factory method for creating new NetronReadableStream instances.
       * This method provides a convenient way to create stream instances
       * with default configuration.
       *
       * @param {RemotePeer} peer - The remote peer for this stream
       * @param {number} streamId - Unique identifier for the stream
       * @param {boolean} [isLive=false] - Whether this is a live stream
       * @returns {NetronReadableStream}
       */
      static create(peer, streamId, isLive = false) {
        return new _NetronReadableStream({ peer, streamId, isLive });
      }
    };
  }
});

// src/netron/writable-stream.ts
var uid2, NetronWritableStream;
var init_writable_stream = __esm({
  "src/netron/writable-stream.ts"() {
    "use strict";
    init_process_shim();
    init_stream();
    init_uid();
    init_packet2();
    uid2 = new Uid();
    NetronWritableStream = class _NetronWritableStream extends Writable {
      static {
        __name(this, "NetronWritableStream");
      }
      /** Unique identifier for this stream instance */
      id;
      /** The remote peer this stream is associated with */
      peer;
      /** Current chunk index for maintaining write order */
      index = 0;
      /** Whether the stream is operating in live/real-time mode */
      isLive;
      /** Flag indicating if the stream has been closed */
      isClosed = false;
      /**
       * Creates a new NetronWritableStream instance.
       *
       * @constructor
       * @param {NetronWritableStreamOptions} options - Configuration options for the stream
       * @param {RemotePeer} options.peer - The remote peer this stream is associated with
       * @param {number} [options.streamId] - Optional custom stream identifier
       * @param {boolean} [options.isLive=false] - Whether the stream is operating in live mode
       * @param {WritableOptions} [options] - Additional Node.js stream options
       */
      constructor({ peer, streamId, isLive = false, ...opts }) {
        super({ ...opts, objectMode: true });
        this.peer = peer;
        this.isLive = isLive;
        this.id = streamId ?? uid2.next();
        this.peer.logger.info({ streamId: this.id, isLive }, "Creating writable stream");
        this.peer.writableStreams.set(this.id, this);
        this.once("close", this.cleanup);
      }
      /**
       * Pipes data from an AsyncIterable or Readable stream into this stream.
       * Handles backpressure and ensures proper cleanup on errors.
       *
       * @param {AsyncIterable<any> | Readable} source - The source stream to pipe from
       * @returns {Promise<void>} A promise that resolves when piping is complete
       * @throws {Error} If an error occurs during the piping process
       */
      async pipeFrom(source) {
        this.peer.logger.debug({ streamId: this.id }, "Starting pipe operation");
        try {
          for await (const chunk of source) {
            if (!this.write(chunk)) {
              this.peer.logger.debug({ streamId: this.id }, "Stream backpressure detected");
              await new Promise((resolve) => this.once("drain", resolve));
            }
          }
          this.end();
          this.peer.logger.debug({ streamId: this.id }, "Pipe operation completed");
        } catch (error) {
          this.peer.logger.error({ streamId: this.id, error }, "Pipe operation failed");
          this.destroy(error instanceof Error ? error : new Error(String(error)));
        }
      }
      /**
       * Internal write implementation for handling stream chunks.
       * Sends data to the remote peer and manages stream state.
       *
       * @override
       * @param {any} chunk - The data chunk to write
       * @param {BufferEncoding} _ - Unused encoding parameter
       * @param {(error?: Error | null) => void} callback - Callback to signal write completion
       */
      _write(chunk, _, callback) {
        if (this.isClosed) {
          this.peer.logger.warn({ streamId: this.id }, "Attempt to write to closed stream");
          callback(new Error("Stream is already closed"));
          return;
        }
        this.peer.logger.debug({ streamId: this.id, index: this.index }, "Writing chunk");
        this.peer.sendStreamChunk(this.id, chunk, this.index++, false, this.isLive).then(() => callback()).catch((err) => {
          this.peer.logger.error({ streamId: this.id, error: err }, "Error sending stream chunk");
          this.peer.sendPacket(
            createPacket(Packet.nextId(), 1, TYPE_STREAM_ERROR, {
              streamId: this.id,
              message: err.message
            })
          ).catch((sendErr) => {
            this.peer.logger.error({ streamId: this.id, error: sendErr }, "Failed to send stream error packet");
          });
          callback(err);
        });
      }
      /**
       * Internal final implementation for handling stream completion.
       * Sends final chunk to remote peer and performs cleanup.
       *
       * @override
       * @param {(error?: Error | null) => void} callback - Callback to signal finalization completion
       */
      _final(callback) {
        if (this.isClosed) {
          this.peer.logger.warn({ streamId: this.id }, "Attempt to finalize closed stream");
          callback(new Error("Stream is already closed"));
          return;
        }
        this.peer.logger.debug({ streamId: this.id, index: this.index }, "Sending final chunk");
        this.peer.sendStreamChunk(this.id, null, this.index, true, this.isLive).then(() => callback()).catch((err) => {
          this.peer.logger.error({ streamId: this.id, error: err }, "Error sending final chunk");
          callback(err);
        }).finally(() => this.closeStream());
      }
      /**
       * Gracefully closes the stream and performs cleanup.
       * This method ensures proper resource cleanup and state management.
       */
      closeStream() {
        if (this.isClosed) {
          this.peer.logger.warn({ streamId: this.id }, "Attempt to close already closed stream");
          return;
        }
        this.peer.logger.info({ streamId: this.id }, "Closing stream");
        this.isClosed = true;
        this.end();
        this.cleanup();
      }
      /**
       * Overrides the destroy method to ensure proper cleanup and error handling.
       * Sends a close notification packet to the remote peer for immediate stream termination.
       *
       * @override
       * @param {Error} [error] - Optional error that caused the destruction
       * @returns {this} The stream instance for chaining
       */
      destroy(error) {
        if (this.isClosed) {
          this.peer.logger.warn({ streamId: this.id }, "Attempt to destroy already closed stream");
          return this;
        }
        this.peer.logger.info({ streamId: this.id, error }, "Destroying stream");
        this.isClosed = true;
        this.cleanup();
        super.destroy(error);
        const closeReason = error ? error.message : "Stream destroyed";
        this.peer.sendPacket(createPacket(Packet.nextId(), 1, TYPE_STREAM_CLOSE, {
          streamId: this.id,
          reason: closeReason
        })).catch((sendError) => {
          this.peer.logger.error({ streamId: this.id, error: sendError }, "Failed to send stream close packet");
        });
        return this;
      }
      /**
       * Internal cleanup method that removes stream references from the peer.
       * This ensures proper garbage collection and prevents memory leaks.
       */
      cleanup = /* @__PURE__ */ __name(() => {
        this.peer.logger.debug({ streamId: this.id }, "Cleaning up stream resources");
        this.peer.writableStreams.delete(this.id);
      }, "cleanup");
      /**
       * Factory method for creating a NetronWritableStream instance.
       * Optionally pipes data from a source stream if provided.
       *
       * @static
       * @param {RemotePeer} peer - The remote peer this stream is associated with
       * @param {AsyncIterable<any> | Readable} [source] - Optional source stream to pipe from
       * @param {boolean} [isLive=false] - Whether the stream is operating in live mode
       * @param {number} [streamId] - Optional custom stream identifier
       * @returns {NetronWritableStream} A new stream instance
       */
      static create(peer, source, isLive = false, streamId) {
        const stream = new _NetronWritableStream({ peer, streamId, isLive });
        if (source) {
          stream.pipeFrom(source);
        }
        return stream;
      }
    };
  }
});

// src/netron/stream-reference.ts
var stream_reference_exports = {};
__export(stream_reference_exports, {
  StreamReference: () => StreamReference
});
var StreamReference;
var init_stream_reference = __esm({
  "src/netron/stream-reference.ts"() {
    "use strict";
    init_process_shim();
    init_readable_stream();
    init_writable_stream();
    StreamReference = class _StreamReference {
      /**
       * Creates a new StreamReference instance.
       *
       * @param {number} streamId - Unique identifier of the stream
       * @param {StreamReferenceType} type - Type of the stream (readable or writable)
       * @param {boolean} isLive - Indicates if the stream is live/real-time
       * @param {string} peerId - ID of the peer that owns the stream
       */
      constructor(streamId, type, isLive, peerId) {
        this.streamId = streamId;
        this.type = type;
        this.isLive = isLive;
        this.peerId = peerId;
      }
      static {
        __name(this, "StreamReference");
      }
      /**
       * Creates a StreamReference from an existing stream instance.
       * This method is used to serialize a local stream for transmission over the network.
       *
       * @static
       * @param {NetronReadableStream | NetronWritableStream} stream - The stream instance to reference
       * @returns {StreamReference} A new StreamReference representing the given stream
       */
      static from(stream) {
        return new _StreamReference(
          stream.id,
          stream instanceof NetronWritableStream ? "writable" : "readable",
          stream.isLive,
          stream.peer.id
        );
      }
      /**
       * Creates a stream instance from a StreamReference.
       * This method is used to deserialize a stream reference into a working stream instance
       * on the receiving end of a network transmission.
       *
       * @static
       * @param {StreamReference} ref - The stream reference to convert
       * @param {RemotePeer} peer - The remote peer that owns the stream
       * @returns {NetronReadableStream | NetronWritableStream} A new stream instance
       * @throws {Error} If the stream type is invalid or creation fails
       */
      static to(ref, peer) {
        if (ref.type === "writable") {
          return NetronReadableStream.create(peer, ref.streamId, ref.isLive);
        } else {
          return NetronWritableStream.create(peer, void 0, ref.isLive, ref.streamId);
        }
      }
    };
  }
});

// src/netron/packet/serializer.ts
async function ensureStreamReferenceRegistered() {
  if (streamReferenceRegistered) {
    return;
  }
  try {
    const module = await Promise.resolve().then(() => (init_stream_reference(), stream_reference_exports));
    StreamReferenceClass = module.StreamReference;
    serializer2.register(
      107,
      StreamReferenceClass,
      /**
       * Encodes a StreamReference object into a binary buffer.
       * Serializes the stream's identity, type, liveness status, and associated peer.
       *
       * @param {StreamReference} obj - The StreamReference object to encode
       * @param {SmartBuffer} buf - The buffer to write the encoded data to
       */
      (obj, buf) => {
        serializer2.encode(obj.streamId.toString(), buf);
        buf.writeUInt8(obj.type === "writable" ? 1 : 0);
        buf.writeUInt8(obj.isLive ? 1 : 0);
        serializer2.encode(obj.peerId, buf);
      },
      /**
       * Decodes a StreamReference object from a binary buffer.
       * Reconstructs the stream reference with its type, liveness status,
       * and associated peer information.
       *
       * @param {SmartBuffer} buf - The buffer containing the encoded StreamReference
       * @returns {StreamReference} A new StreamReference instance with restored properties
       */
      (buf) => {
        const streamId = Number(serializer2.decode(buf));
        const streamType = buf.readUInt8() === 1 ? "writable" : "readable";
        const isLive = buf.readUInt8() === 1;
        const peerId = serializer2.decode(buf);
        return new StreamReferenceClass(streamId, streamType, isLive, peerId);
      }
    );
    streamReferenceRegistered = true;
  } catch (error) {
    console.error("Failed to register StreamReference:", error);
    throw error;
  }
}
var serializer2, streamReferenceRegistered, StreamReferenceClass, originalEncode, originalDecode;
var init_serializer2 = __esm({
  "src/netron/packet/serializer.ts"() {
    "use strict";
    init_process_shim();
    init_dist3();
    init_reference();
    init_definition();
    serializer2 = new Serializer();
    registerCommonTypesFor(serializer2);
    serializer2.register(
      109,
      Definition,
      /**
       * Encodes a Definition object into a binary buffer.
       * The encoding process preserves the object's identity and relationships
       * by serializing its id, parentId, peerId, and metadata.
       *
       * @param {Definition} obj - The Definition object to encode
       * @param {SmartBuffer} buf - The buffer to write the encoded data to
       */
      (obj, buf) => {
        serializer2.encode(obj.id, buf);
        serializer2.encode(obj.parentId, buf);
        serializer2.encode(obj.peerId, buf);
        serializer2.encode(obj.meta, buf);
      },
      /**
       * Decodes a Definition object from a binary buffer.
       * Reconstructs the object's state by reading its properties in the same
       * order they were written during encoding.
       *
       * @param {SmartBuffer} buf - The buffer containing the encoded Definition
       * @returns {Definition} A new Definition instance with restored properties
       */
      (buf) => {
        const id = serializer2.decode(buf);
        const parentId = serializer2.decode(buf);
        const peerId = serializer2.decode(buf);
        const meta = serializer2.decode(buf);
        const def = new Definition(id, peerId, meta);
        def.parentId = parentId;
        return def;
      }
    ).register(
      108,
      Reference,
      /**
       * Encodes a Reference object into a binary buffer.
       * Only the defId property is serialized as it uniquely identifies
       * the referenced service definition.
       *
       * @param {Reference} obj - The Reference object to encode
       * @param {SmartBuffer} buf - The buffer to write the encoded data to
       */
      (obj, buf) => {
        serializer2.encode(obj.defId, buf);
      },
      /**
       * Decodes a Reference object from a binary buffer.
       * Creates a new Reference instance using the decoded defId.
       *
       * @param {SmartBuffer} buf - The buffer containing the encoded Reference
       * @returns {Reference} A new Reference instance with the restored defId
       */
      (buf) => new Reference(serializer2.decode(buf))
    );
    streamReferenceRegistered = false;
    StreamReferenceClass = null;
    __name(ensureStreamReferenceRegistered, "ensureStreamReferenceRegistered");
    originalEncode = serializer2.encode.bind(serializer2);
    originalDecode = serializer2.decode.bind(serializer2);
    serializer2.encode = function(value, buffer) {
      if (value && value.constructor && value.constructor.name === "StreamReference" && !streamReferenceRegistered) {
        Promise.resolve(ensureStreamReferenceRegistered()).catch(console.error);
      }
      return originalEncode(value, buffer);
    };
    serializer2.decode = function(buffer) {
      return originalDecode(buffer);
    };
  }
});

// src/netron/packet/index.ts
var createPacket, encodePacket, decodePacket;
var init_packet2 = __esm({
  "src/netron/packet/index.ts"() {
    "use strict";
    init_process_shim();
    init_dist2();
    init_packet();
    init_serializer2();
    init_types();
    init_types();
    createPacket = /* @__PURE__ */ __name((id, impulse, action, data) => {
      const packet = new Packet(id);
      packet.setImpulse(impulse);
      packet.setType(action);
      packet.data = data;
      return packet;
    }, "createPacket");
    encodePacket = /* @__PURE__ */ __name((packet) => {
      const buf = new SmartBuffer(SmartBuffer.DEFAULT_CAPACITY, true);
      buf.writeUInt32BE(packet.id);
      buf.writeUInt8(packet.flags);
      serializer2.encode(packet.data, buf);
      if (packet.isStreamChunk()) {
        buf.writeUInt32BE(packet.streamId);
        buf.writeUInt32BE(packet.streamIndex);
      }
      return buf.toBuffer();
    }, "encodePacket");
    decodePacket = /* @__PURE__ */ __name((buf) => {
      const buffer = SmartBuffer.wrap(buf);
      const pkt = new Packet(buffer.readUInt32BE());
      pkt.flags = buffer.readUInt8();
      const result = serializer2.decoder.tryDecode(buffer);
      if (!result) {
        throw new Error("Invalid packet");
      }
      pkt.data = result.value;
      if (pkt.isStreamChunk()) {
        pkt.streamId = buffer.readUInt32BE();
        pkt.streamIndex = buffer.readUInt32BE();
      }
      return pkt;
    }, "decodePacket");
  }
});

// src/netron/client.ts
init_process_shim();

// src/netron/browser-netron-client.ts
init_process_shim();

// ../eventemitter/dist/index.js
init_process_shim();

// ../eventemitter/dist/types.js
init_process_shim();

// ../eventemitter/dist/emitter.js
init_process_shim();
init_dist();
var EventEmitter = class {
  static {
    __name(this, "EventEmitter");
  }
  constructor(concurrency) {
    this._events = /* @__PURE__ */ new Map();
    this._eventsCount = 0;
    this.onceListeners = /* @__PURE__ */ new WeakMap();
    if (concurrency && concurrency >= 1) {
      this.setConcurrency(concurrency);
    }
  }
  eventNames() {
    return Array.from(this._events.keys());
  }
  listeners(event) {
    const handlers = this._events.get(event);
    if (!handlers)
      return [];
    if (!Array.isArray(handlers)) {
      return [handlers.fn];
    }
    return handlers.map((h) => h.fn);
  }
  listenerCount(event) {
    const handlers = this._events.get(event);
    if (!handlers)
      return 0;
    if (!Array.isArray(handlers))
      return 1;
    return handlers.length;
  }
  emit(event, ...args) {
    const handlers = this._events.get(event);
    if (!handlers)
      return false;
    if (!Array.isArray(handlers)) {
      if (handlers.once) {
        this.removeListener(event, handlers.fn);
      }
      handlers.fn.apply(handlers.context, args);
    } else {
      const handlersCopy = handlers.slice();
      for (let i = 0; i < handlersCopy.length; i++) {
        const handler = handlersCopy[i];
        if (handler && handler.once) {
          this.removeListener(event, handler.fn);
        }
        if (handler) {
          handler.fn.apply(handler.context, args);
        }
      }
    }
    return true;
  }
  on(event, fn, context) {
    return this.addListener(event, fn, context, false);
  }
  addListener(event, fn, context, once = false) {
    if (typeof fn !== "function") {
      throw new TypeError("The listener must be a function");
    }
    const listener = {
      fn,
      context: context || this,
      once: once || false
    };
    const existing = this._events.get(event);
    if (!existing) {
      this._events.set(event, listener);
      this._eventsCount++;
    } else if (!Array.isArray(existing)) {
      this._events.set(event, [existing, listener]);
    } else {
      existing.push(listener);
    }
    return this;
  }
  once(event, fn, context) {
    if (typeof fn !== "function") {
      throw new TypeError("The listener must be a function");
    }
    let fired = false;
    const onceListener = /* @__PURE__ */ __name((...args) => {
      this.removeListener(event, onceListener);
      if (!fired) {
        fired = true;
        return fn.apply(context || this, args);
      }
      return void 0;
    }, "onceListener");
    this.on(event, onceListener);
    this.onceListeners.set(fn, onceListener);
    return this;
  }
  removeListener(event, fn) {
    const onceListener = this.onceListeners.get(fn);
    if (onceListener) {
      this.onceListeners.delete(fn);
      fn = onceListener;
    }
    const handlers = this._events.get(event);
    if (!handlers)
      return this;
    if (!Array.isArray(handlers)) {
      if (handlers.fn === fn) {
        this._events.delete(event);
        this._eventsCount--;
      }
    } else {
      const filtered = handlers.filter((h) => h.fn !== fn);
      if (filtered.length === 0) {
        this._events.delete(event);
        this._eventsCount--;
      } else if (filtered.length === 1 && filtered[0]) {
        this._events.set(event, filtered[0]);
      } else {
        this._events.set(event, filtered);
      }
    }
    return this;
  }
  off(event, fn) {
    return this.removeListener(event, fn);
  }
  removeAllListeners(event) {
    if (event) {
      if (this._events.has(event)) {
        this._events.delete(event);
        this._eventsCount--;
      }
    } else {
      this._events.clear();
      this._eventsCount = 0;
    }
    return this;
  }
  setConcurrency(concurrency) {
    if (concurrency >= 1) {
      this.limiter = pLimit(concurrency);
    }
    return this;
  }
  emitParallel(event, ...args) {
    const promises = this.listeners(event).map((listener) => this._executeListener(listener, args));
    return Promise.all(promises);
  }
  emitSerial(event, ...args) {
    return this.listeners(event).reduce((promise, listener) => promise.then((values) => this._executeListener(listener, args).then((value) => {
      values.push(value);
      return values;
    })), Promise.resolve([]));
  }
  emitReduce(event, ...args) {
    return this._emitReduceRun(event, args);
  }
  emitReduceRight(event, ...args) {
    return this._emitReduceRun(event, args, true);
  }
  subscribe(event, listener, once = false) {
    const unsubscribe = /* @__PURE__ */ __name(() => {
      this.removeListener(event, listener);
    }, "unsubscribe");
    if (once) {
      this.once(event, listener);
    } else {
      this.on(event, listener);
    }
    return unsubscribe;
  }
  _emitReduceRun(event, args, inverse = false) {
    const listeners = inverse ? this.listeners(event).reverse() : this.listeners(event);
    return listeners.reduce((promise, listener) => promise.then((prevArgs) => {
      const currentArgs = Array.isArray(prevArgs) ? prevArgs : [prevArgs];
      return this._executeListener(listener, currentArgs);
    }), Promise.resolve(args));
  }
  _executeListener(listener, args) {
    try {
      if (this.limiter) {
        return this.limiter(() => listener(...args));
      }
      return Promise.resolve(listener(...args));
    } catch (err) {
      return Promise.reject(err);
    }
  }
};

// ../eventemitter/dist/history.js
init_process_shim();

// ../eventemitter/dist/metrics.js
init_process_shim();

// ../eventemitter/dist/wildcard.js
init_process_shim();

// ../eventemitter/dist/scheduler.js
init_process_shim();

// ../eventemitter/dist/predicates.js
init_process_shim();

// ../eventemitter/dist/enhanced-emitter.js
init_process_shim();

// src/netron/clients/websocket-client.ts
init_process_shim();
init_packet2();
var BrowserWebSocketConnection = class extends EventEmitter {
  static {
    __name(this, "BrowserWebSocketConnection");
  }
  ws = null;
  url;
  protocols;
  reconnectEnabled;
  reconnectInterval;
  maxReconnectAttempts;
  reconnectAttempts = 0;
  reconnectTimeout;
  isManualDisconnect = false;
  constructor(options) {
    super();
    this.url = options.url;
    this.protocols = options.protocols;
    this.reconnectEnabled = options.reconnect ?? true;
    this.reconnectInterval = options.reconnectInterval ?? 1e3;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
  }
  /**
   * Connect to WebSocket server
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.isManualDisconnect = false;
        this.ws = new WebSocket(this.url, this.protocols);
        this.ws.binaryType = "arraybuffer";
        this.ws.addEventListener("open", () => {
          this.reconnectAttempts = 0;
          this.emit("connect");
          resolve();
        });
        this.ws.addEventListener("message", (event) => {
          this.handleMessage(event.data);
        });
        this.ws.addEventListener("error", (event) => {
          const error = new Error("WebSocket error");
          this.emit("error", error);
          reject(error);
        });
        this.ws.addEventListener("close", (event) => {
          this.emit("disconnect", event.reason);
          if (this.reconnectEnabled && !this.isManualDisconnect) {
            this.attemptReconnect();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  /**
   * Handle incoming message (binary data)
   */
  handleMessage(data) {
    try {
      const packet = decodePacket(data);
      this.emit("packet", packet);
      this.emit("message", data, true);
    } catch (error) {
      this.emit("error", error);
    }
  }
  /**
   * Send a packet through WebSocket
   */
  async sendPacket(packet) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    const buffer = encodePacket(packet);
    this.ws.send(buffer);
  }
  /**
   * Send raw data through WebSocket
   */
  async send(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    this.ws.send(data);
  }
  /**
   * Disconnect from WebSocket server
   */
  async disconnect() {
    this.isManualDisconnect = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = void 0;
    }
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1e3, "Manual disconnect");
      }
      this.ws = null;
    }
  }
  /**
   * Check if connected
   */
  isConnected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
  /**
   * Attempt to reconnect to the server
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit("reconnect-failed");
      return;
    }
    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);
    this.reconnectTimeout = window.setTimeout(async () => {
      try {
        await this.connect();
        this.emit("reconnect");
      } catch (error) {
      }
    }, delay);
  }
  /**
   * Get remote address (not available in browser WebSocket)
   */
  get remoteAddress() {
    return this.url;
  }
  /**
   * Get local address (not available in browser WebSocket)
   */
  get localAddress() {
    return void 0;
  }
};

// src/netron/browser-remote-peer.ts
init_process_shim();
init_dist();
init_packet2();
init_constants();
var BrowserRemotePeer = class extends EventEmitter {
  static {
    __name(this, "BrowserRemotePeer");
  }
  id;
  logger;
  connection;
  /**
   * Map of response handlers for pending requests
   */
  responseHandlers;
  /** Map of service definitions indexed by definition ID */
  definitions = /* @__PURE__ */ new Map();
  /** Map of event subscribers indexed by event name */
  eventSubscribers = /* @__PURE__ */ new Map();
  /**
   * Creates a new Browser Remote Peer
   */
  constructor(connection, id = "", logger, requestTimeout) {
    super();
    this.connection = connection;
    this.id = id;
    this.logger = logger || console;
    this.responseHandlers = new TimedMap(requestTimeout ?? REQUEST_TIMEOUT, (packetId) => {
      const handlers = this.responseHandlers.get(packetId);
      if (handlers?.errorHandler) {
        handlers.errorHandler(new Error("Request timeout exceeded"));
      }
      this.responseHandlers.delete(packetId);
    });
  }
  /**
   * Initialize the peer connection
   */
  async init() {
    this.logger.info("Initializing browser remote peer");
    this.connection.on("packet", (packet) => {
      this.handlePacket(packet);
    });
    this.connection.on("disconnect", () => {
      this.cleanup();
    });
  }
  /**
   * Subscribe to an event from the remote peer
   */
  async subscribe(eventName, handler) {
    const handlers = this.eventSubscribers.get(eventName);
    if (!handlers) {
      this.eventSubscribers.set(eventName, [handler]);
      await this.runTask("subscribe", eventName);
    } else if (!handlers.includes(handler)) {
      handlers.push(handler);
    }
  }
  /**
   * Unsubscribe from an event
   */
  async unsubscribe(eventName, handler) {
    const handlers = this.eventSubscribers.get(eventName);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index >= 0) {
        handlers.splice(index, 1);
        if (handlers.length === 0) {
          this.eventSubscribers.delete(eventName);
          await this.runTask("unsubscribe", eventName);
        }
      }
    }
  }
  /**
   * Get a value from a service definition
   */
  get(defId, name) {
    const def = this.definitions.get(defId);
    if (!def) {
      throw new Error(`Unknown definition: ${defId}`);
    }
    return new Promise((resolve, reject) => {
      this.sendRequest(
        TYPE_GET,
        [defId, name],
        (result) => {
          resolve(this.processResult(def, result));
        },
        reject
      ).catch(reject);
    });
  }
  /**
   * Set a value in a service definition
   */
  set(defId, name, value) {
    const def = this.definitions.get(defId);
    if (!def) {
      throw new Error(`Unknown definition: ${defId}`);
    }
    return new Promise((resolve, reject) => {
      this.sendRequest(
        TYPE_SET,
        [defId, name, value],
        () => {
          resolve();
        },
        reject
      ).catch(reject);
    });
  }
  /**
   * Call a method on a service definition
   */
  call(defId, method, args) {
    const def = this.definitions.get(defId);
    if (!def) {
      throw new Error(`Unknown definition: ${defId}`);
    }
    args = this.processArgs(def, args);
    return new Promise((resolve, reject) => {
      this.sendRequest(
        TYPE_CALL,
        [defId, method, ...args],
        (result) => {
          resolve(this.processResult(def, result));
        },
        reject
      ).catch(reject);
    });
  }
  /**
   * Disconnect from the remote peer
   */
  async disconnect() {
    this.logger.info("Disconnecting browser remote peer");
    await this.connection.disconnect();
    this.cleanup();
  }
  /**
   * Execute a task on the remote peer
   */
  runTask(name, ...args) {
    return new Promise((resolve, reject) => {
      this.sendRequest(
        TYPE_TASK,
        [name, ...args],
        (result) => {
          resolve(result);
        },
        reject
      ).catch(reject);
    });
  }
  /**
   * Send a request to the remote peer
   */
  async sendRequest(type, data, successHandler, errorHandler) {
    const packet = createPacket(Packet.nextId(), 1, type, data);
    this.responseHandlers.set(packet.id, {
      successHandler,
      errorHandler
    });
    await this.sendPacket(packet);
  }
  /**
   * Send a packet to the remote peer
   */
  async sendPacket(packet) {
    if (!this.connection.isConnected()) {
      throw new Error("Connection is not open");
    }
    await this.connection.sendPacket(packet);
  }
  /**
   * Handle incoming packets
   */
  handlePacket(packet) {
    this.logger.debug("Handling packet:", packet.getType());
    if (packet.getImpulse() === 0) {
      this.handleResponse(packet);
      return;
    }
    const pType = packet.getType();
    if (pType === TYPE_STREAM) {
      this.emit("stream", packet);
    }
  }
  /**
   * Handle a response packet
   */
  handleResponse(packet) {
    const id = packet.id;
    const handlers = this.responseHandlers.get(id);
    if (handlers) {
      this.responseHandlers.delete(id);
      const data = packet.data;
      if (packet.getError() === 0) {
        handlers.successHandler(data);
      } else {
        handlers.errorHandler?.(data);
      }
    }
  }
  /**
   * Process arguments before sending
   */
  processArgs(def, args) {
    return args;
  }
  /**
   * Process result after receiving
   */
  processResult(def, result) {
    return result;
  }
  /**
   * Reference a service definition
   */
  refService(def, parentDef) {
    const existingDef = this.definitions.get(def.id);
    if (existingDef) {
      return existingDef;
    }
    if (parentDef) {
      def.parentId = parentDef.id;
    }
    this.definitions.set(def.id, def);
    return def;
  }
  /**
   * Clean up resources
   */
  cleanup() {
    this.responseHandlers.clear();
    this.eventSubscribers.clear();
    this.definitions.clear();
  }
};

// src/netron/utils.ts
init_process_shim();
var getQualifiedName = /* @__PURE__ */ __name((name, version) => `${name}${version ? `@${version}` : ""}`, "getQualifiedName");

// src/netron/browser-netron-client.ts
var BrowserNetronClient = class extends EventEmitter {
  static {
    __name(this, "BrowserNetronClient");
  }
  connection = null;
  peer = null;
  options;
  logger;
  id;
  constructor(options = {}) {
    super();
    this.options = options;
    this.logger = options.logger || console;
    this.id = this.generateId();
  }
  /**
   * Connect to Titan WebSocket server
   */
  async connect(url) {
    this.logger.info(`Connecting to ${url}`);
    this.connection = new BrowserWebSocketConnection({
      url,
      timeout: this.options.timeout,
      reconnect: this.options.reconnect,
      reconnectInterval: this.options.reconnectInterval,
      maxReconnectAttempts: this.options.maxReconnectAttempts
    });
    await this.connection.connect();
    await this.performHandshake();
    this.logger.info("Connected successfully");
  }
  /**
   * Perform handshake with server
   */
  async performHandshake() {
    return new Promise((resolve, reject) => {
      const messageHandler = /* @__PURE__ */ __name((data, isBinary) => {
        try {
          const text = new TextDecoder().decode(data);
          const message = JSON.parse(text);
          if (message.type === "id") {
            const serverId = message.id;
            this.logger.info(`Received server ID: ${serverId}`);
            this.peer = new BrowserRemotePeer(
              this.connection,
              serverId,
              this.logger,
              this.options.timeout
            );
            this.peer.init().then(() => {
              const clientIdMessage = JSON.stringify({
                type: "client-id",
                id: this.id
              });
              this.connection.send(new TextEncoder().encode(clientIdMessage));
              this.connection.off("message", messageHandler);
              resolve();
            }).catch(reject);
          }
        } catch (error) {
          this.logger.debug?.("Non-handshake message during handshake:", error);
        }
      }, "messageHandler");
      this.connection.on("message", messageHandler);
      setTimeout(() => {
        this.connection.off("message", messageHandler);
        reject(new Error("Handshake timeout"));
      }, this.options.timeout || 1e4);
    });
  }
  /**
   * Disconnect from server
   */
  async disconnect() {
    this.logger.info("Disconnecting");
    if (this.peer) {
      await this.peer.disconnect();
      this.peer = null;
    }
    if (this.connection) {
      await this.connection.disconnect();
      this.connection = null;
    }
  }
  /**
   * Query service interface from server
   */
  queryInterface(serviceName) {
    if (!this.peer) {
      throw new Error("Not connected. Call connect() first.");
    }
    let name;
    let version;
    if (serviceName.includes("@")) {
      [name, version] = serviceName.split("@");
    } else {
      name = serviceName;
    }
    return this.createServiceProxy(name, version);
  }
  /**
   * Create a proxy for service method calls
   */
  createServiceProxy(serviceName, version) {
    const qualifiedName = version ? getQualifiedName(serviceName, version) : serviceName;
    const SPECIAL_PROPERTIES = [
      "then",
      "catch",
      "finally",
      "constructor",
      "prototype",
      Symbol.toStringTag,
      Symbol.iterator,
      Symbol.asyncIterator
    ];
    return new Proxy({}, {
      get: /* @__PURE__ */ __name((_target, prop) => {
        if (SPECIAL_PROPERTIES.includes(prop)) {
          return void 0;
        }
        if (typeof prop === "symbol" || prop.startsWith("_")) {
          return void 0;
        }
        return async (...args) => {
          if (!this.peer) {
            throw new Error("Not connected");
          }
          let def = Array.from(this.peer.definitions.values()).find(
            (d) => d.meta.name === qualifiedName
          );
          if (!def) {
            def = await this.peer.runTask("query_interface", qualifiedName);
            if (def) {
              this.peer.refService(def);
            }
          }
          if (!def) {
            throw new Error(`Service not found: ${qualifiedName}`);
          }
          return await this.peer.call(def.id, prop, args);
        };
      }, "get")
    });
  }
  /**
   * Check if connected
   */
  isConnected() {
    return this.connection !== null && this.connection.isConnected();
  }
  /**
   * Get client metrics
   */
  getMetrics() {
    return {
      id: this.id,
      connected: this.isConnected(),
      serverId: this.peer?.id
    };
  }
  /**
   * Generate unique client ID
   */
  generateId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : r & 3 | 8;
      return v.toString(16);
    });
  }
};

// src/netron/client.ts
init_types();
init_packet();
export {
  BrowserNetronClient,
  BrowserRemotePeer,
  BrowserWebSocketConnection,
  Packet,
  StreamType,
  TYPE_CALL,
  TYPE_GET,
  TYPE_PING,
  TYPE_SET,
  TYPE_STREAM,
  TYPE_STREAM_CLOSE,
  TYPE_STREAM_ERROR,
  TYPE_TASK
};
/*! Bundled license information:

long/index.js:
  (**
   * @license
   * Copyright 2009 The Closure Library Authors
   * Copyright 2020 Daniel Wirtz / The long.js Authors.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *
   * SPDX-License-Identifier: Apache-2.0
   *)

ieee754/index.js:
  (*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> *)

buffer/index.js:
  (*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   *)
*/
//# sourceMappingURL=netron-unified.js.map
