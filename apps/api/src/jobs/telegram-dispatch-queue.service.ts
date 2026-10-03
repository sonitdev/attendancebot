import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

export interface DeliveryJob { id: string; organizationId: string }
export function deliveryJobId({ id, organizationId }: DeliveryJob): string {
  return `delivery-${createHash('sha256').update(JSON.stringify([organizationId, id])).digest('hex')}`;
}

@Injectable()
export class TelegramDispatchQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramDispatchQueueService.name);
  private producer?: Redis;
  private consumer?: Redis;
  private queue?: Queue<DeliveryJob>;
  private worker?: Worker<DeliveryJob>;
  private stopped = false;

  constructor(private readonly config: ConfigService) {}

  start(processDelivery: (id: string, organizationId: string) => Promise<boolean>): void {
    const url = this.config.get<string>('REDIS_URL');
    if (!url || this.queue || this.stopped) return;
    try {
      // Producers fail fast; workers reconnect indefinitely. Neither is on the attendance transaction path.
      this.producer = new Redis(url, {
        maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 1_000, commandTimeout: 1_000,
      });
      this.consumer = new Redis(url, { maxRetriesPerRequest: null, connectTimeout: 1_000 });
      this.producer.on('error', () => this.logger.warn('Telegram queue unavailable; durable database scan remains active.'));
      this.consumer.on('error', () => {});
      this.queue = new Queue<DeliveryJob>('telegram-deliveries', {
        connection: this.producer,
        defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
      });
      this.worker = new Worker<DeliveryJob>('telegram-deliveries', async (job: Job<DeliveryJob>) => {
        if (typeof job.data?.id !== 'string' || !job.data.id ||
            typeof job.data?.organizationId !== 'string' || !job.data.organizationId) return;
        await processDelivery(job.data.id, job.data.organizationId);
      }, { connection: this.consumer, concurrency: 4 });
      this.queue.on('error', () => {});
      this.worker.on('error', () => {});
    } catch {
      this.logger.warn('Telegram queue initialization failed; using the durable database scan.');
      void this.close();
    }
  }

  async enqueue(data: DeliveryJob): Promise<boolean> {
    if (this.stopped || !this.queue || this.producer?.status !== 'ready') return false;
    // BullMQ initialization can wait for Redis readiness independently of commandTimeout.
    // Bound the entire enqueue. A late enqueue is safe because the database claim is authoritative.
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.queue.add('deliver', data, { jobId: deliveryJobId(data) }).then(() => true),
        new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), 1_500); }),
      ]);
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.close();
  }

  private async close(): Promise<void> {
    // Force close avoids waiting for Redis or a network send. Persisted PROCESSING claims recover safely.
    this.producer?.disconnect();
    this.consumer?.disconnect();
    await Promise.allSettled([this.worker?.close(true), this.queue?.close()]);
    this.worker = undefined;
    this.queue = undefined;
  }
}
