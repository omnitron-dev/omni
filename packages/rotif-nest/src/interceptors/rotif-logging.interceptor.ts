import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RotifMessage } from '@devgrid/rotif';
import {
  Logger,
  Injectable,
  CallHandler,
  NestInterceptor,
  ExecutionContext,
} from '@nestjs/common';

@Injectable()
export class RotifLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RotifLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const msg = context.getArgByIndex<RotifMessage>(0);
    const handlerName = context.getHandler().name;

    this.logger.debug(
      `Handling message "${msg.id}" on channel "${msg.channel}" with handler "${handlerName}". Attempt: ${msg.attempt}`,
    );

    const now = Date.now();
    return next
      .handle()
      .pipe(
        tap(() =>
          this.logger.debug(
            `Message "${msg.id}" handled by "${handlerName}" in ${Date.now() - now
            }ms`,
          ),
        ),
      );
  }
}
