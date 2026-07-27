import { Rule } from '../../../domain/Rule';
import { RuleRepository } from '../../../application/ports/outbound/RuleRepository';

export class InMemoryRuleRepository implements RuleRepository {
  private rules: Map<number, Rule> = new Map();
  private nextId = 1;

  save(rule: Rule): Rule {
    if (rule.id === undefined) {
      rule.id = this.nextId++;
    }
    this.rules.set(rule.id, rule);
    return rule;
  }

  saveAll(rules: Rule[]): Rule[] {
    return rules.map(rule => this.save(rule));
  }

  findByIds(ids: number[]): Rule[] {
    const found: Rule[] = [];
    ids.forEach(id => {
      if (this.rules.has(id)) {
        found.push(this.rules.get(id)!);
      }
    });
    return found;
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
}
