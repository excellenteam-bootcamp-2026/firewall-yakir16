import { inArray } from 'drizzle-orm';
import { Rule, type RuleMode, type RuleType } from '../../../domain/Rule';
import { type RuleRepository } from '../../../application/ports/outbound/RuleRepository';
import { DatabaseService } from './drizzle/DatabaseService';
import { rulesTable } from './drizzle/schema';

export class DrizzleRuleRepository implements RuleRepository {
  private db = DatabaseService.getInstance().db;

  private mapToDomain(row: any): Rule {
    const normalizedType = String(row.type).toLowerCase() as RuleType;
    const normalizedMode = String(row.mode).toLowerCase() as RuleMode;
    const value = normalizedType === 'port' ? Number(row.value) : row.value;

    return new Rule(
      row.id, 
      normalizedType,
      normalizedMode,
      value,
      Boolean(row.active)
    );
  }

  async getAll(): Promise<Rule[]> {
    try {
      const rows = await this.db.select().from(rulesTable);
      return rows.map(row => this.mapToDomain(row));
    } catch (error: any) {
      console.error(" DATABASE ERROR IN getAll():");
      console.error(error.cause || error);
      throw error;
    }
  }

  async findByIds(ids: number[]): Promise<Rule[]> {
    try {
      const rows = await this.db.select()
        .from(rulesTable)
        .where(inArray(rulesTable.id, ids));
        
      return rows.map(row => this.mapToDomain(row));
    } catch (error: any) {
      console.error(" DATABASE ERROR IN findByIds():");
      console.error(error.cause || error);
      throw error;
    }
  }
}