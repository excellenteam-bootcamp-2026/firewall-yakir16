import { Rule } from '../../../domain/Rule';

export interface RuleRepository {
  getAll(): Promise<Rule[]>;
  findByIds(ids: number[]): Promise<Rule[]>;
}