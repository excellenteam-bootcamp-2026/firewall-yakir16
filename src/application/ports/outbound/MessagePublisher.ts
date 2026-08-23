export type Envelope = {
  messageId: string;
  eventType: string;
  timestamp: string;
  payload: unknown;
};

export interface MessagePublisher {
  createEnvelope(eventType: string, payload: unknown): Envelope;

  publishRPC(queue: string, message: Envelope): Promise<unknown>;
}
