import { config as loadEnv } from 'dotenv';

process.env.NODE_ENV = 'test';

loadEnv({ path: '.env.test', override: true, quiet: true });