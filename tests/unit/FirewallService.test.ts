import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { FirewallService } from '../../src/application/use-cases/FirewallService';
import { Rule } from '../../src/domain/Rule';
import { AppError } from '../../src/domain/common/types';
import { FakePublisher, FakeRuleRepository, workerRule } from '../fixtures/fakes';
import { sampleValues } from '../fixtures/rules';

const QUEUE = 'firewall-rules-queue-test';

let repository: FakeRuleRepository;
let publisher: FakePublisher;
let service: FirewallService;

function build(): void {
  repository = new FakeRuleRepository();
  publisher = new FakePublisher();
  service = new FirewallService(repository, publisher, QUEUE);
}

beforeEach(build);

describe('addRules', () => {
  it.each([
    ['two ip addresses', 'ip' as const, sampleValues('ip', 2)],
    ['four ip addresses', 'ip' as const, sampleValues('ip', 4, 4)],
    ['two domains', 'domain' as const, sampleValues('domain', 2)],
    ['three ports', 'port' as const, sampleValues('port', 3)],
  ])('publishes %s and returns what the worker stored', async (_label, type, values) => {
    const created = values.map((value, index) =>
      workerRule({ id: index + 1, type, value })
    );
    publisher.willReturnRules(created);

    const result = await service.addRules({
      type,
      mode: 'blacklist',
      values: values as [unknown, ...unknown[]] as never,
    });

    expect(result.status).toBe('success');
    expect(result.type).toBe(type);
    expect(result.mode).toBe('blacklist');
    expect(result.values).toEqual(
      created.map(({ id, value, active }) => ({ id, value, active }))
    );
  });

  it('sends one CREATE_RULE envelope to the configured queue', async () => {
    publisher.willReturnRules([workerRule({ id: 1 })]);

    await service.addRules({
      type: 'ip',
      mode: 'whitelist',
      values: ['9.9.9.9'],
    });

    expect(publisher.callCount).toBe(1);
    expect(publisher.sent[0]!.queue).toBe(QUEUE);
    expect(publisher.lastEnvelope!.eventType).toBe('CREATE_RULE');
    expect(publisher.lastEnvelope!.payload).toMatchObject({
      type: 'ip',
      mode: 'whitelist',
    });
  });

  it('de-duplicates repeated values before publishing', async () => {
    publisher.willReturnRules([workerRule({ id: 1 })]);

    await service.addRules({
      type: 'ip',
      mode: 'blacklist',
      values: ['1.1.1.1', '1.1.1.1', '1.1.1.1'],
    });

    const payload = publisher.lastEnvelope!.payload as { rules: unknown[] };
    expect(payload.rules).toHaveLength(1);
  });

  it.each([
    ['an invalid ip', 'ip' as const, '999.1.1.1', 'INVALID_IP'],
    ['an ip with leading zeros', 'ip' as const, '010.1.1.1', 'INVALID_IP'],
    ['a port above the range', 'port' as const, 70000, 'INVALID_PORT'],
    ['a port below the range', 'port' as const, 0, 'INVALID_PORT'],
    ['a port as a string', 'port' as const, '80', 'INVALID_PORT'],
    ['a domain with a protocol', 'domain' as const, 'https://a.com', 'INVALID_DOMAIN'],
  ])('rejects %s without publishing anything', async (_l, type, value, code) => {
    await expect(
      service.addRules({ type, mode: 'blacklist', values: [value] as never })
    ).rejects.toThrow(expect.objectContaining({ code }));

    expect(publisher.callCount).toBe(0);
  });

  it('rejects the whole batch when one value is invalid', async () => {
    await expect(
      service.addRules({
        type: 'ip',
        mode: 'blacklist',
        values: ['1.1.1.1', '2.2.2.2', '999.999.999.999'],
      })
    ).rejects.toThrow(expect.objectContaining({ code: 'INVALID_IP' }));

    expect(publisher.callCount).toBe(0);
  });

  it('surfaces a duplicate reported by the worker as a 409', async () => {
    publisher.willReturnRaw({
      status: 'error',
      code: 'RULE_ALREADY_EXISTS',
      message: "Rule '1.1.1.1' already exists for type 'ip'.",
    });

    await expect(
      service.addRules({ type: 'ip', mode: 'blacklist', values: ['1.1.1.1'] })
    ).rejects.toThrow(
      expect.objectContaining({ code: 'RULE_ALREADY_EXISTS', statusCode: 409 })
    );
  });

  it('surfaces a mode conflict reported by the worker as a 409', async () => {
    publisher.willReturnRaw({
      status: 'error',
      code: 'RULE_CONFLICT',
      message: "Rule '1.1.1.1' already exists in 'blacklist' mode.",
    });

    await expect(
      service.addRules({ type: 'ip', mode: 'whitelist', values: ['1.1.1.1'] })
    ).rejects.toThrow(
      expect.objectContaining({ code: 'RULE_CONFLICT', statusCode: 409 })
    );
  });

  it('turns an unrecognisable reply into a 502 rather than a broken 201', async () => {
    publisher.willReturnRaw({ ok: true });

    await expect(
      service.addRules({ type: 'ip', mode: 'blacklist', values: ['1.1.1.1'] })
    ).rejects.toThrow(
      expect.objectContaining({ code: 'UPSTREAM_INVALID_RESPONSE', statusCode: 502 })
    );
  });
});

