import 'dotenv/config';
import { faker } from '@faker-js/faker';
import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { boolean, jsonb, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Rule, type RuleMode, type RuleType, type RuleValue } from '../src/domain/Rule';

const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../tests/fixtures/generated-rules.json'
);

const PER_TYPE_PER_MODE = 10;
const PROCESSED_MESSAGE_COUNT = 10;

const MODES: readonly RuleMode[] = ['blacklist', 'whitelist'];



const rulesTable = pgTable('firewall_rules', {
  id: serial('id').primaryKey(),
  type: varchar('type', { length: 50 }).notNull(),
  mode: varchar('mode', { length: 50 }).notNull(),
  value: varchar('value', { length: 255 }).notNull(),
  active: boolean('active').default(true).notNull(),
});

const processedMessagesTable = pgTable('processed_messages', {
  messageId: varchar('message_id', { length: 64 }).primaryKey(),
  action: varchar('action', { length: 32 }).notNull(),
  result: jsonb('result').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});



function ipValues(count: number): string[] {
  const edgeCases = [
    '0.0.0.0',           
    '255.255.255.255',  
    '1.1.1.1',           
    '127.0.0.1',        
    '10.0.0.1',          
    '172.16.0.1',       
    '192.168.1.1',      
    '8.8.8.8',           
    '100.64.0.1',        
    '203.0.113.1',       
  ];

  const values = new Set(edgeCases);

  while (values.size < count) {
    values.add(faker.internet.ipv4());
  }

  return [...values].slice(0, count);
}

function portValues(count: number): number[] {
  const edgeCases = [
    1,      
    65535,  
    22,     
    80,     
    443,    
    1024,   
    3000,   
    5432,   
    5671,   
    6543,   
  ];

  const values = new Set(edgeCases);

  while (values.size < count) {
    values.add(faker.number.int({ min: 1, max: 65535 }));
  }

  return [...values].slice(0, count);
}

function domainValues(count: number): string[] {
  const edgeCases = [
    'a.io',                                   
    'my-site.com',                            
    'a.b.c.d.example.com',                    
    '123numeric.example.org',                 
    `${'x'.repeat(63)}.com`,                  
    'example.technology',                     
    'sub.domain-with-hyphens.co.uk',          
    'test123.example.net',                    
    'a1.b2.c3.example.io',                    
    'archive.example.museum',                 
  ];

  const values = new Set(edgeCases);

  while (values.size < count) {
    values.add(faker.internet.domainName());
  }

  return [...values].slice(0, count);
}

type SeedRule = {
  type: RuleType;
  mode: RuleMode;
  value: RuleValue;
  active: boolean;
};

function buildRules(): SeedRule[] {
  const total = PER_TYPE_PER_MODE * MODES.length;

  const byType: Record<RuleType, RuleValue[]> = {
    ip: ipValues(total),
    domain: domainValues(total),
    port: portValues(total),
  };

  const rules: SeedRule[] = [];

  for (const [type, values] of Object.entries(byType) as [RuleType, RuleValue[]][]) {
    values.forEach((value, index) => {
      rules.push({
        type,
        
        mode: MODES[index % MODES.length]!,
        value,
       
        active: index % 3 !== 0,
      });
    });
  }

  return rules;
}

function buildProcessedMessages(rules: SeedRule[]) {
  const actions = ['add', 'delete', 'update_status'];

  return Array.from({ length: PROCESSED_MESSAGE_COUNT }, (_, index) => {
    const sample = rules[index % rules.length]!;

    return {
      messageId: randomUUID(),
      action: actions[index % actions.length]!,
      result: [
        {
          id: index + 1,
          type: sample.type,
          mode: sample.mode,
          value: sample.value,
          active: sample.active,
        },
      ],
      createdAt: faker.date.recent({ days: 7 }),
    };
  });
}



function assertNormalized(rules: SeedRule[]): void {
  for (const rule of rules) {
   
    new Rule(undefined, rule.type, rule.mode, rule.value, rule.active);
  }
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const fixturesOnly = process.argv.includes('--fixtures');

  if (fixturesOnly) {
    const rules = buildRules();
    assertNormalized(rules);

    writeFileSync(FIXTURE_PATH, `${JSON.stringify(rules, null, 2)}\n`, 'utf8');

    console.log(`Wrote ${rules.length} rules to ${FIXTURE_PATH}`);
    console.log('Commit this file. It is generated once, not per test run.');
    return;
  }

  if (process.env.ENV === 'production' && process.env.ALLOW_PRODUCTION !== '1') {
    throw new Error(
      'Refusing to seed a production database. ' +
        'Run with ENV=dev, or set ALLOW_PRODUCTION=1 if you really mean it.'
    );
  }

  const connectionString = process.env.DATABASE_URI;
  if (!connectionString) {
    throw new Error('DATABASE_URI is required.');
  }

  const rules = buildRules();
  assertNormalized(rules);

  const processedMessages = buildProcessedMessages(rules);

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  try {
    if (reset) {
      await db.execute(
        sql`truncate firewall_rules, processed_messages restart identity`
      );
      console.log('Truncated firewall_rules and processed_messages.');
    }

    const inserted = await db
      .insert(rulesTable)
      .values(
        rules.map((rule) => ({
          type: rule.type,
          mode: rule.mode,
          value: String(rule.value),
          active: rule.active,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: rulesTable.id });

    await db
      .insert(processedMessagesTable)
      .values(processedMessages)
      .onConflictDoNothing();

    const counts = rules.reduce<Record<string, number>>((acc, rule) => {
      const key = `${rule.type}/${rule.mode}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`\nGenerated ${rules.length} rules, inserted ${inserted.length}.`);
    for (const [key, count] of Object.entries(counts).sort()) {
      console.log(`  ${key.padEnd(18)} ${count}`);
    }
    console.log(`  processed_messages ${processedMessages.length}`);

    if (inserted.length < rules.length) {
      console.log(
        `\n${rules.length - inserted.length} rows already existed and were skipped. ` +
          'Use --reset for a clean slate.'
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});