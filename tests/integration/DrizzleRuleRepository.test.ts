import { describe, expect, it } from '@jest/globals';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DrizzleRuleRepository } from '../../src/adapters/outbound/persistence/DrizzleRuleRepository';
import { createRulesTable } from '../../src/adapters/outbound/persistence/postgres/schema';

function fakeDb(rows: unknown[]): NodePgDatabase {
  const settled = Promise.resolve(rows);

  const chain = {
    where: () => settled,
    then: settled.then.bind(settled),
    catch: settled.catch.bind(settled),
    finally: settled.finally.bind(settled),
  };

  return {
    select: () => ({ from: () => chain }),
  } as unknown as NodePgDatabase;
}

const table = createRulesTable('firewall_rules');

function repositoryFor(rows: unknown[]): DrizzleRuleRepository {
  return new DrizzleRuleRepository(fakeDb(rows), table);
}

describe('mapping stored rows to domain rules', () => {
  it('returns every row from getAll', async () => {
    const repository = repositoryFor([
      { id: 1, type: 'ip', mode: 'blacklist', value: '1.1.1.1', active: true },
      { id: 2, type: 'domain', mode: 'whitelist', value: 'example.com', active: false },
    ]);

    const rules = await repository.getAll();

    expect(rules).toHaveLength(2);
    expect(rules[0]!.toJSON()).toEqual({
      id: 1,
      type: 'ip',
      mode: 'blacklist',
      value: '1.1.1.1',
      active: true,
    });
    expect(rules[1]!.active).toBe(false);
  });

  it('converts a stored port back to a number', async () => {
    const repository = repositoryFor([
      { id: 3, type: 'port', mode: 'blacklist', value: '443', active: true },
    ]);

    const [rule] = await repository.getAll();

    expect(rule!.value).toBe(443);
    expect(typeof rule!.value).toBe('number');
  });

  it('leaves ip and domain values as strings', async () => {
    const repository = repositoryFor([
      { id: 1, type: 'ip', mode: 'blacklist', value: '8.8.8.8', active: true },
      { id: 2, type: 'domain', mode: 'blacklist', value: 'a.io', active: true },
    ]);

    const rules = await repository.getAll();

    expect(typeof rules[0]!.value).toBe('string');
    expect(typeof rules[1]!.value).toBe('string');
  });

  it('normalises type and mode to lower case', async () => {
    const repository = repositoryFor([
      { id: 1, type: 'IP', mode: 'BLACKLIST', value: '1.1.1.1', active: true },
    ]);

    const [rule] = await repository.getAll();

    expect(rule!.type).toBe('ip');
    expect(rule!.mode).toBe('blacklist');
  });

  it('coerces a truthy active column to a boolean', async () => {
    const repository = repositoryFor([
      { id: 1, type: 'ip', mode: 'blacklist', value: '1.1.1.1', active: 1 },
    ]);

    const [rule] = await repository.getAll();

    expect(rule!.active).toBe(true);
  });

  it('returns an empty array when the table is empty', async () => {
    await expect(repositoryFor([]).getAll()).resolves.toEqual([]);
  });
});

describe('filtered queries', () => {
  it('maps the rows returned by findByType', async () => {
    const repository = repositoryFor([
      { id: 1, type: 'ip', mode: 'blacklist', value: '1.1.1.1', active: true },
    ]);

    const rules = await repository.findByType('ip');

    expect(rules).toHaveLength(1);
    expect(rules[0]!.type).toBe('ip');
  });

  it('maps the rows returned by findByIds', async () => {
    const repository = repositoryFor([
      { id: 7, type: 'port', mode: 'whitelist', value: '8080', active: true },
    ]);

    const rules = await repository.findByIds([7]);

    expect(rules[0]!.id).toBe(7);
    expect(rules[0]!.value).toBe(8080);
  });

  it('returns an empty array when nothing matches', async () => {
    await expect(repositoryFor([]).findByIds([999])).resolves.toEqual([]);
  });
});

describe('corrupt rows', () => {
  it('refuses to hand back a row the domain would reject', async () => {
    const repository = repositoryFor([
      { id: 1, type: 'ip', mode: 'blacklist', value: 'not-an-address', active: true },
    ]);

    await expect(repository.getAll()).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_IP' })
    );
  });
});