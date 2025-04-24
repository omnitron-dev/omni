import { OrbitError } from './error';
import { Logger, ErrorHandler } from '../../types/common';
import { OrbitEvent, OrbitEvents } from '../events/orbitEvents';

export class OrbitErrorHandler implements ErrorHandler {
  constructor(private logger: Logger) { }

  public handleError(error: Error, context?: Record<string, any>): void {
    if (error instanceof OrbitError) {
      this.logger.error(`[${error.code}] ${error.message}`, { ...error.details, context });
    } else {
      this.logger.error(`Unhandled error: ${error.message}`, { stack: error.stack, context });
    }

    OrbitEvents.emit(OrbitEvent.ErrorOccurred, { error, context });
  }
}
