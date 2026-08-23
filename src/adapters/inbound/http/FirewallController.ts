import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { type FirewallService } from '../../../application/use-cases/FirewallService';
import { type RuleType } from '../../../domain/Rule';
import { AppError, type NonEmptyList } from '../../../domain/common/types';

const MAX_BATCH_SIZE = 100;

const addRulesSchema = z.object({
  mode: z.enum(['blacklist', 'whitelist']),
  values: z
    .array(z.union([z.string(), z.number()]))
    .nonempty('values array cannot be empty')
    .max(MAX_BATCH_SIZE, `values array cannot exceed ${MAX_BATCH_SIZE} items`),
});

const idsSchema = z.object({
  ids: z
    .array(z.number().int())
    .nonempty('ids array cannot be empty')
    .max(MAX_BATCH_SIZE, `ids array cannot exceed ${MAX_BATCH_SIZE} items`),
});

const updateStatusSchema = idsSchema.extend({
  active: z.boolean(),
});

export function asNonEmpty<T>(values: T[]): NonEmptyList<T> {
  const [first, ...rest] = values;

  if (first === undefined) {
    throw new AppError('VALIDATION_ERROR', 'Array cannot be empty.');
  }

  return [first, ...rest];
}

export class FirewallController {
  public readonly router = Router();

  constructor(private readonly firewallService: FirewallService) {
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.post('/ips', this.addRules('ip'));
    this.router.post('/domains', this.addRules('domain'));
    this.router.post('/ports', this.addRules('port'));
    this.router.delete('/rules', this.deleteRules);
    this.router.get('/rules', this.getRules);
    this.router.patch('/rules/status', this.updateStatus);
  }

  private addRules(type: RuleType) {
    return async (req: Request, res: Response): Promise<void> => {
      try {
        const { mode, values } = addRulesSchema.parse(req.body);
        const result = await this.firewallService.addRules({
          type,
          mode,
          values: asNonEmpty(values),
        });
        res.status(201).json(result);
      } catch (error) {
        this.handleError(res, error);
      }
    };
  }

  private deleteRules = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ids } = idsSchema.parse(req.body);
      const result = await this.firewallService.deleteRules(asNonEmpty(ids));
      res.status(200).json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  private getRules = async (req: Request, res: Response): Promise<void> => {
    try {
      const type = typeof req.query.type === 'string' ? req.query.type : undefined;
      const result = await this.firewallService.getRules(type);
      res.status(200).json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  private updateStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ids, active } = updateStatusSchema.parse(req.body);
      const result = await this.firewallService.updateRulesStatus(
        asNonEmpty(ids),
        active
      );
      res.status(200).json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  private handleError(res: Response, error: unknown): void {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: error.issues[0]?.message ?? 'Invalid request body',
      });
      return;
    }

    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        status: 'error',
        code: error.code,
        message: error.message,
      });
      return;
    }

    console.error('Unhandled error:', (error as Error)?.stack ?? error);
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Server error',
    });
  }
}