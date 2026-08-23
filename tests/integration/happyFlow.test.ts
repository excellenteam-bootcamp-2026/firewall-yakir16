import { describe, expect, it } from '@jest/globals';


const BASE_URL = process.env.SYSTEM_TEST_URL ?? 'http://localhost:3000';
const API = `${BASE_URL}/api/firewall`;

async function orchestratorIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const live = await orchestratorIsUp();

if (!live) {
  console.warn(
    `System test skipped: nothing is answering at ${BASE_URL}. ` +
      'Start both services with ./env-switch.sh dev to run it.'
  );
}

const describeIfLive = live ? describe : describe.skip;

describeIfLive('system: the happy flow of a firewall rule', () => {
  it(
    'creates a rule, reads it back, deactivates it and removes it',
    async () => {
      const suffix = Math.floor(Math.random() * 250) + 1;
      const address = `10.${suffix}.200.1`;

      const post = async (path: string, method: string, body: unknown) => {
        const response = await fetch(`${API}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      };

      const before = await (await fetch(`${API}/rules`)).json();
      expect(JSON.stringify(before)).not.toContain(address);
      const created = await post('/ips', 'POST', {
        values: [address],
        mode: 'blacklist',
      });

      expect(created.status).toBe(201);
      expect(created.body.status).toBe('success');
      expect(created.body.values).toHaveLength(1);

      const id = created.body.values[0].id;
      expect(typeof id).toBe('number');
      expect(created.body.values[0].value).toBe(address);
      expect(created.body.values[0].active).toBe(true);

      const afterCreate = await (await fetch(`${API}/rules`)).json();
      expect(afterCreate.ips[String(id)]).toEqual({
        id,
        value: address,
        active: true,
      });

      const patched = await post('/rules/status', 'PATCH', {
        ids: [id],
        active: false,
      });

      expect(patched.status).toBe(200);
      expect(patched.body.updated[0].active).toBe(false);

      const afterPatch = await (await fetch(`${API}/rules`)).json();
      expect(afterPatch.ips[String(id)].active).toBe(false);

      const removed = await post('/rules', 'DELETE', { ids: [id] });

      expect(removed.status).toBe(200);
      expect(removed.body.removed[0].id).toBe(id);
      expect(removed.body.removed[0].value).toBe(address);

      const afterDelete = await (await fetch(`${API}/rules`)).json();
      expect(afterDelete.ips[String(id)]).toBeUndefined();
    },
    180_000
  );
});