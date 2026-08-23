import { z } from 'zod';
import { AppError } from '../../domain/common/types';

export const workerRuleSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(['ip', 'domain', 'port']),
  mode: z.enum(['blacklist', 'whitelist']),
  value: z.union([z.string(), z.number()]),
  active: z.boolean(),
});

const workerSuccessSchema = z.object({
  status: z.literal('success'),
  rules: z.array(workerRuleSchema),
});

const workerErrorSchema = z.object({
  status: z.literal('error'),
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
});

export const workerResponseSchema = z.discriminatedUnion('status', [
  workerSuccessSchema,
  workerErrorSchema,
]);

export type WorkerRule = z.infer<typeof workerRuleSchema>;
export type WorkerResponse = z.infer<typeof workerResponseSchema>;

const WORKER_ERROR_STATUS: Readonly<Record<string, number>> = {
  RULE_ALREADY_EXISTS: 409,
  RULE_CONFLICT: 409,
  RULE_NOT_FOUND: 404,
  INVALID_IP: 400,
  INVALID_DOMAIN: 400,
  INVALID_PORT: 400,
  INVALID_RULE_TYPE: 400,
  VALIDATION_ERROR: 400,
  INTERNAL_ERROR: 502,
};

export function unwrapWorkerResponse(raw: unknown): WorkerRule[] {
  const parsed = workerResponseSchema.safeParse(raw);

  if (!parsed.success) {
    console.error('Rule builder returned an unexpected payload shape.');
    throw new AppError(
      'UPSTREAM_INVALID_RESPONSE',
      'The rule builder returned a response in an unexpected format.',
      502
    );
  }

  if (parsed.data.status === 'error') {
    const { code, message } = parsed.data;
    throw new AppError(code, message, WORKER_ERROR_STATUS[code] ?? 502);
  }

  return parsed.data.rules;
}
