import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  ENV: z.enum(['dev', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_CONNECTION_INTERVAL: z.coerce.number().int().min(1000).default(5000),
  DATABASE_URI: z.string().url('Must be a valid database connection URL'),
  RABBITMQ_URL: z.string().url('Must be a valid RabbitMQ connection URL'),
  RABBITMQ_QUEUE: z.string().min(1, 'Queue name is required'),
});

export type Environment = z.infer<typeof envSchema>['ENV'];

function buildConfig() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment variables. ${details}`);
  }

  const env = parsed.data;

  const constants = {
    API_PREFIX: '/api/firewall',
    TABLES: {
      FIREWALL_RULES: 'firewall_rules',
    },
    QUEUES: {
      FIREWALL_RULES: env.RABBITMQ_QUEUE,
    },
  } as const;

  return Object.freeze({
    env: env.ENV,
    port: env.PORT,
    dbConnectionInterval: env.DB_CONNECTION_INTERVAL,
    databaseUri: env.DATABASE_URI,
    rabbitmqUrl: env.RABBITMQ_URL,
    rabbitmqQueue: env.RABBITMQ_QUEUE,
    constants,
  });
}

export type Config = ReturnType<typeof buildConfig>;

class ConfigProvider {
  private static instance: Config;

  private constructor() {}

  public static getInstance(): Config {
    if (!ConfigProvider.instance) {
      ConfigProvider.instance = buildConfig();
    }
    return ConfigProvider.instance;
  }
}

export const config: Config = ConfigProvider.getInstance();
