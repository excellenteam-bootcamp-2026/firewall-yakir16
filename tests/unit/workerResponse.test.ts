import { describe, expect, it } from '@jest/globals';

import { unwrapWorkerResponse } from '../../src/application/contracts/workerResponse';
import { AppError } from '../../src/domain/common/types';
import { workerRule } from '../fixtures/fakes';


describe('unwrapWorkerResponse', () => {
  it('returns the rules from a well-formed success reply', () => {
    const rules = [workerRule({ id: 1 }), workerRule({ id: 2, value: '2.2.2.2' })];

    expect(unwrapWorkerResponse({ status: 'success', rules })).toEqual(rules);
  });

  it('accepts a success reply with no rules', () => {
    expect(unwrapWorkerResponse({ status: 'success', rules: [] })).toEqual([]);
  });

  it('accepts a numeric value, which is how ports come back', () => {
    const rules = [workerRule({ id: 3, type: 'port', value: 443 })];

    expect(unwrapWorkerResponse({ status: 'success', rules })).toEqual(rules);
  });

  it.each([
    ['RULE_ALREADY_EXISTS', 409],
    ['RULE_CONFLICT', 409],
    ['RULE_NOT_FOUND', 404],
    ['INVALID_IP', 400],
    ['INVALID_DOMAIN', 400],
    ['INVALID_PORT', 400],
    ['INVALID_RULE_TYPE', 400],
    ['VALIDATION_ERROR', 400],
    ['INTERNAL_ERROR', 502],
  ])('maps %s to HTTP %i', (code, status) => {
    expect(() =>
      unwrapWorkerResponse({ status: 'error', code, message: 'Rejected.' })
    ).toThrow(expect.objectContaining({ code, statusCode: status }));
  });

  it('treats an unrecognised error code as an upstream fault, not a client one', () => {
    expect(() =>
      unwrapWorkerResponse({
        status: 'error',
        code: 'SOMETHING_NEW',
        message: 'Unknown.',
      })
    ).toThrow(expect.objectContaining({ code: 'SOMETHING_NEW', statusCode: 502 }));
  });

  it('preserves the message so the client learns why it was rejected', () => {
    expect(() =>
      unwrapWorkerResponse({
        status: 'error',
        code: 'RULE_CONFLICT',
        message: "Rule '1.1.1.1' already exists in 'blacklist' mode.",
      })
    ).toThrow("Rule '1.1.1.1' already exists in 'blacklist' mode.");
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'success'],
    ['an empty object', {}],
    ['an unknown status', { status: 'maybe', rules: [] }],
    ['a success reply with no rules field', { status: 'success' }],
    ['an error reply with no code', { status: 'error', message: 'Oops.' }],
    ['an error reply with an empty code', { status: 'error', code: '', message: 'x' }],
    ['rules that are not an array', { status: 'success', rules: 'lots' }],
    ['a rule missing its id', { status: 'success', rules: [{ type: 'ip' }] }],
    [
      'a rule with an unknown type',
      { status: 'success', rules: [{ ...workerRule({ id: 1 }), type: 'mac' }] },
    ],
  ])('rejects %s as an invalid upstream response', (_label, payload) => {
    expect(() => unwrapWorkerResponse(payload)).toThrow(
      expect.objectContaining({ code: 'UPSTREAM_INVALID_RESPONSE', statusCode: 502 })
    );
  });

  it('throws an AppError, so the controller can map it without extra cases', () => {
    expect(() => unwrapWorkerResponse(null)).toThrow(AppError);
  });
});