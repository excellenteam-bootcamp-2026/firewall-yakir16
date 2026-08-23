import { beforeEach, describe, expect, it } from '@jest/globals';
import express, { type Express } from 'express';
import request from 'supertest';

import { FirewallController } from '../../src/adapters/inbound/http/FirewallController';
import { FirewallService } from '../../src/application/use-cases/FirewallService';
import { Rule } from '../../src/domain/Rule';
import { FakePublisher, FakeRuleRepository, workerRule } from '../fixtures/fakes';
import { sampleValues } from '../fixtures/rules';


const API = '/api/firewall';

let repository: FakeRuleRepository;
let publisher: FakePublisher;
let app: Express;

beforeEach(() => {
  repository = new FakeRuleRepository();
  publisher = new FakePublisher();

  const service = new FirewallService(repository, publisher, 'test-queue');

  app = express();
  app.use(express.json());
  app.use(API, new FirewallController(service).router);
});


describe('POST /api/firewall/ips', () => {
  it.each([
    ['a single address', sampleValues('ip', 1), 'blacklist'],
    ['two addresses', sampleValues('ip', 2), 'blacklist'],
    ['three addresses on the whitelist', sampleValues('ip', 3, 3), 'whitelist'],
    ['four addresses', sampleValues('ip', 4, 8), 'blacklist'],
  ])('creates %s', async (_label, values, mode) => {
    publisher.willReturnRules(
      values.map((value, index) =>
        workerRule({ id: index + 1, type: 'ip', mode: mode as never, value })
      )
    );

    const response = await request(app)
      .post(`${API}/ips`)
      .send({ values, mode })
      .expect(201);

    expect(response.body.type).toBe('ip');
    expect(response.body.mode).toBe(mode);
    expect(response.body.status).toBe('success');
    expect(response.body.values).toHaveLength(values.length);
    expect(response.body.values[0]).toEqual({
      id: 1,
      value: values[0],
      active: true,
    });
  });
});

describe('POST /api/firewall/domains', () => {
  it.each([
    ['one domain', sampleValues('domain', 1)],
    ['two domains', sampleValues('domain', 2, 2)],
    ['three domains', sampleValues('domain', 3, 6)],
  ])('creates %s', async (_label, values) => {
    publisher.willReturnRules(
      values.map((value, index) =>
        workerRule({ id: index + 1, type: 'domain', value })
      )
    );

    const response = await request(app)
      .post(`${API}/domains`)
      .send({ values, mode: 'blacklist' })
      .expect(201);

    expect(response.body.type).toBe('domain');
    expect(response.body.values).toHaveLength(values.length);
  });
});

describe('POST /api/firewall/ports', () => {
  it.each([
    ['one port', sampleValues('port', 1)],
    ['two ports', sampleValues('port', 2, 2)],
    ['three ports', sampleValues('port', 3, 5)],
    ['four ports on the whitelist', sampleValues('port', 4, 10)],
  ])('creates %s', async (_label, values) => {
    publisher.willReturnRules(
      values.map((value, index) => workerRule({ id: index + 1, type: 'port', value }))
    );

    const response = await request(app)
      .post(`${API}/ports`)
      .send({ values, mode: 'blacklist' })
      .expect(201);

    expect(response.body.type).toBe('port');
    expect(typeof response.body.values[0].value).toBe('number');
  });
});


