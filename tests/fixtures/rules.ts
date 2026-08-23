import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import type { RuleMode, RuleType, RuleValue } from '../../src/domain/Rule';

export type SeededRule = {
  type: RuleType;
  mode: RuleMode;
  value: RuleValue;
  active: boolean;
};

const FIXTURE_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'generated-rules.json'
);

export const seededRules: SeededRule[] = JSON.parse(
  readFileSync(FIXTURE_FILE, 'utf8')
) as SeededRule[];

export function rulesOfType(type: RuleType): SeededRule[] {
  return seededRules.filter((rule) => rule.type === type);
}

export function valuesOfType(type: RuleType): RuleValue[] {
  return rulesOfType(type).map((rule) => rule.value);
}

export function sampleValues(
  type: RuleType,
  count: number,
  offset = 0
): RuleValue[] {
  return valuesOfType(type).slice(offset, offset + count);
}