import { Rule } from '../../../../domain/Rule';
import { RuleRepository } from '../../../../application/ports/RuleRepository';

export class InMemoryRuleRepository implements RuleRepository {
  private rules: Map<number, Rule> = new Map();
  private nextId = 1;

  save(ruleData: Omit<Rule, 'id'>): Rule {
    const rule: Rule = { ...ruleData, id: this.nextId++ };
    this.rules.set(rule.id, rule);
    return rule;
  }

  delete(ids: number[]): Rule[] {
    const removed: Rule[] = [];
    ids.forEach(id => {
      if (this.rules.has(id)) {
        removed.push(this.rules.get(id)!);
        this.rules.delete(id);
      }
    });
    return removed;
  }

  getAll(): Rule[] {
    return Array.from(this.rules.values());
  }

  updateStatus(ids: number[], active: boolean): Rule[] {
    const updated: Rule[] = [];
    ids.forEach(id => {
      const rule = this.rules.get(id);
      if (rule) {
        rule.active = active;
        updated.push(rule);
      }
    });
    return updated;
  }
}