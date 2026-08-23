import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const query = jest.fn<(sql?: string) => Promise<unknown>>();
const end = jest.fn<() => Promise<void>>();
const poolConstructor = jest.fn();

jest.unstable_mockModule('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      poolConstructor(options);
    }
    query = query;
    end = end;
  },
}));

jest.unstable_mockModule('drizzle-orm/node-postgres', () => ({
  drizzle: (pool: unknown) => ({ __pool: pool }),
}));

const { DatabaseService } = await import(
  '../../src/adapters/outbound/persistence/postgres/DatabaseService'
);
type Service = {
  readonly db: unknown;
  connectWithRetry(maxRetries?: number): Promise<unknown>;
  close(): Promise<void>;
};

function freshService(): Service {
  (DatabaseService as unknown as { instance?: unknown }).instance = undefined;
  return DatabaseService.getInstance() as unknown as Service;
}

beforeEach(() => {
  query.mockReset();
  end.mockReset().mockResolvedValue(undefined);
  poolConstructor.mockReset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function drain(promise: Promise<unknown>): Promise<unknown> {
  const settled = promise.catch((error: unknown) => ({ __error: error }));
  await jest.runAllTimersAsync();
  return settled;
}

describe('getInstance', () => {
  it('returns the same object every time', () => {
    expect(DatabaseService.getInstance()).toBe(DatabaseService.getInstance());
  });
});

describe('connecting', () => {
  it('succeeds on the first attempt and returns the drizzle handle', async () => {
    query.mockResolvedValue({ rows: [] });
    const service = freshService();

    const db = await service.connectWithRetry();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(db).toBe(service.db);
  });

  it('configures the pool with bounds and timeouts', async () => {
    query.mockResolvedValue({ rows: [] });

    await freshService().connectWithRetry();

    expect(poolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        max: expect.any(Number),
        idleTimeoutMillis: expect.any(Number),
        connectionTimeoutMillis: expect.any(Number),
      })
    );
  });

  it('retries a refused connection and succeeds on the third attempt', async () => {
    query
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ rows: [] });

    const service = freshService();
    const result = await drain(service.connectWithRetry());

    expect(query).toHaveBeenCalledTimes(3);
    expect(result).not.toMatchObject({ __error: expect.anything() });
  });

  it('throws the last error after exhausting its attempts', async () => {
    const failure = new Error('host unreachable');
    query.mockRejectedValue(failure);

    const result = (await drain(freshService().connectWithRetry())) as {
      __error: unknown;
    };

    expect(query).toHaveBeenCalledTimes(5);
    expect(result.__error).toBe(failure);
  });

  it('honours a smaller retry budget', async () => {
    query.mockRejectedValue(new Error('nope'));

    await drain(freshService().connectWithRetry(2));

    expect(query).toHaveBeenCalledTimes(2);
  });

  it('closes the pool it opened when it gives up', async () => {
    query.mockRejectedValue(new Error('nope'));

    await drain(freshService().connectWithRetry(1));

    expect(end).toHaveBeenCalled();
  });

  it('wraps a non-Error rejection so the caller always gets an Error', async () => {
    query.mockRejectedValue('just a string');

    const result = (await drain(freshService().connectWithRetry(1))) as {
      __error: unknown;
    };

    expect(result.__error).toBeInstanceOf(Error);
    expect((result.__error as Error).message).toContain('Could not connect');
  });
});

describe('db', () => {
  it('refuses to hand out a handle before connecting', () => {
    expect(() => freshService().db).toThrow(/has not been connected/);
  });
});

describe('close', () => {
  it('ends the pool and forgets the handle', async () => {
    query.mockResolvedValue({ rows: [] });
    const service = freshService();
    await service.connectWithRetry();

    await service.close();

    expect(end).toHaveBeenCalled();
    expect(() => service.db).toThrow(/has not been connected/);
  });

  it('is safe to call when nothing was ever opened', async () => {
    await expect(freshService().close()).resolves.toBeUndefined();
  });
});

describe('the retry delay', () => {
  it('waits between attempts rather than hammering the database', async () => {
    query
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ rows: [] });

    const service = freshService();
    const pending = service.connectWithRetry();

    
    await Promise.resolve();
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    await jest.runAllTimersAsync();
    await pending;

    expect(query).toHaveBeenCalledTimes(2);
  });

  it('gives up quietly even if closing the pool also fails', async () => {
    query.mockRejectedValue(new Error('nope'));
    end.mockRejectedValue(new Error('pool already gone'));

    const result = (await drain(freshService().connectWithRetry(1))) as {
      __error: unknown;
    };

    
    expect((result.__error as Error).message).toBe('nope');
  });
});