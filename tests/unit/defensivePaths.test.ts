import { describe, expect, it, jest } from '@jest/globals';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { asNonEmpty } from '../../src/adapters/inbound/http/FirewallController';
import { DrizzleRuleRepository } from '../../src/adapters/outbound/persistence/DrizzleRuleRepository';
import { FirewallService } from '../../src/application/use-cases/FirewallService';
import type { Rule } from '../../src/domain/Rule';
import { FakePublisher, FakeRuleRepository } from '../fixtures/fakes';


describe('asNonEmpty', () => {
  it('narrows a populated array to a non-empty tuple', () => {
    expect(asNonEmpty([1, 2, 3])).toEqual([1, 2, 3]);
    expect(asNonEmpty(['only'])).toEqual(['only']);
  });

  it('refuses an empty array rather than lying about the type', () => {
    expect(() => asNonEmpty([])).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' })
    );
  });
});

describe('getRules with a row the domain does not recognise', () => {
  it('skips it instead of crashing the request', async () => {
    const repository = new FakeRuleRepository();
    const rogue = {
      id: 1,
      type: 'mac',
      mode: 'blacklist',
      value: 'aa:bb:cc:dd:ee:ff',
      active: true,
    } as unknown as Rule;

    repository.seed([rogue]);

    const service = new FirewallService(
      repository,
      new FakePublisher(),
      'test-queue'
    );

    await expect(service.getRules()).resolves.toEqual({
      ips: {},
      domains: {},
      ports: {},
    });
  });
});

describe('DrizzleRuleRepository', () => {
  it('falls back to the configured table when none is injected', async () => {
    const settled = Promise.resolve([]);
    const chain = {
      where: () => settled,
      then: settled.then.bind(settled),
      catch: settled.catch.bind(settled),
      finally: settled.finally.bind(settled),
    };
    const db = { select: () => ({ from: () => chain }) } as unknown as NodePgDatabase;
    const repository = new DrizzleRuleRepository(db);

    await expect(repository.getAll()).resolves.toEqual([]);
  });
});