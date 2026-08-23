import { AppError } from './common/types';

export type RuleValue = string | number;

export const MAX_VALUE_LENGTH = 255;

const IPV4_OCTET = /^(0|[1-9]\d{0,2})$/;

const DOMAIN_LABEL = '[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?';
const DOMAIN_PATTERN = new RegExp(`^(?:${DOMAIN_LABEL}\\.)+[a-zA-Z]{2,63}$`);


export class IpAddress {
  private constructor(public readonly value: string) {}

  static create(raw: RuleValue): IpAddress {
    const invalid = () => {
      throw new AppError('INVALID_IP', 'Only valid IPv4 addresses are accepted.');
    };

    if (typeof raw !== 'string') {
      invalid();
    }

    const parts = (raw as string).split('.');
    if (parts.length !== 4) {
      invalid();
    }

    const allOctetsValid = parts.every(
      (part) => IPV4_OCTET.test(part) && Number(part) <= 255
    );

    if (!allOctetsValid) {
      invalid();
    }

    return new IpAddress(raw as string);
  }
}

export class DomainName {
  private constructor(public readonly value: string) {}

  static create(raw: RuleValue): DomainName {
    const invalid = (reason: string) => {
      throw new AppError('INVALID_DOMAIN', reason);
    };

    if (typeof raw !== 'string') {
      invalid('Invalid domain format.');
    }

    const value = raw as string;

    if (value.length > MAX_VALUE_LENGTH) {
      invalid(`Domain must be ${MAX_VALUE_LENGTH} characters or fewer.`);
    }

    if (value.includes('://') || value.includes('/') || value.includes(':')) {
      invalid('Invalid domain format. Must not include protocol, path, or port.');
    }

    if (!DOMAIN_PATTERN.test(value)) {
      invalid('Invalid domain format.');
    }

    return new DomainName(value);
  }
}

export class PortNumber {
  private constructor(public readonly value: number) {}

  static create(raw: RuleValue): PortNumber {
    if (
      typeof raw !== 'number' ||
      !Number.isInteger(raw) ||
      raw < 1 ||
      raw > 65535
    ) {
      throw new AppError(
        'INVALID_PORT',
        'Ports must be integers between 1 and 65535.'
      );
    }

    return new PortNumber(raw);
  }
}

export type RuleValueObject = IpAddress | DomainName | PortNumber;
