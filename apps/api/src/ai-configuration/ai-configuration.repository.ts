import { recordAudit } from '@atendente/database';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import type {
  CreateVersionDto,
  UpdateVersionDto,
} from './ai-configuration.dto';
const versionFields = {
  id: true,
  versionNumber: true,
  status: true,
  assistantName: true,
  tone: true,
  customTone: true,
  greeting: true,
  systemInstructions: true,
  allowedContent: true,
  enabledCapabilities: true,
  knowledgeEnabled: true,
  handoffPaymentNegotiation: true,
  handoffKnowledgeMiss: true,
  model: true,
  temperature: true,
  maxOutputTokens: true,
  confidenceThreshold: true,
  basedOnVersionId: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
  publishedBy: { select: { name: true } },
} as const;
@Injectable()
export class AIConfigurationRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  private async serial<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.client.$transaction(fn, {
          isolationLevel: 'Serializable',
        });
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
        if (['P2034', 'P2002'].includes(code) && attempt < 4) continue;
        throw error;
      }
    }
  }
  async overview() {
    const scope = await this.authorization.requirePermissions('settings.view');
    const row = await this.database.client.aIConfiguration.findFirst({
      where: {
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, ['settings.view']),
      },
      select: {
        id: true,
        activeVersionId: true,
        createdAt: true,
        updatedAt: true,
        activeVersion: { select: versionFields },
        versions: {
          where: { status: 'DRAFT' },
          select: versionFields,
          take: 1,
        },
      },
    });
    return (
      row ?? {
        id: null,
        activeVersionId: null,
        activeVersion: null,
        versions: [],
      }
    );
  }
  async list() {
    const scope = await this.authorization.requirePermissions('settings.view');
    const configuration = await this.database.client.aIConfiguration.findFirst({
      where: {
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, ['settings.view']),
      },
      select: {
        versions: { select: versionFields, orderBy: { versionNumber: 'desc' } },
      },
    });
    return configuration?.versions ?? [];
  }
  async find(
    id: string,
    permission:
      | 'settings.view'
      | 'settings.manage'
      | 'ai_config.publish' = 'settings.view',
  ) {
    const scope = await this.authorization.requirePermissions(permission);
    const row = await this.database.client.aIConfigurationVersion.findFirst({
      where: {
        id,
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, [permission]),
      },
      select: versionFields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return row;
  }
  async findForSimulation(id: string) {
    const scope =
      await this.authorization.requirePermissions('settings.manage');
    const row = await this.database.client.aIConfigurationVersion.findFirst({
      where: {
        id,
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, ['settings.manage']),
      },
      select: { ...versionFields, tenant: { select: { timezone: true } } },
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return row;
  }
  async create(dto: CreateVersionDto) {
    const scope =
      await this.authorization.requirePermissions('settings.manage');
    return this.serial(async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: authorizedTenantFilter(scope, ['settings.manage']),
        select: { id: true },
      });
      if (!tenant) throw new NotFoundException('Recurso não encontrado.');
      let config = await tx.aIConfiguration.findUnique({
        where: { tenantId: scope.tenantId },
        include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
      });
      if (
        config &&
        (await tx.aIConfigurationVersion.count({
          where: {
            tenantId: scope.tenantId,
            configurationId: config.id,
            status: 'DRAFT',
          },
        }))
      )
        throw new ConflictException('Já existe um rascunho.');
      if (dto.basedOnVersionId) {
        const base = await tx.aIConfigurationVersion.findFirst({
          where: {
            id: dto.basedOnVersionId,
            tenantId: scope.tenantId,
            configurationId: config?.id,
          },
          select: { id: true },
        });
        if (!base) throw new NotFoundException('Versão base não encontrada.');
      }
      if (!config)
        config = await tx.aIConfiguration.create({
          data: { tenantId: scope.tenantId },
          include: {
            versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
          },
        });
      const row = await tx.aIConfigurationVersion.create({
        data: {
          tenantId: scope.tenantId,
          configurationId: config.id,
          versionNumber: (config.versions[0]?.versionNumber ?? 0) + 1,
          status: 'DRAFT',
          assistantName: dto.assistantName,
          tone: dto.tone,
          customTone: dto.tone === 'CUSTOM' ? dto.customTone : null,
          greeting: dto.greeting,
          systemInstructions: dto.systemInstructions,
          allowedContent: dto.allowedContent,
          enabledCapabilities: [...new Set(dto.enabledCapabilities)],
          knowledgeEnabled: dto.knowledgeEnabled,
          handoffPaymentNegotiation: dto.handoffPaymentNegotiation,
          handoffKnowledgeMiss: dto.handoffKnowledgeMiss,
          model: dto.model,
          temperature: dto.temperature,
          maxOutputTokens: dto.maxOutputTokens,
          confidenceThreshold: dto.confidenceThreshold,
          basedOnVersionId: dto.basedOnVersionId,
          createdByUserId: scope.userId,
          updatedByUserId: scope.userId,
        },
        select: versionFields,
      });
      await recordAudit(tx, {
        data: {
          type: 'AI_CONFIG_VERSION_CREATED',
          tenantId: scope.tenantId,
          userId: scope.userId,
          resourceId: row.id,
          changes: {
            version: row.versionNumber,
            basedOnVersionId: dto.basedOnVersionId ?? null,
          },
        },
      });
      return row;
    });
  }
  async cloneActive(expected: string) {
    const scope =
      await this.authorization.requirePermissions('settings.manage');
    return this.serial(async (tx) => {
      const config = await tx.aIConfiguration.findFirst({
        where: {
          tenantId: scope.tenantId,
          tenant: authorizedTenantFilter(scope, ['settings.manage']),
        },
        include: {
          activeVersion: true,
          versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
        },
      });
      if (!config?.activeVersion)
        throw new NotFoundException('Versão publicada não encontrada.');
      if (config.updatedAt.toISOString() !== expected)
        throw new ConflictException(
          'Configuração foi alterada por outro usuário.',
        );
      if (
        await tx.aIConfigurationVersion.count({
          where: {
            tenantId: scope.tenantId,
            configurationId: config.id,
            status: 'DRAFT',
          },
        })
      )
        throw new ConflictException('Já existe um rascunho.');
      const base = config.activeVersion;
      const row = await tx.aIConfigurationVersion.create({
        data: {
          tenantId: scope.tenantId,
          configurationId: config.id,
          versionNumber: (config.versions[0]?.versionNumber ?? 0) + 1,
          status: 'DRAFT',
          assistantName: base.assistantName,
          tone: base.tone,
          customTone: base.customTone,
          greeting: base.greeting,
          systemInstructions: base.systemInstructions,
          allowedContent: base.allowedContent,
          enabledCapabilities: base.enabledCapabilities,
          knowledgeEnabled: base.knowledgeEnabled,
          handoffPaymentNegotiation: base.handoffPaymentNegotiation,
          handoffKnowledgeMiss: base.handoffKnowledgeMiss,
          model: base.model,
          temperature: base.temperature,
          maxOutputTokens: base.maxOutputTokens,
          confidenceThreshold: base.confidenceThreshold,
          basedOnVersionId: base.id,
          createdByUserId: scope.userId,
          updatedByUserId: scope.userId,
        },
        select: versionFields,
      });
      await tx.aIConfiguration.update({
        where: { id: config.id },
        data: { updatedAt: new Date() },
      });
      await recordAudit(tx, {
        data: {
          type: 'AI_CONFIG_VERSION_CREATED',
          tenantId: scope.tenantId,
          userId: scope.userId,
          resourceId: row.id,
          changes: { version: row.versionNumber, basedOnVersionId: base.id },
        },
      });
      return row;
    });
  }
  async update(id: string, dto: UpdateVersionDto) {
    const scope =
      await this.authorization.requirePermissions('settings.manage');
    return this.serial(async (tx) => {
      const row = await tx.aIConfigurationVersion.findFirst({
        where: {
          id,
          tenantId: scope.tenantId,
          status: 'DRAFT',
          tenant: authorizedTenantFilter(scope, ['settings.manage']),
        },
      });
      if (!row) throw new NotFoundException('Rascunho não encontrado.');
      if (row.updatedAt.toISOString() !== dto.expectedUpdatedAt)
        throw new ConflictException('Rascunho foi alterado por outro usuário.');
      const tone = dto.tone ?? row.tone,
        customTone =
          dto.customTone === undefined ? row.customTone : dto.customTone;
      if ((tone === 'CUSTOM') !== !!customTone)
        throw new ConflictException('Tom customizado inválido.');
      const updated = await tx.aIConfigurationVersion.update({
        where: { id },
        data: {
          assistantName: dto.assistantName,
          tone: dto.tone,
          customTone: tone === 'CUSTOM' ? customTone : null,
          greeting: dto.greeting,
          systemInstructions: dto.systemInstructions,
          allowedContent: dto.allowedContent,
          enabledCapabilities: dto.enabledCapabilities
            ? [...new Set(dto.enabledCapabilities)]
            : undefined,
          knowledgeEnabled: dto.knowledgeEnabled,
          handoffPaymentNegotiation: dto.handoffPaymentNegotiation,
          handoffKnowledgeMiss: dto.handoffKnowledgeMiss,
          model: dto.model,
          temperature: dto.temperature,
          maxOutputTokens: dto.maxOutputTokens,
          confidenceThreshold: dto.confidenceThreshold,
          updatedByUserId: scope.userId,
        },
        select: versionFields,
      });
      await recordAudit(tx, {
        data: {
          type: 'AI_CONFIG_VERSION_UPDATED',
          tenantId: scope.tenantId,
          userId: scope.userId,
          resourceId: id,
          changes: {
            version: row.versionNumber,
            fields: Object.keys(dto).filter((k) => k !== 'expectedUpdatedAt'),
          },
        },
      });
      return updated;
    });
  }
  async publish(id: string, expected: string) {
    const scope =
      await this.authorization.requirePermissions('ai_config.publish');
    return this.serial(async (tx) => {
      const row = await tx.aIConfigurationVersion.findFirst({
        where: {
          id,
          tenantId: scope.tenantId,
          status: 'DRAFT',
          tenant: authorizedTenantFilter(scope, ['ai_config.publish']),
        },
        include: { configuration: true },
      });
      if (!row) throw new NotFoundException('Rascunho não encontrado.');
      if (row.updatedAt.toISOString() !== expected)
        throw new ConflictException('Rascunho foi alterado por outro usuário.');
      await tx.aIConfigurationVersion.updateMany({
        where: {
          tenantId: scope.tenantId,
          configurationId: row.configurationId,
          status: 'PUBLISHED',
        },
        data: { status: 'ARCHIVED', updatedByUserId: scope.userId },
      });
      const published = await tx.aIConfigurationVersion.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          publishedByUserId: scope.userId,
          updatedByUserId: scope.userId,
        },
        select: versionFields,
      });
      await tx.aIConfiguration.update({
        where: { id: row.configurationId },
        data: { activeVersionId: id },
      });
      await recordAudit(tx, {
        data: {
          type: 'AI_CONFIG_PUBLISHED',
          tenantId: scope.tenantId,
          userId: scope.userId,
          resourceId: id,
          changes: {
            version: row.versionNumber,
            previousVersionId: row.configuration.activeVersionId,
          },
        },
      });
      return published;
    });
  }
  async restore(id: string) {
    const scope =
      await this.authorization.requirePermissions('ai_config.publish');
    return this.serial(async (tx) => {
      const base = await tx.aIConfigurationVersion.findFirst({
        where: {
          id,
          tenantId: scope.tenantId,
          status: { in: ['PUBLISHED', 'ARCHIVED'] },
          tenant: authorizedTenantFilter(scope, ['ai_config.publish']),
        },
        include: {
          configuration: {
            include: {
              versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
            },
          },
        },
      });
      if (!base) throw new NotFoundException('Versão não encontrada.');
      if (
        await tx.aIConfigurationVersion.count({
          where: {
            tenantId: scope.tenantId,
            configurationId: base.configurationId,
            status: 'DRAFT',
          },
        })
      )
        throw new ConflictException('Existe um rascunho pendente.');
      await tx.aIConfigurationVersion.updateMany({
        where: {
          tenantId: scope.tenantId,
          configurationId: base.configurationId,
          status: 'PUBLISHED',
        },
        data: { status: 'ARCHIVED', updatedByUserId: scope.userId },
      });
      const version = (base.configuration.versions[0]?.versionNumber ?? 0) + 1;
      const restored = await tx.aIConfigurationVersion.create({
        data: {
          tenantId: scope.tenantId,
          configurationId: base.configurationId,
          versionNumber: version,
          status: 'PUBLISHED',
          assistantName: base.assistantName,
          tone: base.tone,
          customTone: base.customTone,
          greeting: base.greeting,
          systemInstructions: base.systemInstructions,
          allowedContent: base.allowedContent,
          enabledCapabilities: base.enabledCapabilities,
          knowledgeEnabled: base.knowledgeEnabled,
          handoffPaymentNegotiation: base.handoffPaymentNegotiation,
          handoffKnowledgeMiss: base.handoffKnowledgeMiss,
          model: base.model,
          temperature: base.temperature,
          maxOutputTokens: base.maxOutputTokens,
          confidenceThreshold: base.confidenceThreshold,
          basedOnVersionId: base.id,
          createdByUserId: scope.userId,
          updatedByUserId: scope.userId,
          publishedByUserId: scope.userId,
          publishedAt: new Date(),
        },
        select: versionFields,
      });
      await tx.aIConfiguration.update({
        where: { id: base.configurationId },
        data: { activeVersionId: restored.id },
      });
      await recordAudit(tx, {
        data: {
          type: 'AI_CONFIG_RESTORED',
          tenantId: scope.tenantId,
          userId: scope.userId,
          resourceId: restored.id,
          changes: { sourceVersionId: base.id, targetVersion: version },
        },
      });
      return restored;
    });
  }
  async production() {
    const scope = await this.authorization.requirePermissions('settings.view');
    return this.database.client.aIConfiguration
      .findFirst({
        where: {
          tenantId: scope.tenantId,
          tenant: authorizedTenantFilter(scope, ['settings.view']),
        },
        select: { activeVersion: { select: versionFields } },
      })
      .then((v) => v?.activeVersion ?? null);
  }
  async recordSimulation(versionId: string) {
    const scope =
      await this.authorization.requirePermissions('settings.manage');
    await recordAudit(this.database.client, {
      data: {
        type: 'AI_CONFIG_SIMULATED',
        tenantId: scope.tenantId,
        userId: scope.userId,
        resourceId: versionId,
        changes: { mode: 'DRY_RUN' },
      },
    });
  }
}
