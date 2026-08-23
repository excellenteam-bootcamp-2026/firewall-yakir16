import { describe, expect, it } from '@jest/globals';

import {
  DomainName,
  IpAddress,
  MAX_VALUE_LENGTH,
  PortNumber,
} from '../../src/domain/valueObjects';
import { AppError } from '../../src/domain/common/types';
import { sampleValues, valuesOfType } from '../fixtures/rules';


describe('IpAddress', () => {
  it.each(sampleValues('ip', 6))('accepts the seeded address %s', (value) => {
    expect(IpAddress.create(value).value).toBe(value);
  });

  it.each([
    ['the lowest address', '0.0.0.0'],
    ['the highest address', '255.255.255.255'],
    ['loopback', '127.0.0.1'],
    ['single-digit octets', '1.2.3.4'],
  ])('accepts %s', (_label, value) => {
    expect(IpAddress.create(value).value).toBe(value);
  });

  it.each([
    ['an octet above 255', '256.1.1.1'],
    ['an octet far above 255', '999.1.1.1'],
    ['leading zeros', '010.1.1.1'],
    ['only three octets', '1.1.1'],
    ['five octets', '1.1.1.1.1'],
    ['a trailing dot', '1.1.1.1.'],
    ['an empty octet', '1..1.1'],
    ['letters', 'not.an.ip.address'],
    ['an empty string', ''],
    ['a negative octet', '-1.1.1.1'],
  ])('rejects %s', (_label, value) => {
    expect(() => IpAddress.create(value)).toThrow(AppError);
    expect(() => IpAddress.create(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_IP' })
    );
  });

  it('rejects a number, because an address is never numeric', () => {
    expect(() => IpAddress.create(3232235777)).toThrow(
      expect.objectContaining({ code: 'INVALID_IP' })
    );
  });
});

describe('PortNumber', () => {
  it.each(sampleValues('port', 6))('accepts the seeded port %s', (value) => {
    expect(PortNumber.create(value).value).toBe(value);
  });

  it.each([
    ['the lowest port', 1],
    ['the highest port', 65535],
    ['the first non-privileged port', 1024],
  ])('accepts %s', (_label, value) => {
    expect(PortNumber.create(value).value).toBe(value);
  });

  it.each([
    ['zero', 0],
    ['a negative port', -1],
    ['one above the maximum', 65536],
    ['far above the maximum', 70000],
    ['a fractional port', 443.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s', (_label, value) => {
    expect(() => PortNumber.create(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_PORT' })
    );
  });

  it('rejects a numeric string, so "80" never reaches the database', () => {
    expect(() => PortNumber.create('80')).toThrow(
      expect.objectContaining({ code: 'INVALID_PORT' })
    );
  });
});

describe('DomainName', () => {
  it.each(sampleValues('domain', 6))('accepts the seeded domain %s', (value) => {
    expect(DomainName.create(value).value).toBe(value);
  });

  it.each([
    ['the shortest valid name', 'a.io'],
    ['a hyphen inside a label', 'my-site.com'],
    ['nested subdomains', 'a.b.c.d.example.com'],
    ['a label starting with digits', '123numeric.example.org'],
    ['the maximum label length', `${'x'.repeat(63)}.com`],
  ])('accepts %s', (_label, value) => {
    expect(DomainName.create(value).value).toBe(value);
  });

  it.each([
    ['a protocol', 'https://example.com'],
    ['a path', 'example.com/admin'],
    ['a port', 'example.com:8080'],
    ['an empty label', 'a..b.com'],
    ['a leading hyphen', '-foo.com'],
    ['a trailing hyphen', 'foo-.com'],
    ['a single-character TLD', 'example.c'],
    ['a numeric TLD', 'example.123'],
    ['no dot at all', 'localhost'],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(() => DomainName.create(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_DOMAIN' })
    );
  });

  it(`rejects a name longer than ${MAX_VALUE_LENGTH} characters`, () => {
    const tooLong = `${'a.'.repeat(130)}com`;

    expect(tooLong.length).toBeGreaterThan(MAX_VALUE_LENGTH);
    expect(() => DomainName.create(tooLong)).toThrow(
      expect.objectContaining({ code: 'INVALID_DOMAIN' })
    );
  });

  it('rejects a number', () => {
    expect(() => DomainName.create(42)).toThrow(
      expect.objectContaining({ code: 'INVALID_DOMAIN' })
    );
  });
});

describe('the seeded fixtures', () => {
  it('contains 20 values of every type', () => {
    expect(valuesOfType('ip')).toHaveLength(20);
    expect(valuesOfType('domain')).toHaveLength(20);
    expect(valuesOfType('port')).toHaveLength(20);
  });
});