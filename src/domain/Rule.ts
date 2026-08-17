import { AppError } from './common/types';

export type RuleType = 'ip' | 'domain' | 'port';
export type RuleMode = 'blacklist' | 'whitelist';

export class Rule {
  constructor(
    public readonly id: number | undefined,
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
      if (typeof this.value !== 'string') {
        throw new AppError('INVALID_IP', 'Only valid IPv4 addresses are accepted.');
      }
      const parts = this.value.split('.');
      const isValidIPv4 = parts.length === 4 && parts.every(part => {
        const num = Number(part);
        return /^\d+$/.test(part) && num >= 0 && num <= 255;
      });
      if (!isValidIPv4) {
        throw new AppError('INVALID_IP', 'Only valid IPv4 addresses are accepted.');
      }
    } else if (this.type === 'domain') {
      if (typeof this.value !== 'string') {
        throw new AppError('INVALID_DOMAIN', 'Invalid domain format.');
      }
      const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!domainRegex.test(this.value) || this.value.includes('://') || this.value.includes('/')) {
        throw new AppError('INVALID_DOMAIN', 'Invalid domain format. Must not include protocol, path, or port.');
      }
    } else if (this.type === 'port') {
      if (typeof this.value !== 'number' || !Number.isInteger(this.value) || this.value < 1 || this.value > 65535) {
        throw new AppError('INVALID_PORT', 'Ports must be integers between 1 and 65535.');
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