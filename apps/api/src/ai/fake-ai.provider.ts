import type { AIProvider, AIRequest, AIResponse } from '@atendente/domain';
/** Explicit test double; never selected by environment or used as a production fallback. */
export class FakeAIProvider implements AIProvider {
  constructor(
    private readonly respond: (
      request: AIRequest,
    ) => Promise<AIResponse> | AIResponse = (request) => ({
      content: 'Resposta simulada.',
      finishReason: 'completed',
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      provider: 'fake',
      model: request.modelConfig.model,
      latencyMs: 0,
      attempts: 1,
    }),
  ) {}
  async generateResponse(request: AIRequest): Promise<AIResponse> {
    return this.respond(request);
  }
}
