import { Rule, RuleMode, RuleType } from '../../domain/Rule';
import { RuleRepository } from '../ports/RuleRepository';

export class FirewallService {
  constructor(private readonly ruleRepository: RuleRepository) {}

  addRules(type: RuleType, mode: RuleMode, values: any[]): Rule[] {
    if (mode !== 'blacklist' && mode !== 'whitelist') {
      throw new Error('INVALID_MODE');
    }
    if (!values || values.length === 0) {
      throw new Error('INVALID_VALUES');
    }
    values.forEach(value => this.validateValue(type, value));
    return values.map(value => 
      this.ruleRepository.save({ type, mode, value, active: true })
    );
  }

  deleteRules(ids: number[]): Rule[] {
    if (!ids || ids.length === 0) throw new Error('INVALID_IDS');
    return this.ruleRepository.delete(ids);
  }

  getRules(type?: string) {
    let rules = this.ruleRepository.getAll();
    if (type) {
      rules = rules.filter(r => r.type === type);
    }
    
    // Grouping by type for the response requirement
    return {
      ips: rules.filter(r => r.type === 'ip'),
      domains: rules.filter(r => r.type === 'domain'),
      ports: rules.filter(r => r.type === 'port')
    };
  }

  updateRulesStatus(ids: number[], active: boolean): Rule[] {
    if (!ids || ids.length === 0) throw new Error('INVALID_IDS');
    if (typeof active !== 'boolean') throw new Error('INVALID_ACTIVE_STATUS');
    return this.ruleRepository.updateStatus(ids, active);
  }

  private validateValue(type: RuleType, value: any) {
    if (type === 'ip') {
      const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
      if (!ipRegex.test(value)) throw new Error('INVALID_IP');
    } else if (type === 'domain') {
      const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!domainRegex.test(value) || value.includes('://') || value.includes('/')) throw new Error('INVALID_DOMAIN');
    } else if (type === 'port') {
      if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('INVALID_PORT');
    }
  }
}