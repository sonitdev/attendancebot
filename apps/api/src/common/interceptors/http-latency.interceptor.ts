import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';
import { startStep } from '../performance/request-timing.js';

@Injectable()
export class HttpLatencyLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const stop = startStep('handler');
    let failed = false;
    // This span intentionally excludes guards and Fastify serialization; hooks own total time.
    return next.handle().pipe(
      tap({ error: () => { failed = true; } }),
      finalize(() => stop(failed)),
    );
  }
}
