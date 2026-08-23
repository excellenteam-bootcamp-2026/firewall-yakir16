import { pgTable, serial, varchar, boolean } from 'drizzle-orm/pg-core';
import { config } from '../../../../main/env';

export function createRulesTable(tableName: string) {
  return pgTable(tableName, {
    id: serial('id').primaryKey(),
    type: varchar('type', { length: 50 }).notNull(),
    mode: varchar('mode', { length: 50 }).notNull(),
    value: varchar('value', { length: 255 }).notNull(),
    active: boolean('active').default(true).notNull(),
  });
}

export type RulesTable = ReturnType<typeof createRulesTable>;

export const rulesTable = createRulesTable(
  config.constants.TABLES.FIREWALL_RULES
);
