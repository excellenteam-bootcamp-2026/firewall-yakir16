import '../adapters/outbound/logger';
import express from 'express';
import { config } from './env';
import { databaseService } from '../adapters/outbound/persistence/drizzle/DatabaseService';
import { DrizzleRuleRepository } from '../adapters/outbound/persistence/DrizzleRuleRepository';
import { RabbitMQService } from '../adapters/outbound/rabbitmq/RabbitMQService';
import { FirewallService } from '../application/use-cases/FirewallService';
import { FirewallController } from '../adapters/inbound/FirewallController';

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  console.info(`${req.method} ${req.originalUrl}`);
  next();
});

async function bootstrap() {
  await databaseService.connectWithRetry();
  const rabbitmqService = RabbitMQService.getInstance();
  await rabbitmqService.connectWithRetry();

  const ruleRepository = new DrizzleRuleRepository();
  const firewallService = new FirewallService(ruleRepository, rabbitmqService);
  const firewallController = new FirewallController(firewallService);

  app.use('/api/firewall', firewallController.router);

  app.listen(config.port, () => {
    console.log(`Server is running in ${config.env} mode on port ${config.port}`);
  });
}

bootstrap();