import { Rule, type RuleType } from '../../src/domain/Rule';
import type { RuleRepository } from '../../src/application/ports/outbound/RuleRepository';
import type {
  Envelope,
  MessagePublisher,
} from '../../src/application/ports/outbound/MessagePublisher';
import type { WorkerRule } from '../../src/application/contracts/workerResponse';



export class FakeRuleRepository implements RuleRepository {
  constructor(private rules: Rule[] = []) {}

  seed(rules: Rule[]): void {
    this.rules = rules;
  }

  async getAll(): Promise<Rule[]> {
    return [...this.rules];
  }

  async findByType(type: RuleType): Promise<Rule[]> {
    return this.rules.filter((rule) => rule.type === type);
  }

  async findByIds(ids: number[]): Promise<Rule[]> {
    return this.rules.filter(
      (rule) => rule.id !== undefined && ids.includes(rule.id)
    );
  }
}

type RpcOutcome =
  | { kind: 'success'; rules: WorkerRule[] }
  | { kind: 'raw'; value: unknown }
  | { kind: 'throw'; error: unknown };

export class FakePublisher implements MessagePublisher {

  public readonly sent: { queue: string; envelope: Envelope }[] = [];

  private outcomes: RpcOutcome[] = [];
  private defaultOutcome: RpcOutcome = { kind: 'success', rules: [] };
  private envelopeCounter = 0;


  willReturnRules(rules: WorkerRule[]): this {
    this.outcomes.push({ kind: 'success', rules });
    return this;
  }

  
  willReturnRaw(value: unknown): this {
    this.outcomes.push({ kind: 'raw', value });
    return this;
  }

 
  willThrow(error: unknown): this {
    this.outcomes.push({ kind: 'throw', error });
    return this;
  }

  
  alwaysReturnRules(rules: WorkerRule[]): this {
    this.defaultOutcome = { kind: 'success', rules };
    return this;
  }

  get callCount(): number {
    return this.sent.length;
  }

  get lastEnvelope(): Envelope | undefined {
    return this.sent.at(-1)?.envelope;
  }

  createEnvelope(eventType: string, payload: unknown): Envelope {
    this.envelopeCounter += 1;
    return {
      messageId: `fake-message-${this.envelopeCounter}`,
      eventType,
      timestamp: '2026-01-01T00:00:00.000Z',
      payload,
    };
  }

  async publishRPC(queue: string, message: Envelope): Promise<unknown> {
    this.sent.push({ queue, envelope: message });

    const outcome = this.outcomes.shift() ?? this.defaultOutcome;

    switch (outcome.kind) {
      case 'throw':
        throw outcome.error;
      case 'raw':
        return outcome.value;
      case 'success':
        return { status: 'success', rules: outcome.rules };
    }
  }
}

export function workerRule(
  overrides: Partial<WorkerRule> & Pick<WorkerRule, 'id'>
): WorkerRule {
  return {
    type: 'ip',
    mode: 'blacklist',
    value: '1.1.1.1',
    active: true,
    ...overrides,
  };
}