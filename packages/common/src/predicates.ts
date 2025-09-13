const objectProto = Object.prototype;
const { hasOwnProperty } = objectProto;
const { toString } = objectProto;
const funcToString = Function.prototype.toString;
const objectCtorString = funcToString.call(Object);
const symToStringTag = Symbol.toStringTag;

// Function to get the tag of a value
export const getTag = (value: any): string => {
  if (value == null) {
    return value === undefined ? "[object Undefined]" : "[object Null]";
  }

  // If the object has Symbol.toStringTag, use it directly
  if (symToStringTag && symToStringTag in Object(value)) {
    return toString.call(value);
  }

  // Otherwise, use the standard conversion
  return toString.call(value);
};

// Function to get a simplified tag of a value
export const getTagSimple = (value: any) => {
  const rawTag = toString.call(value);
  if (value === null) {
    return "null";
  }
  return rawTag.substring(8, rawTag.length - 1).toLowerCase();
};

// Check if the platform is Windows
export const isWindows = process.platform === "win32";
// Check if the platform is Linux
export const linux = process.platform === "linux";
// Check if the platform is FreeBSD
export const freebsd = process.platform === "freebsd";
// Check if the platform is OpenBSD
export const openbsd = process.platform === "openbsd";
// Check if the platform is macOS
export const darwin = process.platform === "darwin";
// Check if the platform is SunOS
export const sunos = process.platform === "sunos";
// Check if the platform is AIX
export const aix = process.platform === "aix";

// Check if the environment is Node.js
export const isNodejs =
  Object.prototype.toString.call(typeof process !== "undefined" ? process : 0) === "[object process]";

// Check if the value is an array
export const { isArray } = Array;

// Check if the value is a function
export const isFunction = (value: any): boolean => typeof value === "function";

// Check if the value is a string
export const isString = (value: any): boolean => typeof value === "string" || value instanceof String;

// Check if the value is a number
export const isNumber = (value: any): boolean => typeof value === "number";

// Check if the value is a buffer
export const isBuffer = (obj: any): boolean =>
  obj != null &&
  ((Boolean(obj.constructor) && typeof obj.constructor.isBuffer === "function" && obj.constructor.isBuffer(obj)) ||
    Boolean(obj._isBuffer));

// Check if the value is a plain object
export const isPlainObject = (value: any): boolean => {
  // Early return for null/undefined and non-objects
  if (!value || typeof value !== "object") {
    return false;
  }
  
  // Get the prototype
  const proto = Object.getPrototypeOf(value);
  
  // Objects created with Object.create(null) are plain objects
  if (proto === null) {
    return true;
  }
  
  // Check if it has Object.prototype as its direct prototype or
  // if its prototype is Object.create(null)
  const hasObjectPrototype = 
    proto === Object.prototype ||
    Object.getPrototypeOf(proto) === null;
  
  if (!hasObjectPrototype) {
    return false;
  }
  
  // Use toString to check the internal [[Class]]
  const stringTag = objectProto.toString.call(value);
  
  // Return true only if it's tagged as [object Object]
  // This will exclude Arguments, Arrays, and other built-in types
  return stringTag === "[object Object]";
};

// Checks whether `field` is a field owned by `object`.
export const isPropertyOwned = (obj: any, field: string) => hasOwnProperty.call(obj, field);

// Checks whether given value is `null`.
export const isNull = (value: any) => value === null;

// Checks whether given value is `undefined`.
export const isUndefined = (value: any) => value === undefined;

// Checks whether given value is class
export const isClass = (value: any) =>
  isFunction(value) &&
  isPropertyOwned(value, "prototype") &&
  value.prototype &&
  isPropertyOwned(value.prototype, "constructor") &&
  value.prototype.constructor.toString().substring(0, 5) === "class";

// Checks whether given value is `NaN`.
export const isNan = Number.isNaN;

// Checks whether given value is a finite number.
export const { isFinite } = Number;

// Checks whether given value is an integer.
export const { isInteger } = Number;

// Checks whether given value is a safe integer.
export const { isSafeInteger } = Number;

// Checks whether given value exists, i.e, not `null` nor `undefined`
export const isExist = (value: any) => value != null;

// Checks whether given value is either `null` or `undefined`
export const isNil = (value: any) => value == null;

// Checks whether given value is an empty string, i.e, a string with whitespace characters only.
export const isEmptyString = (str: any) => typeof str === "string" && /^\s*$/.test(str);

// Checks whether given value is a numeral, i.e:
// - a genuine finite number
// - or a string that represents a finite number
export const isNumeral = (value: any) => {
  const tag = getTagSimple(value);
  if (tag !== "number" && tag !== "string") {
    return false;
  }

  if (isEmptyString(value)) {
    return false;
  }

  try {
    value = Number(value);
  } catch (e) {
    return false;
  }

  return isFinite(value);
};

// Checks whether given value is a BigInt
export const isBigInt = (value: unknown): value is bigint => typeof value === "bigint";

// Checks whether given value is a numeral BigInt
export const isNumeralBigInt = (value: string) => {
  if (typeof value !== 'string') return false;
  return /^-?\d+n$/.test(value) && value !== 'n' && value !== '-n';
};

// Checks whether given value is a numeral integer
export const isNumeralInteger = (value: any) => {
  const tag = getTagSimple(value);
  if (tag !== "number" && tag !== "string") {
    return false;
  }

  if (isEmptyString(value)) {
    return false;
  }

  try {
    value = Number(value);
  } catch (error) {
    return false;
  }

  return Number.isInteger(value);
};

