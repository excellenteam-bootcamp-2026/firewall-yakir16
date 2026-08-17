import amqp from 'amqplib';
import { randomBytes } from 'crypto';
import { config } from '../../../main/env';
import { type MessagePublisher } from '../../../application/ports/outbound/MessagePublisher';

export class RabbitMQService implements MessagePublisher {
  private static instance: RabbitMQService;
  private channel: amqp.Channel | null = null;
  private connection: amqp.Connection | null = null;

  
  private constructor() {}

 
  public static getInstance(): RabbitMQService {
    if (!RabbitMQService.instance) {
      RabbitMQService.instance = new RabbitMQService();
    }
    return RabbitMQService.instance;
  }

  async connectWithRetry(retries = 5, interval = 5000): Promise<void> {
    const url = config.rabbitmqUrl;
    for (let i = 0; i < retries; i++) {
      try {
        this.connection = await amqp.connect(url);
        this.channel = await this.connection.createChannel();
        return;
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(res => setTimeout(res, interval));
      }
    }
  }

  createEnvelope(eventType: string, payload: any): object {
    return {
      eventType,
      timestamp: new Date().toISOString(),
      payload
    };
  }

  async publish(queue: string, message: object): Promise<boolean> {
    if (!this.channel) throw new Error('RabbitMQ channel not initialized');
    await this.channel.assertQueue(queue, { durable: true });
    return this.channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true });
  }

  async publishRPC(queue: string, message: object): Promise<any> {
    if (!this.channel) throw new Error('RabbitMQ channel not initialized');
    await this.channel.assertQueue(queue, { durable: true });
    const correlationId = randomBytes(16).toString('hex');
    const replyQueue = await this.channel.assertQueue('', { exclusive: true });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('RPC request timeout - Python service did not respond in time.'));
      }, 10000);

      this.channel!.consume(
        replyQueue.queue,
        (msg) => {
          if (msg && msg.properties.correlationId === correlationId) {
            clearTimeout(timeout);
            try {
              const content = JSON.parse(msg.content.toString());
              resolve(content);
            } catch (err) {
              reject(new Error('Failed to parse RPC response JSON'));
            }
          }
        },
        { noAck: true }
      );

      this.channel!.sendToQueue(
        queue,
        Buffer.from(JSON.stringify(message)),
        {
          correlationId,
          replyTo: replyQueue.queue,
          persistent: true
        }
      );
    });
  }
}