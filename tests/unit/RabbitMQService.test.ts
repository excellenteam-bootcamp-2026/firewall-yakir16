import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type ReplyHandler = (msg: unknown) => void;

const sendToQueue = jest.fn<(...args: unknown[]) => boolean>();
const assertQueue = jest.fn<(...args: unknown[]) => Promise<{ queue: string }>>();
const consume = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const closeChannel = jest.fn<() => Promise<void>>();
const closeConnection = jest.fn<() => Promise<void>>();
const createChannel = jest.fn<() => Promise<unknown>>();
const connect = jest.fn<(...args: unknown[]) => Promise<unknown>>();

const connectionHandlers = new Map<string, (...args: unknown[]) => void>();

let replyHandler: ReplyHandler;

const REPLY_QUEUE = 'amq.gen-reply-queue';

jest.unstable_mockModule('amqplib', () => ({
  default: { connect },
}));

const { RabbitMQService } = await import(
  '../../src/adapters/outbound/rabbitmq/RabbitMQService'
);

function buildChannel() {
  return {
    assertQueue,
    consume,
    sendToQueue,
    close: closeChannel,
  };
}

function buildConnection() {
  return {
    createChannel,
    close: closeConnection,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      connectionHandlers.set(event, handler);
    },
  };
}

type Service = ReturnType<typeof RabbitMQService.getInstance>;

function freshService(): Service {
  (RabbitMQService as unknown as { instance?: unknown }).instance = undefined;
  return RabbitMQService.getInstance();
}

async function connectedService() {
  const service = freshService();
  await service.connectWithRetry();
  return service;
}

