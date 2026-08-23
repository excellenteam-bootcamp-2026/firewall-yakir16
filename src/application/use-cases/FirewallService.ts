import { Rule, type RuleMode, type RuleType, type RuleValue } from '../../domain/Rule';
import { type RuleRepository } from '../ports/outbound/RuleRepository';
import { type Envelope, type MessagePublisher } from '../ports/outbound/MessagePublisher';
import { AppError, type NonEmptyList } from '../../domain/common/types';
import { unwrapWorkerResponse } from '../contracts/workerResponse';

export type CreateRulesCommand = {
  type: RuleType;
  mode: RuleMode;
  values: NonEmptyList<RuleValue>;
};

const RULE_TYPES: readonly RuleType[] = ['ip', 'domain', 'port'];

const MAX_DISPATCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

const RETRYABLE_CODES = new Set([
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_UNAVAILABLE',
]);

function isRetryable(error: unknown): boolean {
  return error instanceof AppError && RETRYABLE_CODES.has(error.code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupe<T>(values: NonEmptyList<T>): NonEmptyList<T> {
  return [...new Set(values)] as NonEmptyList<T>;
}

export class FirewallService {
  constructor(
    private readonly ruleRepository: RuleRepository,
    private readonly messagePublisher: MessagePublisher,
    private readonly queue: string
  ) {}

  async addRules(command: CreateRulesCommand) {
    const { type, mode } = command;
    const values = dedupe(command.values);

    const rules = values.map((value) => new Rule(undefined, type, mode, value, true));

    const envelope = this.messagePublisher.createEnvelope('CREATE_RULE', {
      type,
      mode,
      rules: rules.map((rule) => rule.toJSON()),
    });

    const created = await this.dispatch(envelope);

    return {
      type,
      mode,
      values: created.map(({ id, value, active }) => ({ id, value, active })),
      status: 'success' as const,
    };
  }

  async deleteRules(command: NonEmptyList<number>) {
    const ids = dedupe(command);
    await this.assertAllExist(ids);

    const envelope = this.messagePublisher.createEnvelope('DELETE_RULE', { ids });
    const removed = await this.dispatch(envelope);

    return { removed, status: 'success' as const };
  }

  async updateRulesStatus(command: NonEmptyList<number>, active: boolean) {
    const ids = dedupe(command);
    await this.assertAllExist(ids);

    const envelope = this.messagePublisher.createEnvelope('UPDATE_RULE', { ids, active });
    const updated = await this.dispatch(envelope);

    return { updated, status: 'success' as const };
  }

  async getRules(type?: string) {
    const normalizedType = this.normalizeTypeFilter(type);

    const rules = normalizedType
      ? await this.ruleRepository.findByType(normalizedType)
      : await this.ruleRepository.getAll();

    const response: Record<string, Record<string, unknown>> = {
      ips: {},
      domains: {},
      ports: {},
    };

    for (const rule of rules) {
      if (rule.id === undefined) {
        continue;
      }

      const group = response[`${rule.type}s`];
      if (!group) {
        continue;
      }

      group[String(rule.id)] = {
        id: rule.id,
        value: rule.value,
        active: rule.active,
      };
    }

    return response;
  }

    private async dispatch(envelope: Envelope) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const raw = await this.messagePublisher.publishRPC(this.queue, envelope);
        return unwrapWorkerResponse(raw);
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_DISPATCH_ATTEMPTS) {
          throw error;
        }

        console.warn(
          `Dispatch attempt ${attempt} failed with a transient error. Retrying.`
        );
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  private async assertAllExist(ids: NonEmptyList<number>): Promise<void> {
    const existing = await this.ruleRepository.findByIds(ids);
    if (existing.length !== ids.length) {
      throw new AppError('RULE_NOT_FOUND', 'Specified rule ID not found.', 404);
    }
  }

  private normalizeTypeFilter(type?: string): RuleType | undefined {
    if (!type) {
      return undefined;
    }

    const lower = type.toLowerCase() as RuleType;
    if (!RULE_TYPES.includes(lower)) {
      throw new AppError('INVALID_TYPE_FILTER', 'Invalid rule type filter.');
    }
    return lower;
  }
}
