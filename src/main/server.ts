import express from 'express';
import { InMemoryRuleRepository } from '../adapters/outbound/persistence/InMemoryRuleRepository';
import { FirewallService } from '../application/use-cases/FirewallService';
import { FirewallController } from '../adapters/inbound/FirewallController';

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});


const ruleRepository = new InMemoryRuleRepository();
const firewallService = new FirewallService(ruleRepository);
const firewallController = new FirewallController(firewallService);

app.use('/api/firewall', firewallController.router);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