describe('deleteRules', () => {
  it('returns the rules the worker removed', async () => {
    repository.seed([new Rule(1, 'ip', 'blacklist', '1.1.1.1', true)]);
    const removed = [workerRule({ id: 1 })];
    publisher.willReturnRules(removed);

    const result = await service.deleteRules([1]);

    expect(result).toEqual({ removed, status: 'success' });
    expect(publisher.lastEnvelope!.eventType).toBe('DELETE_RULE');
  });

  it('rejects with 404 when an id does not exist, without publishing', async () => {
    repository.seed([new Rule(1, 'ip', 'blacklist', '1.1.1.1', true)]);

    await expect(service.deleteRules([1, 999])).rejects.toThrow(
      expect.objectContaining({ code: 'RULE_NOT_FOUND', statusCode: 404 })
    );

    expect(publisher.callCount).toBe(0);
  });

  it('de-duplicates ids before checking them', async () => {
    repository.seed([new Rule(1, 'ip', 'blacklist', '1.1.1.1', true)]);
    publisher.willReturnRules([workerRule({ id: 1 })]);

    await expect(service.deleteRules([1, 1, 1])).resolves.toMatchObject({
      status: 'success',
    });
  });
});

describe('updateRulesStatus', () => {
  it.each([true, false])('publishes active=%s and returns the result', async (active) => {
    repository.seed([new Rule(5, 'port', 'blacklist', 443, !active)]);
    const updated = [workerRule({ id: 5, type: 'port', value: 443, active })];
    publisher.willReturnRules(updated);

    const result = await service.updateRulesStatus([5], active);

    expect(result).toEqual({ updated, status: 'success' });
    expect(publisher.lastEnvelope!.eventType).toBe('UPDATE_RULE');
    expect(publisher.lastEnvelope!.payload).toEqual({ ids: [5], active });
  });

  it('rejects with 404 when an id does not exist', async () => {
    await expect(service.updateRulesStatus([404], true)).rejects.toThrow(
      expect.objectContaining({ code: 'RULE_NOT_FOUND', statusCode: 404 })
    );
  });
});

