export type RuleType = 'ip' | 'domain' | 'port';
export type RuleMode = 'blacklist' | 'whitelist';

export class Rule {
  constructor(
    public id: number,
    public type: RuleType,
    public mode: RuleMode,
    public value: string | number,
    public active: boolean = true // אפשר לתת ערך ברירת מחדל
  ) {}
}