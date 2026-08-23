import { afterEach, describe, expect, it, jest } from '@jest/globals';


const REQUIRED = [
  'ENV',
  'DATABASE_URI',
  'RABBITMQ_URL',
  'RABBITMQ_QUEUE',
] as const;

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
  jest.resetModules();
});

async function importEnv() {
  jest.resetModules();
  return import('../../src/main/env');
}

describe('a valid environment', () => {
  it('exposes the parsed values and the derived constants', async () => {
    const { config } = await importEnv();

    expect(config.env).toBe('dev');
    expect(config.port).toBe(3000);
    expect(config.constants.API_PREFIX).toBe('/api/firewall');
    expect(config.constants.TABLES.FIREWALL_RULES).toBe('firewall_rules');
    expect(config.constants.QUEUES.FIREWALL_RULES).toBe(config.rabbitmqQueue);
  });

  it('is frozen, so nothing can reconfigure the process at runtime', async () => {
    const { config } = await importEnv();

    expect(Object.isFrozen(config)).toBe(true);
  });

  it('returns the same instance on a second read', async () => {
    const first = await importEnv();
    const second = await import('../../src/main/env');

    expect(second.config).toBe(first.config);
  });
});

describe('an invalid environment', () => {
  it.each(REQUIRED)('throws when %s is missing', async (key) => {
    delete process.env[key];

    await expect(importEnv()).rejects.toThrow(/Invalid environment variables/);
  });

  it('names the offending variable so the failure is actionable', async () => {
    delete process.env.RABBITMQ_QUEUE;

    await expect(importEnv()).rejects.toThrow(/RABBITMQ_QUEUE/);
  });

  it.each([
    ['ENV', 'staging'],
    ['PORT', '70000'],
    ['PORT', '0'],
    ['DATABASE_URI', 'not-a-url'],
    ['RABBITMQ_URL', 'nope'],
    ['DB_CONNECTION_INTERVAL', '100'],
  ])('throws when %s is %s', async (key, value) => {
    process.env[key] = value;

    await expect(importEnv()).rejects.toThrow(/Invalid environment variables/);
  });

  it('rejects an empty queue name', async () => {
    process.env.RABBITMQ_QUEUE = '';

    await expect(importEnv()).rejects.toThrow(/Queue name is required/);
  });
});