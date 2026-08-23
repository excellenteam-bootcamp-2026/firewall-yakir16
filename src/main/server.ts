import '../adapters/outbound/logger';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Server } from 'http';
import { config } from './env';
import { databaseService } from '../adapters/outbound/persistence/postgres/DatabaseService';
import { DrizzleRuleRepository } from '../adapters/outbound/persistence/DrizzleRuleRepository';
import { RabbitMQService } from '../adapters/outbound/rabbitmq/RabbitMQService';
import { FirewallService } from '../application/use-cases/FirewallService';
import { FirewallController } from '../adapters/inbound/http/FirewallController';

const app = express();

app.use(express.json({ limit: '256kb' }));

app.use((req, _res, next) => {
  console.info(`${req.method} ${req.originalUrl}`);
  next();
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', env: config.env });
});

async function bootstrap(): Promise<void> {
  const db = await databaseService.connectWithRetry();

  const rabbitmqService = RabbitMQService.getInstance();
  await rabbitmqService.connectWithRetry();

  const ruleRepository = new DrizzleRuleRepository(db);
  const firewallService = new FirewallService(
    ruleRepository,
    rabbitmqService,
    config.constants.QUEUES.FIREWALL_RULES
  );
  const firewallController = new FirewallController(firewallService);

  app.use(config.constants.API_PREFIX, firewallController.router);

  app.use((_req, res) => {
    res.status(404).json({
      status: 'error',
      code: 'NOT_FOUND',
      message: 'Resource not found.',
    });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', (error as Error)?.stack ?? error);
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Server error',
    });
  });

  const server: Server = app.listen(config.port, () => {
    console.info(`Server is running in ${config.env} mode on port ${config.port}.`);
  });

  registerShutdownHandlers(server, rabbitmqService);
}

function registerShutdownHandlers(
  server: Server,
  rabbitmqService: RabbitMQService
): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.info(`Received ${signal}. Shutting down.`);

    server.close();
    await rabbitmqService.close().catch(() => undefined);
    await databaseService.close().catch(() => undefined);

    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

bootstrap().catch((error: unknown) => {
  console.error(
    'Failed to start the server:',
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
