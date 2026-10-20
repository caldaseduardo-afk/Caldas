import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_PROVIDER,
  AIProviderError,
  type AIModelConfig,
  type AIProvider,
  type AIResponse,
} from '@atendente/domain';
import { AuthorizationService } from '../permissions/authorization.service';
import { AIConfigResolver } from './ai.config';
import { prepareAIInput, type AIInput } from './ai-context';
import { AIUsageRepository, type AIUsageResult } from './ai-usage.repository';
@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly config: AIConfigResolver,
    private readonly usages: AIUsageRepository,
    @Inject(AI_PROVIDER) private readonly provider: AIProvider,
  ) {}
  /** Internal trusted caller only; never bind this signature directly to an HTTP body. */
  async generateResponse(
    input: AIInput,
    options?: {
      modelConfig?: AIModelConfig;
      configurationVersionId?: string | null;
    },
  ): Promise<AIResponse> {
    const scope =
      await this.authorization.requirePermissions('settings.manage');
    const configuration = await this.config.resolve(scope.tenantId);
    const prepared = prepareAIInput(input, [configuration.apiKey]);
    const correlationId = prepared.correlationId ?? randomUUID();
    const modelConfig = {
      ...(options?.modelConfig ?? configuration.modelConfig),
    };
    const finish = await this.usages.begin(
      scope,
      modelConfig.model,
      correlationId,
      options?.configurationVersionId,
    );
    const started = performance.now();
    let response: AIResponse;
    let result: AIUsageResult;
    try {
      response = await this.provider.generateResponse({
        ...prepared,
        modelConfig,
        tenantContext: Object.freeze({ tenantId: scope.tenantId }),
        correlationId,
      });
      result = {
        status: 'SUCCESS',
        usage: response.usage,
        latencyMs: response.latencyMs,
        attempts: response.attempts,
        providerRequestId: response.providerRequestId,
      };
    } catch (raw) {
      const error =
        raw instanceof AIProviderError
          ? raw
          : new AIProviderError('AI_UNKNOWN_ERROR');
      result = {
        status: 'ERROR',
        usage: error.usage,
        latencyMs: Math.round(performance.now() - started),
        attempts: error.attempts,
        errorCode: error.code,
      };
      await this.record(
        finish,
        result,
        scope.tenantId,
        correlationId,
        modelConfig.model,
      );
      throw error;
    }
    await this.record(
      finish,
      result,
      scope.tenantId,
      correlationId,
      modelConfig.model,
    );
    return response;
  }
  private async record(
    finish: (result: AIUsageResult) => Promise<void>,
    result: AIUsageResult,
    tenantId: string,
    correlationId: string,
    model: string,
  ) {
    // Explicit allowlist: never spread request, response, exception or SDK objects into logs.
    this.logger.log({
      tenantId,
      correlationId,
      provider: 'openai',
      model,
      status: result.status,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
      tokens: result.usage,
      errorCode: result.errorCode,
    });
    try {
      await finish(result);
    } catch {
      this.logger.error({
        tenantId,
        correlationId,
        code: 'AI_USAGE_PERSISTENCE_FAILED',
      });
      // Do not retry a completed inference when metrics persistence fails. The PENDING row remains.
    }
  }
  async listUsage() {
    return this.usages.list(
      await this.authorization.requirePermissions('analytics.view'),
    );
  }
}
