import { afterEach, describe, expect, it, jest } from '@jest/globals';


const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
  jest.resetModules();
});

async function importLogger(env: 'dev' | 'production') {
  process.env.ENV = env;
  jest.resetModules();
  return import('../../src/adapters/outbound/logger');
}

describe('the singleton', () => {
  it('hands back the same instance every time', async () => {
    const { Logger, logger } = await importLogger('dev');

    expect(Logger.getInstance()).toBe(logger);
    expect(Logger.getInstance()).toBe(Logger.getInstance());
  });
});

describe('under NODE_ENV=test', () => {
  it('leaves the global console alone', async () => {
    const before = console.info;

    await importLogger('dev');

    expect(console.info).toBe(before);
  });
});

describe('transports follow the environment', () => {
  it('uses a single console transport in dev', async () => {
    const { Logger } = await importLogger('dev');
    const instance = Logger.getInstance() as unknown as {
      winstonLogger: { transports: unknown[]; level: string };
    };

    expect(instance.winstonLogger.transports).toHaveLength(1);
    expect(instance.winstonLogger.level).toBe('debug');
  });

  it('uses both a file and a console transport in production', async () => {
    const { Logger } = await importLogger('production');
    const instance = Logger.getInstance() as unknown as {
      winstonLogger: { transports: unknown[]; level: string };
    };
    expect(instance.winstonLogger.transports).toHaveLength(2);
    expect(instance.winstonLogger.level).toBe('info');
  });
});

describe('forwarding to winston', () => {
  it.each(['info', 'warn', 'error', 'debug'])(
    'passes a %s message through',
    async (level) => {
      const { Logger } = await importLogger('dev');
      const instance = Logger.getInstance() as unknown as {
        winstonLogger: { log: (entry: unknown) => void };
        log: (level: string, args: unknown[]) => void;
      };

      const spy = jest
        .spyOn(instance.winstonLogger, 'log')
        .mockImplementation(() => undefined);

      instance.log(level, ['hello']);

      expect(spy).toHaveBeenCalledWith({ level, message: 'hello' });
    }
  );

  it('joins several arguments into one message', async () => {
    const { Logger } = await importLogger('dev');
    const instance = Logger.getInstance() as unknown as {
      winstonLogger: { log: (entry: unknown) => void };
      log: (level: string, args: unknown[]) => void;
    };

    const spy = jest
      .spyOn(instance.winstonLogger, 'log')
      .mockImplementation(() => undefined);

    instance.log('info', ['GET', '/api/firewall/rules', 200]);

    expect(spy).toHaveBeenCalledWith({
      level: 'info',
      message: 'GET /api/firewall/rules 200',
    });
  });

  it('expands an object instead of printing [object Object]', async () => {
    const { Logger } = await importLogger('dev');
    const instance = Logger.getInstance() as unknown as {
      winstonLogger: { log: (entry: unknown) => void };
      log: (level: string, args: unknown[]) => void;
    };

    const spy = jest
      .spyOn(instance.winstonLogger, 'log')
      .mockImplementation(() => undefined);

    instance.log('error', [{ code: 'RULE_CONFLICT', nested: { deep: true } }]);

    const entry = spy.mock.calls[0]![0] as { message: string };
    expect(entry.message).toContain('RULE_CONFLICT');
    expect(entry.message).toContain('deep');
    expect(entry.message).not.toContain('[object Object]');
  });

  it('handles null without treating it as an object', async () => {
    const { Logger } = await importLogger('dev');
    const instance = Logger.getInstance() as unknown as {
      winstonLogger: { log: (entry: unknown) => void };
      log: (level: string, args: unknown[]) => void;
    };

    const spy = jest
      .spyOn(instance.winstonLogger, 'log')
      .mockImplementation(() => undefined);

    instance.log('info', [null, undefined, 42]);

    expect(spy).toHaveBeenCalledWith({
      level: 'info',
      message: 'null undefined 42',
    });
  });
});

describe('when winston itself cannot start', () => {
  it('falls back to the raw stream rather than crashing the process', async () => {
    const { Logger } = await importLogger('dev');
    const instance = Logger.getInstance() as unknown as {
      winstonLogger: unknown;
      log: (level: string, args: unknown[]) => void;
    };

    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    instance.winstonLogger = undefined as never;
    instance.log('error', ['everything is on fire']);

    expect(write).toHaveBeenCalledWith('[ERROR] everything is on fire\n');
  });
});

describe('overriding the console outside a test run', () => {
  it('routes console.log and friends through winston', async () => {
    const saved = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

    try {
      const { Logger } = await importLogger('dev');
      const instance = Logger.getInstance() as unknown as {
        overrideConsole: () => void;
        winstonLogger: { log: (entry: unknown) => void };
      };

      const spy = jest
        .spyOn(instance.winstonLogger, 'log')
        .mockImplementation(() => undefined);

      instance.overrideConsole();

      console.log('one');
      console.info('two');
      console.warn('three');
      console.error('four');
      console.debug('five');

      expect(spy).toHaveBeenCalledWith({ level: 'info', message: 'one' });
      expect(spy).toHaveBeenCalledWith({ level: 'info', message: 'two' });
      expect(spy).toHaveBeenCalledWith({ level: 'warn', message: 'three' });
      expect(spy).toHaveBeenCalledWith({ level: 'error', message: 'four' });
      expect(spy).toHaveBeenCalledWith({ level: 'debug', message: 'five' });
    } finally {
      Object.assign(console, saved);
    }
  });
});

describe('the remaining paths', () => {
  it('replaces the console when NODE_ENV is not test', async () => {
    const saved = { ...console };
    const previousNodeEnv = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = 'development';
      process.env.ENV = 'dev';
      jest.resetModules();

      const { Logger } = await import('../../src/adapters/outbound/logger');
      const instance = Logger.getInstance() as unknown as {
        winstonLogger: { log: (entry: unknown) => void };
      };
      const spy = jest
        .spyOn(instance.winstonLogger, 'log')
        .mockImplementation(() => undefined);

      console.info('routed');

      expect(spy).toHaveBeenCalledWith({ level: 'info', message: 'routed' });
    } finally {
      Object.assign(console, saved);
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('renders a dev line through the printf formatter', async () => {
    const { Logger } = await importLogger('dev');
    const instance = Logger.getInstance() as unknown as {
      winstonLogger: {
        silent: boolean;
        transports: { log?: (info: unknown, next: () => void) => void }[];
      };
      log: (level: string, args: unknown[]) => void;
    };
    instance.winstonLogger.silent = false;
    const transport = instance.winstonLogger.transports[0]!;
    const emitted: string[] = [];
    transport.log = (info, next) => {
      emitted.push(String((info as Record<symbol, unknown>)[Symbol.for('message')]));
      next();
    };

    instance.log('info', ['formatted line']);

    expect(emitted.join('')).toContain('formatted line');
  });

  it('survives winston failing to initialise', async () => {
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    jest.resetModules();
    jest.doMock('winston', () => ({
      format: {
        combine: () => {
          throw new Error('winston is broken');
        },
        timestamp: () => ({}),
        json: () => ({}),
        colorize: () => ({}),
        printf: () => ({}),
      },
      createLogger: () => ({}),
      transports: { File: class {}, Console: class {} },
    }));

    process.env.ENV = 'dev';
    const { Logger } = await import('../../src/adapters/outbound/logger');
    Logger.getInstance();

    expect(write).toHaveBeenCalledWith(
      expect.stringContaining('[FALLBACK LOG]')
    );

    jest.dontMock('winston');
  });
});