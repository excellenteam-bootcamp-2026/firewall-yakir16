import { Rule, type RuleType } from '../../../domain/Rule';

export interface RuleRepository {
  getAll(): Promise<Rule[]>;
  findByType(type: RuleType): Promise<Rule[]>;
  findByIds(ids: number[]): Promise<Rule[]>;
}
