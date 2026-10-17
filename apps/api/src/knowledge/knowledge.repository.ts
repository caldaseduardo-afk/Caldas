import { recordAudit } from '@atendente/database';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import type { CreateArticleDto, UpdateDraftDto } from './knowledge.dto';

const versionFields = {
  id: true,
  version: true,
  title: true,
  category: true,
  content: true,
  tags: true,
  sourceType: true,
  validFrom: true,
  validUntil: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
const articleFields = {
  id: true,
  unitId: true,
  slug: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  versions: { select: versionFields, orderBy: { version: 'desc' as const } },
} as const;

@Injectable()
export class KnowledgeRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async list(filter: {
    status?: 'DRAFT' | 'PUBLISHED' | 'INACTIVE';
    category?: string;
    unitId?: string;
    limit: number;
  }) {
    const scope = await this.authorization.requirePermissions('knowledge.view');
    return this.database.client.knowledgeArticle.findMany({
      where: {
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, ['knowledge.view']),
        status: filter.status,
        unitId: filter.unitId,
        ...(filter.category
          ? { versions: { some: { category: filter.category as never } } }
          : {}),
      },
      select: articleFields,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: filter.limit,
    });
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions('knowledge.view');
    const row = await this.database.client.knowledgeArticle.findFirst({
      where: {
        id,
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, ['knowledge.view']),
      },
      select: articleFields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return row;
  }
  async create(dto: CreateArticleDto) {
    const scope =
      await this.authorization.requirePermissions('knowledge.manage');
    return this.database.client.$transaction(
      async (tx) => {
        const tenant = await tx.tenant.findFirst({
          where: authorizedTenantFilter(scope, ['knowledge.manage']),
          select: { id: true },
        });
        if (!tenant) throw new NotFoundException('Recurso não encontrado.');
        if (dto.unitId) {
          const unit = await tx.unit.findFirst({
            where: { id: dto.unitId, tenantId: scope.tenantId },
            select: { id: true },
          });
          if (!unit) throw new NotFoundException('Recurso não encontrado.');
        }
        const row = await tx.knowledgeArticle.create({
          data: {
            tenantId: scope.tenantId,
            unitId: dto.unitId,
            slug: dto.slug,
            status: 'DRAFT',
            createdByUserId: scope.userId,
            updatedByUserId: scope.userId,
            versions: {
              create: {
                version: 1,
                title: dto.title,
                category: dto.category,
                content: dto.content,
                tags: [...new Set(dto.tags)],
                sourceType: dto.sourceType,
                validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
                validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
                createdByUserId: scope.userId,
                updatedByUserId: scope.userId,
              },
            },
          },
          select: articleFields,
        });
        await recordAudit(tx, {
          data: {
            type: 'KNOWLEDGE_ARTICLE_CREATED',
            tenantId: scope.tenantId,
            userId: scope.userId,
            resourceId: row.id,
            changes: { version: 1, category: dto.category },
          },
        });
        return row;
      },
      { isolationLevel: 'Serializable' },
    );
  }
  async updateDraft(id: string, dto: UpdateDraftDto) {
    const scope =
      await this.authorization.requirePermissions('knowledge.manage');
    return this.database.client.$transaction(
      async (tx) => {
        const article = await tx.knowledgeArticle.findFirst({
          where: {
            id,
            tenantId: scope.tenantId,
            tenant: authorizedTenantFilter(scope, ['knowledge.manage']),
          },
          include: { versions: { where: { status: 'DRAFT' }, take: 1 } },
        });
        if (!article || !article.versions[0])
          throw new NotFoundException('Draft não encontrado.');
        if (article.updatedAt.toISOString() !== dto.expectedUpdatedAt)
          throw new ConflictException('Artigo foi alterado por outro usuário.');
        if (dto.unitId) {
          const unit = await tx.unit.findFirst({
            where: { id: dto.unitId, tenantId: scope.tenantId },
            select: { id: true },
          });
          if (!unit) throw new NotFoundException('Recurso não encontrado.');
        }
        const draft = article.versions[0];
        await tx.knowledgeArticle.update({
          where: { id },
          data: {
            unitId: dto.unitId,
            slug: dto.slug,
            updatedByUserId: scope.userId,
          },
        });
        await tx.knowledgeArticleVersion.update({
          where: { id: draft.id },
          data: {
            title: dto.title,
            category: dto.category as never,
            content: dto.content,
            tags: dto.tags ? [...new Set(dto.tags)] : undefined,
            sourceType: dto.sourceType as never,
            validFrom:
              dto.validFrom === undefined
                ? undefined
                : dto.validFrom
                  ? new Date(dto.validFrom)
                  : null,
            validUntil:
              dto.validUntil === undefined
                ? undefined
                : dto.validUntil
                  ? new Date(dto.validUntil)
                  : null,
            updatedByUserId: scope.userId,
          },
        });
        await recordAudit(tx, {
          data: {
            type: 'KNOWLEDGE_ARTICLE_UPDATED',
            tenantId: scope.tenantId,
            userId: scope.userId,
            resourceId: id,
            changes: {
              version: draft.version,
              fields: Object.keys(dto).filter((k) => k !== 'expectedUpdatedAt'),
            },
          },
        });
        return tx.knowledgeArticle.findUniqueOrThrow({
          where: { id },
          select: articleFields,
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }
  async newVersion(id: string, expectedUpdatedAt: string) {
    const scope =
      await this.authorization.requirePermissions('knowledge.manage');
    return this.database.client.$transaction(
      async (tx) => {
        const article = await tx.knowledgeArticle.findFirst({
          where: {
            id,
            tenantId: scope.tenantId,
            tenant: authorizedTenantFilter(scope, ['knowledge.manage']),
          },
          include: { versions: { orderBy: { version: 'desc' } } },
        });
        if (!article) throw new NotFoundException('Recurso não encontrado.');
        if (article.updatedAt.toISOString() !== expectedUpdatedAt)
          throw new ConflictException('Artigo foi alterado por outro usuário.');
        if (article.versions.some((v) => v.status === 'DRAFT'))
          throw new ConflictException('Já existe um draft.');
        const source =
          article.versions.find((v) => v.status === 'PUBLISHED') ??
          article.versions[0];
        if (!source) throw new NotFoundException('Versão não encontrada.');
        await tx.knowledgeArticleVersion.create({
          data: {
            tenantId: scope.tenantId,
            articleId: id,
            version: article.versions[0].version + 1,
            title: source.title,
            category: source.category,
            content: source.content,
            tags: source.tags,
            sourceType: source.sourceType,
            validFrom: source.validFrom,
            validUntil: source.validUntil,
            status: 'DRAFT',
            createdByUserId: scope.userId,
            updatedByUserId: scope.userId,
          },
        });
        await tx.knowledgeArticle.update({
          where: { id },
          data: { updatedByUserId: scope.userId },
        });
        await recordAudit(tx, {
          data: {
            type: 'KNOWLEDGE_ARTICLE_UPDATED',
            tenantId: scope.tenantId,
            userId: scope.userId,
            resourceId: id,
            changes: {
              action: 'NEW_VERSION',
              version: article.versions[0].version + 1,
            },
          },
        });
        return tx.knowledgeArticle.findUniqueOrThrow({
          where: { id },
          select: articleFields,
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }
  async publish(id: string, version: number, expectedUpdatedAt: string) {
    const scope =
      await this.authorization.requirePermissions('knowledge.publish');
    return this.database.client.$transaction(
      async (tx) => {
        const article = await tx.knowledgeArticle.findFirst({
          where: {
            id,
            tenantId: scope.tenantId,
            tenant: authorizedTenantFilter(scope, ['knowledge.publish']),
          },
          include: { versions: true },
        });
        if (!article) throw new NotFoundException('Recurso não encontrado.');
        if (article.updatedAt.toISOString() !== expectedUpdatedAt)
          throw new ConflictException('Artigo foi alterado por outro usuário.');
        const draft = article.versions.find(
          (v) => v.version === version && v.status === 'DRAFT',
        );
        if (!draft) throw new NotFoundException('Draft não encontrado.');
        await tx.knowledgeArticleVersion.updateMany({
          where: {
            tenantId: scope.tenantId,
            articleId: id,
            status: 'PUBLISHED',
          },
          data: { status: 'INACTIVE', updatedByUserId: scope.userId },
        });
        await tx.knowledgeArticleVersion.update({
          where: { id: draft.id },
          data: {
            status: 'PUBLISHED',
            publishedAt: new Date(),
            publishedByUserId: scope.userId,
            updatedByUserId: scope.userId,
          },
        });
        await tx.knowledgeArticle.update({
          where: { id },
          data: { status: 'PUBLISHED', updatedByUserId: scope.userId },
        });
        await recordAudit(tx, {
          data: {
            type: 'KNOWLEDGE_ARTICLE_PUBLISHED',
            tenantId: scope.tenantId,
            userId: scope.userId,
            resourceId: id,
            changes: { version },
          },
        });
        return tx.knowledgeArticle.findUniqueOrThrow({
          where: { id },
          select: articleFields,
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }
  async inactivate(id: string, expectedUpdatedAt: string) {
    const scope =
      await this.authorization.requirePermissions('knowledge.manage');
    return this.database.client.$transaction(
      async (tx) => {
        const article = await tx.knowledgeArticle.findFirst({
          where: {
            id,
            tenantId: scope.tenantId,
            tenant: authorizedTenantFilter(scope, ['knowledge.manage']),
          },
        });
        if (!article) throw new NotFoundException('Recurso não encontrado.');
        if (article.updatedAt.toISOString() !== expectedUpdatedAt)
          throw new ConflictException('Artigo foi alterado por outro usuário.');
        await tx.knowledgeArticle.update({
          where: { id },
          data: { status: 'INACTIVE', updatedByUserId: scope.userId },
        });
        await tx.knowledgeArticleVersion.updateMany({
          where: {
            tenantId: scope.tenantId,
            articleId: id,
            status: { in: ['DRAFT', 'PUBLISHED'] },
          },
          data: { status: 'INACTIVE', updatedByUserId: scope.userId },
        });
        await recordAudit(tx, {
          data: {
            type: 'KNOWLEDGE_ARTICLE_INACTIVATED',
            tenantId: scope.tenantId,
            userId: scope.userId,
            resourceId: id,
            changes: { status: 'INACTIVE' },
          },
        });
        return tx.knowledgeArticle.findUniqueOrThrow({
          where: { id },
          select: articleFields,
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }
  async published(id: string) {
    const row = await this.find(id);
    const version = row.versions.find((v) => v.status === 'PUBLISHED');
    if (!version)
      throw new NotFoundException('Versão publicada não encontrada.');
    return version;
  }
}
