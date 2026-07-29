// application/ports/outbound/RuleRepository.ts
import { Rule } from '../../../domain/Rule';

export interface RuleRepository {
  save(rule: Rule): Promise<Rule>;
  saveAll(rules: Rule[]): Promise<Rule[]>;
  delete(ids: number[]): Promise<Rule[]>;
  getAll(): Promise<Rule[]>;
  findByIds(ids: number[]): Promise<Rule[]>;
}