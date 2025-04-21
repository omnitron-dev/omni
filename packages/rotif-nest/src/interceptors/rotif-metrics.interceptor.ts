import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RotifMessage } from '@devgrid/rotif';
import {
  Injectable,
  CallHandler,
  NestInterceptor,
  ExecutionContext,
} from '@nestjs/common';

@Injectable()
export class RotifMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const msg = context.getArgByIndex<RotifMessage>(0);
    const start = process.hrtime.bigint();

    return next.handle().pipe(
      tap(() => {
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1_000_000;

        // Здесь можно отправить метрики в Prometheus, Datadog или другую систему мониторинга
        console.log(
          `Metrics: Message ${msg.channel} processed in ${durationMs.toFixed(2)}ms`,
        );
      }),
    );
  }
}
