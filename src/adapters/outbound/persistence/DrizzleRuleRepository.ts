import { inArray } from 'drizzle-orm';
import { Rule, type RuleMode, type RuleType } from '../../../domain/Rule';
import { type RuleRepository } from '../../../application/ports/outbound/RuleRepository';
import { DatabaseService } from './drizzle/DatabaseService';
import { rulesTable } from './drizzle/schema';

export class DrizzleRuleRepository implements RuleRepository {
  private db = DatabaseService.getInstance().db;


  private mapToDomain(row: any): Rule {
    const value = row.type === 'port' ? Number(row.value) : row.value;
    return new Rule(row.id, row.type as RuleType, row.mode as RuleMode, value, row.active);
  }

  async save(rule: Rule): Promise<Rule> {
    const [inserted] = await this.db.insert(rulesTable).values({
      type: rule.type,
      mode: rule.mode,
      value: String(rule.value),
      active: rule.active
    }).returning();

    return this.mapToDomain(inserted);
  }

  async saveAll(rules: Rule[]): Promise<Rule[]> {
   
    const updatedRules: Rule[] = [];
    for (const rule of rules) {
      if (rule.id) {
        const [updated] = await this.db.update(rulesTable)
          .set({ active: rule.active })
          .where(inArray(rulesTable.id, [rule.id]))
          .returning();
        updatedRules.push(this.mapToDomain(updated));
      }
    }
    return updatedRules;
  }

  async delete(ids: number[]): Promise<Rule[]> {
    const deleted = await this.db.delete(rulesTable)
      .where(inArray(rulesTable.id, ids))
      .returning();
    return deleted.map(this.mapToDomain);
  }

  async getAll(): Promise<Rule[]> {
    const rows = await this.db.select().from(rulesTable);
    return rows.map(this.mapToDomain);
  }

  async findByIds(ids: number[]): Promise<Rule[]> {
    const rows = await this.db.select()
      .from(rulesTable)
      .where(inArray(rulesTable.id, ids));
    return rows.map(this.mapToDomain);
  }
}