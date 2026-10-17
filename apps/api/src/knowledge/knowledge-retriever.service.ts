import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import {
  parseDto,
  searchKnowledgeSchema,
  type SearchKnowledgeDto,
} from './knowledge.dto';
import { sanitizeKnowledgeText } from './knowledge.sanitize';
import type {
  KnowledgeRetriever,
  KnowledgeSearchResponse,
} from './knowledge.types';
interface SearchRow {
  article_id: string;
  version: number;
  title: string;
  category: string;
  content: string;
  score: number;
}
@Injectable()
export class KnowledgeRetrieverService implements KnowledgeRetriever {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async search(raw: SearchKnowledgeDto): Promise<KnowledgeSearchResponse> {
    const input = parseDto(searchKnowledgeSchema, raw);
    const scope = await this.authorization.requirePermissions('knowledge.view');
    if (input.unitId) {
      const unit = await this.database.client.unit.findFirst({
        where: {
          id: input.unitId,
          tenantId: scope.tenantId,
          tenant: authorizedTenantFilter(scope, ['knowledge.view']),
        },
        select: { id: true },
      });
      if (!unit) throw new NotFoundException('Recurso não encontrado.');
    }
    const categoryFilter = input.categories?.length
      ? Prisma.sql`AND v."category"::text IN (${Prisma.join(input.categories.map((v) => Prisma.sql`${v}`))})`
      : Prisma.empty;
    const unitFilter = input.unitId
      ? Prisma.sql`AND (a."unit_id" IS NULL OR a."unit_id" = ${input.unitId}::uuid)`
      : Prisma.empty;
    const rows = await this.database.client.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT a."id" AS article_id, v."version", v."title", v."category"::text AS category, v."content",
        (ts_rank_cd(v."search_vector", websearch_to_tsquery('portuguese', ${input.query})) +
         CASE WHEN v."title" ILIKE ${`%${input.query}%`} THEN 0.5 ELSE 0 END) AS score
      FROM "knowledge_articles" a
      JOIN "knowledge_article_versions" v ON v."tenant_id"=a."tenant_id" AND v."article_id"=a."id"
      WHERE a."tenant_id"=${scope.tenantId}::uuid AND a."status"='PUBLISHED' AND v."status"='PUBLISHED'
        AND (v."valid_from" IS NULL OR v."valid_from" <= CURRENT_TIMESTAMP)
        AND (v."valid_until" IS NULL OR v."valid_until" >= CURRENT_TIMESTAMP)
        AND v."search_vector" @@ websearch_to_tsquery('portuguese', ${input.query})
        ${categoryFilter} ${unitFilter}
      ORDER BY score DESC, v."published_at" DESC, a."id" ASC LIMIT ${input.limit}`);
    let remaining = 4000;
    const results = rows
      .filter((r) => Number(r.score) >= 0.05)
      .flatMap((row) => {
        if (remaining <= 0) return [];
        const excerpt = sanitizeKnowledgeText(
          row.content,
          Math.min(1200, remaining),
        );
        remaining -= excerpt.length;
        return [
          {
            reference: row.article_id,
            version: row.version,
            title: sanitizeKnowledgeText(row.title, 200),
            category: row.category,
            excerpt,
            relevanceScore: Number(Number(row.score).toFixed(6)),
          },
        ];
      });
    return { knowledgeFound: results.length > 0, results };
  }
}
