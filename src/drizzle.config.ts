import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { config } from './adapters/main/env'; 

export default defineConfig({
  schema: './adapters/outbound/persistence/drizzle/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
   
    url: config.databaseUri, 
  },
});