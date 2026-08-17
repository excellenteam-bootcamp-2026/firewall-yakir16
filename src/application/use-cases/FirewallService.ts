import { Rule, type RuleMode, type RuleType } from '../../domain/Rule';
import { type RuleRepository } from '../ports/outbound/RuleRepository';
import { type MessagePublisher } from '../ports/outbound/MessagePublisher';
import { AppError, type NonEmptyList } from '../../domain/common/types';
import { config } from '../../main/env';

export type CreateRulesCommand = {
  type: RuleType;
  mode: RuleMode;
  values: NonEmptyList<string | number>;
};

export class FirewallService {
  private readonly queue = config.constants.QUEUES.FIREWALL_RULES;

  constructor(
    private readonly ruleRepository: RuleRepository,
    private readonly messagePublisher: MessagePublisher
  ) {}

  async addRules(command: CreateRulesCommand) {
    const { type, mode, values } = command;

    const createdRules = values.map(value => new Rule(undefined, type, mode, value, true));

    const envelope = this.messagePublisher.createEnvelope('CREATE_RULE', {
      type,
      mode,
      rules: createdRules.map(rule => rule.toJSON())
    });

    const responsePayload = await this.messagePublisher.publishRPC(this.queue, envelope);

    return {
      type,
      mode,
      values: responsePayload.rules,
      status: 'success'
    };
  }

  async deleteRules(ids: NonEmptyList<number>) {
    const existing = await this.ruleRepository.findByIds(ids);
    if (existing.length !== ids.length) {
      throw new AppError('RULE_NOT_FOUND', 'Specified rule ID not found.', 404);
    }

    const envelope = this.messagePublisher.createEnvelope('DELETE_RULE', { ids });
    await this.messagePublisher.publish(this.queue, envelope);

    return {
      removed: existing.map(rule => rule.toJSON()),
      status: 'success'
    };
  }

  async getRules(type?: string) {
    let normalizedType: RuleType | undefined;
    if (type) {
      const lower = type.toLowerCase();
      if (!['ip', 'domain', 'port'].includes(lower)) {
        throw new AppError('INVALID_TYPE_FILTER', 'Invalid rule type filter.');
      }
      normalizedType = lower as RuleType;
    }

    let rules = await this.ruleRepository.getAll();
    if (normalizedType) {
      rules = rules.filter(r => r.type === normalizedType);
    }

    const response: Record<string, Record<string, any>> = {
      ips: {},
      domains: {},
      ports: {}
    };

    rules.forEach(rule => {
      const groupKey = `${rule.type}s`;
      if (rule.id !== undefined) {
        response[groupKey][rule.id.toString()] = {
          id: rule.id,
          value: rule.value,
          active: rule.active
        };
      }
    });

    return response;
  }

  async updateRulesStatus(ids: NonEmptyList<number>, active: boolean) {
    const existingRules = await this.ruleRepository.findByIds(ids);
    if (existingRules.length !== ids.length) {
      throw new AppError('RULE_NOT_FOUND', 'Specified rule ID not found.', 404);
    }

    const envelope = this.messagePublisher.createEnvelope('UPDATE_RULE', { ids, active });
    await this.messagePublisher.publish(this.queue, envelope);

    const updatedRules = existingRules.map(rule => {
      rule.updateStatus(active);
      return rule.toJSON();
    });

    return {
      updated: updatedRules,
      status: 'success'
    };
  }
}