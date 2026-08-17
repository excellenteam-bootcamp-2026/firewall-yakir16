import { pgTable, serial, varchar, boolean } from 'drizzle-orm/pg-core';
import { config } from '../../../../main/env';

export const rulesTable = pgTable(config.constants.TABLES.FIREWALL_RULES, {
  id: serial('id').primaryKey(),
  type: varchar('type', { length: 50 }).notNull(),
  mode: varchar('mode', { length: 50 }).notNull(),
  value: varchar('value', { length: 255 }).notNull(), 
  active: boolean('active').default(true).notNull(),
});