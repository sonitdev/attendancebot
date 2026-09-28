import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

@Injectable()
export class HttpLatencyLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpLatencyLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      routeOptions?: { url?: string };
    }>();
    const startedAt = performance.now();

    // Log the route template, not query parameters that may contain sensitive data.
    const route = request.routeOptions?.url ?? request.url.split('?')[0];

    return next.handle().pipe(
      finalize(() => {
        this.logger.log(
          `[${request.method} ${route}] ${Math.round(performance.now() - startedAt)}ms`,
        );
      }),
    );
  }
}