describe('edge cases are rejected with 400 and a stable code', () => {
  it.each([
    ['an octet above 255', 'ips', { values: ['256.1.1.1'], mode: 'blacklist' }, 'INVALID_IP'],
    ['leading zeros', 'ips', { values: ['010.1.1.1'], mode: 'blacklist' }, 'INVALID_IP'],
    ['too few octets', 'ips', { values: ['1.1.1'], mode: 'blacklist' }, 'INVALID_IP'],
    ['text instead of an address', 'ips', { values: ['nope'], mode: 'blacklist' }, 'INVALID_IP'],
    ['a port above the range', 'ports', { values: [65536], mode: 'blacklist' }, 'INVALID_PORT'],
    ['a port of zero', 'ports', { values: [0], mode: 'blacklist' }, 'INVALID_PORT'],
    ['a negative port', 'ports', { values: [-443], mode: 'blacklist' }, 'INVALID_PORT'],
    ['a port sent as text', 'ports', { values: ['80'], mode: 'blacklist' }, 'INVALID_PORT'],
    ['a domain with a protocol', 'domains', { values: ['https://a.com'], mode: 'blacklist' }, 'INVALID_DOMAIN'],
    ['a domain with a path', 'domains', { values: ['a.com/x'], mode: 'blacklist' }, 'INVALID_DOMAIN'],
    ['a domain with a port', 'domains', { values: ['a.com:8080'], mode: 'blacklist' }, 'INVALID_DOMAIN'],
  ])('rejects %s', async (_label, route, body, code) => {
    const response = await request(app).post(`${API}/${route}`).send(body).expect(400);

    expect(response.body).toEqual({
      status: 'error',
      code,
      message: expect.any(String),
    });
    expect(publisher.callCount).toBe(0);
  });
});

