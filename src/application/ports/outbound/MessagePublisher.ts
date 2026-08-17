export interface MessagePublisher {
  createEnvelope(eventType: string, payload: any): object;
  publish(queue: string, message: object): Promise<boolean>;
  publishRPC(queue: string, message: object): Promise<any>; 
}