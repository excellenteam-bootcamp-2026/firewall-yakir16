import { Rule } from '../../../domain/Rule';

export interface RuleRepository {
  save(rule: Rule): Rule;
  saveAll(rules: Rule[]): Rule[];
  delete(ids: number[]): Rule[];
  getAll(): Rule[];
  findByIds(ids: number[]): Rule[];
}
