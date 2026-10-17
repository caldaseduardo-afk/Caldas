export type MessagingType =
  | 'TEXT'
  | 'IMAGE'
  | 'AUDIO'
  | 'DOCUMENT'
  | 'LOCATION'
  | 'CONTACT'
  | 'INTERACTIVE';
export interface InboundMessage {
  phoneNumberId: string;
  accountId: string;
  providerMessageId: string;
  from: string;
  displayName: string;
  messageType: MessagingType;
  content: string;
  metadata?: Record<string, string | number>;
}
export interface DeliveryStatus {
  phoneNumberId: string;
  accountId: string;
  providerMessageId: string;
  recipient: string;
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  at: Date;
  correlationId?: string;
}
export interface SendContext {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  messageId: string;
}
export interface MessagingProvider {
  verifyWebhook(
    mode: unknown,
    token: unknown,
    challenge: unknown,
    expected: string,
  ): string;
  verifySignature(raw: Buffer, signature: unknown, secret: string): boolean;
  parseInboundWebhook(payload: unknown): InboundMessage[];
  parseStatusWebhook(payload: unknown): DeliveryStatus[];
  sendTextMessage(context: SendContext, text: string): Promise<string>;
  sendMediaMessage(
    context: SendContext,
    media: {
      type: 'image' | 'audio' | 'document';
      id: string;
      caption?: string;
    },
  ): Promise<string>;
  sendInteractiveMessage(
    context: SendContext,
    interactive: { text: string; buttons: { id: string; title: string }[] },
  ): Promise<string>;
}
export class MessagingProviderError extends Error {
  readonly provider = 'WHATSAPP_CLOUD';
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly uncertain = false,
  ) {
    super('Falha no transporte de mensagem.');
    this.name = 'MessagingProviderError';
  }
}
