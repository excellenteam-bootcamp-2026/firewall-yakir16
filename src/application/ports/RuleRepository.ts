import { Rule } from '../../../domain/Rule';

export interface RuleRepository {
  save(rule: Omit<Rule, 'id'>): Rule;
  delete(ids: number[]): Rule[];
  getAll(): Rule[];
  updateStatus(ids: number[], active: boolean): Rule[];
}