import amqp from 'amqplib';
import { randomUUID } from 'crypto';
import { config } from '../../../main/env';
import { AppError } from '../../../domain/common/types';
import {
  type Envelope,
  type MessagePublisher,
} from '../../../application/ports/outbound/MessagePublisher';

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
};

const RPC_TIMEOUT_MS = 30_000;

export class RabbitMQService implements MessagePublisher {
  private static instance: RabbitMQService;

  private connection: AmqpConnection | null = null;
  private channel: amqp.Channel | null = null;
  private replyQueue: string | null = null;
  private reconnecting = false;

  private readonly pending = new Map<string, PendingCall>();

  private constructor() {}

  public static getInstance(): RabbitMQService {
    if (!RabbitMQService.instance) {
      RabbitMQService.instance = new RabbitMQService();
    }
    return RabbitMQService.instance;
  }

  public async connectWithRetry(retries = 5, intervalMs = 5000): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.establish();
        console.info(`Connected to RabbitMQ on attempt ${attempt}.`);
        return;
      } catch (error) {
        lastError = error;
        console.error(`RabbitMQ connection failed (attempt ${attempt}/${retries}).`);
        if (attempt < retries) {
          await this.sleep(intervalMs);
        }
      }
    }

    throw lastError;
  }

  public createEnvelope(eventType: string, payload: unknown): Envelope {
    return {
      messageId: randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  public async publishRPC(queue: string, message: Envelope): Promise<unknown> {
    const channel = this.requireChannel();
    const replyQueue = this.replyQueue;

    if (!replyQueue) {
      throw new AppError(
        'UPSTREAM_UNAVAILABLE',
        'The reply queue is not ready yet.',
        503
      );
    }

    await channel.assertQueue(queue, { durable: true });
    const correlationId = message.messageId;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(
          new AppError(
            'UPSTREAM_TIMEOUT',
            'The rule builder did not respond in time.',
            504
          )
        );
      }, RPC_TIMEOUT_MS);

      timer.unref?.();
      this.pending.set(correlationId, { resolve, reject, timer });

      try {
        channel.sendToQueue(queue, this.encode(message), {
          persistent: true,
          contentType: 'application/json',
          correlationId,
          messageId: correlationId,
          replyTo: replyQueue,
          expiration: String(RPC_TIMEOUT_MS),
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(correlationId);
        reject(error);
      }
    });
  }

  public async close(): Promise<void> {
    this.rejectAllPending(
      new AppError('UPSTREAM_UNAVAILABLE', 'The service is shutting down.', 503)
    );

    try {
      await this.channel?.close();
      await this.connection?.close();
    } finally {
      this.channel = null;
      this.connection = null;
      this.replyQueue = null;
    }
  }

  private async establish(): Promise<void> {
    const connection = await amqp.connect(config.rabbitmqUrl);
    const channel = await connection.createChannel();

    connection.on('error', (error: Error) => {
      console.error(`RabbitMQ connection error: ${error.message}`);
    });

    connection.on('close', () => {
      this.handleDisconnect();
    });

    const reply = await channel.assertQueue('', {
      exclusive: true,
      autoDelete: true,
    });

    await channel.consume(reply.queue, (msg) => this.handleReply(msg), {
      noAck: true,
    });

    this.connection = connection;
    this.channel = channel;
    this.replyQueue = reply.queue;
    this.reconnecting = false;
  }

  private handleReply(msg: amqp.ConsumeMessage | null): void {
    if (!msg) {
      return;
    }

    const correlationId = msg.properties.correlationId;
    if (!correlationId) {
      return;
    }

    const call = this.pending.get(correlationId);
    if (!call) {
      return;
    }

    clearTimeout(call.timer);
    this.pending.delete(correlationId);

    try {
      call.resolve(JSON.parse(msg.content.toString()));
    } catch {
      call.reject(
        new AppError(
          'UPSTREAM_INVALID_RESPONSE',
          'The rule builder returned a reply that is not valid JSON.',
          502
        )
      );
    }
  }

  private handleDisconnect(): void {
    this.channel = null;
    this.connection = null;
    this.replyQueue = null;

    this.rejectAllPending(
      new AppError(
        'UPSTREAM_UNAVAILABLE',
        'The connection to the message broker was lost.',
        503
      )
    );

    if (this.reconnecting) {
      return;
    }

    this.reconnecting = true;
    console.error('RabbitMQ connection closed. Attempting to reconnect.');

    void this.connectWithRetry().catch(() => {
      this.reconnecting = false;
      console.error('RabbitMQ reconnection failed. Publishing is unavailable.');
    });
  }

  private rejectAllPending(error: AppError): void {
    for (const [correlationId, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(error);
      this.pending.delete(correlationId);
    }
  }

  private requireChannel(): amqp.Channel {
    if (!this.channel) {
      throw new AppError(
        'UPSTREAM_UNAVAILABLE',
        'The message broker is not available.',
        503
      );
    }
    return this.channel;
  }

  private encode(message: Envelope): Buffer {
    return Buffer.from(JSON.stringify(message));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
