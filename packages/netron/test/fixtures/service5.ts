import { Public, Service } from '../../dist';

export interface IService5 {
  generateError(errorType: string): void;
  generateCustomError(errorType: string, code: number, meta?: object): void;
}

export declare class PrismaClientKnownRequestError extends Error {
  code: string;
  meta?: Record<string, unknown>;
  clientVersion: string;
  batchRequestIdx?: number;
  constructor(
    message: string,
    {
      code,
      clientVersion,
      meta,
      batchRequestIdx,
    }: {
      code: string;
      clientVersion: string;
      meta?: Record<string, unknown>;
      batchRequestIdx?: number;
    }
  );
  get [Symbol.toStringTag](): string;
}

@Service('service5')
export class Service5 implements IService5 {
  @Public()
  generateError(errorType: string): void {
    switch (errorType) {
      case 'TypeError':
        throw new TypeError('This is a TypeError');
      case 'RangeError':
        throw new RangeError('This is a RangeError');
      case 'ReferenceError':
        throw new ReferenceError('This is a ReferenceError');
      case 'SyntaxError':
        throw new SyntaxError('This is a SyntaxError');
      case 'URIError':
        throw new URIError('This is a URIError');
      case 'EvalError':
        throw new EvalError('This is an EvalError');
      default:
        throw new Error('This is a generic Error');
    }
  }

  @Public()
  generateCustomError(errorType: string, code: number, meta?: object): void {
    const error = new Error('This is a custom error');
    error.name = errorType;
    (error as any).code = code;
    (error as any).meta = meta;
    throw error;
  }
}
