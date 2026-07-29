import { Rule, type RuleMode, type RuleType } from '../../domain/Rule';
import { type RuleRepository } from '../ports/outbound/RuleRepository';

export class FirewallService {
  constructor(private readonly ruleRepository: RuleRepository) {}

  async addRules(type: RuleType, mode: RuleMode, values: any[]) {
    if (mode !== 'blacklist' && mode !== 'whitelist') throw new Error('INVALID_MODE');
    if (!Array.isArray(values) || values.length === 0) throw new Error('INVALID_VALUES');

  
    const createdRules = await Promise.all(
      values.map(async value => {
        const newRule = new Rule(undefined, type, mode, value, true);
        return await this.ruleRepository.save(newRule);
      })
    );

  
    return {
      type,
      mode,
      values: createdRules.map((r: Rule) => ({ id: r.id, value: r.value, active: r.active })),
      status: 'success'
    };
  }

  async deleteRules(ids: any[]) {
    this.validateIds(ids);

    // הוספת await למיצוי ה-Promise
    const existing = await this.ruleRepository.findByIds(ids);
    if (existing.length !== ids.length) {
      throw new Error('RULE_NOT_FOUND');
    }

    // הוספת await לקריאה למחיקה
    const removed = await this.ruleRepository.delete(ids);
    return { removed: removed.map((r: Rule) => r.toJSON()), status: 'success' };
  }

  async getRules(type?: string) {
    if (type && !['ip', 'domain', 'port'].includes(type)) {
      throw new Error('INVALID_TYPE_FILTER');
    }

    // הוספת await לקריאת כל החוקים
    let rules = await this.ruleRepository.getAll();
    if (type) {
      rules = rules.filter((r: Rule) => r.type === type);
    }

    return {
      ips: rules.filter((r: Rule) => r.type === 'ip').map((r: Rule) => r.toJSON()),
      domains: rules.filter((r: Rule) => r.type === 'domain').map((r: Rule) => r.toJSON()),
      ports: rules.filter((r: Rule) => r.type === 'port').map((r: Rule) => r.toJSON())
    };
  }

  async updateRulesStatus(ids: any[], active: any) {
    this.validateIds(ids);
    if (typeof active !== 'boolean') throw new Error('INVALID_ACTIVE_STATUS');

    // הוספת await לחיפוש החוקים לפי מזהים
    const existingRules = await this.ruleRepository.findByIds(ids);
    if (existingRules.length !== ids.length) throw new Error('RULE_NOT_FOUND');

    existingRules.forEach((rule: Rule) => {
      rule.updateStatus(active);
    });

    
    const updated = await this.ruleRepository.saveAll(existingRules);
    return { updated: updated.map((r: Rule) => r.toJSON()), status: 'success' };
  }

  private validateIds(ids: any[]) {
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => Number.isInteger(id))) {
      throw new Error('INVALID_IDS');
    }
  }
}