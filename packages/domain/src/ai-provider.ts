/** Inference roles, deliberately independent of persisted Message.senderType. */
export type AIRole = 'SYSTEM' | 'USER' | 'ASSISTANT';
export interface AIMessage {
  role: AIRole;
  content: string;
}
export interface AIModelConfig {
  model: string;
  maxOutputTokens: number;
  temperature?: number;
}
export type AIResponseFormat =
  | { type: 'text' }
  | {
      type: 'json_schema';
      name: string;
      schema: Record<string, unknown>;
    };
export interface AIRequest {
  systemInstructions: string;
  messages: readonly AIMessage[];
  modelConfig: AIModelConfig;
  tenantContext: { readonly tenantId: string };
  correlationId: string;
  responseFormat?: AIResponseFormat;
}
export interface AIUsageTokens {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
export interface AIResponse {
  content: string;
  finishReason: 'completed';
  usage: AIUsageTokens | null;
  provider: string;
  model: string;
  providerRequestId?: string;
  latencyMs: number;
  attempts: number;
}
export interface AIProvider {
  generateResponse(request: AIRequest): Promise<AIResponse>;
}
export const AI_PROVIDER = Symbol('AIProvider');
export type AIErrorCode =
  | 'AI_AUTH_ERROR'
  | 'AI_RATE_LIMIT'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_BAD_REQUEST'
  | 'AI_UNKNOWN_ERROR'
  | 'AI_CONFIG_ERROR'
  | 'AI_INVALID_RESPONSE';
export class AIProviderError extends Error {
  readonly safeMessage: string;
  constructor(
    readonly code: AIErrorCode,
    readonly retryable = false,
    readonly attempts = 0,
    readonly latencyMs = 0,
    readonly usage: AIUsageTokens | null = null,
  ) {
    super(code);
    this.name = 'AIProviderError';
    this.safeMessage = code;
  }
  readonly provider = 'openai';
}