describe('getRules', () => {
  const stored = [
    new Rule(1, 'ip', 'blacklist', '1.1.1.1', true),
    new Rule(2, 'ip', 'whitelist', '2.2.2.2', false),
    new Rule(3, 'domain', 'blacklist', 'example.com', true),
    new Rule(4, 'port', 'blacklist', 443, true),
  ];

  it('groups every rule under its plural type', async () => {
    repository.seed(stored);

    await expect(service.getRules()).resolves.toEqual({
      ips: {
        '1': { id: 1, value: '1.1.1.1', active: true },
        '2': { id: 2, value: '2.2.2.2', active: false },
      },
      domains: { '3': { id: 3, value: 'example.com', active: true } },
      ports: { '4': { id: 4, value: 443, active: true } },
    });
  });

  it('returns three empty groups when nothing is stored', async () => {
    await expect(service.getRules()).resolves.toEqual({
      ips: {},
      domains: {},
      ports: {},
    });
  });

  it.each(['ip', 'domain', 'port'] as const)('filters by type=%s in the query', async (type) => {
    repository.seed(stored);
    const spy = jest.spyOn(repository, 'findByType');

    await service.getRules(type);

    expect(spy).toHaveBeenCalledWith(type);
  });

  it('accepts an uppercase filter', async () => {
    repository.seed(stored);

    await expect(service.getRules('IP')).resolves.toMatchObject({
      domains: {},
      ports: {},
    });
  });

  it('rejects an unknown filter', async () => {
    await expect(service.getRules('banana')).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_TYPE_FILTER', statusCode: 400 })
    );
  });

  it('skips a rule with no id rather than crashing', async () => {
    repository.seed([new Rule(undefined, 'ip', 'blacklist', '1.1.1.1', true)]);

    await expect(service.getRules()).resolves.toEqual({
      ips: {},
      domains: {},
      ports: {},
    });
  });
});

describe('retrying a transient upstream failure', () => {
  const timeout = () =>
    new AppError('UPSTREAM_TIMEOUT', 'The rule builder did not respond in time.', 504);

  it('retries and succeeds on the second attempt', async () => {
    publisher.willThrow(timeout()).willReturnRules([workerRule({ id: 1 })]);

    await expect(
      service.addRules({ type: 'ip', mode: 'blacklist', values: ['1.1.1.1'] })
    ).resolves.toMatchObject({ status: 'success' });

    expect(publisher.callCount).toBe(2);
  });

  it('reuses the same envelope so the worker can recognise the repeat', async () => {
    publisher.willThrow(timeout()).willReturnRules([workerRule({ id: 1 })]);

    await service.addRules({ type: 'ip', mode: 'blacklist', values: ['1.1.1.1'] });

    const [first, second] = publisher.sent;
    expect(first!.envelope.messageId).toBe(second!.envelope.messageId);
  });

  it('gives up after three attempts and rethrows', async () => {
    publisher.willThrow(timeout()).willThrow(timeout()).willThrow(timeout());

    await expect(
      service.addRules({ type: 'ip', mode: 'blacklist', values: ['1.1.1.1'] })
    ).rejects.toThrow(expect.objectContaining({ code: 'UPSTREAM_TIMEOUT' }));

    expect(publisher.callCount).toBe(3);
  });

  it('retries when the broker is unavailable', async () => {
    publisher
      .willThrow(new AppError('UPSTREAM_UNAVAILABLE', 'Broker gone.', 503))
      .willReturnRules([workerRule({ id: 1 })]);

    await expect(
      service.addRules({ type: 'ip', mode: 'blacklist', values: ['1.1.1.1'] })
    ).resolves.toMatchObject({ status: 'success' });
  });

  it.each([
    ['a conflict', new AppError('RULE_CONFLICT', 'Already blacklisted.', 409)],
    ['a validation failure', new AppError('INVALID_IP', 'Bad address.', 400)],
    ['a plain error', new Error('boom')],
  ])('does not retry %s', async (_label, error) => {
    publisher.willThrow(error);

    await expect(
      service.addRules({ type: 'ip', mode: 'blacklist', values: ['1.1.1.1'] })
    ).rejects.toThrow();

    expect(publisher.callCount).toBe(1);
  });
});