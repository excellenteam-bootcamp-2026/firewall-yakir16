export type RuleType = 'ip' | 'domain' | 'port';
export type RuleMode = 'blacklist' | 'whitelist';

export class Rule {
  constructor(
    public id: number | undefined,
    public readonly type: RuleType,
    public readonly mode: RuleMode,
    public readonly value: string | number,
    private _active: boolean
  ) {
    this.validate();
  }

  get active(): boolean {
    return this._active;
  }

  public updateStatus(isActive: boolean): void {
    this._active = isActive;
  }

  private validate(): void {
    if (this.type === 'ip') {
      if (typeof this.value !== 'string') throw new Error('INVALID_IP');
      const parts = this.value.split('.');
      if (parts.length !== 4) throw new Error('INVALID_IP');
      const isValidIPv4 = parts.every(part => {
        const num = Number(part);
        return /^\d+$/.test(part) && num >= 0 && num <= 255;
      });
      if (!isValidIPv4) throw new Error('INVALID_IP');

    } else if (this.type === 'domain') {
      if (typeof this.value !== 'string') throw new Error('INVALID_DOMAIN');
      const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!domainRegex.test(this.value) || this.value.includes('://') || this.value.includes('/')) {
        throw new Error('INVALID_DOMAIN');
      }

    } else if (this.type === 'port') {
      if (!Number.isInteger(this.value) || (this.value as number) < 1 || (this.value as number) > 65535) {
        throw new Error('INVALID_PORT');
      }
    }
  }

  public toJSON() {
    return {
      id: this.id,
      type: this.type,
      mode: this.mode,
      value: this.value,
      active: this._active
    };
  }
}