describe('malformed requests are rejected before the domain sees them', () => {
  it.each([
    ['an empty values array', 'ips', { values: [], mode: 'blacklist' }],
    ['a missing mode', 'ips', { values: ['1.1.1.1'] }],
    ['an unknown mode', 'ips', { values: ['1.1.1.1'], mode: 'greylist' }],
    ['a missing values array', 'ips', { mode: 'blacklist' }],
    ['an empty body', 'ips', {}],
  ])('rejects %s with VALIDATION_ERROR', async (_label, route, body) => {
    const response = await request(app).post(`${API}/${route}`).send(body).expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a batch larger than the limit', async () => {
    const values = Array.from({ length: 101 }, (_, i) => `10.0.0.${i % 250}`);

    const response = await request(app)
      .post(`${API}/ips`)
      .send({ values, mode: 'blacklist' })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
});


describe('duplicates reported by the worker', () => {
  it('returns 409 when the rule already exists', async () => {
    publisher.willReturnRaw({
      status: 'error',
      code: 'RULE_ALREADY_EXISTS',
      message: "Rule '1.1.1.1' already exists for type 'ip'.",
    });

    const response = await request(app)
      .post(`${API}/ips`)
      .send({ values: ['1.1.1.1'], mode: 'blacklist' })
      .expect(409);

    expect(response.body.code).toBe('RULE_ALREADY_EXISTS');
  });

  it('returns 409 when the rule exists in the opposite mode', async () => {
    publisher.willReturnRaw({
      status: 'error',
      code: 'RULE_CONFLICT',
      message: "Rule '1.1.1.1' already exists in 'blacklist' mode.",
    });

    const response = await request(app)
      .post(`${API}/ips`)
      .send({ values: ['1.1.1.1'], mode: 'whitelist' })
      .expect(409);

    expect(response.body.code).toBe('RULE_CONFLICT');
  });

  it('collapses a value repeated inside one request', async () => {
    publisher.willReturnRules([workerRule({ id: 1 })]);

    await request(app)
      .post(`${API}/ips`)
      .send({ values: ['1.1.1.1', '1.1.1.1'], mode: 'blacklist' })
      .expect(201);

    const payload = publisher.lastEnvelope!.payload as { rules: unknown[] };
    expect(payload.rules).toHaveLength(1);
  });
});


describe('GET /api/firewall/rules', () => {
  beforeEach(() => {
    repository.seed([
      new Rule(1, 'ip', 'blacklist', '1.1.1.1', true),
      new Rule(2, 'domain', 'blacklist', 'example.com', false),
      new Rule(3, 'port', 'whitelist', 443, true),
    ]);
  });

  it('returns every rule grouped by type', async () => {
    const response = await request(app).get(`${API}/rules`).expect(200);

    expect(response.body).toEqual({
      ips: { '1': { id: 1, value: '1.1.1.1', active: true } },
      domains: { '2': { id: 2, value: 'example.com', active: false } },
      ports: { '3': { id: 3, value: 443, active: true } },
    });
  });

  it.each(['ip', 'domain', 'port'])('filters by type=%s', async (type) => {
    const response = await request(app).get(`${API}/rules?type=${type}`).expect(200);

    expect(Object.keys(response.body)).toEqual(['ips', 'domains', 'ports']);
  });

  it('rejects an unknown filter', async () => {
    const response = await request(app).get(`${API}/rules?type=banana`).expect(400);

    expect(response.body.code).toBe('INVALID_TYPE_FILTER');
  });

  it('ignores a repeated type parameter rather than failing', async () => {
    await request(app).get(`${API}/rules?type=ip&type=domain`).expect(200);
  });
});


describe('DELETE /api/firewall/rules', () => {
  beforeEach(() => {
    repository.seed([
      new Rule(1, 'ip', 'blacklist', '1.1.1.1', true),
      new Rule(2, 'ip', 'blacklist', '2.2.2.2', true),
    ]);
  });

  it.each([
    ['one id', [1]],
    ['two ids', [1, 2]],
  ])('removes %s', async (_label, ids) => {
    publisher.willReturnRules(ids.map((id) => workerRule({ id })));

    const response = await request(app)
      .delete(`${API}/rules`)
      .send({ ids })
      .expect(200);

    expect(response.body.status).toBe('success');
    expect(response.body.removed).toHaveLength(ids.length);
  });

  it('returns 404 for an id that does not exist', async () => {
    const response = await request(app)
      .delete(`${API}/rules`)
      .send({ ids: [999] })
      .expect(404);

    expect(response.body.code).toBe('RULE_NOT_FOUND');
    expect(publisher.callCount).toBe(0);
  });

  it.each([
    ['an empty array', { ids: [] }],
    ['a missing ids field', {}],
    ['non-integer ids', { ids: [1.5] }],
  ])('rejects %s', async (_label, body) => {
    const response = await request(app).delete(`${API}/rules`).send(body).expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
});


describe('PATCH /api/firewall/rules/status', () => {
  beforeEach(() => {
    repository.seed([new Rule(1, 'ip', 'blacklist', '1.1.1.1', true)]);
  });

  it.each([true, false])('sets active to %s', async (active) => {
    publisher.willReturnRules([workerRule({ id: 1, active })]);

    const response = await request(app)
      .patch(`${API}/rules/status`)
      .send({ ids: [1], active })
      .expect(200);

    expect(response.body.updated[0].active).toBe(active);
  });

  it('returns 404 for an id that does not exist', async () => {
    const response = await request(app)
      .patch(`${API}/rules/status`)
      .send({ ids: [999], active: false })
      .expect(404);

    expect(response.body.code).toBe('RULE_NOT_FOUND');
  });

  it.each([
    ['active as a string', { ids: [1], active: 'yes' }],
    ['a missing active field', { ids: [1] }],
    ['an empty ids array', { ids: [], active: true }],
  ])('rejects %s', async (_label, body) => {
    const response = await request(app)
      .patch(`${API}/rules/status`)
      .send(body)
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
});


describe('upstream failures reach the client with the right status', () => {
  it.each([
    ['a timeout', 'UPSTREAM_TIMEOUT', 504],
    ['an unreachable broker', 'UPSTREAM_UNAVAILABLE', 503],
  ])('maps %s', async (_label, code, status) => {
    const { AppError } = await import('../../src/domain/common/types');

    publisher
      .willThrow(new AppError(code, 'Upstream problem.', status))
      .willThrow(new AppError(code, 'Upstream problem.', status))
      .willThrow(new AppError(code, 'Upstream problem.', status));

    const response = await request(app)
      .post(`${API}/ips`)
      .send({ values: ['1.1.1.1'], mode: 'blacklist' })
      .expect(status);

    expect(response.body.code).toBe(code);
  }, 20_000);

  it('turns an unexpected error into a 500 without leaking details', async () => {
    publisher.willThrow(new Error('socket hang up'));

    const response = await request(app)
      .post(`${API}/ips`)
      .send({ values: ['1.1.1.1'], mode: 'blacklist' })
      .expect(500);

    expect(response.body).toEqual({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Server error',
    });
  });
});