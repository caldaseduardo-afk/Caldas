import { Inject, Injectable } from '@nestjs/common';
import { KnowledgeRepository } from './knowledge.repository';
import {
  concurrencySchema,
  createArticleSchema,
  listArticlesSchema,
  parseDto,
  searchKnowledgeSchema,
  updateDraftSchema,
} from './knowledge.dto';
import {
  KNOWLEDGE_RETRIEVER,
  type KnowledgeRetriever,
} from './knowledge.types';
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly repository: KnowledgeRepository,
    @Inject(KNOWLEDGE_RETRIEVER) private readonly retriever: KnowledgeRetriever,
  ) {}
  list(query: unknown) {
    return this.repository.list(parseDto(listArticlesSchema, query));
  }
  find(id: string) {
    return this.repository.find(id);
  }
  create(body: unknown) {
    return this.repository.create(parseDto(createArticleSchema, body));
  }
  update(id: string, body: unknown) {
    return this.repository.updateDraft(id, parseDto(updateDraftSchema, body));
  }
  newVersion(id: string, body: unknown) {
    return this.repository.newVersion(
      id,
      parseDto(concurrencySchema, body).expectedUpdatedAt,
    );
  }
  publish(id: string, version: number, body: unknown) {
    return this.repository.publish(
      id,
      version,
      parseDto(concurrencySchema, body).expectedUpdatedAt,
    );
  }
  inactivate(id: string, body: unknown) {
    return this.repository.inactivate(
      id,
      parseDto(concurrencySchema, body).expectedUpdatedAt,
    );
  }
  published(id: string) {
    return this.repository.published(id);
  }
  search(body: unknown) {
    return this.retriever.search(parseDto(searchKnowledgeSchema, body));
  }
}
