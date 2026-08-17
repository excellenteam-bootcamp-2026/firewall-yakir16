import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { type FirewallService } from '../../application/use-cases/FirewallService';
import { type RuleType } from '../../domain/Rule';
import { AppError, type NonEmptyList } from '../../domain/common/types';


const addRulesSchema = z.object({
  mode: z.enum(['blacklist', 'whitelist']),
  values: z.array(z.union([z.string(), z.number()])).min(1, 'values array cannot be empty')
});

const idsSchema = z.object({
  ids: z.array(z.number().int()).min(1, 'ids array cannot be empty')
});

const updateStatusSchema = z.object({
  ids: z.array(z.number().int()).min(1, 'ids array cannot be empty'),
  active: z.boolean({ invalid_type_error: 'Active must be a boolean value.' })
});

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
    return async (req: Request, res: Response) => {
      try {
        const parsed = addRulesSchema.parse(req.body);
        const result = await this.firewallService.addRules({
          type,
          mode: parsed.mode as any,
          values: parsed.values as NonEmptyList<string | number>
        });
        
        res.status(201).json(result);
      } catch (error) {
        this.handleError(res, error);
      }
    };
  }

  private async deleteRules(req: Request, res: Response) {
    try {
      const parsed = idsSchema.parse(req.body);
      const result = await this.firewallService.deleteRules(parsed.ids as NonEmptyList<number>);
      res.status(200).json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  }

  private async getRules(req: Request, res: Response) {
    try {
      const type = req.query.type as string | undefined;
      const rules = await this.firewallService.getRules(type);
      res.status(200).json(rules);
    } catch (error) {
      this.handleError(res, error);
    }
  }

  private async updateStatus(req: Request, res: Response) {
    try {
      const parsed = updateStatusSchema.parse(req.body);
      const result = await this.firewallService.updateRulesStatus(parsed.ids as NonEmptyList<number>, parsed.active);
      res.status(200).json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  }

 
  private handleError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    const issues = (error as any).issues ?? (error as any).errors ?? [];
    return res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      message: issues[0]?.message ?? 'Invalid request body'
    });
  }
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      status: "error",
      code: error.code,
      message: error.message
    });
  }
  console.error('Unhandled error:', (error as any)?.stack || error);
  return res.status(500).json({ status: "error", code: "INTERNAL_ERROR", message: "Server error" });
}
}