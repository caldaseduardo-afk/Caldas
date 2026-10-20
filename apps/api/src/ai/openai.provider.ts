import OpenAI from 'openai';
import {
  AIProviderError,
  type AIProvider,
  type AIRequest,
  type AIResponse,
  type AIUsageTokens,
} from '@atendente/domain';
import type { AIConfiguration } from './ai.config';
import { prepareAIInput, UUID } from './ai-context';

function usageOf(value: unknown): AIUsageTokens | null {
  if (value === undefined || value === null) return null;
  const v = value as Record<string, unknown>;
  const values = [v.input_tokens, v.output_tokens, v.total_tokens];
  if (
    values.some(
      (n) =>
        typeof n !== 'number' ||
        !Number.isSafeInteger(n) ||
        n < 0 ||
        n > 2147483647,
    )
  )
    throw new AIProviderError('AI_INVALID_RESPONSE');
  const [inputTokens, outputTokens, totalTokens] = values as number[];
  if (totalTokens !== inputTokens + outputTokens)
    throw new AIProviderError('AI_INVALID_RESPONSE');
  return { inputTokens, outputTokens, totalTokens };
}
function mapError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError)
    return new AIProviderError('AI_TIMEOUT', true);
  if (error instanceof OpenAI.APIConnectionError)
    return new AIProviderError('AI_PROVIDER_UNAVAILABLE', true);
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403)
      return new AIProviderError('AI_AUTH_ERROR');
    if (error.status === 429) {
      const permanent = [
        'insufficient_quota',
        'credit_balance_exhausted',
        'organization_spend_limit_exceeded',
        'project_spend_limit_exceeded',
        'organization_usage_limit_exceeded',
      ];
      return new AIProviderError(
        'AI_RATE_LIMIT',
        !permanent.includes(error.code ?? ''),
      );
    }
    if (error.status === 408) return new AIProviderError('AI_TIMEOUT', true);
    if (error.status && error.status >= 500)
      return new AIProviderError('AI_PROVIDER_UNAVAILABLE', true);
    if (error.status && error.status >= 400)
      return new AIProviderError('AI_BAD_REQUEST');
  }
  return new AIProviderError('AI_UNKNOWN_ERROR');
}
function retryAfter(error: unknown): number | undefined {
  if (!(error instanceof OpenAI.APIError)) return undefined;
  const ms = error.headers?.get('retry-after-ms');
  if (ms && Number.isFinite(Number(ms))) return Math.max(0, Number(ms));
  const raw = error.headers?.get('retry-after');
  if (!raw) return undefined;
  const value = Number(raw);
  if (Number.isFinite(value)) return Math.max(0, value * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** SDK boundary only: no database, business services, tools or transport side effects. */
export class OpenAIProvider implements AIProvider {
  constructor(
    private readonly configuration: (
      tenantId: string,
    ) => AIConfiguration | Promise<AIConfiguration>,
    private readonly fetcher?: typeof fetch,
  ) {}
  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const started = performance.now();
    const config = await this.configuration(request.tenantContext.tenantId);
    if (
      !UUID.test(request.tenantContext.tenantId) ||
      !UUID.test(request.correlationId)
    )
      throw new AIProviderError('AI_BAD_REQUEST');
    // Re-project at the outbound boundary even when invoked without AIService.
    const input = prepareAIInput(
      {
        systemInstructions: request.systemInstructions,
        messages: request.messages,
        correlationId: request.correlationId,
        responseFormat: request.responseFormat,
      },
      [config.apiKey],
    );
    const model = request.modelConfig;
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model.model) ||
      !Number.isInteger(model.maxOutputTokens) ||
      model.maxOutputTokens < 1 ||
      model.maxOutputTokens > 32768 ||
      (model.temperature !== undefined &&
        (!Number.isFinite(model.temperature) ||
          model.temperature < 0 ||
          model.temperature > 2))
    )
      throw new AIProviderError('AI_BAD_REQUEST');
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeoutMs,
      maxRetries: 0,
      logLevel: 'off',
      ...(this.fetcher ? { fetch: this.fetcher } : {}),
    });
    for (let attempt = 1; ; attempt++) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          client.responses.create(
            {
              model: model.model,
              instructions: input.systemInstructions,
              store: false,
              input: input.messages.map((m) => ({
                role: m.role.toLowerCase() as 'system' | 'user' | 'assistant',
                content: m.content,
              })),
              max_output_tokens: model.maxOutputTokens,
              ...(model.temperature === undefined
                ? {}
                : { temperature: model.temperature }),
              ...(input.responseFormat?.type === 'json_schema'
                ? {
                    text: {
                      format: {
                        type: 'json_schema' as const,
                        name: input.responseFormat.name,
                        schema: input.responseFormat.schema,
                        strict: true,
                      },
                    },
                  }
                : {}),
            },
            {
              signal: controller.signal,
              headers: { 'X-Client-Request-Id': request.correlationId },
            },
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new AIProviderError('AI_TIMEOUT', true));
              controller.abort();
            }, config.timeoutMs);
          }),
        ]);
        const usage = usageOf(response.usage);
        if (
          response.status !== 'completed' ||
          response.error ||
          typeof response.output_text !== 'string' ||
          !response.output_text.trim() ||
          response.output.some(
            (o) =>
              o.type === 'message' &&
              o.content.some((c) => c.type === 'refusal'),
          )
        )
          throw new AIProviderError(
            'AI_INVALID_RESPONSE',
            false,
            attempt,
            0,
            usage,
          );
        if (input.responseFormat?.type === 'json_schema') {
          try {
            JSON.parse(response.output_text);
          } catch {
            throw new AIProviderError(
              'AI_INVALID_RESPONSE',
              false,
              attempt,
              0,
              usage,
            );
          }
        }
        const requestId = response._request_id;
        return {
          content: response.output_text,
          finishReason: 'completed',
          usage,
          provider: 'openai',
          model: model.model,
          ...(requestId && /^[a-zA-Z0-9_-]{1,200}$/.test(requestId)
            ? { providerRequestId: requestId }
            : {}),
          latencyMs: Math.round(performance.now() - started),
          attempts: attempt,
        };
      } catch (error) {
        const mapped = mapError(error);
        const delay = Math.max(
          Math.min(
            config.maxRetryDelayMs,
            config.retryDelayMs * 2 ** (attempt - 1),
          ),
          retryAfter(error) ?? 0,
        );
        if (
          !mapped.retryable ||
          attempt > config.maxRetries ||
          delay > config.maxRetryDelayMs
        )
          throw new AIProviderError(
            mapped.code,
            mapped.retryable,
            attempt,
            Math.round(performance.now() - started),
            mapped.usage,
          );
        if (timer) clearTimeout(timer);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }
}
