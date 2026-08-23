import { eq, inArray } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Rule, type RuleMode, type RuleType } from '../../../domain/Rule';
import { type RuleRepository } from '../../../application/ports/outbound/RuleRepository';
import { rulesTable, type RulesTable } from './postgres/schema';

type RuleRow = {
  id: number;
  type: string;
  mode: string;
  value: string;
  active: boolean;
};

export class DrizzleRuleRepository implements RuleRepository {
  constructor(
    private readonly db: NodePgDatabase,
    private readonly table: RulesTable = rulesTable
  ) {}

  async getAll(): Promise<Rule[]> {
    const rows = await this.db.select().from(this.table);
    return rows.map((row) => this.mapToDomain(row as RuleRow));
  }

  async findByType(type: RuleType): Promise<Rule[]> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(eq(this.table.type, type));
    return rows.map((row) => this.mapToDomain(row as RuleRow));
  }

  async findByIds(ids: number[]): Promise<Rule[]> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(inArray(this.table.id, ids));
    return rows.map((row) => this.mapToDomain(row as RuleRow));
  }

  private mapToDomain(row: RuleRow): Rule {
    const type = String(row.type).toLowerCase() as RuleType;
    const mode = String(row.mode).toLowerCase() as RuleMode;
    const value = type === 'port' ? Number(row.value) : row.value;

    return new Rule(row.id, type, mode, value, Boolean(row.active));
  }
}
