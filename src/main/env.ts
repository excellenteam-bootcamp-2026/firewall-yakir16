import { z } from 'zod';
import * as process from 'process';
import 'dotenv/config';

const envSchema = z.object({
  ENV: z.enum(['dev', 'production']),
  PORT: z.coerce
    .number()
    .min(1, 'Port must be greater than 0')
    .max(65535, 'Port must be 65535 or less')
    .default(3000),
  DB_CONNECTION_INTERVAL: z.coerce.number().min(1000).default(5000),
  
  DATABASE_URI: z.string().url('Must be a valid database connection URL'),
  RABBITMQ_QUEUE: z.string().min(1, 'Queue name is required'),
  
  RABBITMQ_URL: z.string().url('Must be a valid RabbitMQ connection URL'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error(' Invalid environment variables detected. Halting application.');
  console.error(JSON.stringify(parsedEnv.error.format(), null, 2));
  process.exit(1);
}

const envVars = parsedEnv.data;

const CONSTANTS = {
  API_PREFIX: '/api/v1',
  TABLES: {
    FIREWALL_RULES: envVars.ENV === 'production' ? 'firewall_rules' : 'firewall_rules_dev',
    USERS: 'users', 
  },
  QUEUES: { FIREWALL_RULES: envVars.RABBITMQ_QUEUE },
  MESSAGES: {
    SERVER_START: `Server initialized in ${envVars.ENV} mode.`,
  }
} as const;

class Config {
  private static instance: Config;
  public readonly rabbitmqQueue: string;
  public readonly env: 'dev' | 'production';
  public readonly port: number;
  public readonly dbConnectionInterval: number;
  public readonly databaseUri: string;
  public readonly rabbitmqUrl: string;
  public readonly constants: typeof CONSTANTS;

  private constructor() {
    this.env = envVars.ENV;
    this.port = envVars.PORT;
	this.rabbitmqQueue = envVars.RABBITMQ_QUEUE;
    this.dbConnectionInterval = envVars.DB_CONNECTION_INTERVAL;
    this.databaseUri = envVars.DATABASE_URI;
    this.rabbitmqUrl = envVars.RABBITMQ_URL;
    this.constants = CONSTANTS;
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }
}

export const config = Config.getInstance();