function envelopeFor(service: Service) {
  return service.createEnvelope('CREATE_RULE', { type: 'ip' });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function startCall(
  service: Service,
  envelope = envelopeFor(service),
  queue = 'rules'
) {
  const settled = service
    .publishRPC(queue, envelope)
    .then((value: unknown) => ({ value }))
    .catch((error: unknown) => ({ error }));

  return { envelope, settled };
}

function deliverReply(correlationId: string | undefined, body: unknown): void {
  replyHandler({
    properties: { correlationId },
    content: Buffer.from(
      typeof body === 'string' ? body : JSON.stringify(body)
    ),
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  connectionHandlers.clear();

  sendToQueue.mockReset().mockReturnValue(true);
  closeChannel.mockReset().mockResolvedValue(undefined);
  closeConnection.mockReset().mockResolvedValue(undefined);

  assertQueue.mockReset().mockImplementation(async (name: unknown) =>
    name === '' ? { queue: REPLY_QUEUE } : { queue: String(name) }
  );

  consume.mockReset().mockImplementation(async (_queue, handler) => {
    replyHandler = handler as ReplyHandler;
    return { consumerTag: 'tag-1' };
  });

  createChannel.mockReset().mockImplementation(async () => buildChannel());
  connect.mockReset().mockImplementation(async () => buildConnection());
});

afterEach(() => {
  jest.useRealTimers();
});


describe('getInstance', () => {
  it('returns the same object every time', () => {
    expect(RabbitMQService.getInstance()).toBe(RabbitMQService.getInstance());
  });
});


describe('connectWithRetry', () => {
  it('opens a channel and one exclusive reply queue', async () => {
    await connectedService();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(assertQueue).toHaveBeenCalledWith('', {
      exclusive: true,
      autoDelete: true,
    });
    expect(consume).toHaveBeenCalledWith(REPLY_QUEUE, expect.any(Function), {
      noAck: true,
    });
  });

  it('retries a refused connection', async () => {
    connect
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockImplementationOnce(async () => buildConnection());

    const service = freshService();
    const settled = service
      .connectWithRetry()
      .then(() => 'connected')
      .catch((error: unknown) => error);

    await jest.runAllTimersAsync();

    expect(await settled).toBe('connected');
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('throws the last failure once the attempts run out', async () => {
    const failure = new Error('broker unreachable');
    connect.mockRejectedValue(failure);

    const settled = freshService()
      .connectWithRetry(3, 1000)
      .then(() => 'connected')
      .catch((error: unknown) => error);

    await jest.runAllTimersAsync();

    expect(await settled).toBe(failure);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('logs a connection error without tearing the process down', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await connectedService();

    connectionHandlers.get('error')?.(new Error('channel reset by peer'));

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('channel reset by peer')
    );
  });
});


describe('createEnvelope', () => {
  it('stamps a unique id, the event type and a timestamp', () => {
    const service = freshService();

    const first = service.createEnvelope('CREATE_RULE', { a: 1 });
    const second = service.createEnvelope('DELETE_RULE', { b: 2 });

    expect(first.eventType).toBe('CREATE_RULE');
    expect(first.payload).toEqual({ a: 1 });
    expect(first.messageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.messageId).not.toBe(first.messageId);
    expect(() => new Date(first.timestamp).toISOString()).not.toThrow();
  });
});


describe('publishRPC', () => {
  it('refuses to publish before the connection exists', async () => {
    const service = freshService();
    const { settled } = startCall(service);

    expect(await settled).toMatchObject({
      error: expect.objectContaining({
        code: 'UPSTREAM_UNAVAILABLE',
        statusCode: 503,
      }),
    });
  });

  it('sends the message with a correlation id, a reply queue and an expiry', async () => {
    const service = await connectedService();
    const { envelope, settled } = startCall(service);
    await flush();

    deliverReply(envelope.messageId, { status: 'success', rules: [] });
    await settled;

    expect(assertQueue).toHaveBeenCalledWith('rules', { durable: true });

    const [queue, buffer, options] = sendToQueue.mock.calls[0] as [
      string,
      Buffer,
      Record<string, unknown>,
    ];

    expect(queue).toBe('rules');
    expect(JSON.parse(buffer.toString())).toEqual(envelope);
    expect(options).toMatchObject({
      persistent: true,
      contentType: 'application/json',
      correlationId: envelope.messageId,
      messageId: envelope.messageId,
      replyTo: REPLY_QUEUE,
    });
    expect(options.expiration).toBeDefined();
  });

  it('resolves with the parsed reply', async () => {
    const service = await connectedService();
    const reply = { status: 'success', rules: [{ id: 1 }] };
    const { envelope, settled } = startCall(service);
    await flush();

    deliverReply(envelope.messageId, reply);

    expect(await settled).toEqual({ value: reply });
  });

  it('reuses one reply queue across calls instead of creating one each time', async () => {
    const service = await connectedService();

    const first = startCall(service);
    const second = startCall(service);
    await flush();

    deliverReply(first.envelope.messageId, { first: true });
    deliverReply(second.envelope.messageId, { second: true });

    expect(await first.settled).toEqual({ value: { first: true } });
    expect(await second.settled).toEqual({ value: { second: true } });

    const replyQueueDeclarations = assertQueue.mock.calls.filter(
      ([name]) => name === ''
    );
    expect(replyQueueDeclarations).toHaveLength(1);
  });

  it('routes each reply to the call that asked for it', async () => {
    const service = await connectedService();

    const first = startCall(service);
    const second = startCall(service);
    await flush();

    deliverReply(second.envelope.messageId, { who: 'second' });
    deliverReply(first.envelope.messageId, { who: 'first' });

    expect(await first.settled).toEqual({ value: { who: 'first' } });
    expect(await second.settled).toEqual({ value: { who: 'second' } });
  });

  it('times out when no reply arrives', async () => {
    const service = await connectedService();
    const { settled } = startCall(service);
    await flush();

    await jest.advanceTimersByTimeAsync(30_000);

    expect(await settled).toMatchObject({
      error: expect.objectContaining({
        code: 'UPSTREAM_TIMEOUT',
        statusCode: 504,
      }),
    });
  });

  it('ignores a reply whose correlation id it does not recognise', async () => {
    const service = await connectedService();
    const { settled } = startCall(service);
    await flush();

    deliverReply('a-correlation-id-from-somewhere-else', { status: 'success' });

    await jest.advanceTimersByTimeAsync(30_000);

    expect(await settled).toMatchObject({
      error: expect.objectContaining({ code: 'UPSTREAM_TIMEOUT' }),
    });
  });

  it.each([
    ['a null delivery', true],
    ['a reply with no correlation id', false],
  ])('ignores %s', async (_label, nullDelivery) => {
    const service = await connectedService();
    const { settled } = startCall(service);
    await flush();

    if (nullDelivery) {
      replyHandler(null);
    } else {
      deliverReply(undefined, { status: 'success' });
    }

    await jest.advanceTimersByTimeAsync(30_000);

    expect(await settled).toMatchObject({
      error: expect.objectContaining({ code: 'UPSTREAM_TIMEOUT' }),
    });
  });

  it('rejects a reply that is not valid JSON', async () => {
    const service = await connectedService();
    const { envelope, settled } = startCall(service);
    await flush();

    deliverReply(envelope.messageId, 'this is not json');

    expect(await settled).toMatchObject({
      error: expect.objectContaining({
        code: 'UPSTREAM_INVALID_RESPONSE',
        statusCode: 502,
      }),
    });
  });

  it('cleans up when the send itself fails', async () => {
    const service = await connectedService();
    const failure = new Error('channel closed mid-publish');
    sendToQueue.mockImplementation(() => {
      throw failure;
    });

    const { settled } = startCall(service);
    await flush();
    expect(await settled).toEqual({ error: failure });
    expect(jest.getTimerCount()).toBe(0);
  });
});


describe('losing the connection', () => {
  it('fails the calls that were still waiting instead of hanging them', async () => {
    const service = await connectedService();
    const { settled } = startCall(service);
    await flush();

    connectionHandlers.get('close')?.();

    expect(await settled).toMatchObject({
      error: expect.objectContaining({
        code: 'UPSTREAM_UNAVAILABLE',
        statusCode: 503,
      }),
    });

    await jest.runAllTimersAsync();
  });

  it('refuses new calls until it is back', async () => {
    const service = await connectedService();
    connect.mockRejectedValue(new Error('still down'));

    connectionHandlers.get('close')?.();
    await flush();

    const { settled } = startCall(service);

    expect(await settled).toMatchObject({
      error: expect.objectContaining({ code: 'UPSTREAM_UNAVAILABLE' }),
    });

    await jest.runAllTimersAsync();
  });

  it('tries to reconnect on its own', async () => {
    const service = await connectedService();
    connect.mockClear();

    connectionHandlers.get('close')?.();
    await jest.runAllTimersAsync();

    expect(connect).toHaveBeenCalled();
  });

  it('reports a failed reconnection rather than retrying forever', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await connectedService();
    connect.mockRejectedValue(new Error('still down'));

    connectionHandlers.get('close')?.();
    await jest.runAllTimersAsync();

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('reconnection failed')
    );
  });
});


describe('close', () => {
  it('settles pending calls and shuts the channel and connection', async () => {
    const service = await connectedService();
    const { settled } = startCall(service);
    await flush();

    await service.close();

    expect(await settled).toMatchObject({
      error: expect.objectContaining({ code: 'UPSTREAM_UNAVAILABLE' }),
    });
    expect(closeChannel).toHaveBeenCalled();
    expect(closeConnection).toHaveBeenCalled();
  });

  it('leaves the service unable to publish afterwards', async () => {
    const service = await connectedService();
    await service.close();

    const { settled } = startCall(service);

    expect(await settled).toMatchObject({
      error: expect.objectContaining({ code: 'UPSTREAM_UNAVAILABLE' }),
    });
  });

  it('is safe to call when nothing was ever opened', async () => {
    await expect(freshService().close()).resolves.toBeUndefined();
  });
});

describe('the guards against an inconsistent state', () => {
  it('refuses to publish when the channel exists but the reply queue does not', async () => {
    const service = await connectedService();
    (service as unknown as { replyQueue: string | null }).replyQueue = null;

    const { settled } = startCall(service);

    expect(await settled).toMatchObject({
      error: expect.objectContaining({
        code: 'UPSTREAM_UNAVAILABLE',
        statusCode: 503,
      }),
    });
  });

  it('does not start a second reconnect while one is already running', async () => {
    const service = await connectedService();
    connect.mockClear();
    connect.mockImplementation(
      () => new Promise<unknown>(() => undefined) 
    );

    connectionHandlers.get('close')?.();
    await flush();
    connectionHandlers.get('close')?.();
    await flush();

    expect(connect).toHaveBeenCalledTimes(1);

    void service;
  });
});