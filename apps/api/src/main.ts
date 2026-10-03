import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { HttpLatencyLoggingInterceptor } from './common/interceptors/http-latency.interceptor.js';
import { registerRequestTiming } from './common/performance/index.js';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({ bodyLimit: 10 * 1024 * 1024 });
  registerRequestTiming(adapter.getInstance());
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
  );
  app.useGlobalInterceptors(new HttpLatencyLoggingInterceptor());
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-organization-id',
      'idempotency-key',
      'x-telegram-bot-api-secret-token',
      'x-request-id',
      'ngrok-skip-browser-warning',
    ],
    exposedHeaders: ['x-request-id', 'Server-Timing'],
  });
  const port = Number(process.env.PORT ?? 5131);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[NestJS API] Server running on http://localhost:${port}/api/v1`);
}

void bootstrap();
