import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URI;
if (!url) {
  throw new Error('DATABASE_URI is required to run drizzle-kit.');
}
export default defineConfig({
  schema: './src/adapters/outbound/persistence/postgres/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
});
