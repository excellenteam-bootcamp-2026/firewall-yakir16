import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // הצבעה מדויקת לקובץ ה-schema שלך:
  schema: './adapters/outbound/persistence/drizzle/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URI_DEV || 'postgresql://postgres:123456@localhost:5432/dev_db',
  },
});