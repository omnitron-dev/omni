export const errorIdMap: Record<any, number> = {};
export const stdIdMap: Record<string, number> = {};
export const stdErrors: any[] = [];

export const idErrorMap: Record<number, any> = {
  1: Error,
  2: SyntaxError,
  3: TypeError,
  4: ReferenceError,
  5: RangeError,
  6: EvalError,
  7: URIError,
};

const keys: number[] = Object.keys(idErrorMap).map((v) => +v);
for (let i = 0; i < keys.length; i++) {
  const errCode = keys[i]!;
  const ExceptionClass = idErrorMap[errCode];
  errorIdMap[ExceptionClass] = errCode;
  stdErrors.push(ExceptionClass);
  stdIdMap[ExceptionClass.name] = errCode;
}

export const createError = (id: number, message: string, stack?: string) => {
  const err = new idErrorMap[id](message);
  err.stack = stack;
  return err;
};

export const getStdErrorId = (err: any): number => stdIdMap[err.constructor.name] ?? stdIdMap[Error.name]!;
