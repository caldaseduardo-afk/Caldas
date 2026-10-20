import { Injectable } from '@nestjs/common';
import { AIProviderError, type AIModelConfig } from '@atendente/domain';
import { decryptTenantCredential } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
export interface AIConfiguration {
  apiKey: string;
  baseURL: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  maxRetryDelayMs: number;
  modelConfig: AIModelConfig;
}
export function readAIConfiguration(
  env: NodeJS.ProcessEnv,
  providedApiKey = env.OPENAI_API_KEY?.trim(),
): AIConfiguration {
  const fail = (): never => {
    throw new AIProviderError('AI_CONFIG_ERROR');
  };
  const integer = (
    name: string,
    min: number,
    max: number,
    fallback?: string,
  ) => {
    const raw = env[name] || fallback;
    const value = Number(raw);
    return raw &&
      /^\d+$/.test(raw) &&
      Number.isSafeInteger(value) &&
      value >= min &&
      value <= max
      ? value
      : fail();
  };
  const apiKey = providedApiKey?.trim();
  const model = env.OPENAI_MODEL?.trim();
  if (!apiKey || !model || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model))
    return fail();
  let url: URL;
  try {
    url = new URL(env.OPENAI_BASE_URL ?? '');
  } catch {
    return fail();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return fail();
  const temperature =
    env.OPENAI_TEMPERATURE === undefined || env.OPENAI_TEMPERATURE === ''
      ? undefined
      : Number(env.OPENAI_TEMPERATURE);
  if (
    temperature !== undefined &&
    (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)
  )
    return fail();
  return {
    apiKey,
    baseURL: url.toString(),
    timeoutMs: integer('OPENAI_TIMEOUT_MS', 1, 120000),
    maxRetries: integer('OPENAI_MAX_RETRIES', 0, 3, '1'),
    retryDelayMs: integer('OPENAI_RETRY_DELAY_MS', 1, 1000, '250'),
    maxRetryDelayMs: integer('OPENAI_MAX_RETRY_DELAY_MS', 1, 10000, '2000'),
    modelConfig: {
      model,
      maxOutputTokens: integer('OPENAI_MAX_OUTPUT_TOKENS', 1, 32768),
      ...(temperature === undefined ? {} : { temperature }),
    },
  };
}
@Injectable()
export class AIConfigResolver {
  constructor(private readonly database: DatabaseService) {}
  async resolve(tenantId: string): Promise<AIConfiguration> {
    const credential =
      await this.database.client.aIProviderCredential.findUnique({
        where: { tenantId },
        select: { ciphertext: true, nonce: true, authTag: true },
      });
    if (!credential) throw new AIProviderError('AI_CONFIG_ERROR');
    try {
      const apiKey = decryptTenantCredential(
        credential,
        tenantId,
        'OPENAI_API_KEY',
      );
      return readAIConfiguration(process.env, apiKey);
    } catch {
      throw new AIProviderError('AI_CONFIG_ERROR');
    }
  }
  modelConfiguration(): AIModelConfig {
    return readAIConfiguration(process.env, 'configuration-only').modelConfig;
  }
  allowedModels(): readonly string[] {
    const current = this.modelConfiguration().model;
    const configured = (process.env.OPENAI_ALLOWED_MODELS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value));
    return [...new Set([current, ...configured])];
  }
}
