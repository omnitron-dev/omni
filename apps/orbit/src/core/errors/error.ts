export class OrbitError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, any>;

  constructor(code: string, message: string, details?: Record<string, any>) {
    super(message);
    this.name = 'OrbitError';
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, OrbitError);
  }
}