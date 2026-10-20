import { BadRequestException, Injectable } from '@nestjs/common';
import { AIConfigResolver } from '../ai/ai.config';
import { AIConfigurationRepository } from './ai-configuration.repository';
import {
  cloneSchema,
  compareSchema,
  concurrencySchema,
  createVersionSchema,
  parseAIConfigDto,
  updateVersionSchema,
} from './ai-configuration.dto';
import type { EffectiveAIConfiguration } from './ai-configuration.types';

@Injectable()
export class AIConfigurationService {
  constructor(
    private readonly repository: AIConfigurationRepository,
    private readonly global: AIConfigResolver,
  ) {}
  overview() {
    return this.repository.overview();
  }
  versions() {
    return this.repository.list();
  }
  version(id: string) {
    return this.repository.find(id);
  }
  async create(body: unknown) {
    const dto = parseAIConfigDto(createVersionSchema, body);
    this.validateModel(dto.model);
    return this.repository.create(dto);
  }
  async update(id: string, body: unknown) {
    const dto = parseAIConfigDto(updateVersionSchema, body);
    if (dto.model) this.validateModel(dto.model);
    return this.repository.update(id, dto);
  }
  clone(body: unknown) {
    return this.repository.cloneActive(
      parseAIConfigDto(cloneSchema, body).expectedConfigurationUpdatedAt,
    );
  }
  async publish(id: string, body: unknown) {
    const version = await this.repository.find(id, 'ai_config.publish');
    this.validateModel(version.model);
    return this.repository.publish(
      id,
      parseAIConfigDto(concurrencySchema, body).expectedUpdatedAt,
    );
  }
  async restore(id: string) {
    const version = await this.repository.find(id, 'ai_config.publish');
    this.validateModel(version.model);
    return this.repository.restore(id);
  }
  async compare(body: unknown) {
    const dto = parseAIConfigDto(compareSchema, body);
    const [from, to] = await Promise.all([
      this.repository.find(dto.from),
      this.repository.find(dto.to),
    ]);
    const fields = [
      'assistantName',
      'tone',
      'customTone',
      'greeting',
      'systemInstructions',
      'allowedContent',
      'enabledCapabilities',
      'knowledgeEnabled',
      'handoffPaymentNegotiation',
      'handoffKnowledgeMiss',
      'model',
      'temperature',
      'maxOutputTokens',
      'confidenceThreshold',
    ] as const;
    return {
      from: { id: from.id, version: from.versionNumber },
      to: { id: to.id, version: to.versionNumber },
      changes: fields
        .filter((k) => JSON.stringify(from[k]) !== JSON.stringify(to[k]))
        .map((k) => ({ field: k, from: from[k], to: to[k] })),
    };
  }
  async effective(): Promise<EffectiveAIConfiguration> {
    const row = await this.repository.production();
    const global = this.global.modelConfiguration();
    if (!row)
      return {
        versionId: null,
        versionNumber: null,
        assistantName: 'Assistente virtual',
        tone: 'PROFESSIONAL',
        customTone: null,
        greeting: 'Olá! Como posso ajudar?',
        systemInstructions:
          'Atenda apenas demandas administrativas com dados confirmados.',
        allowedContent: [
          'SCHEDULING',
          'RESCHEDULING',
          'CANCELLATION',
          'CLINIC_INFORMATION',
          'INSURANCE_INFORMATION',
          'PAYMENT_INFORMATION',
          'APPOINTMENT_PREPARATION',
        ],
        enabledCapabilities: [
          'SCHEDULING',
          'RESCHEDULING',
          'CANCELLATION',
          'KNOWLEDGE',
          'HANDOFF',
        ],
        knowledgeEnabled: true,
        handoffPaymentNegotiation: true,
        handoffKnowledgeMiss: true,
        confidenceThreshold: 0.6,
        modelConfig: global,
        fallback: true,
      };
    return {
      versionId: row.id,
      versionNumber: row.versionNumber,
      assistantName: row.assistantName,
      tone: row.tone,
      customTone: row.customTone,
      greeting: row.greeting,
      systemInstructions: row.systemInstructions,
      allowedContent: row.allowedContent,
      enabledCapabilities: row.enabledCapabilities,
      knowledgeEnabled: row.knowledgeEnabled,
      handoffPaymentNegotiation: row.handoffPaymentNegotiation,
      handoffKnowledgeMiss: row.handoffKnowledgeMiss,
      confidenceThreshold: Number(row.confidenceThreshold),
      modelConfig: {
        model: row.model,
        maxOutputTokens: row.maxOutputTokens,
        ...(row.temperature === null
          ? {}
          : { temperature: Number(row.temperature) }),
      },
      fallback: false,
    };
  }
  allowedModels() {
    return this.global.allowedModels();
  }
  private validateModel(model: string) {
    if (!this.global.allowedModels().includes(model))
      throw new BadRequestException('Modelo não permitido pela plataforma.');
  }
}
