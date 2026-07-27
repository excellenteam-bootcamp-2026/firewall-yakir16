import { Rule, RuleMode, RuleType } from '../../domain/Rule';
import { RuleRepository } from '../ports/outbound/RuleRepository';

export class FirewallService {
  constructor(private readonly ruleRepository: RuleRepository) {}

  addRules(type: RuleType, mode: RuleMode, values: any[]) {
    if (mode !== 'blacklist' && mode !== 'whitelist') throw new Error('INVALID_MODE');
    if (!Array.isArray(values) || values.length === 0) throw new Error('INVALID_VALUES');

    const createdRules = values.map(value => {
      const newRule = new Rule(undefined, type, mode, value, true);
      return this.ruleRepository.save(newRule);
    });

    return {
      type,
      mode,
      values: createdRules.map(r => ({ id: r.id, value: r.value, active: r.active })),
      status: 'success'
    };
  }

  deleteRules(ids: any[]) {
    this.validateIds(ids);

    const existing = this.ruleRepository.findByIds(ids);
    if (existing.length !== ids.length) {
      throw new Error('RULE_NOT_FOUND');
    }

    const removed = this.ruleRepository.delete(ids);
    return { removed: removed.map(r => r.toJSON()), status: 'success' };
  }

  getRules(type?: string) {
    if (type && !['ip', 'domain', 'port'].includes(type)) {
      throw new Error('INVALID_TYPE_FILTER');
    }

    let rules = this.ruleRepository.getAll();
    if (type) {
      rules = rules.filter(r => r.type === type);
    }

    return {
      ips: rules.filter(r => r.type === 'ip').map(r => r.toJSON()),
      domains: rules.filter(r => r.type === 'domain').map(r => r.toJSON()),
      ports: rules.filter(r => r.type === 'port').map(r => r.toJSON())
    };
  }

  updateRulesStatus(ids: any[], active: any) {
    this.validateIds(ids);
    if (typeof active !== 'boolean') throw new Error('INVALID_ACTIVE_STATUS');

    const existingRules = this.ruleRepository.findByIds(ids);
    if (existingRules.length !== ids.length) throw new Error('RULE_NOT_FOUND');

    existingRules.forEach(rule => {
      rule.updateStatus(active);
    });

    const updated = this.ruleRepository.saveAll(existingRules);
    return { updated: updated.map(r => r.toJSON()), status: 'success' };
  }

  private validateIds(ids: any[]) {
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => Number.isInteger(id))) {
      throw new Error('INVALID_IDS');
    }
  }
}
