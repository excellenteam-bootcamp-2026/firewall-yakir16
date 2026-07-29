import { type Request,type Response, Router } from 'express';
import { type FirewallService } from '../../application/use-cases/FirewallService';
import { type RuleType } from '../../domain/Rule';

export class FirewallController {
  public router = Router();

  constructor(private firewallService: FirewallService) {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    this.router.post('/ips', this.addRules('ip'));
    this.router.post('/domains', this.addRules('domain'));
    this.router.post('/ports', this.addRules('port'));
    this.router.delete('/rules', this.deleteRules.bind(this));
    this.router.get('/rules', this.getRules.bind(this));
    this.router.patch('/rules/status', this.updateStatus.bind(this));
  }

  private addRules(type: RuleType) {
    return (req: Request, res: Response) => {
      try {
        const { values, mode } = req.body;
        const result = this.firewallService.addRules(type, mode, values);
        res.status(201).json(result);
      } catch (error: any) {
        this.handleError(res, error);
      }
    };
  }

  private deleteRules(req: Request, res: Response) {
    try {
      const { ids } = req.body;
      const result = this.firewallService.deleteRules(ids);
      res.status(200).json(result);
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  private getRules(req: Request, res: Response) {
    try {
      const type = req.query.type as string;
      const rules = this.firewallService.getRules(type);
      res.status(200).json(rules);
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  private updateStatus(req: Request, res: Response) {
    try {
      const { ids, active } = req.body;
      const result = this.firewallService.updateRulesStatus(ids, active);
      res.status(200).json(result);
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  private handleError(res: Response, error: Error) {
    const code = error.message;
    let message = 'An error occurred';
    let statusCode = 400;

    switch (code) {
      case 'INVALID_IP': message = 'Only valid IPv4 addresses are accepted.'; break;
      case 'INVALID_DOMAIN': message = 'Invalid domain format. Must not include protocol, path, or port.'; break;
      case 'INVALID_PORT': message = 'Ports must be integers between 1 and 65535.'; break;
      case 'INVALID_MODE': message = 'Mode must be strictly either blacklist or whitelist.'; break;
      case 'INVALID_VALUES': message = 'Values must be a non-empty array.'; break;
      case 'INVALID_IDS': message = 'IDs must be a non-empty array of integers.'; break;
      case 'INVALID_ACTIVE_STATUS': message = 'Active must be a boolean value.'; break;
      case 'RULE_NOT_FOUND': 
        message = 'Specified rule ID not found.'; 
        statusCode = 404; 
        break;
      default: message = error.message || message;
    }

    res.status(statusCode).json({ status: 'error', code, message });
  }
}