// Checks whether given value is an infinite number, i.e: +∞ or -∞.
export const isInfinite = (val: any) => val === +1 / 0 || val === -1 / 0;

// Checks whether given value is an odd number.
export const isOdd = (val: any) => isInteger(val) && val % 2 === 1;

// Checks whether given value is an even number.
export const isEven = (val: any) => isInteger(val) && val % 2 === 0;

// Checks whether given value is a float number.
export const isFloat = (val: any) => isNumber(val) && val !== Math.floor(val);

// Checks whether given value is negative zero.
export const isNegativeZero = (val: any) => val === 0 && Number.NEGATIVE_INFINITY === 1 / val;

// Checks whether `substr` is a substring of `str` starting from `offset`.
export const isSubstring = (substr: string, str: string, offset?: number) => {
  // Type checking
  if (typeof substr !== "string" || typeof str !== "string") {
    return false;
  }

  // Special case for empty strings
  if (substr === "") {
    return true;
  }

  const { length } = str;

  // If the string is empty but the substring is not
  if (length === 0) {
    return false;
  }

  // Convert offset to a number or use 0
  let normalizedOffset = 0;
  if (offset !== undefined) {
    normalizedOffset = Number(offset);
    // Any NaN or invalid value is converted to 0
    if (!Number.isFinite(normalizedOffset)) {
      normalizedOffset = 0;
    }
  }

  // Handle negative offset
  if (normalizedOffset < 0) {
    normalizedOffset = length + normalizedOffset;
  }

  // Boundary check
  if (normalizedOffset < 0) {
    normalizedOffset = 0;
  }

  // If the offset is greater than or equal to the string length, search is impossible
  if (normalizedOffset >= length) {
    return false;
  }

  // Search for the substring starting from the correct offset
  const result = str.indexOf(substr, normalizedOffset);
  return result !== -1;
};

// Checks whether `str` starts with `prefix`.
export const isPrefix = (prefix: string, str: string) => {
  if (typeof str !== 'string' || typeof prefix !== 'string') return false;
  return str.startsWith(prefix);
};

// Checks whether `str` ends with `suffix`.
export const isSuffix = (suffix: string, str: string) => {
  if (typeof str !== 'string' || typeof suffix !== 'string') return false;
  return str.endsWith(suffix);
};

// Checks whether given value is a boolean.
export const isBoolean = (value: any) => value === true || value === false;

// Checks whether given value is an ArrayBuffer.
export const isArrayBuffer = (x: any) => objectProto.toString.call(x) === "[object ArrayBuffer]";

// Checks whether given value is an ArrayBufferView.
export const isArrayBufferView = (x: any) => ArrayBuffer.isView(x);

// Checks whether given value is a Date.
export const isDate = (x: any) => getTagSimple(x) === "date";

// Checks whether given value is an Error.
export const isError = (value: any) => getTagSimple(value) === "error";

// Checks whether given value is a Map.
export const isMap = (value: any) => getTagSimple(value) === "map";

// Checks whether given value is a RegExp.
export const isRegexp = (value: any) => getTagSimple(value) === "regexp";

// Checks whether given value is a Set.
export const isSet = (value: any) => getTagSimple(value) === "set";

// Checks whether given value is a Symbol.
export const isSymbol = (value: any) => getTagSimple(value) === "symbol";

// Checks whether given value is a primitive.
export const isPrimitive = (value: any) =>
  isNil(value) || isNumber(value) || typeof value === "string" || isBoolean(value) || isSymbol(value);

// Checks whether given value is an object.
export const isObject = (value: any) => !isPrimitive(value);

// Checks whether given value is an empty object, i.e, an object without any own, enumerable, string keyed properties.
export const isEmptyObject = (obj: any): boolean => isObject(obj) && Object.keys(obj).length === 0;

// Checks whether `path` is a direct or inherited property of `object`.
export const isPropertyDefined = (obj: any, path: string) => {
  if (!path || typeof path !== 'string') return false;
  if (!isObject(obj)) return false;

  let context = obj;
  const keys = path.split(".");

  for (const key of keys) {
    if (!isObject(context) || !(key in context)) {
      return false;
    }
    context = context[key];
  }

  return true;
};

// Checks whether given function is an async function.
export const isAsyncFunction = (fn: any) => fn && toString.call(fn).slice(8, -1) === "AsyncFunction";

/**
 * Determines whether the provided object is an AsyncGenerator.
 * This predicate is used to identify async generator functions that can be streamed
 * over the network in the Netron system.
 * 
 * @param {any} obj - The object to be evaluated for AsyncGenerator membership
 * @returns {boolean} Returns true if the object is an AsyncGenerator, false otherwise
 * @example
 * async function* generate() { yield 1; }
 * const gen = generate();
 * isAsyncGenerator(gen); // returns true
 */
export const isAsyncGenerator = (obj: any): obj is AsyncGenerator => !!(obj && typeof obj === 'object' &&
  typeof obj.next === 'function' &&
  typeof obj.return === 'function' &&
  typeof obj.throw === 'function' &&
  typeof obj[Symbol.asyncIterator] === 'function');

// Checks whether given value is a Promise.
export const isPromise = (obj: any) => !isNil(obj) && isFunction(obj.then);
