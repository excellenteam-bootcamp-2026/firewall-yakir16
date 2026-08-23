import { describe, expect, it } from '@jest/globals';

import { Rule, type RuleType } from '../../src/domain/Rule';
import { AppError } from '../../src/domain/common/types';
import { seededRules } from '../fixtures/rules';

describe('Rule', () => {
  it('validates every seeded rule, proving the generator is normalized', () => {
    for (const seed of seededRules) {
      const rule = new Rule(undefined, seed.type, seed.mode, seed.value, seed.active);
      expect(rule.value).toBe(seed.value);
    }
  });

  it.each([
    ['an ip rule', 'ip' as RuleType, '8.8.8.8'],
    ['a domain rule', 'domain' as RuleType, 'example.com'],
    ['a port rule', 'port' as RuleType, 443],
  ])('serialises %s to the documented shape', (_label, type, value) => {
    const rule = new Rule(7, type, 'blacklist', value, true);

    expect(rule.toJSON()).toEqual({
      id: 7,
      type,
      mode: 'blacklist',
      value,
      active: true,
    });
  });

  it('keeps id undefined for a rule that has not been stored yet', () => {
    const rule = new Rule(undefined, 'ip', 'whitelist', '1.1.1.1', true);

    expect(rule.id).toBeUndefined();
    expect(rule.toJSON().id).toBeUndefined();
  });

  it('exposes the active flag it was constructed with', () => {
    expect(new Rule(1, 'ip', 'blacklist', '1.1.1.1', false).active).toBe(false);
    expect(new Rule(2, 'ip', 'blacklist', '2.2.2.2', true).active).toBe(true);
  });

  it('accepts both modes', () => {
    expect(new Rule(1, 'ip', 'blacklist', '1.1.1.1', true).mode).toBe('blacklist');
    expect(new Rule(2, 'ip', 'whitelist', '2.2.2.2', true).mode).toBe('whitelist');
  });

  it('rejects a value that does not match its type', () => {
    expect(() => new Rule(undefined, 'ip', 'blacklist', 443, true)).toThrow(
      expect.objectContaining({ code: 'INVALID_IP' })
    );
    expect(() => new Rule(undefined, 'port', 'blacklist', '8.8.8.8', true)).toThrow(
      expect.objectContaining({ code: 'INVALID_PORT' })
    );
  });

  it('rejects an unknown rule type instead of storing it silently', () => {
    expect(
      () => new Rule(undefined, 'mac' as RuleType, 'blacklist', 'aa:bb', true)
    ).toThrow(expect.objectContaining({ code: 'INVALID_RULE_TYPE' }));
  });
});

describe('AppError', () => {
  it('defaults to 400 and keeps instanceof through the prototype fix', () => {
    const error = new AppError('SOME_CODE', 'Something went wrong.');

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('SOME_CODE');
    expect(error.message).toBe('Something went wrong.');
  });

  it('carries an explicit status code when given one', () => {
    expect(new AppError('NOT_FOUND', 'Missing.', 404).statusCode).toBe(404);
  });
});