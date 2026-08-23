import { readFileSync } from 'fs';
import { describe, expect, it } from '@jest/globals';

function hostOf(envFile: string): string {
  const line = readFileSync(envFile, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('DATABASE_URI='));

  return new URL(line!.slice('DATABASE_URI='.length).trim()).host;
}

describe('environment configuration selects the correct database', () => {
  it('dev and production point at different hosts', () => {
    expect(hostOf('.env.dev')).not.toBe(hostOf('.env.prod'));
  });
});
