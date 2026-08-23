import { AppError } from './common/types';
import {
  DomainName,
  IpAddress,
  PortNumber,
  type RuleValue,
  type RuleValueObject,
} from './valueObjects';

export type RuleType = 'ip' | 'domain' | 'port';
export type RuleMode = 'blacklist' | 'whitelist';
export type { RuleValue };

function createRuleValue(type: RuleType, raw: RuleValue): RuleValueObject {
  switch (type) {
    case 'ip':
      return IpAddress.create(raw);
    case 'domain':
      return DomainName.create(raw);
    case 'port':
      return PortNumber.create(raw);
    default:
      throw new AppError(
        'INVALID_RULE_TYPE',
        `Unsupported rule type: '${type}'.`
      );
  }
}

export class Rule {
  private readonly ruleValue: RuleValueObject;

  constructor(
    public readonly id: number | undefined,
    public readonly type: RuleType,
    public readonly mode: RuleMode,
    value: RuleValue,
    private readonly _active: boolean
  ) {
    this.ruleValue = createRuleValue(type, value);
  }

  get value(): RuleValue {
    return this.ruleValue.value;
  }

  get active(): boolean {
    return this._active;
  }

  public toJSON() {
    return {
      id: this.id,
      type: this.type,
      mode: this.mode,
      value: this.value,
      active: this._active,
    };
  }
}
